/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { DataSource } from 'typeorm';

/* USER-TOMBSTONE-V1 (lane fix-S6, 2026-09-24; Reclub E-player.02 "This player is no longer available").
 *
 * Measured (S6 re-check): a LOCAL account deleted by its owner — at once (Misskey i/delete-account) or when its 7-day grace
 * ran out (modules/account/deletion.ts purgeDue) — is HARD-deleted by Misskey's own job (DeleteAccountProcessorService,
 * soft: false → usersRepository.delete), so users/show answered NO_SUCH_USER and the profile read "Player not found."
 *
 * Choice (G11 / G15.0, recorded): Misskey's soft-delete path (soft: true, used for REMOTE users) was checked first and NOT
 * used for local accounts — it keeps the user row, and with it every row the hard delete cascades away: follows (a deleted
 * account would stay in friends / follower counts), club memberships and meet rosters, the verified e-mail (the person
 * could never sign up again with it; G15.15-SSO would re-link an hkpl member to the dead row by that e-mail). So the hard
 * delete stays exactly as Misskey does it, and this keeps ONE fact before it runs: "this id was a local account and was
 * deleted". users/show consults it only when the row is gone. Nothing else about the person is kept (no name, no e-mail).
 */
export async function tombstoneUser(db: DataSource, user: { id: string; username?: string | null }): Promise<void> {
	await db.query(
		`INSERT INTO "gb_user_tombstone" ("userId", "usernameLower", "deletedAt") VALUES ($1, $2, now()) ON CONFLICT ("userId") DO NOTHING`,
		[user.id, user.username ? String(user.username).toLowerCase().slice(0, 128) : null]);
}

/** true when this local user id (or local username) belonged to an account that was deleted. */
export async function isTombstoned(db: DataSource, by: { userId?: string; username?: string }): Promise<boolean> {
	if (by.userId) return ((await db.query('SELECT 1 FROM "gb_user_tombstone" WHERE "userId" = $1 LIMIT 1', [by.userId])) as unknown[]).length > 0;
	if (by.username) return ((await db.query('SELECT 1 FROM "gb_user_tombstone" WHERE "usernameLower" = $1 LIMIT 1', [by.username.toLowerCase()])) as unknown[]).length > 0;
	return false;
}

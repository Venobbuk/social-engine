/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { DataSource } from 'typeorm';
import { generateNativeUserToken } from '@/misc/token.js';

/* ACCOUNT-GRACE-V1 (lane account-rest, 2026-09-24; Reclub E-delete-account.02/.03, E-marked-deletion.01, E-auth-login.06).
 *
 * Reclub: "Delete account" → type DELETE ACCOUNT → "Request received — your account will be deleted within 7 days";
 * signing in inside that window opens "This account is currently marked for deletion · Request reactivation".
 * GripBat deleted at once (adapter/account/delete → DeleteAccountService), so a mistaken tap was unrecoverable.
 *
 * Now a deletion is SCHEDULED:
 *   request  → a gb_account_deletion row (purgeAt = now + 7 days); the account is closed at once: every access_token row
 *              of the user is deleted and the native token regenerated (Misskey's own i/regenerate-token events), so every
 *              device is signed out; it is hidden from player search (isExplorable false, the old value kept for restore).
 *   sign-in  → NOT refused (no sign-in code changes — gripbat-accounts owns sign-in). The app asks deletionOf() and shows
 *              its gate: Restore my account / Sign out.
 *   restore  → the row goes, isExplorable comes back. Only while purgeAt is in the future.
 *   purge    → the minute sweep (MeetSweepProcessorService, a system-queue job — REUSED) calls purgeDue(): Misskey's
 *              DeleteAccountService.deleteAccount (REUSED, core/DeleteAccountService.ts:40), then the host-minted username is
 *              freed exactly as adapter/account/delete did before (the person's next sign-in mints a fresh account).
 * Searched first (G11): Misskey has no deactivation / grace state (User has isSuspended / isDeleted only; isSuspended
 * would refuse the very sign-in that must restore), so the grace row is NEW; everything it does is native.
 */
export const GRACE_DAYS = 7;
const HOST_MINTED = /^[a-z0-9-]+_[0-9a-f]{12}$/;   // adapter/sso usernameFor(): <iss>_<12 hex>

export type DeletionState = { pending: boolean; requestedAt: string | null; purgeAt: string | null };

export async function deletionOf(db: DataSource, userId: string): Promise<DeletionState> {
	const r = (await db.query('SELECT "requestedAt", "purgeAt" FROM "gb_account_deletion" WHERE "userId" = $1', [userId]) as { requestedAt: Date; purgeAt: Date }[])[0];
	return r ? { pending: true, requestedAt: new Date(r.requestedAt).toISOString(), purgeAt: new Date(r.purgeAt).toISOString() } : { pending: false, requestedAt: null, purgeAt: null };
}

/** Schedule (idempotent: a second request keeps the first date) and close the account now. */
export async function scheduleDeletion(db: DataSource, userId: string, how: string, events: { tokenRegenerated: (oldToken: string, newToken: string) => void }): Promise<DeletionState> {
	const u = (await db.query('SELECT "isExplorable", "token" FROM "user" WHERE "id" = $1', [userId]) as { isExplorable: boolean; token: string | null }[])[0];
	if (!u) throw new Error('no such user');
	await db.query(
		`INSERT INTO "gb_account_deletion" ("userId", "requestedAt", "purgeAt", "how", "wasExplorable") VALUES ($1, now(), now() + ($2 || ' days')::interval, $3, $4)
		 ON CONFLICT ("userId") DO NOTHING`, [userId, String(GRACE_DAYS), how.slice(0, 128), u.isExplorable !== false]);
	// signed out everywhere: the per-login SSO credentials (access_token rows) and the native master token
	await db.query('DELETE FROM "access_token" WHERE "userId" = $1', [userId]);
	if (u.token) {
		const fresh = generateNativeUserToken();
		await db.query('UPDATE "user" SET "token" = $2 WHERE "id" = $1', [userId, fresh]);
		events.tokenRegenerated(u.token, fresh);
	}
	await db.query('UPDATE "user" SET "isExplorable" = false WHERE "id" = $1', [userId]);
	return await deletionOf(db, userId);
}

/** Restore inside the grace. false = nothing pending (or already past purgeAt — the sweep owns it then). */
export async function restoreDeletion(db: DataSource, userId: string): Promise<boolean> {
	const rows = await db.query('DELETE FROM "gb_account_deletion" WHERE "userId" = $1 AND "purgeAt" > now() RETURNING "wasExplorable"', [userId]) as { wasExplorable: boolean }[] | [{ wasExplorable: boolean }[], number];
	const list = Array.isArray(rows[0]) ? (rows[0] as { wasExplorable: boolean }[]) : (rows as { wasExplorable: boolean }[]);
	if (!list.length) return false;
	await db.query('UPDATE "user" SET "isExplorable" = $2 WHERE "id" = $1', [userId, list[0].wasExplorable !== false]);
	return true;
}

/** The sweep: purge every account whose grace has run out (a few per minute). Returns how many were purged. */
export async function purgeDue(db: DataSource, purge: (user: { id: string; host: null }) => Promise<void>, limit = 5): Promise<number> {
	const due = await db.query('SELECT d."userId", u."username", u."isDeleted" FROM "gb_account_deletion" d JOIN "user" u ON u.id = d."userId" WHERE d."purgeAt" <= now() ORDER BY d."purgeAt" LIMIT $1', [limit]) as { userId: string; username: string; isDeleted: boolean }[];
	let n = 0;
	for (const d of due) {
		if (!d.isDeleted) {
			await purge({ id: d.userId, host: null });
			if (HOST_MINTED.test(d.username)) {
				// the row stays as a tombstone, so free the deterministic SSO username (adapter/account/delete did this; probes/safety-v1 7b)
				const freed = d.username + '_x' + Date.now().toString(36);
				await db.query('UPDATE "user" SET "username" = $2, "usernameLower" = $3 WHERE "id" = $1', [d.userId, freed, freed.toLowerCase()]);
				await db.query('DELETE FROM "used_username" WHERE "username" = $1', [d.username.toLowerCase()]);
			}
		}
		await db.query('DELETE FROM "gb_account_deletion" WHERE "userId" = $1', [d.userId]);
		n++;
	}
	return n;
}

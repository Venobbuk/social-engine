/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/* CLUB-NAME-RESERVED-V1 (2026-09-23, Reclub triage B-wiz-name.04) — Reclub: "Names containing "Reclub" are reserved for
 * official accounts." GripBat's equivalent: a club (a Misskey channel) may not be named or renamed to anything containing
 * the brand, unless a moderator does it. Searched before writing: Misskey's own reservation is meta.preservedUsernames,
 * which covers USER names only (SignupService); channels/create and channels/update take any name. So this is the one
 * rule both channel doors call — EXTEND of the native doors, no table, no setting. */
const RESERVED = [/grip\s*bat/i];

export function isReservedClubName(name: string | null | undefined): boolean {
	const n = String(name ?? '').normalize('NFKC');
	return RESERVED.some((r) => r.test(n));
}

export const reservedClubNameError = {
	message: 'Names containing "GripBat" are reserved for official accounts.',
	code: 'CLUB_NAME_RESERVED',
	id: 'b3c0d7a2-6e1f-4f0a-9c3d-7a5e2f1c0b01',
} as const;

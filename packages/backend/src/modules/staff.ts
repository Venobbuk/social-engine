/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { DataSource } from 'typeorm';

/* STAFF-ROLE-V1 (batch-1 review fix): "GripBat staff" is a PLAIN engine role (isModerator false, no admin/moderator
 * power anywhere in Misskey). adapter/sso keeps its assignment in step with the host (hkpl SUPER_ADMIN, or TENANT_ADMIN of
 * a tenant in ADAPTER_SSO_STAFF_TENANTS). The only doors it opens are the ones that ask for it by id here:
 * clubs/claims/list, clubs/claims/decide (ClubService.claimsList / claimsDecide) and venues/staff-update. Staff also
 * receive the "Club ownership claim" notification. Nothing else in the engine treats them differently from a member. */
export const STAFF_ROLE_ID = 'arc5w1aagbstaff1';

export const notStaffError = {
	message: 'Only GripBat staff can do this.',
	code: 'NOT_GRIPBAT_STAFF',
	id: 'a7c5f1a0-6b1e-4c1d-9e2f-5a7ff0000001',
	kind: 'permission',
	httpStatusCode: 403,
} as const;

/** Holds the GripBat staff role right now (an expired assignment does not count). */
export async function isGripbatStaff(db: DataSource, userId: string): Promise<boolean> {
	const rows = await db.query(`SELECT 1 FROM "role_assignment" WHERE "roleId" = $1 AND "userId" = $2 AND ("expiresAt" IS NULL OR "expiresAt" > now()) LIMIT 1`, [STAFF_ROLE_ID, userId]) as unknown[];
	return rows.length > 0;
}

/** Everyone who holds the GripBat staff role right now. */
export async function gripbatStaffIds(db: DataSource): Promise<string[]> {
	const rows = await db.query(`SELECT "userId" FROM "role_assignment" WHERE "roleId" = $1 AND ("expiresAt" IS NULL OR "expiresAt" > now())`, [STAFF_ROLE_ID]) as { userId: string }[];
	return rows.map(r => r.userId);
}

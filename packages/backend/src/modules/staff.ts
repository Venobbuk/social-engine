/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { DataSource } from 'typeorm';

/* STAFF-ROLE-V1 → STAFF-ADMIN-V1 (2026-09-25, operator: "Yes, full moderator + administrator"): "GripBat staff" is a FULL
 * moderator + administrator engine role (isModerator AND isAdministrator true — adapter/sso ensureStaffRole creates it so and
 * promotes an older plain row). It therefore opens every Misskey moderator/admin door, PLUS the id-checked doors that ask for
 * it here (isGripbatStaff / NOT_GRIPBAT_STAFF): clubs/claims/list|decide, coaches/applications/list|decide,
 * venues/staff-update, the venue staff checks in VenueExtras, gb/maintenance, and the gb/account/me staff flag. adapter/sso keeps the assignment in step with the host at every SSO sign-in (hkpl
 * SUPER_ADMIN, or TENANT_ADMIN of a tenant in ADAPTER_SSO_STAFF_TENANTS). Staff also receive the "Club ownership claim"
 * notification. (The batch-1 "plain role, no moderator power" rule was superseded by STAFF-ADMIN-V1.) */
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

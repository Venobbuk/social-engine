/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/*
 * COACH-VERIFY-V1 (2026-09-20, NUKE-REVIEW-FIXES-V1 — review finding 3). Additive, idempotent.
 *
 * NUKE-COACH-V1 made "is a coach" the native role arc5w1aagbcoach1, which is right — but the only door that grants a
 * role is admin/roles/assign (requireModerator:true), and the GripBat staff role is deliberately PLAIN
 * (modules/staff.ts:8-13, isModerator false). So the shipped copy "GripBat staff verify coaches. Fill in your details
 * and they will review them." was unfulfillable: staff had no door, and every applicant sat "Waiting to be verified"
 * for ever.
 *
 * coach_claim is the APPLICATION, exactly like club_claim: a request that GripBat staff decide. The verdict is still
 * written to the NATIVE role_assignment through RoleService.assign / unassign (G11 — roles are not rebuilt here); this
 * table only records that an application was made and what staff answered, which the role alone cannot say (a role
 * assignment cannot express "declined", and without it a declined applicant is indistinguishable from a new one and
 * would sit in the queue for ever).
 *
 * No rows exist anywhere before this migration — the table is new. down() drops it; the role assignments it produced
 * are native rows and are NOT touched by down(), so a rollback keeps every verified coach verified.
 */
export class CoachVerifyV11789097100005 {
	name = 'CoachVerifyV11789097100005';

	async up(queryRunner) {
		await queryRunner.query(`CREATE TABLE IF NOT EXISTS "coach_claim" (
			"id" varchar(32) NOT NULL, "userId" varchar(32) NOT NULL,
			"status" varchar(16) NOT NULL DEFAULT 'pending', "createdAt" timestamptz NOT NULL DEFAULT now(),
			"decidedAt" timestamptz, "decidedById" varchar(32), CONSTRAINT "PK_coach_claim" PRIMARY KEY ("id"))`);
		await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_coach_claim_one_pending" ON "coach_claim" ("userId") WHERE "status" = 'pending'`);
		await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_coach_claim_status" ON "coach_claim" ("status", "createdAt")`);

		// anyone who already holds the role was verified before this queue existed: record it, so the staff list and the
		// player's own screen agree with the role from the first request instead of showing them as never having applied.
		await queryRunner.query(`
			INSERT INTO "coach_claim" ("id", "userId", "status", "createdAt", "decidedAt")
			SELECT a."id", a."userId", 'approved', now(), now() FROM "role_assignment" a
			WHERE a."roleId" = 'arc5w1aagbcoach1'
			ON CONFLICT ("id") DO NOTHING`);
	}

	async down(queryRunner) {
		await queryRunner.query(`DROP TABLE IF EXISTS "coach_claim"`);
	}
}

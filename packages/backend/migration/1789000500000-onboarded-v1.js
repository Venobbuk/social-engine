/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/* ONBOARDED-V1 (2026-09-17). A per-user, per-sport "finished onboarding" stamp on the meet player level record,
 * exposed through meets/level. Additive, idempotent. */
export class OnboardedV11789000500000 {
	name = 'OnboardedV11789000500000';

	async up(queryRunner) {
		await queryRunner.query(`ALTER TABLE "meet_player_level" ADD COLUMN IF NOT EXISTS "onboardedAt" timestamp with time zone`);
	}

	async down(queryRunner) {
		await queryRunner.query(`ALTER TABLE "meet_player_level" DROP COLUMN IF EXISTS "onboardedAt"`);
	}
}

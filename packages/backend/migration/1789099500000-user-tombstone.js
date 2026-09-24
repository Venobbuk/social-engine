/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// USER-TOMBSTONE-V1 (lane fix-S6, 2026-09-24)
//  gb_user_tombstone — one row per LOCAL account Misskey hard-deleted (modules/account/tombstone.ts), so users/show can say
//  "no longer available" instead of "no such user". Holds the id, the lower-cased username and the time only.
// Additive and idempotent (IF NOT EXISTS); down drops exactly what up added.
export class UserTombstone1789099500000 {
	name = 'UserTombstone1789099500000';

	async up(queryRunner) {
		await queryRunner.query(`CREATE TABLE IF NOT EXISTS "gb_user_tombstone" ("userId" character varying(32) NOT NULL, "usernameLower" character varying(128), "deletedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_gb_user_tombstone" PRIMARY KEY ("userId"))`);
		await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_gb_user_tombstone_usernameLower" ON "gb_user_tombstone" ("usernameLower")`);
	}

	async down(queryRunner) {
		await queryRunner.query(`DROP INDEX IF EXISTS "IDX_gb_user_tombstone_usernameLower"`);
		await queryRunner.query(`DROP TABLE IF EXISTS "gb_user_tombstone"`);
	}
}

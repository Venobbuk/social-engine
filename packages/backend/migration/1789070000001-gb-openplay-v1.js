/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/*
 * GB-OPENPLAY-V1 (2026-09-19). Additive, idempotent. gb_openplay_game: played open-play games pulled from hkpl
 * (GET /api/v1/social/openplay/played) so they count toward the GripBat rating (modules/stats/GbRating.ts).
 */
export class GbOpenplayV11789070000001 {
	name = 'GbOpenplayV11789070000001';

	async up(queryRunner) {
		await queryRunner.query(`CREATE TABLE IF NOT EXISTS "gb_openplay_game" (
			"id" varchar(40) NOT NULL, "playedAt" timestamptz NOT NULL, "format" varchar(16) NOT NULL DEFAULT 'doubles',
			"refs" varchar(64)[] NOT NULL DEFAULT '{}', "scoreA" integer NOT NULL, "scoreB" integer NOT NULL,
			"importedAt" timestamptz NOT NULL DEFAULT now(), CONSTRAINT "PK_gb_openplay_game" PRIMARY KEY ("id"))`);
		await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_gb_openplay_game_played" ON "gb_openplay_game" ("playedAt")`);
	}

	async down(queryRunner) {
		await queryRunner.query(`DROP TABLE IF EXISTS "gb_openplay_game"`);
	}
}

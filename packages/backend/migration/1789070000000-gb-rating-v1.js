/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/*
 * GB-RATING-V1 (2026-09-19). Additive, idempotent. GripBat's own rating from GripBat's own matches (modules/stats/GbRating.ts).
 *   gb_player_rating  one row per (user, sport): the current GripBat rating and how many rated matches it rests on.
 *   gb_rating_log     one row per (source, match, player): pre/post rating, team + opponent average, expected win,
 *                     result, games from the player's side, partner, opponents. A skipped match (guest, bye, draw)
 *                     has one row with userId '-' and skipped = true so it is not read again.
 */
export class GbRatingV11789070000000 {
	name = 'GbRatingV11789070000000';

	async up(queryRunner) {
		await queryRunner.query(`CREATE TABLE IF NOT EXISTS "gb_player_rating" (
			"userId" varchar(32) NOT NULL, "sport" varchar(32) NOT NULL DEFAULT 'pickleball',
			"rating" numeric(5,3) NOT NULL, "matches" integer NOT NULL DEFAULT 0, "updatedAt" timestamptz NOT NULL DEFAULT now(),
			CONSTRAINT "PK_gb_player_rating" PRIMARY KEY ("userId", "sport"))`);
		await queryRunner.query(`CREATE TABLE IF NOT EXISTS "gb_rating_log" (
			"source" varchar(16) NOT NULL, "matchId" varchar(32) NOT NULL, "userId" varchar(32) NOT NULL,
			"sport" varchar(32) NOT NULL DEFAULT 'pickleball', "skipped" boolean NOT NULL DEFAULT false,
			"side" smallint, "partnerId" varchar(32), "opponentIds" varchar(32)[] NOT NULL DEFAULT '{}',
			"pre" numeric(5,3), "post" numeric(5,3), "teamRating" numeric(5,3), "oppRating" numeric(5,3), "expected" numeric(6,5),
			"won" boolean, "games" jsonb NOT NULL DEFAULT '[]', "playedAt" timestamptz, "createdAt" timestamptz NOT NULL DEFAULT now(),
			CONSTRAINT "PK_gb_rating_log" PRIMARY KEY ("source", "matchId", "userId"))`);
		await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_gb_rating_log_user" ON "gb_rating_log" ("userId", "sport", "playedAt")`);
		await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_gb_rating_log_match" ON "gb_rating_log" ("source", "matchId")`);
	}

	async down(queryRunner) {
		await queryRunner.query(`DROP TABLE IF EXISTS "gb_rating_log"`);
		await queryRunner.query(`DROP TABLE IF EXISTS "gb_player_rating"`);
	}
}

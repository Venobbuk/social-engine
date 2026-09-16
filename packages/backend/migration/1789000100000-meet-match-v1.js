/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/*
 * MEET-MATCH-V1 (2026-09-16). Reclub's Matches pane (spec_meets.md §4). The switch "Matches will be submitted"
 * already exists as meet.submitMatches; the account gate as meet.duprAccountGate. This adds only the matches.
 *   meet_match        — one row per match: round, court, two teams of participant ids, score sets, DUPR badge.
 * Additive and idempotent. DUPR submission itself is hkpl's (SOCIAL-DUPR-V1); the engine keeps only the receipt.
 */
export class MeetMatchV11789000100000 {
	name = 'MeetMatchV11789000100000';

	async up(queryRunner) {
		await queryRunner.query(`CREATE TABLE IF NOT EXISTS "meet_match" (
			"id" character varying(32) NOT NULL,
			"meetId" character varying(32) NOT NULL,
			"round" integer,
			"courtIndex" integer,
			"team1Ids" character varying(32) array NOT NULL DEFAULT '{}',
			"team2Ids" character varying(32) array NOT NULL DEFAULT '{}',
			"scores" jsonb NOT NULL DEFAULT '[]',
			"createdById" character varying(32),
			"duprStatus" character varying(16),
			"duprSubmittedById" character varying(32),
			"duprSubmittedAt" timestamp with time zone,
			"duprRef" character varying(128),
			"duprError" character varying(512),
			"updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
			CONSTRAINT "PK_meet_match" PRIMARY KEY ("id")
		)`);
		await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_meet_match_meetId" ON "meet_match" ("meetId")`);
		await queryRunner.query(`ALTER TABLE "meet_match" DROP CONSTRAINT IF EXISTS "FK_meet_match_meet"`);
		await queryRunner.query(`ALTER TABLE "meet_match" ADD CONSTRAINT "FK_meet_match_meet" FOREIGN KEY ("meetId") REFERENCES "meet"("id") ON DELETE CASCADE`);
	}

	async down(queryRunner) {
		await queryRunner.query(`DROP TABLE IF EXISTS "meet_match"`);
	}
}

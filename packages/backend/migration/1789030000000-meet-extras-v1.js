/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/*
 * MEET-EXTRAS-V1 (2026-09-19). The Reclub meet functions PARITY.md rows 3/16/18/33/43/49/73/88 still lacked:
 *   meet.externalUrl / contactInfo        — a LISTING (type 'listing') is information only: details + a link/contact
 *   meet.promotedAt / promotedReach       — "Get more players → Promote meet", once per meet
 *   meet.scoringType … tbLossPoints       — SET vs GAME scoring, standings mode, tiebreaker order, forfeit/draw values
 *   meet.reminded24At / reminded2At       — the reminder job's receipts (24 h and 2 h before start)
 *   meet_match.forfeitTeam                — the side that forfeited (1 | 2)
 *   meet_media                            — the meet Photos pane: drive files attached to a meet
 * Additive and idempotent.
 */
export class MeetExtrasV11789030000000 {
	name = 'MeetExtrasV11789030000000';

	async up(queryRunner) {
		await queryRunner.query(`ALTER TABLE "meet" ADD COLUMN IF NOT EXISTS "externalUrl" character varying(512)`);
		await queryRunner.query(`ALTER TABLE "meet" ADD COLUMN IF NOT EXISTS "contactInfo" character varying(256)`);
		await queryRunner.query(`ALTER TABLE "meet" ADD COLUMN IF NOT EXISTS "promotedAt" timestamp with time zone`);
		await queryRunner.query(`ALTER TABLE "meet" ADD COLUMN IF NOT EXISTS "promotedReach" integer NOT NULL DEFAULT 0`);
		await queryRunner.query(`ALTER TABLE "meet" ADD COLUMN IF NOT EXISTS "scoringType" character varying(8) NOT NULL DEFAULT 'GAME'`);
		await queryRunner.query(`ALTER TABLE "meet" ADD COLUMN IF NOT EXISTS "standingsMode" character varying(16) NOT NULL DEFAULT 'winLoss'`);
		await queryRunner.query(`ALTER TABLE "meet" ADD COLUMN IF NOT EXISTS "tiebreakers" character varying(16) array NOT NULL DEFAULT '{h2h_wins,score_diff,total_score}'`);
		await queryRunner.query(`ALTER TABLE "meet" ADD COLUMN IF NOT EXISTS "forfeitScore" integer NOT NULL DEFAULT 11`);
		await queryRunner.query(`ALTER TABLE "meet" ADD COLUMN IF NOT EXISTS "winPoints" integer NOT NULL DEFAULT 1`);
		await queryRunner.query(`ALTER TABLE "meet" ADD COLUMN IF NOT EXISTS "lossPoints" integer NOT NULL DEFAULT 0`);
		await queryRunner.query(`ALTER TABLE "meet" ADD COLUMN IF NOT EXISTS "drawPoints" integer NOT NULL DEFAULT 0`);
		await queryRunner.query(`ALTER TABLE "meet" ADD COLUMN IF NOT EXISTS "tbWinPoints" integer NOT NULL DEFAULT 1`);
		await queryRunner.query(`ALTER TABLE "meet" ADD COLUMN IF NOT EXISTS "tbLossPoints" integer NOT NULL DEFAULT 0`);
		await queryRunner.query(`ALTER TABLE "meet" ADD COLUMN IF NOT EXISTS "reminded24At" timestamp with time zone`);
		await queryRunner.query(`ALTER TABLE "meet" ADD COLUMN IF NOT EXISTS "reminded2At" timestamp with time zone`);
		await queryRunner.query(`ALTER TABLE "meet_match" ADD COLUMN IF NOT EXISTS "forfeitTeam" integer`);
		await queryRunner.query(`CREATE TABLE IF NOT EXISTS "meet_media" (
			"id" character varying(32) NOT NULL,
			"meetId" character varying(32) NOT NULL,
			"userId" character varying(32) NOT NULL,
			"fileId" character varying(32) NOT NULL,
			"createdAt" timestamp with time zone NOT NULL DEFAULT now(),
			CONSTRAINT "PK_meet_media" PRIMARY KEY ("id")
		)`);
		await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_meet_media_meetId" ON "meet_media" ("meetId")`);
		await queryRunner.query(`ALTER TABLE "meet_media" DROP CONSTRAINT IF EXISTS "FK_meet_media_meet"`);
		await queryRunner.query(`ALTER TABLE "meet_media" ADD CONSTRAINT "FK_meet_media_meet" FOREIGN KEY ("meetId") REFERENCES "meet"("id") ON DELETE CASCADE`);
		await queryRunner.query(`ALTER TABLE "meet_media" DROP CONSTRAINT IF EXISTS "FK_meet_media_file"`);
		await queryRunner.query(`ALTER TABLE "meet_media" ADD CONSTRAINT "FK_meet_media_file" FOREIGN KEY ("fileId") REFERENCES "drive_file"("id") ON DELETE CASCADE`);
	}

	async down(queryRunner) {
		await queryRunner.query(`DROP TABLE IF EXISTS "meet_media"`);
		await queryRunner.query(`ALTER TABLE "meet_match" DROP COLUMN IF EXISTS "forfeitTeam"`);
		for (const c of ['externalUrl', 'contactInfo', 'promotedAt', 'promotedReach', 'scoringType', 'standingsMode', 'tiebreakers', 'forfeitScore', 'winPoints', 'lossPoints', 'drawPoints', 'tbWinPoints', 'tbLossPoints', 'reminded24At', 'reminded2At']) {
			await queryRunner.query(`ALTER TABLE "meet" DROP COLUMN IF EXISTS "${c}"`);
		}
	}
}

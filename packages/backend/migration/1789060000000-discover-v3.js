/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/*
 * DISCOVER-V3 (2026-09-19). Additive, idempotent.
 *   venue_feedback        — Reclub's venue feedback form (help:venue_* keys: wrong_details / permanently_closed /
 *                           safety_concern / incorrect_images / suspicious_fraudulent / other) and the owner claim
 *                           (category owner_claim — Reclub's "Want a Verified Badge? Contact our Support team"): a row
 *                           per submission, status open|resolved, replyRequested. Staff read it; the venue-owner
 *                           assignment itself stays venues/staff-update.
 *   meet_player_level     — Reclub's Coach model (module 2008: experience, rate, notes, status Active|Inactive), one
 *                           profile per (user, sport) — exactly the grain of this table, so the columns live here.
 */
export class DiscoverV31789060000000 {
	name = 'DiscoverV31789060000000';

	async up(queryRunner) {
		await queryRunner.query(`CREATE TABLE IF NOT EXISTS "venue_feedback" (
			"id" character varying(32) NOT NULL,
			"venueId" character varying(32) NOT NULL,
			"userId" character varying(32) NOT NULL,
			"category" character varying(32) NOT NULL,
			"body" character varying(2048),
			"replyRequested" boolean NOT NULL DEFAULT false,
			"status" character varying(16) NOT NULL DEFAULT 'open',
			"createdAt" timestamp with time zone NOT NULL DEFAULT now(),
			CONSTRAINT "PK_venue_feedback" PRIMARY KEY ("id")
		)`);
		await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_venue_feedback_venue" ON "venue_feedback" ("venueId")`);
		await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_venue_feedback_user" ON "venue_feedback" ("userId")`);
		await queryRunner.query(`ALTER TABLE "meet_player_level" ADD COLUMN IF NOT EXISTS "coachStatus" character varying(16)`);
		await queryRunner.query(`ALTER TABLE "meet_player_level" ADD COLUMN IF NOT EXISTS "coachExperience" character varying(2048)`);
		await queryRunner.query(`ALTER TABLE "meet_player_level" ADD COLUMN IF NOT EXISTS "coachRate" character varying(256)`);
		await queryRunner.query(`ALTER TABLE "meet_player_level" ADD COLUMN IF NOT EXISTS "coachNotes" character varying(2048)`);
		await queryRunner.query(`ALTER TABLE "meet_player_level" ADD COLUMN IF NOT EXISTS "coachUpdatedAt" timestamp with time zone`);
	}

	async down(queryRunner) {
		await queryRunner.query(`ALTER TABLE "meet_player_level" DROP COLUMN IF EXISTS "coachUpdatedAt"`);
		await queryRunner.query(`ALTER TABLE "meet_player_level" DROP COLUMN IF EXISTS "coachNotes"`);
		await queryRunner.query(`ALTER TABLE "meet_player_level" DROP COLUMN IF EXISTS "coachRate"`);
		await queryRunner.query(`ALTER TABLE "meet_player_level" DROP COLUMN IF EXISTS "coachExperience"`);
		await queryRunner.query(`ALTER TABLE "meet_player_level" DROP COLUMN IF EXISTS "coachStatus"`);
		await queryRunner.query(`DROP TABLE IF EXISTS "venue_feedback"`);
	}
}

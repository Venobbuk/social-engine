/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/*
 * CLUB-V3 (2026-09-19). Reclub's club parity rows (PARITY.md 104 / 106 / 109 / 113 / 115 / 117 / 118, schedule row 40):
 *   club_setting      + refCode (six-char club code, Reclub "ID: <refCode>"), accessToken (the ?at= invite token of a
 *                       private club), tags (GroupTag list: id, name, visibility, order, members {userId: expiresAt}),
 *                       awards (the club's showcase: [{title, event, date, placement}])
 *   club_member_state  per-member club state: pinnedAt (Pin to home), pausedAt (Take a break), adminRoomId (the
 *                       "Message admins" thread)
 *   club_schedule      Reclub's recurring schedule: weekday + time + venue + capacity + fee + level gate + publish lead
 *                       time; a system job materialises the next meet publishLeadHours ahead (meet.seriesId = schedule id)
 * Additive, idempotent.
 */
export class ClubV31789050000000 {
	name = 'ClubV31789050000000';

	async up(queryRunner) {
		await queryRunner.query(`ALTER TABLE "club_setting" ADD COLUMN IF NOT EXISTS "refCode" character varying(8)`);
		await queryRunner.query(`ALTER TABLE "club_setting" ADD COLUMN IF NOT EXISTS "accessToken" character varying(32)`);
		await queryRunner.query(`ALTER TABLE "club_setting" ADD COLUMN IF NOT EXISTS "tags" jsonb NOT NULL DEFAULT '[]'`);
		await queryRunner.query(`ALTER TABLE "club_setting" ADD COLUMN IF NOT EXISTS "awards" jsonb NOT NULL DEFAULT '[]'`);
		await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_club_setting_refCode" ON "club_setting" ("refCode")`);

		await queryRunner.query(`CREATE TABLE IF NOT EXISTS "club_member_state" (
			"id" character varying(32) NOT NULL,
			"channelId" character varying(32) NOT NULL,
			"userId" character varying(32) NOT NULL,
			"pinnedAt" timestamp with time zone,
			"pausedAt" timestamp with time zone,
			"adminRoomId" character varying(32),
			"updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
			CONSTRAINT "PK_club_member_state" PRIMARY KEY ("id"),
			CONSTRAINT "FK_club_member_state_channel" FOREIGN KEY ("channelId") REFERENCES "channel"("id") ON DELETE CASCADE,
			CONSTRAINT "FK_club_member_state_user" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE
		)`);
		await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_club_member_state_channel_user" ON "club_member_state" ("channelId", "userId")`);
		await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_club_member_state_user" ON "club_member_state" ("userId")`);

		await queryRunner.query(`CREATE TABLE IF NOT EXISTS "club_schedule" (
			"id" character varying(32) NOT NULL,
			"channelId" character varying(32) NOT NULL,
			"hostId" character varying(32) NOT NULL,
			"name" character varying(128) NOT NULL,
			"weekday" integer NOT NULL,
			"startTime" character varying(5) NOT NULL,
			"durationMinutes" integer NOT NULL DEFAULT 120,
			"timezone" character varying(64) NOT NULL DEFAULT 'Asia/Hong_Kong',
			"venueId" character varying(32),
			"venueName" character varying(256),
			"venueAddress" character varying(512),
			"lat" double precision,
			"lng" double precision,
			"capacity" integer NOT NULL DEFAULT 8,
			"hostPlays" boolean NOT NULL DEFAULT true,
			"visibility" character varying(16) NOT NULL DEFAULT 'public',
			"autoApprove" boolean NOT NULL DEFAULT true,
			"allowPlusOne" boolean NOT NULL DEFAULT true,
			"feeType" character varying(16) NOT NULL DEFAULT 'none',
			"feeAmount" integer,
			"feeCurrency" character varying(3) NOT NULL DEFAULT 'HKD',
			"paymentInfo" character varying(512),
			"gateType" character varying(16) NOT NULL DEFAULT 'guidance',
			"levelBasis" character varying(16) NOT NULL DEFAULT 'self',
			"minLevel" double precision,
			"maxLevel" double precision,
			"gender" character varying(16) NOT NULL DEFAULT 'any',
			"ageGroup" character varying(16) NOT NULL DEFAULT 'any',
			"submitMatches" boolean NOT NULL DEFAULT false,
			"publishLeadHours" integer NOT NULL DEFAULT 168,
			"status" character varying(16) NOT NULL DEFAULT 'active',
			"tagIds" character varying(32)[] NOT NULL DEFAULT '{}',
			"notes" character varying(4096),
			"sendNotifications" boolean NOT NULL DEFAULT true,
			"lastRunAt" timestamp with time zone,
			"createdAt" timestamp with time zone NOT NULL DEFAULT now(),
			"updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
			CONSTRAINT "PK_club_schedule" PRIMARY KEY ("id"),
			CONSTRAINT "FK_club_schedule_channel" FOREIGN KEY ("channelId") REFERENCES "channel"("id") ON DELETE CASCADE
		)`);
		await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_club_schedule_channel" ON "club_schedule" ("channelId")`);
		await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_club_schedule_status" ON "club_schedule" ("status")`);
		await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_meet_seriesId" ON "meet" ("seriesId")`);
	}

	async down(queryRunner) {
		await queryRunner.query(`DROP TABLE IF EXISTS "club_schedule"`);
		await queryRunner.query(`DROP TABLE IF EXISTS "club_member_state"`);
		await queryRunner.query(`DROP INDEX IF EXISTS "IDX_club_setting_refCode"`);
		await queryRunner.query(`ALTER TABLE "club_setting" DROP COLUMN IF EXISTS "awards"`);
		await queryRunner.query(`ALTER TABLE "club_setting" DROP COLUMN IF EXISTS "tags"`);
		await queryRunner.query(`ALTER TABLE "club_setting" DROP COLUMN IF EXISTS "accessToken"`);
		await queryRunner.query(`ALTER TABLE "club_setting" DROP COLUMN IF EXISTS "refCode"`);
	}
}

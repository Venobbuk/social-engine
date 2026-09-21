/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/*
 * COACHING-V1 (2026-09-22). The coaching / lesson-booking feature.
 *   coach_schedule    a coach-owned recurring lesson slot (mirrors club_schedule; owned by a USER, attached to a club).
 *   coach_enrollment  a student's weekly enrolment (series) or pack purchase — the seat-per-week bookkeeping.
 *   coach_profile     a coach's self-written "About / qualifications" (display only; never verified or gated).
 *   meet.coachScheduleId / meet.priceTiers          a meet with coachScheduleId set IS a lesson; priceTiers copied.
 *   meet_participant.agreedPrice / agreedCurrency / enrollmentId    the price LOCKED at booking + its enrolment.
 *
 * Every statement is idempotent (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS). down() drops what up() added.
 * The whole feature is dark until the COACHING_V1 env flag is set on an instance, so these tables simply sit empty
 * until then. Sorts after 1789097300000-comp-dupr-v1.
 */
export class CoachingV11789097400000 {
	name = 'CoachingV11789097400000';

	async up(queryRunner) {
		// ---- coach_schedule ------------------------------------------------------------------------------------
		await queryRunner.query(`CREATE TABLE IF NOT EXISTS "coach_schedule" (
			"id" varchar(32) NOT NULL,
			"ownerUserId" varchar(32) NOT NULL,
			"channelId" varchar(32) NOT NULL,
			"name" varchar(128) NOT NULL,
			"sport" varchar(32) NOT NULL DEFAULT 'pickleball',
			"weekday" integer NOT NULL,
			"startTime" varchar(5) NOT NULL,
			"durationMinutes" integer NOT NULL DEFAULT 60,
			"timezone" varchar(64) NOT NULL DEFAULT 'Asia/Hong_Kong',
			"venueId" varchar(32),
			"venueName" varchar(256),
			"venueAddress" varchar(512),
			"lat" double precision,
			"lng" double precision,
			"capacity" integer NOT NULL DEFAULT 1,
			"bookingMode" varchar(16) NOT NULL DEFAULT 'single',
			"packSize" integer,
			"priceTiers" jsonb NOT NULL DEFAULT '{"version":1,"tiers":[]}',
			"cancellationPolicy" jsonb NOT NULL DEFAULT '{"windowHours":24}',
			"paymentInfo" varchar(512),
			"visibility" varchar(16) NOT NULL DEFAULT 'public',
			"autoApprove" boolean NOT NULL DEFAULT true,
			"gateType" varchar(16) NOT NULL DEFAULT 'guidance',
			"levelBasis" varchar(16) NOT NULL DEFAULT 'self',
			"minLevel" double precision,
			"maxLevel" double precision,
			"gender" varchar(16) NOT NULL DEFAULT 'any',
			"ageGroup" varchar(16) NOT NULL DEFAULT 'any',
			"publishLeadHours" integer NOT NULL DEFAULT 168,
			"status" varchar(16) NOT NULL DEFAULT 'active',
			"tagIds" varchar(32) array NOT NULL DEFAULT '{}',
			"notes" varchar(4096),
			"sendNotifications" boolean NOT NULL DEFAULT true,
			"lastRunAt" timestamp with time zone,
			"createdAt" timestamp with time zone NOT NULL DEFAULT now(),
			"updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
			CONSTRAINT "PK_coach_schedule" PRIMARY KEY ("id"),
			CONSTRAINT "FK_coach_schedule_owner" FOREIGN KEY ("ownerUserId") REFERENCES "user"("id") ON DELETE CASCADE,
			CONSTRAINT "FK_coach_schedule_channel" FOREIGN KEY ("channelId") REFERENCES "channel"("id") ON DELETE CASCADE)`);
		await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_coach_schedule_owner" ON "coach_schedule" ("ownerUserId")`);
		await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_coach_schedule_channel" ON "coach_schedule" ("channelId")`);
		await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_coach_schedule_status" ON "coach_schedule" ("status")`);

		// ---- coach_enrollment ----------------------------------------------------------------------------------
		await queryRunner.query(`CREATE TABLE IF NOT EXISTS "coach_enrollment" (
			"id" varchar(32) NOT NULL,
			"scheduleId" varchar(32) NOT NULL,
			"userId" varchar(32) NOT NULL,
			"mode" varchar(16) NOT NULL,
			"status" varchar(16) NOT NULL DEFAULT 'active',
			"agreedPrice" integer,
			"agreedCurrency" varchar(3),
			"packSize" integer,
			"packRemaining" integer,
			"paid" boolean NOT NULL DEFAULT false,
			"paidAt" timestamp with time zone,
			"skips" varchar(64) array NOT NULL DEFAULT '{}',
			"createdAt" timestamp with time zone NOT NULL DEFAULT now(),
			"cancelledAt" timestamp with time zone,
			CONSTRAINT "PK_coach_enrollment" PRIMARY KEY ("id"),
			CONSTRAINT "FK_coach_enrollment_schedule" FOREIGN KEY ("scheduleId") REFERENCES "coach_schedule"("id") ON DELETE CASCADE,
			CONSTRAINT "FK_coach_enrollment_user" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE)`);
		await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_coach_enrollment_schedule" ON "coach_enrollment" ("scheduleId")`);
		await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_coach_enrollment_user" ON "coach_enrollment" ("userId")`);
		// one ACTIVE enrolment per (slot, student) — a cancelled one may sit alongside a fresh active one
		await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_coach_enrollment_active" ON "coach_enrollment" ("scheduleId", "userId") WHERE "status" = 'active'`);

		// ---- coach_profile -------------------------------------------------------------------------------------
		await queryRunner.query(`CREATE TABLE IF NOT EXISTS "coach_profile" (
			"userId" varchar(32) NOT NULL,
			"about" varchar(2000),
			"updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
			CONSTRAINT "PK_coach_profile" PRIMARY KEY ("userId"),
			CONSTRAINT "FK_coach_profile_user" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE)`);

		// ---- meet: the thin coach flag + the lesson's own price bands -----------------------------------------
		await queryRunner.query(`ALTER TABLE "meet" ADD COLUMN IF NOT EXISTS "coachScheduleId" varchar(32)`);
		await queryRunner.query(`ALTER TABLE "meet" ADD COLUMN IF NOT EXISTS "priceTiers" jsonb`);
		await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_meet_coachScheduleId" ON "meet" ("coachScheduleId")`);

		// ---- meet_participant: the price locked at booking + its enrolment ------------------------------------
		await queryRunner.query(`ALTER TABLE "meet_participant" ADD COLUMN IF NOT EXISTS "agreedPrice" integer`);
		await queryRunner.query(`ALTER TABLE "meet_participant" ADD COLUMN IF NOT EXISTS "agreedCurrency" varchar(3)`);
		await queryRunner.query(`ALTER TABLE "meet_participant" ADD COLUMN IF NOT EXISTS "enrollmentId" varchar(32)`);
		await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_meet_participant_enrollmentId" ON "meet_participant" ("enrollmentId")`);

		const n = async (sql) => Number((await queryRunner.query(sql))[0].n);
		console.log('COACHING-V1 migration up', JSON.stringify({
			schedules: await n(`SELECT count(*) AS n FROM "coach_schedule"`),
			enrolments: await n(`SELECT count(*) AS n FROM "coach_enrollment"`),
			lessons: await n(`SELECT count(*) AS n FROM "meet" WHERE "coachScheduleId" IS NOT NULL`),
		}));
	}

	async down(queryRunner) {
		await queryRunner.query(`DROP INDEX IF EXISTS "IDX_meet_participant_enrollmentId"`);
		await queryRunner.query(`ALTER TABLE "meet_participant" DROP COLUMN IF EXISTS "enrollmentId"`);
		await queryRunner.query(`ALTER TABLE "meet_participant" DROP COLUMN IF EXISTS "agreedCurrency"`);
		await queryRunner.query(`ALTER TABLE "meet_participant" DROP COLUMN IF EXISTS "agreedPrice"`);
		await queryRunner.query(`DROP INDEX IF EXISTS "IDX_meet_coachScheduleId"`);
		await queryRunner.query(`ALTER TABLE "meet" DROP COLUMN IF EXISTS "priceTiers"`);
		await queryRunner.query(`ALTER TABLE "meet" DROP COLUMN IF EXISTS "coachScheduleId"`);
		await queryRunner.query(`DROP TABLE IF EXISTS "coach_profile"`);
		await queryRunner.query(`DROP TABLE IF EXISTS "coach_enrollment"`);
		await queryRunner.query(`DROP TABLE IF EXISTS "coach_schedule"`);
	}
}

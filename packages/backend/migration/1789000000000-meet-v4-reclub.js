/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/*
 * MEET-V4-RECLUB (2026-09-16). Brings the meet tables to Reclub 2.45.12's field set and states — the
 * adversarial review of 2026-09-12 found the v1 module enforced no invariant in the database and carried an
 * invented seat-hold timer. Nothing here is a redesign: every column and value maps to a field verified in the
 * shipped Reclub bundle (D:\Downloads\SCHEMA_SESSIONS_V3_20260912.md §0), and the four things that are NOT in
 * Reclub are removed.
 *
 * ADDED
 *   meet.confirmed          — the ONE counter. CHECK confirmed <= capacity is the oversell guard; every transition
 *                             into 'confirmed' runs one conditional UPDATE against it (MeetService). Reclub's
 *                             numComfirmedReserved. Backfilled from live rows below.
 *   meet.duprAccountGate, repeatInterval/repeatCount, blindTeamsMinutes, allowPlayerScoring, sendNotifications,
 *   meet.rosterVisibility[], flags[], venueId
 *   meet_participant.extGender/extAge, positionId, forceSkill, forcePosition, paymentType
 *   meet_participant 'spectator' status (Reclub 0 — a roster row that holds no seat: the host-only host)
 *   meet_participant tag 'dropper'
 *   meet_group              — Reclub MeetGroup{groupId, groupTagIds}: MANY clubs per meet, each with a tag
 *                             filter; the old single channelId stays as the meet's wall.
 *   meet_review             — endorsement (public) / feedback (private) / warning (private until 5 distinct
 *                             authors; Reclub warning_description). The safety model, copied whole.
 *   partial unique (meetId, waitlistRank) WHERE status='waitlisted' — the tie guard for the race reproduced on
 *                             live data (ten rows, three ranks, 55 ms). Order stays statusChangedAt, as Reclub.
 *
 * REMOVED (not in Reclub)
 *   meet.payByMinutes, meet_participant.holdExpiresAt — the invented pay-by timer. Reclub's Hold is a manual
 *                             host state with no expiry; the host's 48 h rule lives in the notes field.
 *   participant statuses 'removed' and 'left' — Reclub DELETES User/Reserved/PlusOne rows on leave/remove.
 *                             Existing rows in those states are deleted here; the (meetId,userId) unique
 *                             index therefore stays exactly as it is.
 *   meet.visibility 'club'   — Reclub privacy is binary. 'club' becomes 'private' + a meet_group row for the
 *                             meet's channel, which is what "club meet" meant.
 */
export class MeetV4Reclub1789000000000 {
	name = 'MeetV4Reclub1789000000000';

	async up(queryRunner) {
		// ---- meet: the counter and its guard --------------------------------------------------------
		await queryRunner.query(`ALTER TABLE "meet" ADD COLUMN IF NOT EXISTS "confirmed" integer NOT NULL DEFAULT 0`);
		await queryRunner.query(`UPDATE "meet" m SET "confirmed" = (SELECT count(*) FROM "meet_participant" p WHERE p."meetId" = m."id" AND p."status" = 'confirmed')`);
		// a meet that is ALREADY over capacity (v1 had no guard) must not block the constraint: raise its capacity to fit
		await queryRunner.query(`UPDATE "meet" SET "capacity" = "confirmed" WHERE "confirmed" > "capacity"`);
		await queryRunner.query(`ALTER TABLE "meet" DROP CONSTRAINT IF EXISTS "CHK_meet_confirmed_within_capacity"`);
		await queryRunner.query(`ALTER TABLE "meet" ADD CONSTRAINT "CHK_meet_confirmed_within_capacity" CHECK ("confirmed" >= 0 AND "confirmed" <= "capacity")`);

		// ---- meet: Reclub fields not yet present ---------------------------------------------------
		await queryRunner.query(`ALTER TABLE "meet" ADD COLUMN IF NOT EXISTS "duprAccountGate" character varying(16) NOT NULL DEFAULT 'guidance'`);
		await queryRunner.query(`ALTER TABLE "meet" ADD COLUMN IF NOT EXISTS "repeatInterval" character varying(16)`);
		await queryRunner.query(`ALTER TABLE "meet" ADD COLUMN IF NOT EXISTS "repeatCount" integer`);
		await queryRunner.query(`ALTER TABLE "meet" ADD COLUMN IF NOT EXISTS "blindTeamsMinutes" integer`);
		await queryRunner.query(`ALTER TABLE "meet" ADD COLUMN IF NOT EXISTS "allowPlayerScoring" boolean NOT NULL DEFAULT false`);
		await queryRunner.query(`ALTER TABLE "meet" ADD COLUMN IF NOT EXISTS "sendNotifications" boolean NOT NULL DEFAULT true`);
		await queryRunner.query(`ALTER TABLE "meet" ADD COLUMN IF NOT EXISTS "rosterVisibility" character varying(32) array NOT NULL DEFAULT '{}'`);
		await queryRunner.query(`ALTER TABLE "meet" ADD COLUMN IF NOT EXISTS "flags" character varying(32) array NOT NULL DEFAULT '{}'`);
		await queryRunner.query(`ALTER TABLE "meet" ADD COLUMN IF NOT EXISTS "venueId" character varying(32)`);
		await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_meet_venueId" ON "meet" ("venueId")`);

		// ---- meet: privacy is binary ---------------------------------------------------------------
		await queryRunner.query(`ALTER TABLE "meet" ADD COLUMN IF NOT EXISTS "_v4_was_club" boolean NOT NULL DEFAULT false`);
		await queryRunner.query(`UPDATE "meet" SET "_v4_was_club" = true, "visibility" = 'private' WHERE "visibility" = 'club'`);
		await queryRunner.query(`ALTER TABLE "meet" DROP CONSTRAINT IF EXISTS "CHK_meet_visibility_binary"`);
		await queryRunner.query(`ALTER TABLE "meet" ADD CONSTRAINT "CHK_meet_visibility_binary" CHECK ("visibility" IN ('public','private'))`);
		await queryRunner.query(`ALTER TABLE "meet" DROP CONSTRAINT IF EXISTS "CHK_meet_status"`);
		await queryRunner.query(`ALTER TABLE "meet" ADD CONSTRAINT "CHK_meet_status" CHECK ("status" IN ('pending','active','cancelled'))`);

		// ---- meet: the invented timer goes ---------------------------------------------------------
		await queryRunner.query(`ALTER TABLE "meet" DROP COLUMN IF EXISTS "payByMinutes"`);

		// ---- meet_group: many clubs per meet, each with a tag filter (Reclub MeetGroup) --------------
		await queryRunner.query(`CREATE TABLE IF NOT EXISTS "meet_group" (
			"meetId" character varying(32) NOT NULL,
			"channelId" character varying(32) NOT NULL,
			"tags" character varying(64) array NOT NULL DEFAULT '{}',
			"invitedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
			"cancelledAt" TIMESTAMP WITH TIME ZONE,
			CONSTRAINT "PK_meet_group" PRIMARY KEY ("meetId", "channelId"),
			CONSTRAINT "FK_meet_group_meet" FOREIGN KEY ("meetId") REFERENCES "meet"("id") ON DELETE CASCADE,
			CONSTRAINT "FK_meet_group_channel" FOREIGN KEY ("channelId") REFERENCES "channel"("id") ON DELETE CASCADE
		)`);
		await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_meet_group_channelId" ON "meet_group" ("channelId")`);
		// the meets that were 'club' become private + attached to their channel
		await queryRunner.query(`INSERT INTO "meet_group" ("meetId","channelId") SELECT "id", "channelId" FROM "meet" WHERE "_v4_was_club" AND "channelId" IS NOT NULL ON CONFLICT DO NOTHING`);
		await queryRunner.query(`ALTER TABLE "meet" DROP COLUMN IF EXISTS "_v4_was_club"`);

		// ---- meet_participant: Reclub fields, states and tags --------------------------------------
		await queryRunner.query(`ALTER TABLE "meet_participant" ADD COLUMN IF NOT EXISTS "extGender" character varying(8)`);
		await queryRunner.query(`ALTER TABLE "meet_participant" ADD COLUMN IF NOT EXISTS "extAge" character varying(8)`);
		await queryRunner.query(`ALTER TABLE "meet_participant" ADD COLUMN IF NOT EXISTS "positionId" character varying(32)`);
		await queryRunner.query(`ALTER TABLE "meet_participant" ADD COLUMN IF NOT EXISTS "forceSkill" double precision`);
		await queryRunner.query(`ALTER TABLE "meet_participant" ADD COLUMN IF NOT EXISTS "forcePosition" character varying(32)`);
		await queryRunner.query(`ALTER TABLE "meet_participant" ADD COLUMN IF NOT EXISTS "paymentType" character varying(16)`);
		// removed/left rows are deleted, as Reclub does; the unique (meetId,userId) index already exists and stays
		await queryRunner.query(`DELETE FROM "meet_participant" WHERE "status" IN ('removed','left')`);
		await queryRunner.query(`ALTER TABLE "meet_participant" DROP CONSTRAINT IF EXISTS "CHK_meet_participant_status"`);
		await queryRunner.query(`ALTER TABLE "meet_participant" ADD CONSTRAINT "CHK_meet_participant_status" CHECK ("status" IN ('requested','invited','confirmed','waitlisted','hold','maybe','declined','spectator'))`);
		// statusChangedAt is Reclub's lastStatusUpdatedAt — the 3-day auto-confirm and the waitlist order run on it
		await queryRunner.query(`UPDATE "meet_participant" SET "statusChangedAt" = now() WHERE "statusChangedAt" IS NULL`);
		await queryRunner.query(`ALTER TABLE "meet_participant" ALTER COLUMN "statusChangedAt" SET NOT NULL`);
		await queryRunner.query(`ALTER TABLE "meet_participant" ALTER COLUMN "statusChangedAt" SET DEFAULT now()`);
		// REPAIR before the guard: v1 assigned ranks with a read-then-write and the live data holds ties (ten rows
		// on three ranks, 55 ms apart — reproduced 2026-09-12). Re-rank every waitlist in Reclub's own order,
		// statusChangedAt ascending (id breaks a dead heat), so the unique index below can exist at all.
		await queryRunner.query(`UPDATE "meet_participant" p SET "waitlistRank" = r.rn FROM (
			SELECT "id", row_number() OVER (PARTITION BY "meetId" ORDER BY "statusChangedAt" ASC, "id" ASC) AS rn
			FROM "meet_participant" WHERE "status" = 'waitlisted') r WHERE p."id" = r."id"`);
		await queryRunner.query(`UPDATE "meet_participant" SET "waitlistRank" = NULL WHERE "status" <> 'waitlisted' AND "waitlistRank" IS NOT NULL`);
		// the tie guard
		await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_meet_participant_waitlist_rank" ON "meet_participant" ("meetId", "waitlistRank") WHERE "status" = 'waitlisted'`);
		await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_meet_participant_status_changed" ON "meet_participant" ("status", "statusChangedAt")`);
		// the invented timer goes
		await queryRunner.query(`ALTER TABLE "meet_participant" DROP COLUMN IF EXISTS "holdExpiresAt"`);

		// ---- meet_review: the safety model, copied whole -------------------------------------------
		await queryRunner.query(`CREATE TABLE IF NOT EXISTS "meet_review" (
			"id" character varying(32) NOT NULL,
			"authorId" character varying(32) NOT NULL,
			"targetUserId" character varying(32) NOT NULL,
			"meetId" character varying(32),
			"type" character varying(16) NOT NULL,
			"body" character varying(2048),
			"acknowledgedAt" TIMESTAMP WITH TIME ZONE,
			"archivedAt" TIMESTAMP WITH TIME ZONE,
			"createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
			CONSTRAINT "PK_meet_review" PRIMARY KEY ("id"),
			CONSTRAINT "CHK_meet_review_type" CHECK ("type" IN ('endorsement','feedback','warning')),
			CONSTRAINT "CHK_meet_review_not_self" CHECK ("authorId" <> "targetUserId"),
			CONSTRAINT "FK_meet_review_author" FOREIGN KEY ("authorId") REFERENCES "user"("id") ON DELETE CASCADE,
			CONSTRAINT "FK_meet_review_target" FOREIGN KEY ("targetUserId") REFERENCES "user"("id") ON DELETE CASCADE,
			CONSTRAINT "FK_meet_review_meet" FOREIGN KEY ("meetId") REFERENCES "meet"("id") ON DELETE SET NULL
		)`);
		// one review of each type per (author, target): a warning counts once per person, which is what "given by at least 5 others" means
		await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_meet_review_author_target_type" ON "meet_review" ("authorId", "targetUserId", "type")`);
		await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_meet_review_target_type" ON "meet_review" ("targetUserId", "type")`);
	}

	async down(queryRunner) {
		await queryRunner.query(`DROP TABLE IF EXISTS "meet_review"`);
		await queryRunner.query(`DROP INDEX IF EXISTS "IDX_meet_participant_waitlist_rank"`);
		await queryRunner.query(`DROP INDEX IF EXISTS "IDX_meet_participant_status_changed"`);
		await queryRunner.query(`ALTER TABLE "meet_participant" DROP CONSTRAINT IF EXISTS "CHK_meet_participant_status"`);
		await queryRunner.query(`ALTER TABLE "meet_participant" ADD COLUMN IF NOT EXISTS "holdExpiresAt" TIMESTAMP WITH TIME ZONE`);
		for (const c of ['extGender', 'extAge', 'positionId', 'forceSkill', 'forcePosition', 'paymentType']) {
			await queryRunner.query(`ALTER TABLE "meet_participant" DROP COLUMN IF EXISTS "${c}"`);
		}
		await queryRunner.query(`DROP TABLE IF EXISTS "meet_group"`);
		await queryRunner.query(`ALTER TABLE "meet" DROP CONSTRAINT IF EXISTS "CHK_meet_status"`);
		await queryRunner.query(`ALTER TABLE "meet" DROP CONSTRAINT IF EXISTS "CHK_meet_visibility_binary"`);
		await queryRunner.query(`ALTER TABLE "meet" DROP CONSTRAINT IF EXISTS "CHK_meet_confirmed_within_capacity"`);
		await queryRunner.query(`ALTER TABLE "meet" ADD COLUMN IF NOT EXISTS "payByMinutes" integer`);
		for (const c of ['confirmed', 'duprAccountGate', 'repeatInterval', 'repeatCount', 'blindTeamsMinutes', 'allowPlayerScoring', 'sendNotifications', 'rosterVisibility', 'flags', 'venueId']) {
			await queryRunner.query(`ALTER TABLE "meet" DROP COLUMN IF EXISTS "${c}"`);
		}
	}
}

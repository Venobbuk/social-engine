/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/*
 * MEETS-FIXES-V1 (lane meets-fixes, 2026-09-23) — the engine columns the Reclub meet / schedule / friends gaps need.
 *   club_schedule   type · duprAccountGate · cancellationFreezeHours   copied onto every meet the schedule creates
 *                   participants jsonb [{userId, role: host|coach|player|paymentCollector}]   Reclub schedule participants
 *                   optOutUserIds varchar[]   members who left the schedule (Reclub "Leave schedule"); the sweep skips them
 *   gb_activity_hide  (userId, hiddenFromId) — Reclub "Show my activities" OFF for one friend
 *   meet_saved      (userId, meetId) — a listing saved to My activities (Reclub Add to My Activities)
 *   meet_club_invite (meetId, channelId) — the clubs invited to a meet (Reclub Invited clubs section)
 *   meet_match.notes      Reclub match notes
 *   meet_participant.bib  Reclub bib / jersey number
 *   club_setting.memberGated  Reclub Member Gated: members may invite and approve members too
 * Every statement is idempotent (IF NOT EXISTS); down() drops only what up() added.
 */
export class MeetsFixesV11789098100000 {
	name = 'MeetsFixesV11789098100000';

	async up(queryRunner) {
		await queryRunner.query(`ALTER TABLE "club_schedule" ADD COLUMN IF NOT EXISTS "type" varchar(16) NOT NULL DEFAULT 'managed'`);
		await queryRunner.query(`ALTER TABLE "club_schedule" ADD COLUMN IF NOT EXISTS "duprAccountGate" varchar(16) NOT NULL DEFAULT 'guidance'`);
		await queryRunner.query(`ALTER TABLE "club_schedule" ADD COLUMN IF NOT EXISTS "cancellationFreezeHours" integer NOT NULL DEFAULT 0`);
		await queryRunner.query(`ALTER TABLE "club_schedule" ADD COLUMN IF NOT EXISTS "participants" jsonb NOT NULL DEFAULT '[]'`);
		await queryRunner.query(`ALTER TABLE "club_schedule" ADD COLUMN IF NOT EXISTS "optOutUserIds" varchar(32) array NOT NULL DEFAULT '{}'`);
		await queryRunner.query(`CREATE TABLE IF NOT EXISTS "gb_activity_hide" ("userId" varchar(32) NOT NULL, "hiddenFromId" varchar(32) NOT NULL, "createdAt" timestamp with time zone NOT NULL DEFAULT now(), CONSTRAINT "PK_gb_activity_hide" PRIMARY KEY ("userId", "hiddenFromId"))`);
		await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_gb_activity_hide_from" ON "gb_activity_hide" ("hiddenFromId")`);
		await queryRunner.query(`CREATE TABLE IF NOT EXISTS "meet_saved" ("userId" varchar(32) NOT NULL, "meetId" varchar(32) NOT NULL, "createdAt" timestamp with time zone NOT NULL DEFAULT now(), CONSTRAINT "PK_meet_saved" PRIMARY KEY ("userId", "meetId"))`);
		await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_meet_saved_meet" ON "meet_saved" ("meetId")`);
		await queryRunner.query(`CREATE TABLE IF NOT EXISTS "meet_club_invite" ("meetId" varchar(32) NOT NULL, "channelId" varchar(32) NOT NULL, "invitedById" varchar(32) NOT NULL, "audience" varchar(16) NOT NULL DEFAULT 'members', "createdAt" timestamp with time zone NOT NULL DEFAULT now(), CONSTRAINT "PK_meet_club_invite" PRIMARY KEY ("meetId", "channelId"))`);
		await queryRunner.query(`ALTER TABLE "meet_match" ADD COLUMN IF NOT EXISTS "notes" varchar(512)`);
		await queryRunner.query(`ALTER TABLE "meet_participant" ADD COLUMN IF NOT EXISTS "bib" varchar(8)`);
		await queryRunner.query(`ALTER TABLE "club_setting" ADD COLUMN IF NOT EXISTS "memberGated" boolean NOT NULL DEFAULT false`);
	}

	async down(queryRunner) {
		await queryRunner.query(`ALTER TABLE "club_setting" DROP COLUMN IF EXISTS "memberGated"`);
		await queryRunner.query(`ALTER TABLE "meet_participant" DROP COLUMN IF EXISTS "bib"`);
		await queryRunner.query(`ALTER TABLE "meet_match" DROP COLUMN IF EXISTS "notes"`);
		await queryRunner.query(`DROP TABLE IF EXISTS "meet_club_invite"`);
		await queryRunner.query(`DROP TABLE IF EXISTS "meet_saved"`);
		await queryRunner.query(`DROP TABLE IF EXISTS "gb_activity_hide"`);
		await queryRunner.query(`ALTER TABLE "club_schedule" DROP COLUMN IF EXISTS "optOutUserIds"`);
		await queryRunner.query(`ALTER TABLE "club_schedule" DROP COLUMN IF EXISTS "participants"`);
		await queryRunner.query(`ALTER TABLE "club_schedule" DROP COLUMN IF EXISTS "cancellationFreezeHours"`);
		await queryRunner.query(`ALTER TABLE "club_schedule" DROP COLUMN IF EXISTS "duprAccountGate"`);
		await queryRunner.query(`ALTER TABLE "club_schedule" DROP COLUMN IF EXISTS "type"`);
	}
}

/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/*
 * CLUB-ADMIN-V1 (2026-09-17). Reclub's Group settings on a channel: club_setting (visibility, gate, create-meet
 * permission, sport, level, admins, member tags, venues, payment info, forum/chat flags) and club_join_request
 * (approval-gated joins). Membership stays channel_following. Additive, idempotent.
 */
export class ClubAdminV11789000300000 {
	name = 'ClubAdminV11789000300000';

	async up(queryRunner) {
		await queryRunner.query(`CREATE TABLE IF NOT EXISTS "club_setting" (
			"channelId" character varying(32) NOT NULL,
			"visibility" character varying(16) NOT NULL DEFAULT 'public',
			"gateType" character varying(16) NOT NULL DEFAULT 'open',
			"createMeetPermission" character varying(16) NOT NULL DEFAULT 'members',
			"sport" character varying(32) NOT NULL DEFAULT 'pickleball',
			"level" character varying(64),
			"adminIds" character varying(32)[] NOT NULL DEFAULT '{}',
			"memberTags" jsonb NOT NULL DEFAULT '{}',
			"venueIds" character varying(32)[] NOT NULL DEFAULT '{}',
			"paymentInfo" character varying(512),
			"enableForum" boolean NOT NULL DEFAULT true,
			"enableChat" boolean NOT NULL DEFAULT true,
			"updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
			CONSTRAINT "PK_club_setting" PRIMARY KEY ("channelId"),
			CONSTRAINT "FK_club_setting_channel" FOREIGN KEY ("channelId") REFERENCES "channel"("id") ON DELETE CASCADE
		)`);
		await queryRunner.query(`CREATE TABLE IF NOT EXISTS "club_join_request" (
			"id" character varying(32) NOT NULL,
			"channelId" character varying(32) NOT NULL,
			"userId" character varying(32) NOT NULL,
			"status" character varying(16) NOT NULL DEFAULT 'pending',
			"message" character varying(512),
			"decidedById" character varying(32),
			"decidedAt" timestamp with time zone,
			"createdAt" timestamp with time zone NOT NULL DEFAULT now(),
			CONSTRAINT "PK_club_join_request" PRIMARY KEY ("id"),
			CONSTRAINT "FK_club_join_request_channel" FOREIGN KEY ("channelId") REFERENCES "channel"("id") ON DELETE CASCADE,
			CONSTRAINT "FK_club_join_request_user" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE
		)`);
		await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_club_join_request_channel_user" ON "club_join_request" ("channelId", "userId")`);
		await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_club_join_request_channel" ON "club_join_request" ("channelId")`);
	}

	async down(queryRunner) {
		await queryRunner.query(`DROP TABLE IF EXISTS "club_join_request"`);
		await queryRunner.query(`DROP TABLE IF EXISTS "club_setting"`);
	}
}

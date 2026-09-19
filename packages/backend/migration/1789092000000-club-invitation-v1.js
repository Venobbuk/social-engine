/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/*
 * CLUB-INVITE-V1 (2026-09-20). Additive, idempotent. club_invitation: a club admin invites one player by name
 * (Reclub "Invite to a club"); the player accepts (seated in any gate) or declines. One pending row per club+player.
 * status: pending | accepted | declined | cancelled.
 */
export class ClubInvitationV11789092000000 {
	name = 'ClubInvitationV11789092000000';

	async up(queryRunner) {
		await queryRunner.query(`CREATE TABLE IF NOT EXISTS "club_invitation" (
			"id" varchar(32) NOT NULL, "channelId" varchar(32) NOT NULL, "userId" varchar(32) NOT NULL,
			"invitedById" varchar(32) NOT NULL, "status" varchar(16) NOT NULL DEFAULT 'pending',
			"createdAt" timestamptz NOT NULL DEFAULT now(), "decidedAt" timestamptz,
			CONSTRAINT "PK_club_invitation" PRIMARY KEY ("id"))`);
		await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_club_invitation_one_pending" ON "club_invitation" ("channelId", "userId") WHERE "status" = 'pending'`);
		await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_club_invitation_user_status" ON "club_invitation" ("userId", "status")`);
	}

	async down(queryRunner) {
		await queryRunner.query(`DROP TABLE IF EXISTS "club_invitation"`);
	}
}

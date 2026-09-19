/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/*
 * CLUB-CLAIM-VERIFY-V1 (2026-09-19). Additive, idempotent. club_claim: a member's request to own an ownerless club.
 * Staff (moderators) approve or reject it; until then the club stays ownerless (was: instant takeover by any member).
 */
export class ClubClaimV11789080000000 {
	name = 'ClubClaimV11789080000000';

	async up(queryRunner) {
		await queryRunner.query(`CREATE TABLE IF NOT EXISTS "club_claim" (
			"id" varchar(32) NOT NULL, "channelId" varchar(32) NOT NULL, "userId" varchar(32) NOT NULL,
			"status" varchar(16) NOT NULL DEFAULT 'pending', "createdAt" timestamptz NOT NULL DEFAULT now(),
			"decidedAt" timestamptz, "decidedById" varchar(32), CONSTRAINT "PK_club_claim" PRIMARY KEY ("id"))`);
		await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_club_claim_one_pending" ON "club_claim" ("channelId", "userId") WHERE "status" = 'pending'`);
		await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_club_claim_status" ON "club_claim" ("status", "createdAt")`);
	}

	async down(queryRunner) {
		await queryRunner.query(`DROP TABLE IF EXISTS "club_claim"`);
	}
}

/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/*
 * TOURNAMENT-V1 (2026-09-19). User-created competitions (Reclub 2.45.12 competitions, spec_competition_dupr.md):
 *   competition        — the tournament: format, participant type, registration timeline, fee, venue, draw settings,
 *                        standings calculation + tiebreakers, status, brackets-manager export (bracketData)
 *   competition_entry  — a team / pair / player entry with seed, pool, status, paid tag
 *   competition_match  — one row per match of every stage: score sets, forfeits, result, bracket link
 *   competition_award  — 1st–4th (+ co-3rd) and custom awards; userIds denormalised for the profile's placements
 * Additive and idempotent.
 */
export class TournamentV11789010000000 {
	name = 'TournamentV11789010000000';

	async up(queryRunner) {
		await queryRunner.query(`CREATE TABLE IF NOT EXISTS "competition" (
			"id" character varying(32) NOT NULL,
			"referenceCode" character varying(16) NOT NULL,
			"hostId" character varying(32) NOT NULL,
			"channelId" character varying(32),
			"chatRoomId" character varying(32),
			"sport" character varying(32) NOT NULL DEFAULT 'pickleball',
			"name" character varying(128) NOT NULL,
			"notes" character varying(4096),
			"format" character varying(32) NOT NULL DEFAULT 'singleElim',
			"participantType" character varying(16) NOT NULL DEFAULT 'singles',
			"teamMinSize" integer NOT NULL DEFAULT 1,
			"teamMaxSize" integer NOT NULL DEFAULT 1,
			"maxEntries" integer NOT NULL DEFAULT 8,
			"registrationOpenAt" timestamp with time zone,
			"registrationCloseAt" timestamp with time zone,
			"lockRegistration" boolean NOT NULL DEFAULT false,
			"startAt" timestamp with time zone NOT NULL,
			"durationDays" integer NOT NULL DEFAULT 1,
			"timezone" character varying(64) NOT NULL DEFAULT 'Asia/Hong_Kong',
			"venueName" character varying(256),
			"venueAddress" character varying(512),
			"lat" double precision,
			"lng" double precision,
			"venueId" character varying(32),
			"feeType" character varying(16) NOT NULL DEFAULT 'free',
			"feeAmount" integer,
			"feeEarlyBirdAmount" integer,
			"earlyBirdAt" timestamp with time zone,
			"feeCurrency" character varying(3) NOT NULL DEFAULT 'HKD',
			"paymentInfo" character varying(512),
			"visibility" character varying(16) NOT NULL DEFAULT 'public',
			"accessToken" character varying(32),
			"status" character varying(16) NOT NULL DEFAULT 'draft',
			"minLevel" double precision,
			"maxLevel" double precision,
			"gender" character varying(16) NOT NULL DEFAULT 'any',
			"ageGroup" character varying(16) NOT NULL DEFAULT 'any',
			"numGroups" integer NOT NULL DEFAULT 1,
			"numContinue" integer NOT NULL DEFAULT 2,
			"thirdPlaceMatch" boolean NOT NULL DEFAULT true,
			"setsPerMatch" integer NOT NULL DEFAULT 1,
			"forfeitWinScore" integer NOT NULL DEFAULT 11,
			"pointCalculationType" character varying(16) NOT NULL DEFAULT 'winLoss',
			"standardWinPoint" integer NOT NULL DEFAULT 3,
			"standardLossPoint" integer NOT NULL DEFAULT 0,
			"drawPoint" integer NOT NULL DEFAULT 1,
			"tiebreakerWinPoint" integer NOT NULL DEFAULT 2,
			"tiebreakerLossPoint" integer NOT NULL DEFAULT 1,
			"tiebreakers" character varying(16) array NOT NULL DEFAULT '{h2h_wins,score_diff,h2h_diff,total_score}',
			"revealDraw" boolean NOT NULL DEFAULT false,
			"showSeeds" boolean NOT NULL DEFAULT true,
			"manualSeeding" boolean NOT NULL DEFAULT false,
			"autoApprove" boolean NOT NULL DEFAULT true,
			"bracketData" jsonb,
			"startedAt" timestamp with time zone,
			"endedAt" timestamp with time zone,
			"cancelledAt" timestamp with time zone,
			"updatedAt" timestamp with time zone,
			CONSTRAINT "PK_competition" PRIMARY KEY ("id")
		)`);
		await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_competition_referenceCode" ON "competition" ("referenceCode")`);
		await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_competition_hostId" ON "competition" ("hostId")`);
		await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_competition_channelId" ON "competition" ("channelId")`);
		await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_competition_startAt" ON "competition" ("startAt")`);
		await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_competition_status" ON "competition" ("status")`);
		await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_competition_venueId" ON "competition" ("venueId")`);
		await queryRunner.query(`ALTER TABLE "competition" DROP CONSTRAINT IF EXISTS "FK_competition_host"`);
		await queryRunner.query(`ALTER TABLE "competition" ADD CONSTRAINT "FK_competition_host" FOREIGN KEY ("hostId") REFERENCES "user"("id") ON DELETE CASCADE`);
		await queryRunner.query(`ALTER TABLE "competition" DROP CONSTRAINT IF EXISTS "FK_competition_channel"`);
		await queryRunner.query(`ALTER TABLE "competition" ADD CONSTRAINT "FK_competition_channel" FOREIGN KEY ("channelId") REFERENCES "channel"("id") ON DELETE SET NULL`);
		await queryRunner.query(`ALTER TABLE "competition" DROP CONSTRAINT IF EXISTS "FK_competition_chatRoom"`);
		await queryRunner.query(`ALTER TABLE "competition" ADD CONSTRAINT "FK_competition_chatRoom" FOREIGN KEY ("chatRoomId") REFERENCES "chat_room"("id") ON DELETE SET NULL`);

		await queryRunner.query(`CREATE TABLE IF NOT EXISTS "competition_entry" (
			"id" character varying(32) NOT NULL,
			"competitionId" character varying(32) NOT NULL,
			"name" character varying(128) NOT NULL,
			"captainId" character varying(32),
			"userIds" character varying(32) array NOT NULL DEFAULT '{}',
			"seed" integer,
			"pool" integer,
			"status" character varying(16) NOT NULL DEFAULT 'confirmed',
			"isPaid" boolean NOT NULL DEFAULT false,
			"notes" character varying(512),
			"createdById" character varying(32),
			"createdAt" timestamp with time zone NOT NULL DEFAULT now(),
			"statusChangedAt" timestamp with time zone NOT NULL DEFAULT now(),
			CONSTRAINT "PK_competition_entry" PRIMARY KEY ("id")
		)`);
		await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_competition_entry_competitionId" ON "competition_entry" ("competitionId")`);
		await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_competition_entry_captainId" ON "competition_entry" ("captainId")`);
		await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_competition_entry_status" ON "competition_entry" ("status")`);
		await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_competition_entry_userIds" ON "competition_entry" USING gin ("userIds")`);
		await queryRunner.query(`ALTER TABLE "competition_entry" DROP CONSTRAINT IF EXISTS "FK_competition_entry_competition"`);
		await queryRunner.query(`ALTER TABLE "competition_entry" ADD CONSTRAINT "FK_competition_entry_competition" FOREIGN KEY ("competitionId") REFERENCES "competition"("id") ON DELETE CASCADE`);

		await queryRunner.query(`CREATE TABLE IF NOT EXISTS "competition_match" (
			"id" character varying(32) NOT NULL,
			"competitionId" character varying(32) NOT NULL,
			"stage" character varying(16) NOT NULL DEFAULT 'regular',
			"pool" integer,
			"round" integer NOT NULL DEFAULT 1,
			"number" integer NOT NULL DEFAULT 1,
			"bracketId" integer,
			"bracketGroup" character varying(16),
			"entry1Id" character varying(32),
			"entry2Id" character varying(32),
			"entry1Status" character varying(16) NOT NULL DEFAULT 'pending',
			"entry2Status" character varying(16) NOT NULL DEFAULT 'pending',
			"status" character varying(16) NOT NULL DEFAULT 'pending',
			"scores" jsonb NOT NULL DEFAULT '[]',
			"result" character varying(8),
			"courtIndex" integer,
			"startAt" timestamp with time zone,
			"notes" character varying(512),
			"isExtra" boolean NOT NULL DEFAULT false,
			"createdAt" timestamp with time zone NOT NULL DEFAULT now(),
			"updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
			CONSTRAINT "PK_competition_match" PRIMARY KEY ("id")
		)`);
		await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_competition_match_competitionId" ON "competition_match" ("competitionId")`);
		await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_competition_match_status" ON "competition_match" ("status")`);
		await queryRunner.query(`ALTER TABLE "competition_match" DROP CONSTRAINT IF EXISTS "FK_competition_match_competition"`);
		await queryRunner.query(`ALTER TABLE "competition_match" ADD CONSTRAINT "FK_competition_match_competition" FOREIGN KEY ("competitionId") REFERENCES "competition"("id") ON DELETE CASCADE`);

		await queryRunner.query(`CREATE TABLE IF NOT EXISTS "competition_award" (
			"id" character varying(32) NOT NULL,
			"competitionId" character varying(32) NOT NULL,
			"type" character varying(16) NOT NULL DEFAULT 'custom',
			"name" character varying(128) NOT NULL,
			"description" character varying(512),
			"entryId" character varying(32),
			"userIds" character varying(32) array NOT NULL DEFAULT '{}',
			"enabled" boolean NOT NULL DEFAULT true,
			"awardedAt" timestamp with time zone,
			"createdAt" timestamp with time zone NOT NULL DEFAULT now(),
			CONSTRAINT "PK_competition_award" PRIMARY KEY ("id")
		)`);
		await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_competition_award_competitionId" ON "competition_award" ("competitionId")`);
		await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_competition_award_userIds" ON "competition_award" USING gin ("userIds")`);
		await queryRunner.query(`ALTER TABLE "competition_award" DROP CONSTRAINT IF EXISTS "FK_competition_award_competition"`);
		await queryRunner.query(`ALTER TABLE "competition_award" ADD CONSTRAINT "FK_competition_award_competition" FOREIGN KEY ("competitionId") REFERENCES "competition"("id") ON DELETE CASCADE`);
	}

	async down(queryRunner) {
		await queryRunner.query(`DROP TABLE IF EXISTS "competition_award"`);
		await queryRunner.query(`DROP TABLE IF EXISTS "competition_match"`);
		await queryRunner.query(`DROP TABLE IF EXISTS "competition_entry"`);
		await queryRunner.query(`DROP TABLE IF EXISTS "competition"`);
	}
}

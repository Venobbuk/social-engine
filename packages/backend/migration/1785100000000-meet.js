/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class Meet1785100000000 {
	name = 'Meet1785100000000';

	async up(queryRunner) {
		await queryRunner.query(`CREATE TABLE "meet" (
			"id" character varying(32) NOT NULL,
			"referenceCode" character varying(16) NOT NULL,
			"hostId" character varying(32) NOT NULL,
			"channelId" character varying(32),
			"chatRoomId" character varying(32),
			"type" character varying(16) NOT NULL DEFAULT 'managed',
			"sport" character varying(32) NOT NULL DEFAULT 'pickleball',
			"format" character varying(32),
			"name" character varying(128) NOT NULL,
			"notes" character varying(4096),
			"startAt" TIMESTAMP WITH TIME ZONE NOT NULL,
			"durationMinutes" integer NOT NULL,
			"timezone" character varying(64) NOT NULL DEFAULT 'Asia/Hong_Kong',
			"venueName" character varying(256),
			"venueAddress" character varying(512),
			"lat" double precision,
			"lng" double precision,
			"venueRef" character varying(64),
			"capacity" integer NOT NULL DEFAULT 4,
			"hostPlays" boolean NOT NULL DEFAULT true,
			"visibility" character varying(16) NOT NULL DEFAULT 'public',
			"accessToken" character varying(32),
			"status" character varying(16) NOT NULL DEFAULT 'active',
			"autoApprove" boolean NOT NULL DEFAULT false,
			"allowPlusOne" boolean NOT NULL DEFAULT true,
			"guestsPerMember" integer NOT NULL DEFAULT 1,
			"feeType" character varying(16) NOT NULL DEFAULT 'none',
			"feeAmount" integer,
			"feeCurrency" character varying(3) NOT NULL DEFAULT 'HKD',
			"paymentInfo" character varying(512),
			"payByMinutes" integer,
			"cancellationFreezeHours" integer NOT NULL DEFAULT 0,
			"gateType" character varying(16) NOT NULL DEFAULT 'strict',
			"levelBasis" character varying(16) NOT NULL DEFAULT 'self',
			"minLevel" double precision,
			"maxLevel" double precision,
			"gender" character varying(16) NOT NULL DEFAULT 'any',
			"ageGroup" character varying(16) NOT NULL DEFAULT 'any',
			"submitMatches" boolean NOT NULL DEFAULT false,
			"seriesId" character varying(32),
			"cancelledAt" TIMESTAMP WITH TIME ZONE,
			"updatedAt" TIMESTAMP WITH TIME ZONE,
			CONSTRAINT "PK_meet_id" PRIMARY KEY ("id")
		)`);
		await queryRunner.query(`CREATE UNIQUE INDEX "IDX_meet_referenceCode" ON "meet" ("referenceCode")`);
		await queryRunner.query(`CREATE INDEX "IDX_meet_hostId" ON "meet" ("hostId")`);
		await queryRunner.query(`CREATE INDEX "IDX_meet_channelId" ON "meet" ("channelId")`);
		await queryRunner.query(`CREATE INDEX "IDX_meet_startAt" ON "meet" ("startAt")`);
		await queryRunner.query(`CREATE INDEX "IDX_meet_status" ON "meet" ("status")`);
		await queryRunner.query(`ALTER TABLE "meet" ADD CONSTRAINT "FK_meet_hostId" FOREIGN KEY ("hostId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
		await queryRunner.query(`ALTER TABLE "meet" ADD CONSTRAINT "FK_meet_channelId" FOREIGN KEY ("channelId") REFERENCES "channel"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
		await queryRunner.query(`ALTER TABLE "meet" ADD CONSTRAINT "FK_meet_chatRoomId" FOREIGN KEY ("chatRoomId") REFERENCES "chat_room"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);

		await queryRunner.query(`CREATE TABLE "meet_participant" (
			"id" character varying(32) NOT NULL,
			"meetId" character varying(32) NOT NULL,
			"userId" character varying(32),
			"kind" character varying(16) NOT NULL DEFAULT 'user',
			"sponsorId" character varying(32),
			"displayName" character varying(128),
			"declaredLevel" double precision,
			"status" character varying(16) NOT NULL DEFAULT 'requested',
			"waitlistRank" integer,
			"holdExpiresAt" TIMESTAMP WITH TIME ZONE,
			"isHost" boolean NOT NULL DEFAULT false,
			"isCoach" boolean NOT NULL DEFAULT false,
			"isReferee" boolean NOT NULL DEFAULT false,
			"isPaymentCollector" boolean NOT NULL DEFAULT false,
			"tags" character varying(32) array NOT NULL DEFAULT '{}',
			"teamKey" character varying(32),
			"courtIndex" integer,
			"statusChangedAt" TIMESTAMP WITH TIME ZONE,
			"checkedInAt" TIMESTAMP WITH TIME ZONE,
			CONSTRAINT "PK_meet_participant_id" PRIMARY KEY ("id")
		)`);
		await queryRunner.query(`CREATE INDEX "IDX_meet_participant_meetId" ON "meet_participant" ("meetId")`);
		await queryRunner.query(`CREATE INDEX "IDX_meet_participant_userId" ON "meet_participant" ("userId")`);
		await queryRunner.query(`CREATE INDEX "IDX_meet_participant_status" ON "meet_participant" ("status")`);
		await queryRunner.query(`CREATE UNIQUE INDEX "IDX_meet_participant_meet_user" ON "meet_participant" ("meetId", "userId") WHERE "userId" IS NOT NULL`);
		await queryRunner.query(`ALTER TABLE "meet_participant" ADD CONSTRAINT "FK_meet_participant_meetId" FOREIGN KEY ("meetId") REFERENCES "meet"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
		await queryRunner.query(`ALTER TABLE "meet_participant" ADD CONSTRAINT "FK_meet_participant_userId" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);

		await queryRunner.query(`CREATE TABLE "meet_player_level" (
			"id" character varying(32) NOT NULL,
			"userId" character varying(32) NOT NULL,
			"sport" character varying(32) NOT NULL DEFAULT 'pickleball',
			"selfLevel" double precision,
			"duprSingles" double precision,
			"duprDoubles" double precision,
			"duprId" character varying(64),
			"gender" character varying(16),
			"ageGroup" character varying(16),
			"source" character varying(32),
			"updatedAt" TIMESTAMP WITH TIME ZONE,
			CONSTRAINT "PK_meet_player_level_id" PRIMARY KEY ("id")
		)`);
		await queryRunner.query(`CREATE INDEX "IDX_meet_player_level_userId" ON "meet_player_level" ("userId")`);
		await queryRunner.query(`CREATE UNIQUE INDEX "IDX_meet_player_level_user_sport" ON "meet_player_level" ("userId", "sport")`);
		await queryRunner.query(`ALTER TABLE "meet_player_level" ADD CONSTRAINT "FK_meet_player_level_userId" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
	}

	async down(queryRunner) {
		await queryRunner.query(`DROP TABLE "meet_player_level"`);
		await queryRunner.query(`DROP TABLE "meet_participant"`);
		await queryRunner.query(`DROP TABLE "meet"`);
	}
}

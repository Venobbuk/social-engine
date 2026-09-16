/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/*
 * VENUE-V1 (2026-09-16, W4). Reclub's venue model + two-tier curation (D13) and saved discovery locations (D14).
 *   venue          — name/address/lat/lng, Google externalId, AMap id, source league|community, curatedByTenant +
 *                    externalRef (the hkpl Venue row it mirrors; unique per tenant so the sync is an upsert),
 *                    status verified|under_review|closed, staff-assigned ownerUserId.
 *   user_location  — home / work / favourite places a player discovers from, with the radius last used.
 *   channel.externalRef — CLUB-SYNC-V1 (W4.6): a league club (hkpl Club row) mirrored as a channel, upserted by
 *                    adapter/clubs/sync on hkpl:<tenantId>:<clubId>; inactive clubs become archived channels.
 * Additive, idempotent. meet.venueId (already present) points at venue.id from now on.
 */
export class VenueV11789000200000 {
	name = 'VenueV11789000200000';

	async up(queryRunner) {
		await queryRunner.query(`CREATE TABLE IF NOT EXISTS "venue" (
			"id" character varying(32) NOT NULL,
			"name" character varying(256) NOT NULL,
			"address" character varying(512),
			"district" character varying(128),
			"city" character varying(128),
			"country" character varying(2) NOT NULL DEFAULT 'HK',
			"lat" double precision,
			"lng" double precision,
			"externalId" character varying(256),
			"amapPlaceId" character varying(256),
			"source" character varying(16) NOT NULL DEFAULT 'community',
			"curatedByTenant" character varying(64),
			"externalRef" character varying(64),
			"status" character varying(16) NOT NULL DEFAULT 'under_review',
			"ownerUserId" character varying(32),
			"courtCount" integer,
			"notes" character varying(2048),
			"createdById" character varying(32),
			"createdAt" timestamp with time zone NOT NULL DEFAULT now(),
			"updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
			CONSTRAINT "PK_venue" PRIMARY KEY ("id")
		)`);
		await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_venue_lat" ON "venue" ("lat")`);
		await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_venue_lng" ON "venue" ("lng")`);
		await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_venue_externalId" ON "venue" ("externalId")`);
		await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_venue_status" ON "venue" ("status")`);
		await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_venue_source_tenant_ref" ON "venue" ("source", "curatedByTenant", "externalRef") WHERE "externalRef" IS NOT NULL`);
		await queryRunner.query(`ALTER TABLE "venue" DROP CONSTRAINT IF EXISTS "CHK_venue_source"`);
		await queryRunner.query(`ALTER TABLE "venue" ADD CONSTRAINT "CHK_venue_source" CHECK ("source" IN ('league', 'community'))`);
		await queryRunner.query(`ALTER TABLE "venue" DROP CONSTRAINT IF EXISTS "CHK_venue_status"`);
		await queryRunner.query(`ALTER TABLE "venue" ADD CONSTRAINT "CHK_venue_status" CHECK ("status" IN ('verified', 'under_review', 'closed'))`);

		await queryRunner.query(`CREATE TABLE IF NOT EXISTS "user_location" (
			"id" character varying(32) NOT NULL,
			"userId" character varying(32) NOT NULL,
			"kind" character varying(16) NOT NULL DEFAULT 'favourite',
			"label" character varying(128) NOT NULL,
			"address" character varying(512),
			"lat" double precision NOT NULL,
			"lng" double precision NOT NULL,
			"radiusKm" integer NOT NULL DEFAULT 20,
			"updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
			CONSTRAINT "PK_user_location" PRIMARY KEY ("id")
		)`);
		await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_user_location_userId" ON "user_location" ("userId")`);
		await queryRunner.query(`ALTER TABLE "user_location" DROP CONSTRAINT IF EXISTS "FK_user_location_user"`);
		await queryRunner.query(`ALTER TABLE "user_location" ADD CONSTRAINT "FK_user_location_user" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE`);
		await queryRunner.query(`ALTER TABLE "user_location" DROP CONSTRAINT IF EXISTS "CHK_user_location_kind"`);
		await queryRunner.query(`ALTER TABLE "user_location" ADD CONSTRAINT "CHK_user_location_kind" CHECK ("kind" IN ('home', 'work', 'favourite'))`);
		await queryRunner.query(`ALTER TABLE "user_location" DROP CONSTRAINT IF EXISTS "CHK_user_location_radius"`);
		await queryRunner.query(`ALTER TABLE "user_location" ADD CONSTRAINT "CHK_user_location_radius" CHECK ("radiusKm" BETWEEN 1 AND 80)`);

		await queryRunner.query(`ALTER TABLE "channel" ADD COLUMN IF NOT EXISTS "externalRef" character varying(96)`);
		await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_channel_externalRef" ON "channel" ("externalRef") WHERE "externalRef" IS NOT NULL`);
	}

	async down(queryRunner) {
		await queryRunner.query(`ALTER TABLE "channel" DROP COLUMN IF EXISTS "externalRef"`);
		await queryRunner.query(`DROP TABLE IF EXISTS "user_location"`);
		await queryRunner.query(`DROP TABLE IF EXISTS "venue"`);
	}
}

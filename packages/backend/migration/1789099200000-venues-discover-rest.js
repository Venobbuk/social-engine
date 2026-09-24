/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/*
 * VENUES-REST-V1 (lane venues-discover-rest, 2026-09-23). Additive, idempotent; down restores the prior schema.
 *   venue_media  — Reclub venue media (module 7374: GET/POST /media {mediaIds, isPinned}, DELETE /media/<id>): a photo
 *                  of a venue IS a native drive file (uploaded through drive/files/create); this row only says which
 *                  venue it shows and whether an owner pinned it to the top of the carousel. G11 rule 3: Misskey has
 *                  no venue, so no native place holds "the photos of a venue".
 *   venue_pin    — Reclub "Pin to home" on a venue (pinVenue / unpinVenue, pinned quick bar). Same shape as the native
 *                  channel_favorite (userId, channelId) that pins a club; a venue is not a channel, so its own row.
 *   venue."coOwnerIds" — Reclub "Manage Owners" (venue-owner.tsx picks several players, selected chips). ownerUserId
 *                  stays the primary owner (the claim flow sets it); the others are co-owners with the same rights.
 */
export class VenuesDiscoverRest1789099200000 {
	name = 'VenuesDiscoverRest1789099200000';

	async up(queryRunner) {
		await queryRunner.query(`CREATE TABLE IF NOT EXISTS "venue_media" (
			"id" character varying(32) NOT NULL,
			"venueId" character varying(32) NOT NULL,
			"fileId" character varying(32) NOT NULL,
			"userId" character varying(32) NOT NULL,
			"isPinned" boolean NOT NULL DEFAULT false,
			"createdAt" timestamp with time zone NOT NULL DEFAULT now(),
			CONSTRAINT "PK_venue_media" PRIMARY KEY ("id"),
			CONSTRAINT "FK_venue_media_venue" FOREIGN KEY ("venueId") REFERENCES "venue"("id") ON DELETE CASCADE,
			CONSTRAINT "FK_venue_media_file" FOREIGN KEY ("fileId") REFERENCES "drive_file"("id") ON DELETE CASCADE,
			CONSTRAINT "FK_venue_media_user" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE
		)`);
		await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_venue_media_venue" ON "venue_media" ("venueId")`);
		await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_venue_media_venue_file" ON "venue_media" ("venueId", "fileId")`);
		await queryRunner.query(`CREATE TABLE IF NOT EXISTS "venue_pin" (
			"id" character varying(32) NOT NULL,
			"userId" character varying(32) NOT NULL,
			"venueId" character varying(32) NOT NULL,
			"createdAt" timestamp with time zone NOT NULL DEFAULT now(),
			CONSTRAINT "PK_venue_pin" PRIMARY KEY ("id"),
			CONSTRAINT "FK_venue_pin_user" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE,
			CONSTRAINT "FK_venue_pin_venue" FOREIGN KEY ("venueId") REFERENCES "venue"("id") ON DELETE CASCADE
		)`);
		await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_venue_pin_user_venue" ON "venue_pin" ("userId", "venueId")`);
		await queryRunner.query(`ALTER TABLE "venue" ADD COLUMN IF NOT EXISTS "coOwnerIds" character varying(32) array NOT NULL DEFAULT '{}'`);
	}

	async down(queryRunner) {
		await queryRunner.query(`ALTER TABLE "venue" DROP COLUMN IF EXISTS "coOwnerIds"`);
		await queryRunner.query(`DROP TABLE IF EXISTS "venue_pin"`);
		await queryRunner.query(`DROP TABLE IF EXISTS "venue_media"`);
	}
}

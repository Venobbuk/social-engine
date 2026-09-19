/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/*
 * CLUB-TIERS-V1 (2026-09-20). Reclub's two relationships with a club: FOLLOWER (channel_following, unchanged) and
 * MEMBER (this table). Until now membership WAS channel_following, so a follow bypassed the club's gate.
 *
 *   club_member        one row per (club, member). The row id is an engine id whose time part is the join date
 *                      (Misskey convention, idService.parse) — backfilled rows reuse the follow row's id (the old
 *                      joinedAt) and the owner's row reuses the channel id (the club's creation date).
 *                      via: open | approval | invite | link | owner | migration   ·   fromFollower: they followed before
 *                      they joined (the insights' follower → member conversion)   ·   invitedById: CLUB-INVITE-V1.
 *   (no new column for "tell me about new meets": that switch is a notification_mute row, scope 'clubMeets',
 *    targetId = the club — CHAT-V2's one mute table — so it belongs to the person, not the tier, and a follower who
 *    joins keeps it.)
 *
 * BACKFILL (nobody loses access): every channel_following row that existed when the tiers FIRST went live becomes a
 * member (via 'migration'), and every club owner becomes a member (via 'owner').
 *
 * review-batch2 #5 — the backfill used to be guarded on "club_member is empty", and down() dropped the table. A
 * revert + re-apply therefore PROMOTED every follower to member (members-only meets, club chat, posting rights), and
 * it deleted the people's 'clubMeets' notification mutes for good. Both are fixed here, per ROW, not per table:
 *   · club_tiers_backfill  one bookkeeping row, written on the first up() and NEVER dropped by down(). It holds the
 *                          newest channel_following id of that moment. Engine ids are time-ordered, so "a follow that
 *                          existed before the tiers went live" is exactly `f."id" <= maxFollowId` — a follow made
 *                          AFTER go-live is greater than the watermark and is never promoted, on any later run.
 *   · club_member_archive  down() parks the memberships here instead of throwing them away, and the next up() puts
 *                          them back first, with their real `via` / `invitedById`, before the watermark backfill runs.
 *   · the 'clubMeets' notification mutes are the PERSON's setting, not the tiers' data — down() leaves them alone.
 * Every statement is still idempotent (IF NOT EXISTS / ON CONFLICT DO NOTHING); channel_following is never touched,
 * so the old model (follow == member) returns exactly on a revert.
 */
// INT-BATCH2: renumbered twice. 1789080000000 (the lane's own) is already taken on the live DB by
// ClubClaimV11789080000000 (CLUB-CLAIM-VERIFY-V1, batch 1); 1789095000000 would then have sorted BEFORE the
// NUKE-* migrations (1789097100001-4), which ship first. 1789097200000 is free and sorts after all of them.
export class ClubTiersV11789097200000 {
	name = 'ClubTiersV11789097200000';

	async up(queryRunner) {
		const count = async (sql) => Number((await queryRunner.query(sql))[0].n);
		const before = {
			follows: await count(`SELECT count(*) AS n FROM "channel_following"`),
			ownedClubs: await count(`SELECT count(*) AS n FROM "channel" WHERE "userId" IS NOT NULL`),
		};
		await queryRunner.query(`CREATE TABLE IF NOT EXISTS "club_member" (
			"id" varchar(32) NOT NULL,
			"channelId" varchar(32) NOT NULL,
			"userId" varchar(32) NOT NULL,
			"via" varchar(16) NOT NULL DEFAULT 'open',
			"fromFollower" boolean NOT NULL DEFAULT false,
			"invitedById" varchar(32),
			CONSTRAINT "PK_club_member" PRIMARY KEY ("id"),
			CONSTRAINT "FK_club_member_channel" FOREIGN KEY ("channelId") REFERENCES "channel"("id") ON DELETE CASCADE,
			CONSTRAINT "FK_club_member_user" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE)`);
		await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_club_member_channel_user" ON "club_member" ("channelId", "userId")`);
		await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_club_member_user" ON "club_member" ("userId")`);

		// the bookkeeping row (one row, forever): when the tiers first went live, and the follow watermark of that moment
		await queryRunner.query(`CREATE TABLE IF NOT EXISTS "club_tiers_backfill" (
			"id" integer NOT NULL DEFAULT 1,
			"at" timestamp with time zone NOT NULL DEFAULT now(),
			"maxFollowId" varchar(32),
			CONSTRAINT "PK_club_tiers_backfill" PRIMARY KEY ("id"),
			CONSTRAINT "CK_club_tiers_backfill_single_row" CHECK ("id" = 1))`);
		const firstRun = (await queryRunner.query(`SELECT 1 AS n FROM "club_tiers_backfill" WHERE "id" = 1`)).length === 0;
		if (firstRun) {
			await queryRunner.query(`INSERT INTO "club_tiers_backfill" ("id", "maxFollowId")
				SELECT 1, (SELECT max("id") FROM "channel_following") ON CONFLICT ("id") DO NOTHING`);
		}
		const watermark = (await queryRunner.query(`SELECT "maxFollowId" AS m FROM "club_tiers_backfill" WHERE "id" = 1`))[0].m;

		// 1. put back what a previous down() parked (their real via / invitedById wins over the backfill below)
		const parked = (await queryRunner.query(`SELECT to_regclass('public.club_member_archive') IS NOT NULL AS t`))[0].t;
		if (parked) {
			await queryRunner.query(`INSERT INTO "club_member" ("id", "channelId", "userId", "via", "fromFollower", "invitedById")
				SELECT a."id", a."channelId", a."userId", a."via", a."fromFollower", a."invitedById" FROM "club_member_archive" a
				WHERE EXISTS (SELECT 1 FROM "channel" c WHERE c."id" = a."channelId") AND EXISTS (SELECT 1 FROM "user" u WHERE u."id" = a."userId")
				ON CONFLICT ("channelId", "userId") DO NOTHING`);
			await queryRunner.query(`DROP TABLE "club_member_archive"`);
		}
		// 2. the follows that existed when the tiers went live are the members of that moment — and ONLY those
		await queryRunner.query(`INSERT INTO "club_member" ("id", "channelId", "userId", "via", "fromFollower")
			SELECT f."id", f."followeeId", f."followerId", 'migration', false FROM "channel_following" f
			WHERE $1::varchar IS NOT NULL AND f."id" <= $1::varchar
			ON CONFLICT ("channelId", "userId") DO NOTHING`, [watermark]);
		// 3. the owner is a member of their club (channels/create never followed them)
		await queryRunner.query(`INSERT INTO "club_member" ("id", "channelId", "userId", "via", "fromFollower")
			SELECT c."id", c."id", c."userId", 'owner', false FROM "channel" c WHERE c."userId" IS NOT NULL
			ON CONFLICT ("channelId", "userId") DO NOTHING`);

		const after = {
			firstRun,
			watermark,
			restoredFromArchive: !!parked,
			members: await count(`SELECT count(*) AS n FROM "club_member"`),
			fromFollows: await count(`SELECT count(*) AS n FROM "club_member" WHERE "via" = 'migration'`),
			owners: await count(`SELECT count(*) AS n FROM "club_member" WHERE "via" = 'owner'`),
			followsUnchanged: await count(`SELECT count(*) AS n FROM "channel_following"`),
			followsWithoutMember: await count(`SELECT count(*) AS n FROM "channel_following" f WHERE NOT EXISTS (SELECT 1 FROM "club_member" m WHERE m."channelId" = f."followeeId" AND m."userId" = f."followerId")`),
			clubMeetsMutes: await count(`SELECT count(*) AS n FROM "notification_mute" WHERE "scope" = 'clubMeets'`),
		};
		console.log('CLUB-TIERS-V1 migration', JSON.stringify({ before, after }));
	}

	async down(queryRunner) {
		// review-batch2 #5: the memberships are PARKED, not thrown away (the next up() restores them), and the people's
		// 'clubMeets' notification mutes are left exactly as they are — they are the person's setting, and under the old
		// model they simply go unread. The watermark row in club_tiers_backfill stays too, so a re-apply can never
		// promote a follower who joined after go-live.
		const exists = (await queryRunner.query(`SELECT to_regclass('public.club_member') IS NOT NULL AS t`))[0].t;
		if (exists) {
			await queryRunner.query(`DROP TABLE IF EXISTS "club_member_archive"`);
			await queryRunner.query(`CREATE TABLE "club_member_archive" AS SELECT * FROM "club_member"`);
		}
		await queryRunner.query(`DROP TABLE IF EXISTS "club_member"`);
	}
}

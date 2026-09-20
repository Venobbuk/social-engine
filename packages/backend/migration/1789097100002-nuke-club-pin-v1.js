/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/*
 * NUKE-CLUB-PIN-V1 (2026-09-20, G11 "adopt Misskey first").
 * "Pin this club to my home screen" was club_member_state."pinnedAt" beside Misskey's own channel favourite
 * (channel_favorite, written by channels/favorite / channels/unfavorite, read by channels/my-favorites and
 * reported on every packed Channel as isFavorited). One fact, two stores. The native one wins.
 *
 * Data: every pinned row becomes a channel_favorite (0 such rows on the live 'social' db and on se_sbx at the
 * time of writing). The club_member_state row itself stays — it still carries pausedAt ("Take a break") and
 * adminRoomId ("Message admins"), which Misskey has no place for.
 */
export class NukeClubPinV11789097100002 {
	name = 'NukeClubPinV11789097100002';

	async up(queryRunner) {
		await queryRunner.query(`
			INSERT INTO "channel_favorite" ("id", "userId", "channelId")
			SELECT s."id", s."userId", s."channelId" FROM "club_member_state" s
			WHERE s."pinnedAt" IS NOT NULL
			  AND EXISTS (SELECT 1 FROM "channel" c WHERE c."id" = s."channelId")
			  AND EXISTS (SELECT 1 FROM "user" u WHERE u."id" = s."userId")
			ON CONFLICT DO NOTHING`);
		await queryRunner.query(`ALTER TABLE "club_member_state" DROP COLUMN IF EXISTS "pinnedAt"`);
	}

	async down(queryRunner) {
		await queryRunner.query(`ALTER TABLE "club_member_state" ADD COLUMN IF NOT EXISTS "pinnedAt" TIMESTAMP WITH TIME ZONE`);
		await queryRunner.query(`COMMENT ON COLUMN "club_member_state"."pinnedAt" IS 'Reclub is_pinned: the club sits on the Home pinned row'`);
		await queryRunner.query(`
			UPDATE "club_member_state" s SET "pinnedAt" = now()
			WHERE EXISTS (SELECT 1 FROM "channel_favorite" f WHERE f."userId" = s."userId" AND f."channelId" = s."channelId")`);
	}
}

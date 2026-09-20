/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/*
 * NUKE-MEET-PHOTOS-V1 (2026-09-20, G11 "adopt Misskey first").
 * meets/media/{add,list,delete} + the meet_media table were a second attachment store beside Misskey's own:
 * a chat message can already carry a drive file (chat/messages/create-to-room {fileId}), the room timeline
 * already lists them with the packed DriveFile, and chat/messages/delete already lets the author OR whoever
 * runs the room (the meet host / co-host, via ChatModeration.runsRoom) remove one.
 * The meet's Photos pane is now the file messages of meet.chatRoomId.
 *
 * Data: every meet_media row becomes a file message in that meet's chat room, from the same uploader, keeping
 * its time (the message id is the media row id, which is an aid minted at the same moment). Rows whose meet has
 * no chat room, or whose uploader is no longer in it, are left in place and the table is kept — the migration
 * only drops meet_media when it is empty afterwards, so nothing is ever silently lost.
 * 0 rows on the live 'social' db and on se_sbx at the time of writing.
 */
export class NukeMeetPhotosV11789097100004 {
	name = 'NukeMeetPhotosV11789097100004';

	async up(queryRunner) {
		await queryRunner.query(`
			INSERT INTO "chat_message" ("id", "fromUserId", "toRoomId", "text", "fileId", "reads")
			SELECT m."id", m."userId", mt."chatRoomId", NULL, m."fileId", '{}'
			FROM "meet_media" m
			JOIN "meet" mt ON mt."id" = m."meetId"
			WHERE mt."chatRoomId" IS NOT NULL
			  AND (mt."hostId" = m."userId" OR EXISTS (
			        SELECT 1 FROM "chat_room_membership" cm WHERE cm."roomId" = mt."chatRoomId" AND cm."userId" = m."userId"))
			ON CONFLICT DO NOTHING`);
		await queryRunner.query(`
			DELETE FROM "meet_media" m
			WHERE EXISTS (SELECT 1 FROM "chat_message" c WHERE c."id" = m."id")`);
		const left = await queryRunner.query(`SELECT count(*)::int AS n FROM "meet_media"`);
		if (Number(left[0].n) === 0) {
			await queryRunner.query(`DROP TABLE IF EXISTS "meet_media"`);
		} else {
			// eslint-disable-next-line no-console
			console.warn(`[NUKE-MEET-PHOTOS-V1] ${left[0].n} meet_media row(s) had no chat room to move to — table KEPT, move them by hand.`);
		}
	}

	async down(queryRunner) {
		await queryRunner.query(`CREATE TABLE IF NOT EXISTS "meet_media" (
			"id" character varying(32) NOT NULL,
			"meetId" character varying(32) NOT NULL,
			"userId" character varying(32) NOT NULL,
			"fileId" character varying(32) NOT NULL,
			"createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
			CONSTRAINT "PK_meet_media" PRIMARY KEY ("id"))`);
		await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_meet_media_meetId" ON "meet_media" ("meetId")`);
		// the messages stay where they are: a photo message is a real chat message now, not a copy
	}
}

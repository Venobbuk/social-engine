/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/*
 * NUKE-CHAT-MUTE-V1 (2026-09-20, G11 "adopt Misskey first").
 * The per-meet chat mute WAS a column of ours (meet_participant."chatMuted") beside the native one
 * (chat_room_membership."isMuted", written by chat/rooms/mute). Two stores for one fact. The native one wins:
 * meets/chat-mute is deleted and the app calls chat/rooms/mute on meet.chatRoomId.
 *
 * Data: every chatMuted=true row is COPIED into the native membership before the column goes (0 such rows on the
 * live 'social' db and on se_sbx at the time of writing — this is here so the migration is correct anywhere).
 * A muted participant who is not yet in the room has nowhere native to put the flag and is listed by the SELECT in
 * `down` only; they re-mute from the meet kebab once the room seats them.
 */
export class NukeChatMuteV11789097100001 {
	name = 'NukeChatMuteV11789097100001';

	async up(queryRunner) {
		await queryRunner.query(`
			UPDATE "chat_room_membership" m SET "isMuted" = true
			FROM "meet_participant" p, "meet" mt
			WHERE p."chatMuted" = true
			  AND mt."id" = p."meetId" AND mt."chatRoomId" IS NOT NULL
			  AND m."roomId" = mt."chatRoomId" AND m."userId" = p."userId"`);
		await queryRunner.query(`ALTER TABLE "meet_participant" DROP COLUMN IF EXISTS "chatMuted"`);
	}

	async down(queryRunner) {
		await queryRunner.query(`ALTER TABLE "meet_participant" ADD COLUMN IF NOT EXISTS "chatMuted" boolean NOT NULL DEFAULT false`);
		await queryRunner.query(`
			UPDATE "meet_participant" p SET "chatMuted" = true
			FROM "meet" mt, "chat_room_membership" m
			WHERE mt."id" = p."meetId" AND mt."chatRoomId" IS NOT NULL
			  AND m."roomId" = mt."chatRoomId" AND m."userId" = p."userId" AND m."isMuted" = true`);
	}
}

/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/* CLUB-CHAT-V1 (2026-09-17). A club's chat room (Reclub group chat): one engine chat room per club, minted on first
 * open. Additive, idempotent. */
export class ClubChatV11789000400000 {
	name = 'ClubChatV11789000400000';

	async up(queryRunner) {
		await queryRunner.query(`ALTER TABLE "club_setting" ADD COLUMN IF NOT EXISTS "chatRoomId" character varying(32)`);
	}

	async down(queryRunner) {
		await queryRunner.query(`ALTER TABLE "club_setting" DROP COLUMN IF EXISTS "chatRoomId"`);
	}
}

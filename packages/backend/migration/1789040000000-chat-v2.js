/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/* CHAT-V2 (2026-09-19) — Reclub chat parity: rich messages, per-thread mutes, archive rule.
 *  chat_message.attachment  jsonb  — a card riding on the message: { kind: 'meet', meetId, name, startAt, venueName }
 *  chat_message.system      jsonb  — a system line (Reclub ChannelMessageType.System): { key: 'joined' | 'cancelled' |
 *                                    'time' | 'venue' | 'fee' | 'ended', name?: string, meetId?: string }
 *  chat_room.readOnlyAt     timestamptz — the archive rule: after this instant nobody may send (meet chats: the end of
 *                                    the meet + 14 days; competition chats: + 7 days). NULL = open.
 *  notification_mute        — one table for every "turn notifications off" switch: a thread (scope room / user with the
 *                                    target id) and the app-level toggles (scope club / chat / promoted / updates, target '').
 * Additive, idempotent. */
export class ChatV21789040000000 {
	name = 'ChatV21789040000000';

	async up(queryRunner) {
		await queryRunner.query(`ALTER TABLE "chat_message" ADD COLUMN IF NOT EXISTS "attachment" jsonb`);
		await queryRunner.query(`ALTER TABLE "chat_message" ADD COLUMN IF NOT EXISTS "system" jsonb`);
		await queryRunner.query(`ALTER TABLE "chat_room" ADD COLUMN IF NOT EXISTS "readOnlyAt" TIMESTAMP WITH TIME ZONE`);
		await queryRunner.query(`CREATE TABLE IF NOT EXISTS "notification_mute" (
			"id" character varying(32) NOT NULL,
			"userId" character varying(32) NOT NULL,
			"scope" character varying(16) NOT NULL,
			"targetId" character varying(32) NOT NULL DEFAULT '',
			"createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
			CONSTRAINT "PK_notification_mute" PRIMARY KEY ("id")
		)`);
		await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_notification_mute_user_scope_target" ON "notification_mute" ("userId", "scope", "targetId")`);
		await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_notification_mute_scope_target" ON "notification_mute" ("scope", "targetId")`);
	}

	async down(queryRunner) {
		await queryRunner.query(`DROP TABLE IF EXISTS "notification_mute"`);
		await queryRunner.query(`ALTER TABLE "chat_room" DROP COLUMN IF EXISTS "readOnlyAt"`);
		await queryRunner.query(`ALTER TABLE "chat_message" DROP COLUMN IF EXISTS "system"`);
		await queryRunner.query(`ALTER TABLE "chat_message" DROP COLUMN IF EXISTS "attachment"`);
	}
}

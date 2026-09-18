/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/*
 * HOST-TOOLS-V1 (2026-09-19). The host's roster tools that Reclub's participant sheet / Payments Manager / Details
 * kebab carry and the engine did not yet store:
 *   meet_participant.chatMuted     — "Turn off chat notifications" for THIS meet (the room owner has no chat_room_membership
 *                                    row, so the flag lives here; ChatService also honours it for the owner via redis)
 *   meet_participant.receipt*      — the proof of payment (a drive file: id, url, when, by whom) — Reclub PaymentTransaction
 * Additive, idempotent.
 */
export class HostToolsV11789020000000 {
	name = 'HostToolsV11789020000000';

	async up(queryRunner) {
		await queryRunner.query(`ALTER TABLE "meet_participant" ADD COLUMN IF NOT EXISTS "chatMuted" boolean NOT NULL DEFAULT false`);
		await queryRunner.query(`ALTER TABLE "meet_participant" ADD COLUMN IF NOT EXISTS "receiptFileId" character varying(32)`);
		await queryRunner.query(`ALTER TABLE "meet_participant" ADD COLUMN IF NOT EXISTS "receiptUrl" character varying(1024)`);
		await queryRunner.query(`ALTER TABLE "meet_participant" ADD COLUMN IF NOT EXISTS "receiptAt" timestamp with time zone`);
		await queryRunner.query(`ALTER TABLE "meet_participant" ADD COLUMN IF NOT EXISTS "receiptById" character varying(32)`);
	}

	async down(queryRunner) {
		await queryRunner.query(`ALTER TABLE "meet_participant" DROP COLUMN IF EXISTS "receiptById"`);
		await queryRunner.query(`ALTER TABLE "meet_participant" DROP COLUMN IF EXISTS "receiptAt"`);
		await queryRunner.query(`ALTER TABLE "meet_participant" DROP COLUMN IF EXISTS "receiptUrl"`);
		await queryRunner.query(`ALTER TABLE "meet_participant" DROP COLUMN IF EXISTS "receiptFileId"`);
		await queryRunner.query(`ALTER TABLE "meet_participant" DROP COLUMN IF EXISTS "chatMuted"`);
	}
}

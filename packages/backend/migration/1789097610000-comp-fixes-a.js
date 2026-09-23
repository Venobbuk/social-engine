/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/*
 * COMP-FIXES-A (2026-09-23). Registration / entries / teams / invitations / roles / chats rows of the L6 scope sweep.
 *   competition        hideRoster boolean              Reclub Hide roster as a SAVED setting (was a local view toggle)
 *                      spectatorAutoApprove boolean    Reclub Spectators "Auto approve" (off = Requested / Approved)
 *                      coverFileIds varchar(32)[]      host cover photos (drive files, first = primary)
 *                      chatRooms jsonb                 { captain?, staff?, forum? } chat room ids
 *   competition_entry  reserved jsonb                  reserved spot { gender, ageGroup, level }
 *                      positions jsonb                 { userId: position }
 *                      chatRoomId varchar(32)          the team chat room
 * The new entry statuses ('invited', 'spectatorPending') fit the existing varchar(16) column — no DDL for them.
 * Additive and idempotent (IF [NOT] EXISTS, constant defaults): existing rows read as before (roster shown, spectators
 * auto-approved, no covers, no extra rooms); down() restores the previous shape. No data is read, written or moved.
 */
export class CompFixesA1789097610000 {
	name = 'CompFixesA1789097610000';

	async up(queryRunner) {
		await queryRunner.query(`ALTER TABLE "competition" ADD COLUMN IF NOT EXISTS "hideRoster" boolean NOT NULL DEFAULT false`);
		await queryRunner.query(`ALTER TABLE "competition" ADD COLUMN IF NOT EXISTS "spectatorAutoApprove" boolean NOT NULL DEFAULT true`);
		await queryRunner.query(`ALTER TABLE "competition" ADD COLUMN IF NOT EXISTS "coverFileIds" character varying(32) array NOT NULL DEFAULT '{}'`);
		await queryRunner.query(`ALTER TABLE "competition" ADD COLUMN IF NOT EXISTS "chatRooms" jsonb NOT NULL DEFAULT '{}'`);
		await queryRunner.query(`ALTER TABLE "competition_entry" ADD COLUMN IF NOT EXISTS "reserved" jsonb`);
		await queryRunner.query(`ALTER TABLE "competition_entry" ADD COLUMN IF NOT EXISTS "positions" jsonb NOT NULL DEFAULT '{}'`);
		await queryRunner.query(`ALTER TABLE "competition_entry" ADD COLUMN IF NOT EXISTS "chatRoomId" character varying(32)`);
	}

	async down(queryRunner) {
		await queryRunner.query(`ALTER TABLE "competition_entry" DROP COLUMN IF EXISTS "chatRoomId"`);
		await queryRunner.query(`ALTER TABLE "competition_entry" DROP COLUMN IF EXISTS "positions"`);
		await queryRunner.query(`ALTER TABLE "competition_entry" DROP COLUMN IF EXISTS "reserved"`);
		await queryRunner.query(`ALTER TABLE "competition" DROP COLUMN IF EXISTS "chatRooms"`);
		await queryRunner.query(`ALTER TABLE "competition" DROP COLUMN IF EXISTS "coverFileIds"`);
		await queryRunner.query(`ALTER TABLE "competition" DROP COLUMN IF EXISTS "spectatorAutoApprove"`);
		await queryRunner.query(`ALTER TABLE "competition" DROP COLUMN IF EXISTS "hideRoster"`);
	}
}

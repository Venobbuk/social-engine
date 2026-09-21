/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/*
 * COMP-DUPR-V1 (2026-09-21). A TOURNAMENT match can go to DUPR down the same path a meet match takes, so
 * competition_match gets the same five dupr* columns meet_match has carried since MEET-MATCH-V1
 * (1789000100000-meet-match-v1.js:25-29) — same names, same types, same widths:
 *   duprStatus         varchar(16)   queued | submitted | failed | ineligible (null = never sent)
 *   duprSubmittedById  varchar(32)   who sent it
 *   duprSubmittedAt    timestamptz   when
 *   duprRef            varchar(128)  hkpl's queue id, then DUPR's match id once drained
 *   duprError          varchar(512)  why it did not go
 * DUPR itself lives on hkpl (SOCIAL-DUPR-V1): this table only remembers what was sent and what came back.
 * Additive and idempotent — every statement is IF [NOT] EXISTS, so a re-run is a no-op and down() restores the
 * table to its previous shape. No data is read, written or moved.
 */
export class CompDuprV11789097300000 {
	name = 'CompDuprV11789097300000';

	async up(queryRunner) {
		await queryRunner.query(`ALTER TABLE "competition_match" ADD COLUMN IF NOT EXISTS "duprStatus" character varying(16)`);
		await queryRunner.query(`ALTER TABLE "competition_match" ADD COLUMN IF NOT EXISTS "duprSubmittedById" character varying(32)`);
		await queryRunner.query(`ALTER TABLE "competition_match" ADD COLUMN IF NOT EXISTS "duprSubmittedAt" timestamp with time zone`);
		await queryRunner.query(`ALTER TABLE "competition_match" ADD COLUMN IF NOT EXISTS "duprRef" character varying(128)`);
		await queryRunner.query(`ALTER TABLE "competition_match" ADD COLUMN IF NOT EXISTS "duprError" character varying(512)`);
	}

	async down(queryRunner) {
		await queryRunner.query(`ALTER TABLE "competition_match" DROP COLUMN IF EXISTS "duprError"`);
		await queryRunner.query(`ALTER TABLE "competition_match" DROP COLUMN IF EXISTS "duprRef"`);
		await queryRunner.query(`ALTER TABLE "competition_match" DROP COLUMN IF EXISTS "duprSubmittedAt"`);
		await queryRunner.query(`ALTER TABLE "competition_match" DROP COLUMN IF EXISTS "duprSubmittedById"`);
		await queryRunner.query(`ALTER TABLE "competition_match" DROP COLUMN IF EXISTS "duprStatus"`);
	}
}

/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/*
 * COMP-FIXES-B (2026-09-23). Matches / scoring / format of the competitions (lane comp-fixes-b):
 *   competition        consolationBracket boolean   Reclub match format "Consolation Bracket" (pool play)
 *                      scoreSetDefaults jsonb        Reclub score-set configuration [{ name?, type }] — every match's default sets
 *   competition_match  name varchar(64)              Reclub Create / Edit match "Name"
 * (The serve tag and the per-set line-up live inside competition_match.scores jsonb — no column.)
 * Additive and idempotent — IF [NOT] EXISTS with constant defaults, so existing rows read exactly as before (no consolation,
 * no default sets, no name) and down() restores the previous shape. No data is read, written or moved.
 */
export class CompFixesB1789097682000 {
	name = 'CompFixesB1789097682000';

	async up(queryRunner) {
		await queryRunner.query(`ALTER TABLE "competition" ADD COLUMN IF NOT EXISTS "consolationBracket" boolean NOT NULL DEFAULT false`);
		await queryRunner.query(`ALTER TABLE "competition" ADD COLUMN IF NOT EXISTS "scoreSetDefaults" jsonb NOT NULL DEFAULT '[]'`);
		await queryRunner.query(`ALTER TABLE "competition_match" ADD COLUMN IF NOT EXISTS "name" character varying(64)`);
	}

	async down(queryRunner) {
		await queryRunner.query(`ALTER TABLE "competition_match" DROP COLUMN IF EXISTS "name"`);
		await queryRunner.query(`ALTER TABLE "competition" DROP COLUMN IF EXISTS "scoreSetDefaults"`);
		await queryRunner.query(`ALTER TABLE "competition" DROP COLUMN IF EXISTS "consolationBracket"`);
	}
}

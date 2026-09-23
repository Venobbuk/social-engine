/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/*
 * COMP-T3-V1 (2026-09-23). The competitions tail of the Reclub triage (probes/t3-competitions.verdict.json): the columns
 * the verified-missing functions need, and nothing else.
 *   competition        courtLabels varchar(32)[]      Reclub Customize Courts (index = competition_match.courtIndex)
 *                      roundRobinCycles integer        Single / Double / Triple round robin (1..3)
 *                      feeFreeAgentAmount integer      Reclub feeFreeAgentAmount
 *                      feeFreeAgentEarlyBirdAmount     Reclub feeFreeAgentEarlyBirdAmount
 *                      membersOnly boolean             a club competition open to the club's members only
 *                      stageNames jsonb                { regular?, playoff?, consolation? }
 *                      matchRules varchar(2048)        Reclub MATCH RULES
 *   competition_entry  eligibility jsonb               the host's eligibility calls { userId: boolean }
 *                      avatarFileId varchar(32)        the team avatar (a drive file)
 *   competition_match  refereeIds varchar(32)[]        this match's referees
 *                      availability jsonb              { userId: yes | maybe | no }
 * Additive and idempotent — every statement is IF [NOT] EXISTS with a constant default, so existing rows read exactly as
 * before (1 cycle, no labels, no overrides) and down() restores the previous shape. No data is read, written or moved.
 */
export class CompT3V11789097500000 {
	name = 'CompT3V11789097500000';

	async up(queryRunner) {
		await queryRunner.query(`ALTER TABLE "competition" ADD COLUMN IF NOT EXISTS "courtLabels" character varying(32) array NOT NULL DEFAULT '{}'`);
		await queryRunner.query(`ALTER TABLE "competition" ADD COLUMN IF NOT EXISTS "roundRobinCycles" integer NOT NULL DEFAULT 1`);
		await queryRunner.query(`ALTER TABLE "competition" ADD COLUMN IF NOT EXISTS "feeFreeAgentAmount" integer`);
		await queryRunner.query(`ALTER TABLE "competition" ADD COLUMN IF NOT EXISTS "feeFreeAgentEarlyBirdAmount" integer`);
		await queryRunner.query(`ALTER TABLE "competition" ADD COLUMN IF NOT EXISTS "membersOnly" boolean NOT NULL DEFAULT false`);
		await queryRunner.query(`ALTER TABLE "competition" ADD COLUMN IF NOT EXISTS "stageNames" jsonb NOT NULL DEFAULT '{}'`);
		await queryRunner.query(`ALTER TABLE "competition" ADD COLUMN IF NOT EXISTS "matchRules" character varying(2048)`);
		await queryRunner.query(`ALTER TABLE "competition_entry" ADD COLUMN IF NOT EXISTS "eligibility" jsonb NOT NULL DEFAULT '{}'`);
		await queryRunner.query(`ALTER TABLE "competition_entry" ADD COLUMN IF NOT EXISTS "avatarFileId" character varying(32)`);
		await queryRunner.query(`ALTER TABLE "competition_match" ADD COLUMN IF NOT EXISTS "refereeIds" character varying(32) array NOT NULL DEFAULT '{}'`);
		await queryRunner.query(`ALTER TABLE "competition_match" ADD COLUMN IF NOT EXISTS "availability" jsonb NOT NULL DEFAULT '{}'`);
	}

	async down(queryRunner) {
		await queryRunner.query(`ALTER TABLE "competition_match" DROP COLUMN IF EXISTS "availability"`);
		await queryRunner.query(`ALTER TABLE "competition_match" DROP COLUMN IF EXISTS "refereeIds"`);
		await queryRunner.query(`ALTER TABLE "competition_entry" DROP COLUMN IF EXISTS "avatarFileId"`);
		await queryRunner.query(`ALTER TABLE "competition_entry" DROP COLUMN IF EXISTS "eligibility"`);
		await queryRunner.query(`ALTER TABLE "competition" DROP COLUMN IF EXISTS "matchRules"`);
		await queryRunner.query(`ALTER TABLE "competition" DROP COLUMN IF EXISTS "stageNames"`);
		await queryRunner.query(`ALTER TABLE "competition" DROP COLUMN IF EXISTS "membersOnly"`);
		await queryRunner.query(`ALTER TABLE "competition" DROP COLUMN IF EXISTS "feeFreeAgentEarlyBirdAmount"`);
		await queryRunner.query(`ALTER TABLE "competition" DROP COLUMN IF EXISTS "feeFreeAgentAmount"`);
		await queryRunner.query(`ALTER TABLE "competition" DROP COLUMN IF EXISTS "roundRobinCycles"`);
		await queryRunner.query(`ALTER TABLE "competition" DROP COLUMN IF EXISTS "courtLabels"`);
	}
}

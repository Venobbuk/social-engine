/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// ACCOUNT-REST-V1 (lane account-rest, 2026-09-24)
//  gb_account_deletion — ACCOUNT-GRACE-V1: a deletion is scheduled for 7 days (modules/account/deletion.ts), restorable.
//  meet_match / competition_match "duprBasis" + "duprScoring" — DUPR-OPTIONS-V1: what the host chose on the DUPR confirm
//    sheet (Submission basis Matches / Sets, Scoring type Sideout / Rally), kept on the row so a retry sends the same thing.
// Additive and idempotent (IF NOT EXISTS); down drops exactly what up added.
export class AccountRest1789099300000 {
	name = 'AccountRest1789099300000';

	async up(queryRunner) {
		await queryRunner.query(`CREATE TABLE IF NOT EXISTS "gb_account_deletion" ("userId" character varying(32) NOT NULL, "requestedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "purgeAt" TIMESTAMP WITH TIME ZONE NOT NULL, "how" character varying(128), "wasExplorable" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_gb_account_deletion" PRIMARY KEY ("userId"))`);
		await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_gb_account_deletion_purgeAt" ON "gb_account_deletion" ("purgeAt")`);
		await queryRunner.query(`ALTER TABLE "meet_match" ADD COLUMN IF NOT EXISTS "duprBasis" character varying(8)`);
		await queryRunner.query(`ALTER TABLE "meet_match" ADD COLUMN IF NOT EXISTS "duprScoring" character varying(8)`);
		await queryRunner.query(`ALTER TABLE "competition_match" ADD COLUMN IF NOT EXISTS "duprBasis" character varying(8)`);
		await queryRunner.query(`ALTER TABLE "competition_match" ADD COLUMN IF NOT EXISTS "duprScoring" character varying(8)`);
	}

	async down(queryRunner) {
		await queryRunner.query(`ALTER TABLE "competition_match" DROP COLUMN IF EXISTS "duprScoring"`);
		await queryRunner.query(`ALTER TABLE "competition_match" DROP COLUMN IF EXISTS "duprBasis"`);
		await queryRunner.query(`ALTER TABLE "meet_match" DROP COLUMN IF EXISTS "duprScoring"`);
		await queryRunner.query(`ALTER TABLE "meet_match" DROP COLUMN IF EXISTS "duprBasis"`);
		await queryRunner.query(`DROP INDEX IF EXISTS "IDX_gb_account_deletion_purgeAt"`);
		await queryRunner.query(`DROP TABLE IF EXISTS "gb_account_deletion"`);
	}
}

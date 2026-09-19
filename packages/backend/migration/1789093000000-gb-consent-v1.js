/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/* GB-CONSENT-V1 (2026-09-20; batch-1 review fix: per ACCOUNT, with history) — the GripBat terms / privacy acceptance.
 *  gb_terms_acceptance  one row per acceptance, append-only: (userId, version, acceptedAt by the server's clock).
 *  meets/level { acceptTerms: '<version>' } appends a row unless that version is already the member's latest; the
 *  member's current consent is their latest row. Nothing is ever overwritten, so what was accepted when stays on record.
 * Additive, idempotent. */
export class GbConsentV11789093000000 {
	name = 'GbConsentV11789093000000';

	async up(queryRunner) {
		await queryRunner.query(`CREATE TABLE IF NOT EXISTS "gb_terms_acceptance" (
			"id" character varying(32) NOT NULL,
			"userId" character varying(32) NOT NULL,
			"version" character varying(32) NOT NULL,
			"acceptedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
			CONSTRAINT "PK_gb_terms_acceptance" PRIMARY KEY ("id"),
			CONSTRAINT "FK_gb_terms_acceptance_user" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE)`);
		await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_gb_terms_acceptance_user_at" ON "gb_terms_acceptance" ("userId", "acceptedAt" DESC)`);
	}

	async down(queryRunner) {
		await queryRunner.query(`DROP TABLE IF EXISTS "gb_terms_acceptance"`);
	}
}

/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// FIX-S8 (lane fix-S8, 2026-09-24)
//  gb_user_pref — LAST-ACTIVE-OPTIN-V1 (E-chat-room.01): a member's GripBat-only preferences, one row per member. Today one
//    column: "lastActiveExact" — the member allows others to see the exact "Active 2h ago" instead of Misskey's buckets
//    (default false = buckets; the native user.hideOnlineStatus still hides presence altogether).
// Additive and idempotent (IF NOT EXISTS); down drops exactly what up added.
export class FixS81789099480000 {
	name = 'FixS81789099480000';

	async up(queryRunner) {
		await queryRunner.query(`CREATE TABLE IF NOT EXISTS "gb_user_pref" ("userId" character varying(32) NOT NULL, "lastActiveExact" boolean NOT NULL DEFAULT false, "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_gb_user_pref" PRIMARY KEY ("userId"), CONSTRAINT "FK_gb_user_pref_user" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE)`);
	}

	async down(queryRunner) {
		await queryRunner.query(`DROP TABLE IF EXISTS "gb_user_pref"`);
	}
}

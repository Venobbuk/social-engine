/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/*
 * KUDOS-CHAT-V1 (lane kudos-chat, 2026-09-23). The S8 verifier rows that need a column.
 *
 * meet_review — the 'endorsement' row IS GripBat's kudos (up to 3 dimensions, public; T3 432d552 kept that model).
 * Reclub gives kudos per ACTIVITY (KudoReferenceType Meet | Competition): a pair played three meets, three kudos.
 * GripBat kept ONE endorsement per pair for life, so a later meet overwrote the earlier one and a competition could
 * not hold kudos at all.
 *   competitionId varchar(32)   the competition a kudos was given in; FK competition ON DELETE SET NULL (like meetId)
 *   note varchar(512)           the endorsement's "Any additional notes?" (Reclub common.endorsement_note)
 *   unique (author, target, type)                 now only for feedback / warning (one per pair, as before)
 *   unique (author, target, meetId)               endorsement, per meet
 *   unique (author, target, competitionId)        endorsement, per competition
 *   unique (author, target) WHERE both refs null  a legacy endorsement whose meet was deleted stays single
 * chat_message — Reclub "Message unsent" / "removed by an admin" + Undelete (soft delete):
 *   deletedAt timestamptz, deletedById varchar(32)
 * kudos_award — Reclub "MOST STREET CRED of the month": one winner per closed month per dimension ('' = all kudos).
 *   Written by stats/kudos-awards the first time a closed month is read (a closed month is final, so the result equals
 *   a month-end job's); seenAt = the winner dismissed the popup.
 * Existing rows are untouched (no data is moved); down() restores the previous shape — where a pair now holds several
 * endorsements (possible only after up) the newest is kept (lossy by design; rehearsed on a copy).
 */
export class KudosChatV11789098800000 {
	name = 'KudosChatV11789098800000';

	async up(queryRunner) {
		await queryRunner.query(`ALTER TABLE "meet_review" ADD COLUMN IF NOT EXISTS "competitionId" character varying(32)`);
		await queryRunner.query(`ALTER TABLE "meet_review" ADD COLUMN IF NOT EXISTS "note" character varying(512)`);
		await queryRunner.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_meet_review_competition') THEN ALTER TABLE "meet_review" ADD CONSTRAINT "FK_meet_review_competition" FOREIGN KEY ("competitionId") REFERENCES "competition"("id") ON DELETE SET NULL; END IF; END $$`);
		await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_meet_review_competition" ON "meet_review" ("competitionId")`);
		await queryRunner.query(`DROP INDEX IF EXISTS "IDX_meet_review_author_target_type"`);
		await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_meet_review_author_target_type" ON "meet_review" ("authorId", "targetUserId", "type") WHERE "type" <> 'endorsement'`);
		await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_meet_review_endorse_meet" ON "meet_review" ("authorId", "targetUserId", "meetId") WHERE "type" = 'endorsement' AND "meetId" IS NOT NULL`);
		await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_meet_review_endorse_comp" ON "meet_review" ("authorId", "targetUserId", "competitionId") WHERE "type" = 'endorsement' AND "competitionId" IS NOT NULL`);
		await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_meet_review_endorse_none" ON "meet_review" ("authorId", "targetUserId") WHERE "type" = 'endorsement' AND "meetId" IS NULL AND "competitionId" IS NULL`);

		await queryRunner.query(`ALTER TABLE "chat_message" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP WITH TIME ZONE`);
		await queryRunner.query(`ALTER TABLE "chat_message" ADD COLUMN IF NOT EXISTS "deletedById" character varying(32)`);

		await queryRunner.query(`CREATE TABLE IF NOT EXISTS "kudos_award" ("id" character varying(32) NOT NULL, "month" character varying(7) NOT NULL, "dimension" character varying(64) NOT NULL DEFAULT '', "userId" character varying(32) NOT NULL, "kudos" integer NOT NULL, "people" integer NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "seenAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_kudos_award" PRIMARY KEY ("id"), CONSTRAINT "FK_kudos_award_user" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE)`);
		await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_kudos_award_month_dim" ON "kudos_award" ("month", "dimension")`);
		await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_kudos_award_user" ON "kudos_award" ("userId")`);
	}

	async down(queryRunner) {
		await queryRunner.query(`DROP TABLE IF EXISTS "kudos_award"`);
		await queryRunner.query(`ALTER TABLE "chat_message" DROP COLUMN IF EXISTS "deletedById"`);
		await queryRunner.query(`ALTER TABLE "chat_message" DROP COLUMN IF EXISTS "deletedAt"`);
		await queryRunner.query(`DROP INDEX IF EXISTS "IDX_meet_review_endorse_none"`);
		await queryRunner.query(`DROP INDEX IF EXISTS "IDX_meet_review_endorse_comp"`);
		await queryRunner.query(`DROP INDEX IF EXISTS "IDX_meet_review_endorse_meet"`);
		await queryRunner.query(`DROP INDEX IF EXISTS "IDX_meet_review_author_target_type"`);
		// several endorsements per pair (one per activity) → keep the newest, as the one-per-pair index requires
		await queryRunner.query(`DELETE FROM "meet_review" r USING "meet_review" n WHERE r."type" = 'endorsement' AND n."type" = 'endorsement' AND n."authorId" = r."authorId" AND n."targetUserId" = r."targetUserId" AND (n."createdAt" > r."createdAt" OR (n."createdAt" = r."createdAt" AND n."id" > r."id"))`);
		await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_meet_review_author_target_type" ON "meet_review" ("authorId", "targetUserId", "type")`);
		await queryRunner.query(`DROP INDEX IF EXISTS "IDX_meet_review_competition"`);
		await queryRunner.query(`ALTER TABLE "meet_review" DROP CONSTRAINT IF EXISTS "FK_meet_review_competition"`);
		await queryRunner.query(`ALTER TABLE "meet_review" DROP COLUMN IF EXISTS "note"`);
		await queryRunner.query(`ALTER TABLE "meet_review" DROP COLUMN IF EXISTS "competitionId"`);
	}
}

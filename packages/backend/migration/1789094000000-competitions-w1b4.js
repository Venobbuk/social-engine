/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/*
 * COMP-W1B4 (2026-09-20). Reclub competition parity (probes/reclub-triage.json family "competitions"):
 *   competition_entry  + invitedUserIds   partners named by the entrant who have not accepted yet (T1 partner consent:
 *                                         nobody is seated in a team, or its chat, without saying yes)
 *                      + requestedUserIds players asking to join an existing team (the captain accepts / declines)
 *   competition        + adminIds, refereeIds  co-admins (manage everything the host does) and referees (score any match)
 *                      + announcements        the host's announcements ([{id, userId, text, createdAt}], newest first)
 * A free agent (Reclub "Join as free agent") needs no column: it is an entry with status 'freeAgent' (one player + notes,
 * never drawn, never counted as an entry, never locks the player out of a team; the host assigns them to a team).
 * Additive, idempotent.
 */
export class CompetitionsW1B41789094000000 {
	name = 'CompetitionsW1B41789094000000';

	async up(queryRunner) {
		await queryRunner.query(`ALTER TABLE "competition_entry" ADD COLUMN IF NOT EXISTS "invitedUserIds" character varying(32) array NOT NULL DEFAULT '{}'`);
		await queryRunner.query(`ALTER TABLE "competition_entry" ADD COLUMN IF NOT EXISTS "requestedUserIds" character varying(32) array NOT NULL DEFAULT '{}'`);
		await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_competition_entry_invitedUserIds" ON "competition_entry" USING gin ("invitedUserIds")`);
		await queryRunner.query(`ALTER TABLE "competition" ADD COLUMN IF NOT EXISTS "adminIds" character varying(32) array NOT NULL DEFAULT '{}'`);
		await queryRunner.query(`ALTER TABLE "competition" ADD COLUMN IF NOT EXISTS "refereeIds" character varying(32) array NOT NULL DEFAULT '{}'`);
		await queryRunner.query(`ALTER TABLE "competition" ADD COLUMN IF NOT EXISTS "announcements" jsonb NOT NULL DEFAULT '[]'`);
	}

	async down(queryRunner) {
		await queryRunner.query(`ALTER TABLE "competition" DROP COLUMN IF EXISTS "announcements"`);
		await queryRunner.query(`ALTER TABLE "competition" DROP COLUMN IF EXISTS "refereeIds"`);
		await queryRunner.query(`ALTER TABLE "competition" DROP COLUMN IF EXISTS "adminIds"`);
		await queryRunner.query(`DROP INDEX IF EXISTS "IDX_competition_entry_invitedUserIds"`);
		await queryRunner.query(`ALTER TABLE "competition_entry" DROP COLUMN IF EXISTS "requestedUserIds"`);
		await queryRunner.query(`ALTER TABLE "competition_entry" DROP COLUMN IF EXISTS "invitedUserIds"`);
	}
}

/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/*
 * NUKE-COACH-V1 (2026-09-20, G11 "adopt Misskey first").
 * The coaches module (coaches/show, coaches/update, coaches/list + five coach* columns on meet_player_level) let
 * ANYONE declare themselves a coach. Misskey already has both halves:
 *   - who is a coach  -> a ROLE a moderator grants (admin/roles/assign); roles/users lists the holders; the badge
 *                        shows on the profile; users/show.roles reports it.
 *   - the details     -> the native profile fields[] (user_profile."fields", written by i/update).
 * This migration creates the role (fixed id, so app and engine can name it) and drops the five columns.
 *
 * The role is PLAIN: isModerator / isAdministrator false, no policies — it grants no power, it is a label.
 * target 'manual' means nobody is auto-assigned; isPublic + isExplorable are what roles/users requires.
 *
 * Data: 0 rows with coachStatus IS NOT NULL on the live 'social' db and on se_sbx at the time of writing, so there
 * is nothing to move. Any row that did exist is copied into the profile fields below before the columns go, and the
 * role is granted to its owner, so no coach is silently deleted.
 */
const ROLE_ID = 'arc5w1aagbcoach1';

export class NukeCoachV11789097100003 {
	name = 'NukeCoachV11789097100003';

	async up(queryRunner) {
		await queryRunner.query(`
			INSERT INTO "role" ("id", "updatedAt", "lastUsedAt", "name", "description", "isPublic", "isExplorable", "asBadge", "target", "color", "displayOrder")
			VALUES ($1, now(), now(), 'Coach', 'Granted by GripBat staff to a verified coach. Their experience, rate and notes live on their profile.', true, true, true, 'manual', '#FF5A36', 10)
			ON CONFLICT ("id") DO NOTHING`, [ROLE_ID]);

		// any existing coach keeps their details, as profile fields, and gets the role
		await queryRunner.query(`
			UPDATE "user_profile" p SET "fields" = (
				COALESCE(p."fields", '[]'::jsonb)
				|| CASE WHEN l."coachExperience" IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(jsonb_build_object('name', 'Coaching experience', 'value', l."coachExperience")) END
				|| CASE WHEN l."coachRate"       IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(jsonb_build_object('name', 'Coaching rate',       'value', l."coachRate"))       END
				|| CASE WHEN l."coachNotes"      IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(jsonb_build_object('name', 'Coaching notes',      'value', l."coachNotes"))      END
			)
			FROM "meet_player_level" l
			WHERE l."userId" = p."userId" AND l."coachStatus" IS NOT NULL`);
		await queryRunner.query(`
			INSERT INTO "role_assignment" ("id", "roleId", "userId")
			SELECT l."id", $1, l."userId" FROM "meet_player_level" l
			WHERE l."coachStatus" = 'active'
			ON CONFLICT DO NOTHING`, [ROLE_ID]);

		for (const col of ['coachStatus', 'coachExperience', 'coachRate', 'coachNotes', 'coachUpdatedAt']) {
			await queryRunner.query(`ALTER TABLE "meet_player_level" DROP COLUMN IF EXISTS "${col}"`);
		}
	}

	async down(queryRunner) {
		await queryRunner.query(`ALTER TABLE "meet_player_level" ADD COLUMN IF NOT EXISTS "coachStatus" character varying(16)`);
		await queryRunner.query(`ALTER TABLE "meet_player_level" ADD COLUMN IF NOT EXISTS "coachExperience" character varying(2048)`);
		await queryRunner.query(`ALTER TABLE "meet_player_level" ADD COLUMN IF NOT EXISTS "coachRate" character varying(256)`);
		await queryRunner.query(`ALTER TABLE "meet_player_level" ADD COLUMN IF NOT EXISTS "coachNotes" character varying(2048)`);
		await queryRunner.query(`ALTER TABLE "meet_player_level" ADD COLUMN IF NOT EXISTS "coachUpdatedAt" timestamp with time zone`);
		await queryRunner.query(`
			UPDATE "meet_player_level" l SET "coachStatus" = 'active', "coachUpdatedAt" = now()
			WHERE EXISTS (SELECT 1 FROM "role_assignment" a WHERE a."roleId" = $1 AND a."userId" = l."userId")`, [ROLE_ID]);
		await queryRunner.query(`DELETE FROM "role_assignment" WHERE "roleId" = $1`, [ROLE_ID]);
		await queryRunner.query(`DELETE FROM "role" WHERE "id" = $1`, [ROLE_ID]);
	}
}

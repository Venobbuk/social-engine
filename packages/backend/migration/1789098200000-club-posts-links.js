/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/*
 * CLUB-POSTS-LINKS-V1 (lane club-posts-links, 2026-09-23) — the columns behind four Reclub rows.
 *   club_setting.allowOutsideLinks   Reclub "Allow outside activity links" (B-set-comms.03); default true = today's behaviour
 *   club_setting.handle              Reclub club handle /clubs/@handle (B-set-profile.03 / B-link-club.02); unique when set
 *   poll.allowAddChoices             Reclub "Allow adding new options" (B-create-poll.02) on Misskey's own poll row
 *   poll.choiceAddedBy               who added each choice ('' = the author's own) — "Added by you"
 * Per-post visibility (B-content-editor.07) needs no column: it is Misskey's own note.visibility.
 * Every statement is idempotent (IF NOT EXISTS); down() drops only what up() added.
 */
export class ClubPostsLinks1789098200000 {
	name = 'ClubPostsLinks1789098200000';

	async up(queryRunner) {
		await queryRunner.query(`ALTER TABLE "club_setting" ADD COLUMN IF NOT EXISTS "allowOutsideLinks" boolean NOT NULL DEFAULT true`);
		await queryRunner.query(`ALTER TABLE "club_setting" ADD COLUMN IF NOT EXISTS "handle" varchar(30)`);
		await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_club_setting_handle" ON "club_setting" ("handle") WHERE "handle" IS NOT NULL`);
		await queryRunner.query(`ALTER TABLE "poll" ADD COLUMN IF NOT EXISTS "allowAddChoices" boolean NOT NULL DEFAULT false`);
		await queryRunner.query(`ALTER TABLE "poll" ADD COLUMN IF NOT EXISTS "choiceAddedBy" varchar(32) array NOT NULL DEFAULT '{}'`);
	}

	async down(queryRunner) {
		await queryRunner.query(`ALTER TABLE "poll" DROP COLUMN IF EXISTS "choiceAddedBy"`);
		await queryRunner.query(`ALTER TABLE "poll" DROP COLUMN IF EXISTS "allowAddChoices"`);
		await queryRunner.query(`DROP INDEX IF EXISTS "IDX_club_setting_handle"`);
		await queryRunner.query(`ALTER TABLE "club_setting" DROP COLUMN IF EXISTS "handle"`);
		await queryRunner.query(`ALTER TABLE "club_setting" DROP COLUMN IF EXISTS "allowOutsideLinks"`);
	}
}

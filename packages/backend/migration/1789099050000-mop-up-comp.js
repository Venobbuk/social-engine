/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/*
 * MOP-UP-COMP (2026-09-24). Reserve ONE place on a competition team (Reclub CompetitionParticipant referenceType
 * Reserved inside a team):
 *   competition_entry  reservedPlaces jsonb NOT NULL DEFAULT '[]'   [{ id, name, gender, ageGroup, level, byId, at }]
 * Additive and idempotent (IF [NOT] EXISTS, constant default): existing teams read as "no reserved place"; down()
 * restores the previous shape. No data is read, written or moved.
 */
export class MopUpComp1789099050000 {
	name = 'MopUpComp1789099050000';

	async up(queryRunner) {
		await queryRunner.query(`ALTER TABLE "competition_entry" ADD COLUMN IF NOT EXISTS "reservedPlaces" jsonb NOT NULL DEFAULT '[]'`);
	}

	async down(queryRunner) {
		await queryRunner.query(`ALTER TABLE "competition_entry" DROP COLUMN IF EXISTS "reservedPlaces"`);
	}
}

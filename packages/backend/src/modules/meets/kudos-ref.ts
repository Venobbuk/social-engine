/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { DataSource } from 'typeorm';

/* KUDOS-CHAT-V1 — kudos in a COMPETITION (Reclub give-competition-kudos, KudoReferenceType.Competition).
 * Reclub opens the kudos flow when the competition has ENDED, to its participants (team mates, other teams, podium).
 * GripBat's equivalent of "played together" for a competition: both are members of a confirmed entry of it, and it
 * is done ('done' = Reclub Ended). Read straight from competition / competition_entry (userIds varchar[]), so the
 * meets module needs no competitions service. */
export type CompKudosCheck = { ok: true; name: string } | { ok: false; code: 'no_such_competition' | 'not_ended' | 'not_participant' };

export async function competedTogether(db: DataSource, competitionId: string, a: string, b: string): Promise<CompKudosCheck> {
	const c = await db.query(`SELECT id, name, status FROM "competition" WHERE id = $1`, [competitionId]) as { id: string; name: string; status: string }[];
	if (!c.length) return { ok: false, code: 'no_such_competition' };
	if (c[0].status !== 'done') return { ok: false, code: 'not_ended' };
	const rows = await db.query(
		`SELECT count(*) FILTER (WHERE $2 = ANY(e."userIds"))::int AS a, count(*) FILTER (WHERE $3 = ANY(e."userIds"))::int AS b
		   FROM "competition_entry" e WHERE e."competitionId" = $1 AND e.status = 'confirmed'`, [competitionId, a, b]) as { a: number; b: number }[];
	if (!rows.length || !rows[0].a || !rows[0].b) return { ok: false, code: 'not_participant' };
	return { ok: true, name: c[0].name };
}

/** The confirmed participants of a done competition (the give-kudos grid), with their entry for the Teams sort. */
export async function competitionPeople(db: DataSource, competitionId: string): Promise<{ userId: string; entryId: string; entryName: string | null }[]> {
	const rows = await db.query(
		`SELECT e.id AS "entryId", e.name AS "entryName", u AS "userId"
		   FROM "competition_entry" e, unnest(e."userIds") AS u
		  WHERE e."competitionId" = $1 AND e.status = 'confirmed'`, [competitionId]) as { userId: string; entryId: string; entryName: string | null }[];
	return rows;
}

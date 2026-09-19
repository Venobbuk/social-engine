/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { DataSource } from 'typeorm';

// DISCOVER-V3 (stats): Reclub's Statistics tab model (spec_competition_dupr.md §8 / Y.7) computed from the rows the
// engine already holds — meet_match (team1Ids/team2Ids are meet_participant ids; scores are [a,b] games), meet_participant
// (participant → user), meet_review (endorsement = kudos, body = comma list of dimensions), meet_player_level (DUPR).

/** Reclub GroupStatisticsTimeframe → a [from, to) window. YEAR is the app's word for YTD. */
export function timeframeWindow(tf: string): [Date, Date] {
	const now = new Date(); const y = now.getFullYear(), m = now.getMonth();
	switch (tf) {
		case 'CURRENT_MONTH': return [new Date(y, m, 1), new Date(y, m + 1, 1)];
		case 'LAST_MONTH': return [new Date(y, m - 1, 1), new Date(y, m, 1)];
		case 'LAST_3_MONTHS': return [new Date(y, m - 3, 1), new Date(y, m + 1, 1)];
		case 'LAST_6_MONTHS': return [new Date(y, m - 6, 1), new Date(y, m + 1, 1)];
		case 'YTD': case 'YEAR': return [new Date(y, 0, 1), new Date(y + 1, 0, 1)];
		case 'LAST_YEAR': return [new Date(y - 1, 0, 1), new Date(y, 0, 1)];
		default: return [new Date(2000, 0, 1), new Date(2100, 0, 1)];
	}
}
export const TIMEFRAMES = ['CURRENT_MONTH', 'LAST_MONTH', 'LAST_3_MONTHS', 'LAST_6_MONTHS', 'YTD', 'YEAR', 'LAST_YEAR', 'ALL_TIME'] as const;

export interface ScoredMatch { id: string; meetId: string; meetName: string; startAt: Date; round: number | null; courtIndex: number | null; team1Ids: string[]; team2Ids: string[]; scores: [number, number][]; winnerTeam: 1 | 2 | null }

/** Winner by games won — the same rule as MeetEntityService.packMatch. */
export function winnerOf(scores: [number, number][]): 1 | 2 | null {
	let w1 = 0, w2 = 0;
	for (const [a, b] of scores) { if (a > b) w1++; else if (b > a) w2++; }
	return scores.length === 0 || w1 === w2 ? null : (w1 > w2 ? 1 : 2);
}

/** Every scored match of a sport that a user played (through any of their participant rows), newest first. */
export async function scoredMatchesOf(db: DataSource, userId: string, sport: string, limit = 500): Promise<ScoredMatch[]> {
	const rows = await db.query(
		`SELECT mm.id, mm."meetId", mm.round, mm."courtIndex", mm."team1Ids", mm."team2Ids", mm.scores, m.name AS "meetName", m."startAt"
		 FROM meet_match mm JOIN meet m ON m.id = mm."meetId"
		 WHERE m.status <> 'cancelled' AND m.sport = $2 AND jsonb_array_length(mm.scores) > 0
		   AND EXISTS (SELECT 1 FROM meet_participant p WHERE p."userId" = $1 AND p."meetId" = mm."meetId" AND (p.id = ANY(mm."team1Ids") OR p.id = ANY(mm."team2Ids")))
		   -- SEC-CASUAL-CONSENT-V1: a casual game shows in a player's stats / H2H only when every account player on the
		   -- match is confirmed (a pending or declined player keeps it hidden until they confirm).
		   AND (NOT ('casual' = ANY(m.flags)) OR (m."startAt" < now() AND NOT EXISTS (
		         SELECT 1 FROM meet_participant pu
		          WHERE pu."meetId" = mm."meetId"
		            AND (pu.id = ANY(mm."team1Ids") OR pu.id = ANY(mm."team2Ids"))
		            AND pu."userId" IS NOT NULL AND pu.status <> 'confirmed')))
		 ORDER BY m."startAt" DESC LIMIT $3`, [userId, sport, limit]) as { id: string; meetId: string; round: number | null; courtIndex: number | null; team1Ids: string[]; team2Ids: string[]; scores: [number, number][]; meetName: string; startAt: Date }[];
	return rows.map(r => ({ id: r.id, meetId: r.meetId, meetName: r.meetName, startAt: new Date(r.startAt), round: r.round, courtIndex: r.courtIndex, team1Ids: r.team1Ids ?? [], team2Ids: r.team2Ids ?? [], scores: r.scores ?? [], winnerTeam: winnerOf(r.scores ?? []) }));
}

/** participant id → { userId, name } for every id in the matches given. */
export async function participantsOf(db: DataSource, matches: ScoredMatch[]): Promise<Map<string, { userId: string | null; displayName: string | null }>> {
	const ids = [...new Set(matches.flatMap(m => [...m.team1Ids, ...m.team2Ids]))];
	const out = new Map<string, { userId: string | null; displayName: string | null }>();
	if (!ids.length) return out;
	const rows = await db.query('SELECT id, "userId", "displayName" FROM meet_participant WHERE id = ANY($1)', [ids]) as { id: string; userId: string | null; displayName: string | null }[];
	for (const r of rows) out.set(r.id, { userId: r.userId, displayName: r.displayName });
	return out;
}

/** The side (1 | 2 | 0) a user is on in a match, through the participant map. */
export function sideOf(m: ScoredMatch, parts: Map<string, { userId: string | null }>, userId: string): 0 | 1 | 2 {
	if (m.team1Ids.some(id => parts.get(id)?.userId === userId)) return 1;
	if (m.team2Ids.some(id => parts.get(id)?.userId === userId)) return 2;
	return 0;
}

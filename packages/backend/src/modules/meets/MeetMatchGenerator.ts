/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// MEET-GEN-V1: Reclub's match generator (spec_competition_dupr §Y.3, spec_meets §4.2–4.5) as pure scheduling.
//   SINGLES            round robin, circle method; full = n−1 rounds (n even) / n (odd, one bye); ≤ 12 players
//   ROTATING_PARTNERS  "Americano": every round 4 players per court, partners and opponents rotated so repeats are
//                      rare; prioritizeLeastMatches seats the players with the fewest matches first; ≤ 32
//   PRESET_TEAMS       "Team Americano": fixed pairs (participant.teamKey) play a round robin; ≤ 12 teams
//   LADDER_RUN         "Mexicano": ONE round at a time from the standings — 1 & 4 vs 2 & 3 on court 1, 5–8 on
//                      court 2, …; ranking by matches won / points won / win % / points %; ≥ 4 players
// The service decides persistence (preview vs save, reset); this file only computes rounds. Deterministic for a
// given seed so a preview and the save that follows agree.

export type Scheme = 'SINGLES' | 'ROTATING_PARTNERS' | 'PRESET_TEAMS' | 'LADDER_RUN';
export type RankingCriteria = 'MATCHES_WON' | 'POINTS_WON' | 'WIN_PCT' | 'POINTS_PCT';
export interface GenMatch { round: number; courtIndex: number; team1Ids: string[]; team2Ids: string[] }
export interface PlayerStat { id: string; played: number; wins: number; pointsFor: number; pointsAgainst: number; partners: Record<string, number>; opponents: Record<string, number> }
export interface GenInput {
	scheme: Scheme;
	participantIds: string[];              // confirmed participants chosen by the host
	teams?: string[][];                    // PRESET_TEAMS: each team's participant ids
	courts: number;                        // sublocations
	limitRounds?: number | null;           // null = full round robin (SINGLES / PRESET_TEAMS) or n−1 (ROTATING)
	prioritizeLeastMatches?: boolean;
	rankingCriteria?: RankingCriteria;
	stats: Record<string, PlayerStat>;     // from the meet's existing scored matches
	startRound: number;                    // first round number to emit
	seed?: number;
}
export interface GenOutput { matches: GenMatch[]; rounds: number; players: number; warnings: string[]; fullRounds: number }

export const LIMITS = { simple: 12, rotating: 32 };

// small deterministic PRNG so preview == save
function rng(seed: number) { let s = seed >>> 0 || 1; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
function shuffle<T>(arr: T[], r: () => number): T[] { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
const stat = (stats: Record<string, PlayerStat>, id: string): PlayerStat => stats[id] ?? { id, played: 0, wins: 0, pointsFor: 0, pointsAgainst: 0, partners: {}, opponents: {} };

/** Pairings of a round robin by the circle method: returns rounds of [a, b] pairs (null = bye). */
function circle(ids: string[]): [string, string][][] {
	const p = ids.slice(); if (p.length % 2) p.push('');
	const n = p.length, rounds: [string, string][][] = [];
	for (let r = 0; r < n - 1; r++) {
		const pairs: [string, string][] = [];
		for (let i = 0; i < n / 2; i++) { const a = p[i], b = p[n - 1 - i]; if (a && b) pairs.push(r % 2 ? [b, a] : [a, b]); }
		rounds.push(pairs);
		p.splice(1, 0, p.pop() as string);   // rotate all but the first
	}
	return rounds;
}

/** Pack a list of pairings into rounds of at most `courts` matches with no player twice in a round. */
function pack(pairings: { t1: string[]; t2: string[] }[], courts: number, startRound: number, limit: number | null): GenMatch[] {
	const out: GenMatch[] = []; const left = pairings.slice(); let round = startRound;
	while (left.length) {
		const busy = new Set<string>(); let court = 0;
		for (let i = 0; i < left.length && court < courts;) {
			const m = left[i]; const ids = [...m.t1, ...m.t2];
			if (ids.some((x) => busy.has(x))) { i++; continue; }
			ids.forEach((x) => busy.add(x)); out.push({ round, courtIndex: court++, team1Ids: m.t1, team2Ids: m.t2 }); left.splice(i, 1);
		}
		if (court === 0) break;   // cannot place anything (should not happen)
		round++;
		if (limit != null && round - startRound >= limit) break;
	}
	return out;
}

export function generate(input: GenInput): GenOutput {
	const warnings: string[] = []; const r = rng(input.seed ?? 1);
	const courts = Math.max(1, Math.min(20, input.courts | 0));
	const ids = Array.from(new Set(input.participantIds));
	const stats = input.stats;

	if (input.scheme === 'SINGLES') {
		if (ids.length < 2) return { matches: [], rounds: 0, players: ids.length, warnings: ['not_enough_players'], fullRounds: 0 };
		if (ids.length > LIMITS.simple) return { matches: [], rounds: 0, players: ids.length, warnings: ['exceeds_limits.simple'], fullRounds: 0 };
		const rounds = circle(shuffle(ids, r));
		const pairings = rounds.flat().map(([a, b]) => ({ t1: [a], t2: [b] }));
		const matches = pack(pairings, courts, input.startRound, input.limitRounds ?? null);
		return { matches, rounds: matches.length ? matches[matches.length - 1].round - input.startRound + 1 : 0, players: ids.length, warnings, fullRounds: rounds.length };
	}

	if (input.scheme === 'PRESET_TEAMS') {
		const teams = (input.teams ?? []).filter((t) => t.length > 0);
		if (teams.length < 2) return { matches: [], rounds: 0, players: ids.length, warnings: ['not_enough_teams'], fullRounds: 0 };
		if (teams.length > LIMITS.simple) return { matches: [], rounds: 0, players: ids.length, warnings: ['exceeds_limits.simple'], fullRounds: 0 };
		const keys = teams.map((_, i) => String(i));
		const rounds = circle(shuffle(keys, r));
		const pairings = rounds.flat().map(([a, b]) => ({ t1: teams[Number(a)], t2: teams[Number(b)] }));
		const matches = pack(pairings, courts, input.startRound, input.limitRounds ?? null);
		return { matches, rounds: matches.length ? matches[matches.length - 1].round - input.startRound + 1 : 0, players: teams.flat().length, warnings, fullRounds: rounds.length };
	}

	if (input.scheme === 'ROTATING_PARTNERS') {
		if (ids.length < 4) return { matches: [], rounds: 0, players: ids.length, warnings: ['not_enough_players'], fullRounds: 0 };
		if (ids.length > LIMITS.rotating) return { matches: [], rounds: 0, players: ids.length, warnings: ['exceeds_limits.rotating'], fullRounds: 0 };
		if (ids.length % 4) warnings.push('uneven_scramble');
		const full = ids.length - 1;
		const limit = input.limitRounds ?? Math.min(full, 8);
		// running tallies, seeded from the meet's history so a second generation keeps spreading partners
		const played: Record<string, number> = {}; const partner: Record<string, Record<string, number>> = {}; const opp: Record<string, Record<string, number>> = {};
		// FAIR-SEATS-V1: who sits out rotates in BOTH modes — every round seats the players with the fewest matches so far,
		// ties broken by a shuffle done BEFORE the sort (a random tie-break inside a comparator is inconsistent and biased
		// the seating: 7 players, one seated 6/6 rounds and another 2/6 — graded 2026-09-17). prioritizeLeastMatches decides
		// whether the meet's history counts too (Reclub's toggle) or only this generation.
		for (const id of ids) { const s = stat(stats, id); played[id] = input.prioritizeLeastMatches ? s.played : 0; partner[id] = { ...s.partners }; opp[id] = { ...s.opponents }; }
		const bump = (m: Record<string, Record<string, number>>, a: string, b: string) => { m[a][b] = (m[a][b] ?? 0) + 1; m[b][a] = (m[b][a] ?? 0) + 1; };
		const matches: GenMatch[] = [];
		for (let rd = 0; rd < limit; rd++) {
			const seats = Math.min(ids.length - (ids.length % 4), courts * 4);
			if (seats < 4) break;
			// who plays this round: fewest matches first when asked (Reclub "Prioritize least matches"), else a shuffle
			const order = shuffle(ids, r).sort((a, b) => played[a] - played[b]);   // stable: the shuffle decides ties
			const pool = order.slice(0, seats);
			// greedy groups of four: take the next player, then the three with the least history with the group
			const left = pool.slice(); const groups: string[][] = [];
			while (left.length >= 4) {
				const g = [left.shift() as string];
				while (g.length < 4) {
					let best = 0, bestCost = Infinity;
					for (let i = 0; i < left.length; i++) { const c = g.reduce((n, x) => n + (partner[x][left[i]] ?? 0) * 2 + (opp[x][left[i]] ?? 0), 0) + r() * 0.01; if (c < bestCost) { bestCost = c; best = i; } }
					g.push(left.splice(best, 1)[0]);
				}
				groups.push(g);
			}
			groups.forEach((g, court) => {
				// the split of four with the fewest repeated partnerships (then opponents)
				const splits: [string[], string[]][] = [[[g[0], g[1]], [g[2], g[3]]], [[g[0], g[2]], [g[1], g[3]]], [[g[0], g[3]], [g[1], g[2]]]];
				const cost = ([t1, t2]: [string[], string[]]) => (partner[t1[0]][t1[1]] ?? 0) * 3 + (partner[t2[0]][t2[1]] ?? 0) * 3 + t1.reduce((n, a) => n + t2.reduce((m, b) => m + (opp[a][b] ?? 0), 0), 0);
				const [t1, t2] = splits.slice().sort((a, b) => cost(a) - cost(b))[0];
				matches.push({ round: input.startRound + rd, courtIndex: court, team1Ids: t1, team2Ids: t2 });
				bump(partner, t1[0], t1[1]); bump(partner, t2[0], t2[1]);
				for (const a of t1) for (const b of t2) bump(opp, a, b);
				for (const x of g) played[x]++;
			});
		}
		// receipt: within this generation nobody sits out twice more than anyone else
		const gen: Record<string, number> = {}; for (const m of matches) for (const x of [...m.team1Ids, ...m.team2Ids]) gen[x] = (gen[x] ?? 0) + 1;
		const counts = ids.map((x) => gen[x] ?? 0); if (Math.max(...counts) - Math.min(...counts) > 1) warnings.push('uneven_seating');
		return { matches, rounds: matches.length ? matches[matches.length - 1].round - input.startRound + 1 : 0, players: ids.length, warnings, fullRounds: full };
	}

	// LADDER_RUN — one round from the standings
	if (ids.length < 4) return { matches: [], rounds: 0, players: ids.length, warnings: ['ladder_run.min_players_required'], fullRounds: 0 };
	if (ids.length > LIMITS.rotating) return { matches: [], rounds: 0, players: ids.length, warnings: ['exceeds_limits.rotating'], fullRounds: 0 };
	const crit = input.rankingCriteria ?? 'MATCHES_WON';
	const score = (id: string) => { const s = stat(stats, id); const tot = s.pointsFor + s.pointsAgainst; switch (crit) { case 'POINTS_WON': return s.pointsFor; case 'WIN_PCT': return s.played ? s.wins / s.played : 0; case 'POINTS_PCT': return tot ? s.pointsFor / tot : 0; default: return s.wins; } };
	let order = ids.slice().sort((a, b) => score(b) - score(a) || stat(stats, b).pointsFor - stat(stats, a).pointsFor || r() - 0.5);
	if (input.prioritizeLeastMatches) order = order.sort((a, b) => stat(stats, a).played - stat(stats, b).played);   // stable: keeps the ranking within equal counts
	const anyPlayed = ids.some((id) => stat(stats, id).played > 0);
	if (!anyPlayed) order = shuffle(ids, r);   // the first Mexicano round is a draw
	const seats = Math.min(order.length - (order.length % 4), courts * 4);
	const matches: GenMatch[] = [];
	for (let i = 0; i + 3 < seats; i += 4) matches.push({ round: input.startRound, courtIndex: i / 4, team1Ids: [order[i], order[i + 3]], team2Ids: [order[i + 1], order[i + 2]] });
	if (order.length % 4) warnings.push('uneven_scramble');
	return { matches, rounds: matches.length ? 1 : 0, players: ids.length, warnings, fullRounds: 1 };
}

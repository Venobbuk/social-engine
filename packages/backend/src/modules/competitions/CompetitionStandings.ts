/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { MiCompetition } from './models/Competition.js';
import type { MiCompetitionMatch, CompetitionScoreSet, CompetitionMatchResult } from './models/CompetitionMatch.js';

/**
 * TOURNAMENT-V1 — the pure standings / result module (research_match_generation.md §7.6, Reclub standings row shape
 * spec_competition_dupr.md §2.3: teamId, place, points, wins, losses, draws, tiebreakerWins, tiebreakerLosses,
 * h2hWins, scoreDiff, h2hDiff, winPct, setsWon, setsLoss, setsWinPct, totalScore, group).
 *
 *   points   = wins·W + losses·L + draws·D + tbWins·TW + tbLosses·TL     (Reclub "Win - Loss Points")
 *   primary  = pointCalculationType: winLoss → points · totalScores → totalScore · winPct → winPct ·
 *              setsWinPct → setsWinPct · setsWon → setsWon
 *   ties     = the competition's tiebreaker1..4 in order; h2h_wins / h2h_diff are computed inside the tied group only
 *   place    = shared by rows still tied after every tiebreaker
 */
export interface StandingsRow {
	entryId: string;
	pool: number | null;
	place: number;
	points: number;
	played: number;
	wins: number;
	losses: number;
	draws: number;
	tiebreakerWins: number;
	tiebreakerLosses: number;
	h2hWins: number;
	h2hDiff: number;
	scoreDiff: number;
	totalScore: number;
	pointsAgainst: number;
	winPct: number;
	setsWon: number;
	setsLoss: number;
	setsWinPct: number;
}

export type StandingsConfig = Pick<MiCompetition, 'pointCalculationType' | 'standardWinPoint' | 'standardLossPoint' | 'drawPoint' | 'tiebreakerWinPoint' | 'tiebreakerLossPoint' | 'tiebreakers' | 'forfeitWinScore' | 'setsPerMatch'>;

/** Sets won by each side, counting standard + tiebreaker sets (an 'extra' set never decides a match). */
export function setsWon(scores: CompetitionScoreSet[]): [number, number] {
	let a = 0, b = 0;
	for (const s of scores) {
		if (s.type === 'extra') continue;
		if (s.t1 > s.t2) a++; else if (s.t2 > s.t1) b++;
	}
	return [a, b];
}

/** The result of a match from its sets and forfeits. Draw only when allowDraw (round robin / pools). */
export function decideResult(scores: CompetitionScoreSet[], forfeit: 'entry1' | 'entry2' | 'both' | null, allowDraw: boolean): CompetitionMatchResult {
	if (forfeit === 'both') return allowDraw ? 'draw' : null;
	if (forfeit === 'entry1') return 'entry2';
	if (forfeit === 'entry2') return 'entry1';
	if (!scores.length) return null;
	const [a, b] = setsWon(scores);
	if (a > b) return 'entry1';
	if (b > a) return 'entry2';
	return allowDraw ? 'draw' : null;
}

/** True when the deciding set was a tiebreaker (standard sets split evenly, a tiebreaker set broke it). */
function decidedByTiebreaker(scores: CompetitionScoreSet[]): boolean {
	const std = scores.filter((s) => s.type === 'standard');
	const tb = scores.filter((s) => s.type === 'tiebreaker');
	if (!tb.length) return false;
	const [a, b] = setsWon(std);
	return a === b;
}

function blank(entryId: string, pool: number | null): StandingsRow {
	return { entryId, pool, place: 0, points: 0, played: 0, wins: 0, losses: 0, draws: 0, tiebreakerWins: 0, tiebreakerLosses: 0, h2hWins: 0, h2hDiff: 0, scoreDiff: 0, totalScore: 0, pointsAgainst: 0, winPct: 0, setsWon: 0, setsLoss: 0, setsWinPct: 0 };
}

/** Effective score sets of a match for the tallies: a forfeit is scored forfeitWinScore–0 per deciding set. */
function effectiveSets(m: MiCompetitionMatch, cfg: StandingsConfig): CompetitionScoreSet[] {
	const forfeit1 = m.entry1Status === 'forfeit', forfeit2 = m.entry2Status === 'forfeit';
	if (!forfeit1 && !forfeit2) return m.scores;
	const need = Math.max(1, Math.ceil(cfg.setsPerMatch / 2));
	const out: CompetitionScoreSet[] = [];
	for (let i = 0; i < need; i++) out.push({ t1: forfeit1 ? 0 : cfg.forfeitWinScore, t2: forfeit2 ? 0 : cfg.forfeitWinScore, type: 'standard' });
	return out;
}

/**
 * Standings of a set of entries over their completed matches (regular stage of one pool, or the whole round robin).
 * Entries with no match still get a row (0 points) so the table is complete from the draw onwards.
 */
export function computeStandings(entries: { id: string; pool: number | null }[], matches: MiCompetitionMatch[], cfg: StandingsConfig): StandingsRow[] {
	const rows = new Map<string, StandingsRow>();
	for (const e of entries) rows.set(e.id, blank(e.id, e.pool));
	const played: MiCompetitionMatch[] = matches.filter((m) => m.status === 'completed' && m.result != null && m.entry1Id && m.entry2Id && rows.has(m.entry1Id) && rows.has(m.entry2Id));

	for (const m of played) {
		const r1 = rows.get(m.entry1Id!)!, r2 = rows.get(m.entry2Id!)!;
		const sets = effectiveSets(m, cfg);
		const [s1, s2] = setsWon(sets);
		let pf1 = 0, pf2 = 0;
		for (const s of sets) { if (s.type === 'extra') continue; pf1 += s.t1; pf2 += s.t2; }
		r1.played++; r2.played++;
		r1.totalScore += pf1; r1.pointsAgainst += pf2; r2.totalScore += pf2; r2.pointsAgainst += pf1;
		r1.setsWon += s1; r1.setsLoss += s2; r2.setsWon += s2; r2.setsLoss += s1;
		const tb = decidedByTiebreaker(m.scores) && m.entry1Status !== 'forfeit' && m.entry2Status !== 'forfeit';
		if (m.result === 'draw') { r1.draws++; r2.draws++; }
		else if (m.result === 'entry1') { if (tb) { r1.tiebreakerWins++; r2.tiebreakerLosses++; } else { r1.wins++; r2.losses++; } }
		else if (m.result === 'entry2') { if (tb) { r2.tiebreakerWins++; r1.tiebreakerLosses++; } else { r2.wins++; r1.losses++; } }
	}
	for (const r of rows.values()) {
		r.points = r.wins * cfg.standardWinPoint + r.losses * cfg.standardLossPoint + r.draws * cfg.drawPoint + r.tiebreakerWins * cfg.tiebreakerWinPoint + r.tiebreakerLosses * cfg.tiebreakerLossPoint;
		r.scoreDiff = r.totalScore - r.pointsAgainst;
		const w = r.wins + r.tiebreakerWins, l = r.losses + r.tiebreakerLosses;
		r.winPct = r.played ? (w + r.draws * 0.5) / r.played : 0;
		r.setsWinPct = (r.setsWon + r.setsLoss) ? r.setsWon / (r.setsWon + r.setsLoss) : 0;
		void l;
	}

	const primary = (r: StandingsRow): number => {
		switch (cfg.pointCalculationType) {
			case 'totalScores': return r.totalScore;
			case 'winPct': return r.winPct;
			case 'setsWinPct': return r.setsWinPct;
			case 'setsWon': return r.setsWon;
			default: return r.points;
		}
	};
	// head-to-head inside a tied group: wins and score difference over the matches among those entries only
	const h2h = (group: StandingsRow[]): void => {
		const ids = new Set(group.map((g) => g.entryId));
		for (const g of group) { g.h2hWins = 0; g.h2hDiff = 0; }
		for (const m of played) {
			if (!ids.has(m.entry1Id!) || !ids.has(m.entry2Id!)) continue;
			const r1 = rows.get(m.entry1Id!)!, r2 = rows.get(m.entry2Id!)!;
			const sets = effectiveSets(m, cfg);
			let pf1 = 0, pf2 = 0;
			for (const s of sets) { if (s.type === 'extra') continue; pf1 += s.t1; pf2 += s.t2; }
			r1.h2hDiff += pf1 - pf2; r2.h2hDiff += pf2 - pf1;
			if (m.result === 'entry1') r1.h2hWins++; else if (m.result === 'entry2') r2.h2hWins++;
		}
	};
	const tbValue = (r: StandingsRow, key: string): number => {
		switch (key) {
			case 'h2h_wins': return r.h2hWins;
			case 'score_diff': return r.scoreDiff;
			case 'h2h_diff': return r.h2hDiff;
			case 'total_score': return r.totalScore;
			case 'sets_won': return r.setsWon;
			case 'win_pct': return r.winPct;
			case 'sets_win_pct': return r.setsWinPct;
			default: return 0;
		}
	};
	// sort: primary desc; then break each tied group by the tiebreakers in order (recursively, so h2h is recomputed
	// among the entries that are STILL tied at each step)
	const order = (group: StandingsRow[], keys: string[]): StandingsRow[] => {
		if (group.length <= 1 || !keys.length) return group;
		const [k, ...rest] = keys;
		if (k === 'h2h_wins' || k === 'h2h_diff') h2h(group);
		const sorted = group.slice().sort((a, b) => tbValue(b, k) - tbValue(a, k));
		const out: StandingsRow[] = [];
		let i = 0;
		while (i < sorted.length) {
			let j = i + 1;
			while (j < sorted.length && tbValue(sorted[j], k) === tbValue(sorted[i], k)) j++;
			out.push(...order(sorted.slice(i, j), rest));
			i = j;
		}
		return out;
	};
	const all = [...rows.values()].sort((a, b) => primary(b) - primary(a));
	const ranked: StandingsRow[] = [];
	let i = 0;
	while (i < all.length) {
		let j = i + 1;
		while (j < all.length && primary(all[j]) === primary(all[i])) j++;
		ranked.push(...order(all.slice(i, j), cfg.tiebreakers));
		i = j;
	}
	// places: rows still equal on the primary AND every tiebreaker share a place
	const sig = (r: StandingsRow) => [primary(r), ...cfg.tiebreakers.map((k) => tbValue(r, k))].join('|');
	for (let p = 0; p < ranked.length; p++) ranked[p].place = p > 0 && sig(ranked[p]) === sig(ranked[p - 1]) ? ranked[p - 1].place : p + 1;
	return ranked;
}

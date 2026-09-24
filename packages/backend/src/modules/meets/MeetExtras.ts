/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { DataSource } from 'typeorm';
import type { MiMeet } from '@/modules/meets/models/Meet.js';
import { memberExistsSql } from '@/modules/clubs/club-tiers.js'; // INT-BATCH2 × CLUB-TIERS-V1: the ONE membership rule

/**
 * MEET-EXTRAS-V1 (2026-09-19) — the Reclub meet functions PARITY.md still listed as missing, as plain functions so
 * no DI registration line outside this folder is touched (the endpoints and the sweep hand in what they hold):
 *   promote     — "Get more players → Promote meet": one push to followers + players within 20 km who play the band,
 *                 public meets only, ≤ 36 h before start, once per meet (spec_meets.md §8.1, §Y.6)
 *   reminders   — 24 h and 2 h before start, to confirmed players; honours meet.sendNotifications and a per-row mute
 *                 flag if another stream adds one (any of muted / isMuted / notificationsMuted read defensively)
 *   (media      — GONE, NUKE-MEET-PHOTOS-V1: a meet photo is a FILE MESSAGE in the meet's native chat room)
 *   standings   — SET vs GAME scoring, standings modes and tiebreakers (spec_competition_dupr.md §2.3, §4.6), the
 *                 whole-meet summary card (§5.6 share-matches-summary)
 * What is left here is pure functions over what the caller already holds — no table of its own.
 */

export const SCORING_TYPES = ['GAME', 'SET'] as const;
export const STANDINGS_MODES = ['winLoss', 'winPct', 'setsWon', 'setsWinPct', 'totalScore'] as const;
export const TIEBREAKERS = ['h2h_wins', 'score_diff', 'h2h_diff', 'total_score', 'sets_won', 'win_pct', 'sets_win_pct'] as const;
export type ScoringType = typeof SCORING_TYPES[number];
export type StandingsMode = typeof STANDINGS_MODES[number];
export type Tiebreaker = typeof TIEBREAKERS[number];

export const PROMOTE_WINDOW_HOURS = 36;   // "You can only promote to the community 36 hours before start."
export const PROMOTE_RADIUS_KM = 20;      // web evidence: radius 20 km
export const PROMOTE_CAP = 500;
export const REMIND_24H_MS = 24 * 3600_000;
export const REMIND_2H_MS = 2 * 3600_000;

export type Notify = (userId: string, header: string, body: string, link: string) => void;

export interface ScoringSettings {
	scoringType: ScoringType;
	standingsMode: StandingsMode;
	tiebreakers: Tiebreaker[];
	forfeitScore: number;
	winPoints: number;
	lossPoints: number;
	drawPoints: number;
	tbWinPoints: number;
	tbLossPoints: number;
}

export function scoringOf(meet: Partial<MiMeet> & Record<string, unknown>): ScoringSettings {
	const m = meet as Record<string, unknown>;
	const tb = Array.isArray(m.tiebreakers) ? (m.tiebreakers as string[]).filter((t): t is Tiebreaker => (TIEBREAKERS as readonly string[]).includes(t)) : [];
	return {
		scoringType: (SCORING_TYPES as readonly string[]).includes(String(m.scoringType)) ? m.scoringType as ScoringType : 'GAME',
		standingsMode: (STANDINGS_MODES as readonly string[]).includes(String(m.standingsMode)) ? m.standingsMode as StandingsMode : 'winLoss',
		tiebreakers: tb.length ? tb : ['h2h_wins', 'score_diff', 'total_score'],
		forfeitScore: Number.isInteger(m.forfeitScore) ? m.forfeitScore as number : 11,
		winPoints: Number.isInteger(m.winPoints) ? m.winPoints as number : 1,
		lossPoints: Number.isInteger(m.lossPoints) ? m.lossPoints as number : 0,
		drawPoints: Number.isInteger(m.drawPoints) ? m.drawPoints as number : 0,
		tbWinPoints: Number.isInteger(m.tbWinPoints) ? m.tbWinPoints as number : 1,
		tbLossPoints: Number.isInteger(m.tbLossPoints) ? m.tbLossPoints as number : 0,
	};
}

// ------------------------------------------------------------------------------------------------- standings
export interface MatchLike { id: string; round: number | null; courtIndex: number | null; team1Ids: string[]; team2Ids: string[]; scores: [number, number][]; forfeitTeam: number | null }

export interface StandingRow {
	participantId: string;
	played: number; wins: number; losses: number; draws: number; tbWins: number; tbLosses: number;
	setsWon: number; setsLost: number; pointsFor: number; pointsAgainst: number;
	points: number; scoreDiff: number; totalScore: number; winPct: number; setsWinPct: number;
	h2hWins: Record<string, number>; h2hDiff: Record<string, number>;
	place: number;
}

/** The result of one match under the meet's rules: sets (games) won per side, points per side, winner, tiebreak. */
export function evaluateMatch(m: MatchLike, s: ScoringSettings): { sets: [number, number]; points: [number, number]; winner: 0 | 1 | 2; draw: boolean; tiebreak: boolean; scored: boolean } {
	if (m.forfeitTeam === 1 || m.forfeitTeam === 2) {
		const w = m.forfeitTeam === 1 ? 2 : 1;
		return { sets: w === 1 ? [1, 0] : [0, 1], points: w === 1 ? [s.forfeitScore, 0] : [0, s.forfeitScore], winner: w, draw: false, tiebreak: false, scored: true };
	}
	if (!m.scores.length) return { sets: [0, 0], points: [0, 0], winner: 0, draw: false, tiebreak: false, scored: false };
	let a = 0, b = 0, pa = 0, pb = 0;
	for (const [x, y] of m.scores) { if (x > y) a++; else if (y > x) b++; pa += x; pb += y; }
	const winner: 0 | 1 | 2 = a > b ? 1 : b > a ? 2 : 0;
	// SET scoring: a match that needed the deciding set (sets split before it) is a tiebreaker win/loss (Reclub point pairs)
	const tiebreak = s.scoringType === 'SET' && winner !== 0 && m.scores.length >= 3 && Math.abs(a - b) === 1;
	return { sets: [a, b], points: [pa, pb], winner, draw: winner === 0, tiebreak, scored: true };
}

/** Standings for a set of participant ids over the meet's matches, ranked by the standings mode then the tiebreakers. */
export function computeStandings(participantIds: string[], matches: MatchLike[], s: ScoringSettings): StandingRow[] {
	const rows = new Map<string, StandingRow>();
	const get = (id: string): StandingRow => {
		let r = rows.get(id);
		if (!r) { r = { participantId: id, played: 0, wins: 0, losses: 0, draws: 0, tbWins: 0, tbLosses: 0, setsWon: 0, setsLost: 0, pointsFor: 0, pointsAgainst: 0, points: 0, scoreDiff: 0, totalScore: 0, winPct: 0, setsWinPct: 0, h2hWins: {}, h2hDiff: {}, place: 0 }; rows.set(id, r); }
		return r;
	};
	for (const id of participantIds) get(id);
	for (const m of matches) {
		const e = evaluateMatch(m, s);
		if (!e.scored) continue;
		[m.team1Ids, m.team2Ids].forEach((team, ti) => {
			const other = ti === 0 ? m.team2Ids : m.team1Ids;
			const won = e.winner === ti + 1, lost = e.winner !== 0 && !won;
			for (const id of team) {
				const r = get(id);
				r.played++;
				if (e.draw) r.draws++;
				else if (won) { if (e.tiebreak) r.tbWins++; else r.wins++; }
				else if (lost) { if (e.tiebreak) r.tbLosses++; else r.losses++; }
				r.setsWon += e.sets[ti]; r.setsLost += e.sets[1 - ti];
				r.pointsFor += e.points[ti]; r.pointsAgainst += e.points[1 - ti];
				for (const o of other) {
					if (won) r.h2hWins[o] = (r.h2hWins[o] ?? 0) + 1;
					r.h2hDiff[o] = (r.h2hDiff[o] ?? 0) + (e.points[ti] - e.points[1 - ti]);
				}
			}
		});
	}
	for (const r of rows.values()) {
		const allWins = r.wins + r.tbWins, allLosses = r.losses + r.tbLosses;
		r.points = r.wins * s.winPoints + r.losses * s.lossPoints + r.tbWins * s.tbWinPoints + r.tbLosses * s.tbLossPoints + r.draws * s.drawPoints;
		r.scoreDiff = r.pointsFor - r.pointsAgainst;
		r.totalScore = r.pointsFor;
		r.winPct = r.played ? Math.round((allWins / (allWins + allLosses + r.draws || 1)) * 1000) / 10 : 0;
		r.setsWinPct = (r.setsWon + r.setsLost) ? Math.round((r.setsWon / (r.setsWon + r.setsLost)) * 1000) / 10 : 0;
	}
	const primary = (r: StandingRow): number => s.standingsMode === 'winPct' ? r.winPct : s.standingsMode === 'setsWon' ? r.setsWon : s.standingsMode === 'setsWinPct' ? r.setsWinPct : s.standingsMode === 'totalScore' ? r.totalScore : r.points;
	const tbValue = (r: StandingRow, tb: Tiebreaker, group: StandingRow[]): number => {
		switch (tb) {
			case 'h2h_wins': return group.reduce((n, o) => o === r ? n : n + (r.h2hWins[o.participantId] ?? 0), 0);
			case 'h2h_diff': return group.reduce((n, o) => o === r ? n : n + (r.h2hDiff[o.participantId] ?? 0), 0);
			case 'score_diff': return r.scoreDiff;
			case 'total_score': return r.totalScore;
			case 'sets_won': return r.setsWon;
			case 'win_pct': return r.winPct;
			case 'sets_win_pct': return r.setsWinPct;
		}
	};
	const criteria: ((r: StandingRow, group: StandingRow[]) => number)[] = [primary, ...s.tiebreakers.map((tb) => (r: StandingRow, g: StandingRow[]) => tbValue(r, tb, g))];
	const order = (group: StandingRow[], idx: number): StandingRow[] => {
		if (group.length <= 1 || idx >= criteria.length) return group;
		const keyed = group.map((r) => ({ r, k: criteria[idx](r, group) })).sort((a, b) => b.k - a.k);
		const out: StandingRow[] = [];
		let i = 0;
		while (i < keyed.length) {
			let j = i; while (j < keyed.length && keyed[j].k === keyed[i].k) j++;
			out.push(...order(keyed.slice(i, j).map((x) => x.r), idx + 1));
			i = j;
		}
		return out;
	};
	const ranked = order([...rows.values()], 0);
	// place: equal on every criterion = the same place
	let place = 0;
	ranked.forEach((r, i) => {
		const prev = ranked[i - 1];
		const same = prev && criteria.every((c) => c(r, ranked) === c(prev, ranked));
		if (!same) place = i + 1;
		r.place = place;
	});
	return ranked;
}

// ------------------------------------------------------------------------------------------------- promote
export type PromoteGate = 'ok' | 'not_public' | 'not_active' | 'started' | 'too_early' | 'already_promoted';

export function promoteGate(meet: MiMeet, now = Date.now()): PromoteGate {
	const m = meet as unknown as Record<string, unknown>;
	if (meet.status !== 'active') return 'not_active';
	if (meet.visibility !== 'public') return 'not_public';
	const start = new Date(meet.startAt).getTime();
	if (start <= now) return 'started';
	if (start - now > PROMOTE_WINDOW_HOURS * 3600_000) return 'too_early';
	if (m.promotedAt != null || (meet.flags ?? []).some((f) => /PROMOTED$/.test(f))) return 'already_promoted';
	return 'ok';
}

/**
 * The audience of one promotion: the host's followers plus every player whose saved home is within 20 km, both
 * limited to the meet's level band (by its level basis) when it has one, minus the host and everyone already on the
 * roster. Distinct user ids, capped.
 *
 * PROMOTE-AUDIENCE-V1 (W1 lane B1, triage A-promote-meet.03): Reclub's "CHOOSE YOUR AUDIENCE" — the host picks
 *   'club'       the members of the meet's club (INT-BATCH2 × CLUB-TIERS-V1: club_member of meet.channelId — NOT the
 *                follower tier, which is channel_following; minus members on a break)
 *   'proximity'  players whose saved home is within 20 km
 *   'all'        (default, the V1 audience) followers + nearby
 * The level band, the host and the roster exclusions apply to every audience.
 */
export type PromoteAudienceKind = 'all' | 'club' | 'proximity';
/** PROMOTE-FILTERS-V1 (lane club-posts-links, A-promote-meet.04): Reclub's "Choose skill levels" chips — the app's level
 *  bands (lib/club-levels): each band is [x, x + 0.5), "5.0+" is 5.0 and up. */
export const PROMOTE_LEVELS = ['2.0', '2.5', '3.0', '3.5', '4.0', '4.5', '5.0+'] as const;
export interface PromoteFilters { levels?: string[]; genders?: string[]; ageGroups?: string[] }
/** The filters as SQL on the candidate u (whitelisted values only, inlined). Empty = no filter. */
function promoteFilterSql(f: PromoteFilters | undefined, levelCol: string): string {
	if (!f) return '';
	const out: string[] = [];
	const levels = (f.levels ?? []).filter((x) => (PROMOTE_LEVELS as readonly string[]).includes(x));
	if (levels.length && levels.length < PROMOTE_LEVELS.length) {
		const bands = levels.map((x) => { const lo = parseFloat(x); return x.endsWith('+') ? `(${levelCol} >= ${lo})` : `(${levelCol} >= ${lo} AND ${levelCol} < ${lo + 0.5})`; });
		out.push(`AND EXISTS (SELECT 1 FROM "meet_player_level" fl WHERE fl."userId" = u."id" AND fl."sport" = $2 AND (${bands.join(' OR ')}))`);
	}
	const genders = (f.genders ?? []).filter((x) => x === 'female' || x === 'male');
	if (genders.length === 1) out.push(`AND EXISTS (SELECT 1 FROM "meet_player_level" fg WHERE fg."userId" = u."id" AND fg."gender" = '${genders[0]}')`);
	const ages = (f.ageGroups ?? []).filter((x) => x === 'junior' || x === 'adult' || x === 'senior');
	if (ages.length && ages.length < 3) out.push(`AND EXISTS (SELECT 1 FROM "meet_player_level" fa WHERE fa."userId" = u."id" AND fa."ageGroup" IN (${ages.map((x) => `'${x}'`).join(', ')}))`);
	return out.join(' ');
}
export async function promoteAudience(db: DataSource, meet: MiMeet, audience: PromoteAudienceKind = 'all', filters?: PromoteFilters): Promise<{ userIds: string[]; followers: number; nearby: number; club: number }> {
	const level = meet.levelBasis === 'duprSingles' ? 'duprSingles' : meet.levelBasis === 'duprDoubles' ? 'duprDoubles' : 'selfLevel';
	const band = meet.minLevel != null || meet.maxLevel != null;
	const bandSql = band
		? `AND EXISTS (SELECT 1 FROM "meet_player_level" l WHERE l."userId" = u."id" AND l."sport" = $2 AND COALESCE(l."${level}", l."selfLevel") IS NOT NULL
		     ${meet.minLevel != null ? `AND COALESCE(l."${level}", l."selfLevel") >= ${Number(meet.minLevel)}` : ''} ${meet.maxLevel != null ? `AND COALESCE(l."${level}", l."selfLevel") <= ${Number(meet.maxLevel)}` : ''})`
		: '';
	const base = `FROM "user" u WHERE u."host" IS NULL AND u."isSuspended" = false AND u."isDeleted" = false AND u."id" <> $3 AND $2::varchar IS NOT NULL
		AND NOT EXISTS (SELECT 1 FROM "meet_participant" p WHERE p."meetId" = $1 AND p."userId" = u."id") ${bandSql} ${promoteFilterSql(filters, `COALESCE(fl."${level}", fl."selfLevel")`)}`;
	if (audience === 'club') {
		if (!meet.channelId) return { userIds: [], followers: 0, nearby: 0, club: 0 };
		const club = await db.query(`SELECT u."id" ${base} AND ${memberExistsSql('$4', 'u."id"')}
			AND NOT EXISTS (SELECT 1 FROM "club_member_state" s WHERE s."channelId" = $4 AND s."userId" = u."id" AND s."pausedAt" IS NOT NULL) LIMIT ${PROMOTE_CAP}`, [meet.id, meet.sport, meet.hostId, meet.channelId]) as { id: string }[];
		return { userIds: club.map((r) => r.id), followers: 0, nearby: 0, club: club.length };
	}
	const followers = audience === 'proximity' ? [] : await db.query(`SELECT u."id" ${base} AND EXISTS (SELECT 1 FROM "following" f WHERE f."followeeId" = $3 AND f."followerId" = u."id") LIMIT ${PROMOTE_CAP}`, [meet.id, meet.sport, meet.hostId]) as { id: string }[];
	let nearby: { id: string }[] = [];
	if (meet.lat != null && meet.lng != null) {
		const lat = Number(meet.lat), lng = Number(meet.lng);
		const dist = `(6371 * acos(least(1, cos(radians(${lat})) * cos(radians(h."lat")) * cos(radians(h."lng") - radians(${lng})) + sin(radians(${lat})) * sin(radians(h."lat")))))`;
		nearby = await db.query(`SELECT u."id" ${base} AND EXISTS (SELECT 1 FROM "user_location" h WHERE h."userId" = u."id" AND h."kind" = 'home' AND ${dist} <= ${PROMOTE_RADIUS_KM}) LIMIT ${PROMOTE_CAP}`, [meet.id, meet.sport, meet.hostId]) as { id: string }[];
	}
	const ids = Array.from(new Set([...followers.map((r) => r.id), ...nearby.map((r) => r.id)])).slice(0, PROMOTE_CAP);
	return { userIds: ids, followers: followers.length, nearby: nearby.length, club: 0 };
}

/** Reclub `meets:notification.body` = "{{name}} is looking for {{num}} players {{datetime}} at {{location}}. Can you join?" — the app re-inserts the two captures. */
// FIX-S5 PROMOTE-ONE-SOURCE-V1 (A-promote-meet.02): the meet's NAME is in the sentence, and meets/promote {preview} answers
// this very string (and the header) — the app's "What players will see" renders it through the same localizer as the inbox,
// so the preview and the delivered notification cannot drift. Singular for one seat.
export const PROMOTE_HEADER = 'Looking for players';
export function promoteBody(hostName: string, meet: MiMeet, spotsLeft: number): string {
	const when = fmtWhen(meet);
	return `${hostName} is looking for ${spotsLeft === 1 ? '1 player' : spotsLeft + ' players'} for ${meet.name} on ${when}${meet.venueName ? ' at ' + meet.venueName : ''}. Can you join?`;
}

export function fmtWhen(meet: MiMeet): string {
	try {
		return new Intl.DateTimeFormat('en-GB', { timeZone: meet.timezone || 'Asia/Hong_Kong', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(meet.startAt));
	} catch {
		return new Date(meet.startAt).toISOString();
	}
}
export function fmtTimeOnly(meet: MiMeet): string {
	try {
		return new Intl.DateTimeFormat('en-GB', { timeZone: meet.timezone || 'Asia/Hong_Kong', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(meet.startAt));
	} catch {
		return new Date(meet.startAt).toISOString();
	}
}

// ------------------------------------------------------------------------------------------------- reminders
/**
 * 24 h and 2 h before start, once each, to every confirmed player of an active meet that sends notifications.
 * Runs inside the minute sweep. A participant row carrying a mute flag (another stream's column, read by name if it
 * exists) is skipped. Returns what was sent for the sweep log.
 */
export async function remindUpcoming(db: DataSource, notify: Notify, now = new Date()): Promise<{ meets24: number; meets2: number; sent: number }> {
	let meets24 = 0, meets2 = 0, sent = 0;
	const nowMs = now.getTime();
	const due = await db.query(
		`SELECT * FROM "meet" WHERE "status" = 'active' AND "sendNotifications" = true AND "startAt" > $1 AND "startAt" <= $2 AND ("reminded24At" IS NULL OR "reminded2At" IS NULL)`,
		[now, new Date(nowMs + REMIND_24H_MS)]) as (MiMeet & { reminded24At: Date | null; reminded2At: Date | null })[];
	for (const meet of due) {
		const start = new Date(meet.startAt).getTime();
		const in2h = start - nowMs <= REMIND_2H_MS;
		const kind: '24' | '2' | null = in2h && meet.reminded2At == null ? '2' : !in2h && meet.reminded24At == null ? '24' : null;
		if (!kind) continue;
		// mark first (idempotent under two sweepers), then send
		const col = kind === '2' ? 'reminded2At' : 'reminded24At';
		const marked = await db.query(`UPDATE "meet" SET "${col}" = $2 WHERE "id" = $1 AND "${col}" IS NULL RETURNING "id"`, [meet.id, now]) as { id: string }[];
		if (!marked.length) continue;
		if (kind === '2') { meets2++; } else { meets24++; }
		const rows = await db.query(`SELECT * FROM "meet_participant" WHERE "meetId" = $1 AND "status" = 'confirmed' AND "userId" IS NOT NULL`, [meet.id]) as Record<string, unknown>[];
		const body = kind === '2'
			? `${meet.name} starts in 2 hours at ${fmtTimeOnly(meet)}${meet.venueName ? ' — ' + meet.venueName : ''}.`
			: `${meet.name} starts ${start - nowMs > 20 * 3600_000 ? 'tomorrow' : 'today'} at ${fmtTimeOnly(meet)}${meet.venueName ? ' — ' + meet.venueName : ''}.`;
		for (const p of rows) {
			if (p.muted === true || p.isMuted === true || p.notificationsMuted === true || p.mutedAt != null) continue;
			notify(String(p.userId), 'Reminder', body, 'meet:' + meet.id);
			sent++;
		}
	}
	return { meets24, meets2, sent };
}

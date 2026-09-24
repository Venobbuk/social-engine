/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { DataSource } from 'typeorm';
import { winnerOf } from './_shared.js';

// STATS-HISTORY-V1 (W2-S, 2026-09-20): match history, match recap, activities, GripBat rankings and pair records —
// Reclub's My history (Meets / Competitions / Matches), Match summary, Player sport › Matches, Statistics › Rankings and
// Stats team summary / head-to-head — from the rows the engine already holds:
//   meet_match (+ meet_participant ids), competition_match (+ competition_entry.userIds), gb_openplay_game via
//   gb_rating_log (source 'openplay'), and GB-RATING-V1's gb_rating_log / gb_player_rating for the "beyond DUPR" numbers.
// MEMORY RULE (operator 2026-09-20, after hkpl was taken down by a bulk history read): every function here pages IN SQL
// (ORDER BY … LIMIT … OFFSET) and only the page's rows are read back and enriched; nothing loads a whole history.
// PRIVACY: a viewer who is not the player sees only matches of PUBLIC meets / competitions, or of ones the viewer
// hosted or played in (the same rule meets/show applies to a private meet's roster).
// ONE rule, applied by EVERY function here: historyPage / activitiesPage / matchSummary (meetVisible / compVisible)
// and pairSummary / rankingsPage (logVisible). A new aggregate in this file without it publishes private meets to
// anonymous callers - review-batch2 #6.

export type Source = 'meet' | 'competition' | 'openplay';
export type PlayerRef = { userId: string | null; name: string | null };
export interface HistoryRow {
	source: Source; matchId: string; contextId: string | null; contextName: string | null; venueName: string | null;
	playedAt: string; round: number | null; courtIndex: number | null;
	partners: PlayerRef[]; opponents: PlayerRef[];
	games: [number, number][];   // from the player's side: [theirs-side-of-player, opponents]
	won: boolean | null; forfeit: boolean; ratingDelta: number | null;
}

// VISIBILITY (one rule, reused): viewer $V may see a meet when it is public, they host it, or they are on its roster;
// a competition when it is public, they host it, or they are in any of its entries. '' = anonymous.
const meetVisible = (m: string, v: string) => `(${m}.visibility = 'public' OR ${m}."hostId" = ${v} OR EXISTS (SELECT 1 FROM meet_participant vp WHERE vp."meetId" = ${m}.id AND vp."userId" = ${v}))`;
const compVisible = (c: string, v: string) => `(${c}.visibility = 'public' OR ${c}."hostId" = ${v} OR EXISTS (SELECT 1 FROM competition_entry ve WHERE ve."competitionId" = ${c}.id AND ${v} = ANY(ve."userIds")))`;
/** A gb_rating_log row `l` the viewer may see (open play is public open play on hkpl) - and that still COUNTS.
 *  The EXISTS requires the match row to be there and the meet / competition not to be cancelled: the same rule as
 *  FRESH-EYES-V1's edgeOf() guard (modules/stats/GbRating.ts, master d7abe5128d, "a rating row cannot outlive the
 *  match that justified it") and as historyPage / activitiesPage below (`status <> 'cancelled'`). The two compose:
 *  a row counts only while the match that justified it is alive AND the viewer may see where it was played.
 *  SEC-CHEM-V2: exported — GbRating's pair record (gb-pairs, gb-fair, gb-edge partners) reads through the same rule. */
export const logVisible =(l: string, v: string) => `(${l}.source = 'openplay'
	OR (${l}.source = 'meet' AND EXISTS (SELECT 1 FROM meet_match vmm JOIN meet vm ON vm.id = vmm."meetId" WHERE vmm.id = ${l}."matchId" AND vm.status <> 'cancelled' AND ${meetVisible('vm', v)}))
	OR (${l}.source = 'competition' AND EXISTS (SELECT 1 FROM competition_match vcm JOIN competition vc ON vc.id = vcm."competitionId" WHERE vcm.id = ${l}."matchId" AND vc.status <> 'cancelled' AND ${compVisible('vc', v)})))`;

const MAX_OFFSET = 5000;
const pageArgs = (limit: number, offset: number): [number, number] => [Math.max(1, Math.min(100, limit | 0)), Math.max(0, Math.min(MAX_OFFSET, offset | 0))];

/** Competition score sets [{t1,t2,type}] → [[t1,t2]] (the 'extra' rows are not games — GbRating's rule). */
function compGames(raw: unknown): [number, number][] {
	return (Array.isArray(raw) ? raw : []).filter((g: any) => g && g.type !== 'extra').map((g: any) => [Number(g.t1), Number(g.t2)] as [number, number]);
}
function meetGames(raw: unknown): [number, number][] {
	return (Array.isArray(raw) ? raw : []).map((g: any) => [Number(g[0]), Number(g[1])] as [number, number]);
}

// ACCOUNT-BUGS-V1: a match in a cancelled meet OR competition is not history (GbRating.liveLog; the competition branch
// below lacked `c.status <> 'cancelled'`, so My history listed what the pair record hid).
// The SQL that lists a player's scored matches (newest first). $1 player, $2 sport, $3 viewer ('' = anonymous),
// $4 limit, $5 offset, $6 context id or NULL, $7 partner id or NULL, $8 opponent ids (varchar[]) or NULL.
const HISTORY_SQL = `
WITH h AS (
	SELECT 'meet'::text AS source, mm.id AS "matchId", m.id AS "contextId", m.name AS "contextName", m."venueName" AS "venueName",
	       m."startAt" AS "playedAt", mm.round, mm."courtIndex", (CASE WHEN p.id = ANY(mm."team1Ids") THEN 1 ELSE 2 END)::int AS side,
	       mm.scores AS games, mm."forfeitTeam" AS "forfeitTeam", mm."team1Ids" AS t1, mm."team2Ids" AS t2,
	       NULL::varchar[] AS u1, NULL::varchar[] AS u2, NULL::varchar AS "logPartner", NULL::varchar[] AS "logOpp", NULL::text AS result, NULL::text AS f1, NULL::text AS f2
	FROM meet_participant p
	JOIN meet_match mm ON mm."meetId" = p."meetId" AND (p.id = ANY(mm."team1Ids") OR p.id = ANY(mm."team2Ids"))
	JOIN meet m ON m.id = mm."meetId"
	WHERE p."userId" = $1 AND m.sport = $2 AND m.status <> 'cancelled' AND jsonb_array_length(mm.scores) > 0
	  AND ($3 = $1 OR ${meetVisible('m', '$3')})
	  AND ($6::varchar IS NULL OR m.id = $6)
	UNION ALL
	SELECT 'competition', cm.id, c.id, c.name, c."venueName", COALESCE(cm."startAt", cm."updatedAt"), cm.round, cm."courtIndex",
	       (CASE WHEN cm."entry1Id" = e.id THEN 1 ELSE 2 END)::int, cm.scores, NULL::int, NULL::varchar[], NULL::varchar[],
	       e1."userIds", e2."userIds", NULL::varchar, NULL::varchar[], cm.result::text, cm."entry1Status"::text, cm."entry2Status"::text
	FROM competition_entry e
	JOIN competition_match cm ON cm."competitionId" = e."competitionId" AND (cm."entry1Id" = e.id OR cm."entry2Id" = e.id)
	JOIN competition c ON c.id = cm."competitionId"
	LEFT JOIN competition_entry e1 ON e1.id = cm."entry1Id" LEFT JOIN competition_entry e2 ON e2.id = cm."entry2Id"
	WHERE $1 = ANY(e."userIds") AND c.sport = $2 AND c.status <> 'cancelled' AND cm.status = 'completed' AND jsonb_array_length(cm.scores) > 0
	  AND ($3 = $1 OR ${compVisible('c', '$3')})
	  AND ($6::varchar IS NULL OR c.id = $6)
	UNION ALL
	SELECT 'openplay', l."matchId", NULL, NULL, NULL, l."playedAt", NULL, NULL, 1, l.games, NULL, NULL, NULL, NULL, NULL,
	       l."partnerId", l."opponentIds", NULL, NULL, NULL
	FROM gb_rating_log l WHERE l.source = 'openplay' AND l."userId" = $1 AND l.sport = $2 AND NOT l.skipped AND $6::varchar IS NULL
)
SELECT h.* FROM h
WHERE ($7::varchar IS NULL AND $8::varchar[] IS NULL) OR EXISTS (
	SELECT 1 FROM gb_rating_log f WHERE f.source = h.source AND f."matchId" = h."matchId" AND f."userId" = $1 AND NOT f.skipped
	  AND ($7::varchar IS NULL OR f."partnerId" = $7) AND ($8::varchar[] IS NULL OR f."opponentIds" @> $8))
ORDER BY h."playedAt" DESC, h."matchId" DESC LIMIT $4 OFFSET $5`;

type RawHist = { source: Source; matchId: string; contextId: string | null; contextName: string | null; venueName: string | null; playedAt: Date; round: number | null; courtIndex: number | null; side: number; games: unknown; forfeitTeam: number | null; t1: string[] | null; t2: string[] | null; u1: string[] | null; u2: string[] | null; logPartner: string | null; logOpp: string[] | null; result: string | null; f1: string | null; f2: string | null };

/** One page of a player's scored matches. Filters: one meet / competition, a partner, an opponent line-up. */
export async function historyPage(db: DataSource, o: { userId: string; viewerId: string | null; sport: string; limit: number; offset: number; contextId?: string | null; partnerId?: string | null; opponentIds?: string[] | null }): Promise<HistoryRow[]> {
	const [limit, offset] = pageArgs(o.limit, o.offset);
	const raw = await db.query(HISTORY_SQL, [o.userId, o.sport, o.viewerId ?? '', limit, offset, o.contextId ?? null, o.partnerId ?? null, o.opponentIds && o.opponentIds.length ? o.opponentIds : null]) as RawHist[];
	if (!raw.length) return [];
	// names for the meet participant ids of THIS page only
	const pids = [...new Set(raw.flatMap((r) => [...(r.t1 ?? []), ...(r.t2 ?? [])]))];
	const pmap = new Map<string, PlayerRef>();
	if (pids.length) for (const x of await db.query('SELECT id, "userId", "displayName" FROM meet_participant WHERE id = ANY($1)', [pids]) as { id: string; userId: string | null; displayName: string | null }[]) pmap.set(x.id, { userId: x.userId, name: x.displayName });
	// rating movement of the player in these matches (GB-RATING-V1 log), page only
	// SEC-RATING-VIEW-V1 (G15.3 addendum (a)): a per-match rating change is the player's own business — with public results
	// anyone could compute a pair's chemistry from it. Another viewer gets ratingDelta null on every row (Reclub shows none).
	const deltas = new Map<string, number>();
	if (o.viewerId != null && o.viewerId === o.userId) for (const x of await db.query('SELECT source, "matchId", pre, post FROM gb_rating_log WHERE "userId" = $1 AND NOT skipped AND "matchId" = ANY($2)', [o.userId, raw.map((r) => r.matchId)]) as { source: string; matchId: string; pre: string; post: string }[]) {
		if (x.pre != null && x.post != null) deltas.set(x.source + ':' + x.matchId, Math.round((Number(x.post) - Number(x.pre)) * 1000) / 1000);
	}
	const ref = (u: string | null): PlayerRef => ({ userId: u, name: null });
	return raw.map((r) => {
		const side = r.side === 2 ? 2 : 1;
		let mine: PlayerRef[] = [], theirs: PlayerRef[] = [], games: [number, number][] = [], won: boolean | null = null, forfeit = false;
		if (r.source === 'meet') {
			const t1 = (r.t1 ?? []).map((id) => pmap.get(id) ?? { userId: null, name: null }), t2 = (r.t2 ?? []).map((id) => pmap.get(id) ?? { userId: null, name: null });
			[mine, theirs] = side === 1 ? [t1, t2] : [t2, t1];
			const g = meetGames(r.games);
			games = side === 1 ? g : g.map(([a, b]) => [b, a] as [number, number]);
			if (r.forfeitTeam === 1 || r.forfeitTeam === 2) { forfeit = true; won = r.forfeitTeam !== side; }
			else { const w = winnerOf(g); won = w == null ? null : w === side; }
		} else if (r.source === 'competition') {
			const t1 = (r.u1 ?? []).map(ref), t2 = (r.u2 ?? []).map(ref);
			[mine, theirs] = side === 1 ? [t1, t2] : [t2, t1];
			const g = compGames(r.games);
			games = side === 1 ? g : g.map(([a, b]) => [b, a] as [number, number]);
			// the same rule as matchSummary: a result wins, else a one-sided forfeit, else the games
			const ff1 = r.f1 === 'forfeit', ff2 = r.f2 === 'forfeit';
			if (r.result === 'entry1' || r.result === 'entry2') won = (r.result === 'entry1') === (side === 1);
			else if (ff1 !== ff2) won = (ff1 ? 2 : 1) === side;
			else { const w = winnerOf(g); won = w == null ? null : w === side; }
			forfeit = ff1 || ff2;
		} else {
			mine = r.logPartner ? [ref(r.logPartner)] : [];
			theirs = (r.logOpp ?? []).map(ref);
			games = meetGames(r.games);
			const w = winnerOf(games); won = w == null ? null : w === 1;
		}
		return {
			source: r.source, matchId: r.matchId, contextId: r.contextId, contextName: r.contextName, venueName: r.venueName,
			playedAt: new Date(r.playedAt).toISOString(), round: r.round, courtIndex: r.courtIndex,
			partners: mine.filter((p) => p.userId !== o.userId), opponents: theirs, games, won, forfeit,
			ratingDelta: deltas.get(r.source + ':' + r.matchId) ?? null,
		};
	});
}

/* COMMUNITY-MATCHES-V1 (lane account-rest, S7 D-statistics.06 — Reclub Statistics › Match history › Community matches):
 * the newest scored matches of the whole community, one SQL page. The SAME visibility rule as every function here
 * (meetVisible / compVisible for the viewer), the same liveness rule (not cancelled; a competition match completed),
 * so nothing private and nothing retired leaks. Each row is told from team 1's side: partners = team 1, opponents =
 * team 2, games team 1 first, won = team 1 won; `community: true` tells the list to draw 'A / B vs C / D'. */
const COMMUNITY_SQL = `
WITH h AS (
	SELECT 'meet'::text AS source, mm.id AS "matchId", m.id AS "contextId", m.name AS "contextName", m."venueName" AS "venueName",
	       m."startAt" AS "playedAt", mm.round, mm."courtIndex", mm.scores AS games, mm."forfeitTeam" AS "forfeitTeam",
	       mm."team1Ids" AS t1, mm."team2Ids" AS t2, NULL::varchar[] AS u1, NULL::varchar[] AS u2, NULL::text AS result, NULL::text AS f1, NULL::text AS f2
	FROM meet_match mm JOIN meet m ON m.id = mm."meetId"
	WHERE m.sport = $1 AND m.status <> 'cancelled' AND jsonb_array_length(mm.scores) > 0 AND m."startAt" < now() AND ${meetVisible('m', '$2')}
	UNION ALL
	SELECT 'competition', cm.id, c.id, c.name, c."venueName", COALESCE(cm."startAt", cm."updatedAt"), cm.round, cm."courtIndex", cm.scores, NULL::int,
	       NULL::varchar[], NULL::varchar[], e1."userIds", e2."userIds", cm.result::text, cm."entry1Status"::text, cm."entry2Status"::text
	FROM competition_match cm JOIN competition c ON c.id = cm."competitionId"
	LEFT JOIN competition_entry e1 ON e1.id = cm."entry1Id" LEFT JOIN competition_entry e2 ON e2.id = cm."entry2Id"
	WHERE c.sport = $1 AND c.status <> 'cancelled' AND cm.status = 'completed' AND jsonb_array_length(cm.scores) > 0 AND ${compVisible('c', '$2')}
)
SELECT h.* FROM h ORDER BY h."playedAt" DESC, h."matchId" DESC LIMIT $3 OFFSET $4`;

export async function communityPage(db: DataSource, o: { viewerId: string | null; sport: string; limit: number; offset: number }): Promise<(HistoryRow & { community: true })[]> {
	const [limit, offset] = pageArgs(o.limit, o.offset);
	const raw = await db.query(COMMUNITY_SQL, [o.sport, o.viewerId ?? '', limit, offset]) as RawHist[];
	if (!raw.length) return [];
	const pids = [...new Set(raw.flatMap((r) => [...(r.t1 ?? []), ...(r.t2 ?? [])]))];
	const pmap = new Map<string, PlayerRef>();
	if (pids.length) for (const x of await db.query('SELECT id, "userId", "displayName" FROM meet_participant WHERE id = ANY($1)', [pids]) as { id: string; userId: string | null; displayName: string | null }[]) pmap.set(x.id, { userId: x.userId, name: x.displayName });
	const ref = (u: string | null): PlayerRef => ({ userId: u, name: null });
	return raw.map((r) => {
		let t1: PlayerRef[], t2: PlayerRef[], games: [number, number][], won: boolean | null, forfeit = false;
		if (r.source === 'meet') {
			t1 = (r.t1 ?? []).map((id) => pmap.get(id) ?? { userId: null, name: null }); t2 = (r.t2 ?? []).map((id) => pmap.get(id) ?? { userId: null, name: null });
			games = meetGames(r.games);
			if (r.forfeitTeam === 1 || r.forfeitTeam === 2) { forfeit = true; won = r.forfeitTeam !== 1; } else { const w = winnerOf(games); won = w == null ? null : w === 1; }
		} else {
			t1 = (r.u1 ?? []).map(ref); t2 = (r.u2 ?? []).map(ref);
			games = compGames(r.games);
			const ff1 = r.f1 === 'forfeit', ff2 = r.f2 === 'forfeit';
			if (r.result === 'entry1' || r.result === 'entry2') won = r.result === 'entry1';
			else if (ff1 !== ff2) won = ff2;
			else { const w = winnerOf(games); won = w == null ? null : w === 1; }
			forfeit = ff1 || ff2;
		}
		return { source: r.source, matchId: r.matchId, contextId: r.contextId, contextName: r.contextName, venueName: r.venueName,
			playedAt: new Date(r.playedAt).toISOString(), round: r.round, courtIndex: r.courtIndex,
			partners: t1, opponents: t2, games, won, forfeit, ratingDelta: null, community: true as const };
	});
}

/** Every user id a page of rows mentions (for one UserLite packMany). */
export function userIdsOf(rows: { partners: PlayerRef[]; opponents: PlayerRef[] }[]): string[] {
	return [...new Set(rows.flatMap((r) => [...r.partners, ...r.opponents].map((p) => p.userId).filter((x): x is string => !!x)))];
}

// ---- match recap (Reclub Match summary) ---------------------------------------------------------------------------
export interface Summary {
	source: Source; matchId: string;
	context: { kind: 'meet' | 'competition' | 'openplay'; id: string | null; name: string | null; startAt: string | null; venueName: string | null; visibility: string | null };
	playedAt: string | null; round: number | null; courtIndex: number | null; stage: string | null; pool: number | null;
	teams: { side: 1 | 2; players: (PlayerRef & { ratingPre: number | null; ratingPost: number | null })[]; winner: boolean; forfeited: boolean }[];
	games: [number, number][];   // team 1 first
	dupr: { status: string | null; submittedById: string | null; submittedAt: string | null; ref: string | null; error: string | null } | null;
}

/** One match, read-only. null = no such match, or the viewer may not see it (same answer on purpose). */
export async function matchSummary(db: DataSource, source: Source, matchId: string, viewerId: string | null): Promise<Summary | null> {
	const viewer = viewerId ?? '';
	const logs = new Map<string, { pre: number | null; post: number | null; side: number | null }>();
	const loadLogs = async () => { for (const x of await db.query('SELECT "userId", pre, post, side FROM gb_rating_log WHERE source = $1 AND "matchId" = $2 AND NOT skipped', [source, matchId]) as { userId: string; pre: string | null; post: string | null; side: number | null }[]) logs.set(x.userId, { pre: x.pre == null ? null : Number(x.pre), post: x.post == null ? null : Number(x.post), side: x.side }); };
	// SEC-RATING-VIEW-V1 (G15.3 addendum (a)): ratingPre / ratingPost only on the VIEWER's own row; every other player's is null
	const withRating = (p: PlayerRef) => { const l = p.userId && viewer !== '' && p.userId === viewer ? logs.get(p.userId) : undefined; return { ...p, ratingPre: l ? l.pre : null, ratingPost: l ? l.post : null }; };
	if (source === 'meet') {
		const r = (await db.query(
			`SELECT mm.id, mm.round, mm."courtIndex", mm."team1Ids", mm."team2Ids", mm.scores, mm."forfeitTeam", mm."duprStatus", mm."duprSubmittedById", mm."duprSubmittedAt", mm."duprRef", mm."duprError",
			        m.id AS "meetId", m.name, m."startAt", m."venueName", m.visibility, m."hostId"
			 FROM meet_match mm JOIN meet m ON m.id = mm."meetId"
			 WHERE mm.id = $1 AND m.status <> 'cancelled' AND ${meetVisible('m', '$2')}`, [matchId, viewer]))[0];
		if (!r) return null;
		const ids = [...(r.team1Ids ?? []), ...(r.team2Ids ?? [])];
		const pmap = new Map<string, PlayerRef>();
		if (ids.length) for (const x of await db.query('SELECT id, "userId", "displayName" FROM meet_participant WHERE id = ANY($1)', [ids]) as { id: string; userId: string | null; displayName: string | null }[]) pmap.set(x.id, { userId: x.userId, name: x.displayName });
		await loadLogs();
		const games = meetGames(r.scores);
		const ff = r.forfeitTeam === 1 || r.forfeitTeam === 2 ? Number(r.forfeitTeam) : null;
		const w = ff ? (ff === 1 ? 2 : 1) : winnerOf(games);
		const team = (side: 1 | 2, list: string[]) => ({ side, players: (list ?? []).map((id) => withRating(pmap.get(id) ?? { userId: null, name: null })), winner: w === side, forfeited: ff === side });
		return {
			source, matchId, context: { kind: 'meet', id: r.meetId, name: r.name, startAt: new Date(r.startAt).toISOString(), venueName: r.venueName, visibility: r.visibility },
			playedAt: new Date(r.startAt).toISOString(), round: r.round, courtIndex: r.courtIndex, stage: null, pool: null,
			teams: [team(1, r.team1Ids), team(2, r.team2Ids)], games,
			dupr: { status: r.duprStatus ?? null, submittedById: r.duprSubmittedById ?? null, submittedAt: r.duprSubmittedAt ? new Date(r.duprSubmittedAt).toISOString() : null, ref: r.duprRef ?? null, error: viewer && viewer === r.hostId ? r.duprError ?? null : null },   // the error text is for the host
		};
	}
	if (source === 'competition') {
		const r = (await db.query(
			`SELECT cm.id, cm.round, cm."courtIndex", cm.stage, cm.pool, cm.scores, cm.result, cm."entry1Status", cm."entry2Status", COALESCE(cm."startAt", cm."updatedAt") AS "playedAt",
			        cm."duprStatus", cm."duprSubmittedById", cm."duprSubmittedAt", cm."duprRef", cm."duprError", c."hostId",   -- DUPR-COMP-RECAP-V1
			        c.id AS "compId", c.name, c."startAt", c."venueName", c.visibility, e1."userIds" AS u1, e2."userIds" AS u2, e1.name AS n1, e2.name AS n2
			 FROM competition_match cm JOIN competition c ON c.id = cm."competitionId"
			 LEFT JOIN competition_entry e1 ON e1.id = cm."entry1Id" LEFT JOIN competition_entry e2 ON e2.id = cm."entry2Id"
			 WHERE cm.id = $1 AND c.status <> 'cancelled' AND ${compVisible('c', '$2')}`, [matchId, viewer]))[0];
		if (!r) return null;
		await loadLogs();
		const games = compGames(r.scores);
		const f1 = r.entry1Status === 'forfeit', f2 = r.entry2Status === 'forfeit';
		const w = r.result === 'entry1' ? 1 : r.result === 'entry2' ? 2 : f1 !== f2 ? (f1 ? 2 : 1) : winnerOf(games);
		const team = (side: 1 | 2, list: string[] | null, ff: boolean) => ({ side, players: (list ?? []).map((u) => withRating({ userId: u, name: null })), winner: w === side, forfeited: ff });
		return {
			source, matchId, context: { kind: 'competition', id: r.compId, name: r.name, startAt: r.startAt ? new Date(r.startAt).toISOString() : null, venueName: r.venueName, visibility: r.visibility },
			playedAt: r.playedAt ? new Date(r.playedAt).toISOString() : null, round: r.round, courtIndex: r.courtIndex, stage: r.stage, pool: r.pool,
			teams: [team(1, r.u1, f1), team(2, r.u2, f2)], games,
			// DUPR-COMP-RECAP-V1 (lane account-rest, S7 D-match-summary.02): was `dupr: null` — the same receipt as a meet match
			dupr: { status: r.duprStatus ?? null, submittedById: r.duprSubmittedById ?? null, submittedAt: r.duprSubmittedAt ? new Date(r.duprSubmittedAt).toISOString() : null, ref: r.duprRef ?? null, error: viewer && viewer === r.hostId ? r.duprError ?? null : null },
		};
	}
	// openplay: the rating log is the record (one row per player, side 1 | 2, games from that player's side)
	await loadLogs();
	if (!logs.size) return null;
	const rows = await db.query('SELECT "userId", side, games, "playedAt", won FROM gb_rating_log WHERE source = $1 AND "matchId" = $2 AND NOT skipped ORDER BY side, "userId"', [source, matchId]) as { userId: string; side: number; games: unknown; playedAt: Date; won: boolean }[];
	const s1 = rows.filter((x) => x.side === 1), s2 = rows.filter((x) => x.side === 2);
	const games = s1.length ? meetGames(s1[0].games) : s2.length ? meetGames(s2[0].games).map(([a, b]) => [b, a] as [number, number]) : [];
	const w1 = s1.length ? s1[0].won : s2.length ? !s2[0].won : false;
	return {
		source, matchId, context: { kind: 'openplay', id: null, name: null, startAt: null, venueName: null, visibility: 'public' },
		playedAt: rows[0] ? new Date(rows[0].playedAt).toISOString() : null, round: null, courtIndex: null, stage: null, pool: null,
		teams: [{ side: 1, players: s1.map((x) => withRating({ userId: x.userId, name: null })), winner: !!w1, forfeited: false }, { side: 2, players: s2.map((x) => withRating({ userId: x.userId, name: null })), winner: !w1, forfeited: false }],
		games, dupr: null,
	};
}

// ---- activities (Reclub My history › Meets / Competitions; player activity list) ---------------------------------
export interface ActivityRow { kind: 'meet' | 'competition'; id: string; name: string; startAt: string; venueName: string | null; hosted: boolean; players: number; matches: number; wins: number; losses: number }

/** Past meets / competitions a player played in or hosted, newest first, one page. */
export async function activitiesPage(db: DataSource, o: { userId: string; viewerId: string | null; sport: string; kind: 'all' | 'meet' | 'competition'; limit: number; offset: number }): Promise<ActivityRow[]> {
	const [limit, offset] = pageArgs(o.limit, o.offset);
	const rows = await db.query(
		`WITH a AS (
			SELECT 'meet'::text AS kind, m.id, m.name, m."startAt", m."venueName", (m."hostId" = $1 OR COALESCE(bool_or(p."isHost"), false)) AS hosted, m.confirmed::int AS players
			FROM meet m LEFT JOIN meet_participant p ON p."meetId" = m.id AND p."userId" = $1 AND p.status = 'confirmed'
			WHERE m.sport = $2 AND m.status <> 'cancelled' AND m."startAt" < now() AND (p.id IS NOT NULL OR m."hostId" = $1)
			  AND ($3 = $1 OR ${meetVisible('m', '$3')})
			GROUP BY m.id
			UNION ALL
			SELECT 'competition', c.id, c.name, c."startAt", c."venueName", c."hostId" = $1,
			       (SELECT count(*) FROM competition_entry ce WHERE ce."competitionId" = c.id AND ce.status IN ('confirmed', 'forfeit'))::int
			FROM competition c
			WHERE c.sport = $2 AND c.status <> 'cancelled' AND c."startAt" < now()
			  AND (c."hostId" = $1 OR EXISTS (SELECT 1 FROM competition_entry ce WHERE ce."competitionId" = c.id AND $1 = ANY(ce."userIds")))
			  AND ($3 = $1 OR ${compVisible('c', '$3')})
		)
		SELECT * FROM a WHERE ($4 = 'all' OR kind = $4) ORDER BY "startAt" DESC, id DESC LIMIT $5 OFFSET $6`,
		[o.userId, o.sport, o.viewerId ?? '', o.kind, limit, offset]) as { kind: 'meet' | 'competition'; id: string; name: string; startAt: Date; venueName: string | null; hosted: boolean; players: number }[];
	if (!rows.length) return [];
	// the player's record in each activity of THIS page — one GROUP BY in SQL over the page's ids (same winner rules as
	// historyPage: meet forfeit → the other side; competition result → one-sided forfeit → games)
	const rec = new Map<string, { matches: number; wins: number; losses: number }>();
	const gw = (arr: string, a: string, b: string, extra = '') => `(SELECT CASE WHEN sum(CASE WHEN ${a} > ${b} THEN 1 ELSE 0 END) > sum(CASE WHEN ${b} > ${a} THEN 1 ELSE 0 END) THEN 1 WHEN sum(CASE WHEN ${a} > ${b} THEN 1 ELSE 0 END) < sum(CASE WHEN ${b} > ${a} THEN 1 ELSE 0 END) THEN 2 ELSE 0 END FROM jsonb_array_elements(${arr}) g ${extra})`;
	for (const x of await db.query(
		`WITH x AS (
			SELECT mm."meetId" AS ctx, (CASE WHEN p.id = ANY(mm."team1Ids") THEN 1 ELSE 2 END) AS side,
			       (CASE WHEN mm."forfeitTeam" IN (1, 2) THEN 3 - mm."forfeitTeam" ELSE ${gw('mm.scores', '(g->>0)::int', '(g->>1)::int')} END) AS w
			FROM meet_participant p JOIN meet_match mm ON mm."meetId" = p."meetId" AND (p.id = ANY(mm."team1Ids") OR p.id = ANY(mm."team2Ids"))
			WHERE p."userId" = $1 AND p."meetId" = ANY($2) AND jsonb_array_length(mm.scores) > 0
			UNION ALL
			SELECT cm."competitionId", (CASE WHEN cm."entry1Id" = e.id THEN 1 ELSE 2 END),
			       (CASE WHEN cm.result = 'entry1' THEN 1 WHEN cm.result = 'entry2' THEN 2
			             WHEN cm."entry1Status" = 'forfeit' AND cm."entry2Status" <> 'forfeit' THEN 2 WHEN cm."entry2Status" = 'forfeit' AND cm."entry1Status" <> 'forfeit' THEN 1
			             ELSE ${gw('cm.scores', "(g->>'t1')::int", "(g->>'t2')::int", "WHERE COALESCE(g->>'type', '') <> 'extra'")} END)
			FROM competition_entry e JOIN competition_match cm ON cm."competitionId" = e."competitionId" AND (cm."entry1Id" = e.id OR cm."entry2Id" = e.id)
			WHERE $1 = ANY(e."userIds") AND e."competitionId" = ANY($2) AND cm.status = 'completed' AND jsonb_array_length(cm.scores) > 0
		)
		SELECT ctx, count(*)::int AS n, sum(CASE WHEN w = side THEN 1 ELSE 0 END)::int AS w, sum(CASE WHEN w <> 0 AND w <> side THEN 1 ELSE 0 END)::int AS l FROM x GROUP BY ctx`,
		[o.userId, rows.map((a) => a.id)]) as { ctx: string; n: number; w: number; l: number }[]) rec.set(x.ctx, { matches: Number(x.n), wins: Number(x.w), losses: Number(x.l) });
	return rows.map((a) => ({ kind: a.kind, id: a.id, name: a.name, startAt: new Date(a.startAt).toISOString(), venueName: a.venueName, hosted: !!a.hosted, players: Number(a.players) || 0, ...(rec.get(a.id) ?? { matches: 0, wins: 0, losses: 0 }) }));
}

// ---- rankings (Reclub Statistics › Rankings, on the GripBat rating) ------------------------------------------------
// The GripBat rating is ONE number across singles and doubles (GB-RATING-V1 has one stream per sport); the type decides
// who is listed (a rated match of that type) and which wins / matches / opponents are counted. The app says so.
export interface RankRow { rank: number; userId: string; rating: number; matches: number; wins: number; opponents: number; provisional: boolean }

// $1 sport, $2 doubles?, $3 gender or NULL, $4 viewer ('' = anonymous). review-batch2 #6: the counts are the
// VIEWER's view of a player's record - exactly as stats/pair-summary reads it - so a match played in a PRIVATE meet
// is counted only for someone who may see that meet, and a player whose only rated matches of this type are private
// is not in that viewer's table at all.
const RANK_CTE = `
WITH base AS (
	SELECT l."userId", l.won, l."opponentIds" FROM gb_rating_log l
	WHERE l.sport = $1 AND NOT l.skipped AND (l."partnerId" IS NOT NULL) = $2
	  AND ${logVisible('l', '$4')}
),
agg AS (SELECT "userId", count(*)::int AS matches, sum(CASE WHEN won THEN 1 ELSE 0 END)::int AS wins FROM base GROUP BY "userId"),
opp AS (SELECT b."userId", count(DISTINCT o)::int AS opponents FROM base b CROSS JOIN LATERAL unnest(b."opponentIds") o GROUP BY b."userId"),
-- SEC-RATING-VIEW-V1 (G15.3 addendum (c)): the rating a player is ranked on is the VIEWER's view of it — the newest post of
-- the rows this viewer may see (GbRating.viewerRatings, the same rule) — never the running total a private game moved.
rt AS (SELECT l."userId", count(*)::int AS matches, (array_agg(l.post ORDER BY l."playedAt" DESC, l."createdAt" DESC))[1] AS rating
       FROM gb_rating_log l WHERE l.sport = $1 AND NOT l.skipped AND l."userId" IN (SELECT "userId" FROM agg) AND ${logVisible('l', '$4')} GROUP BY l."userId"),
ranked AS (
	SELECT a."userId", r.rating::float AS rating, r.matches::int AS total, a.matches, a.wins, COALESCE(opp.opponents, 0) AS opponents,
	       rank() OVER (ORDER BY r.rating DESC) AS rank
	FROM agg a JOIN rt r ON r."userId" = a."userId"
	LEFT JOIN opp ON opp."userId" = a."userId"
	LEFT JOIN meet_player_level pl ON pl."userId" = a."userId" AND pl.sport = $1
	WHERE ($3::varchar IS NULL OR pl.gender = $3)
)`;

/** One page of the GripBat ranking table for singles or doubles + the viewer's own row. Aggregated in SQL. */
export async function rankingsPage(db: DataSource, o: { sport: string; type: 'singles' | 'doubles'; gender: string | null; limit: number; offset: number; viewerId: string | null }): Promise<{ total: number; mine: RankRow | null; rows: RankRow[] }> {
	const [limit, offset] = pageArgs(o.limit, o.offset);
	const args = [o.sport, o.type === 'doubles', o.gender, o.viewerId ?? ''];
	const pack = (x: any): RankRow => ({ rank: Number(x.rank), userId: x.userId, rating: Math.round(Number(x.rating) * 1000) / 1000, matches: Number(x.matches), wins: Number(x.wins), opponents: Number(x.opponents), provisional: Number(x.total) < 10 });
	const rows = (await db.query(RANK_CTE + ' SELECT * FROM ranked ORDER BY rank, "userId" LIMIT $5 OFFSET $6', [...args, limit, offset]) as any[]).map(pack);
	const total = Number(((await db.query(RANK_CTE + ' SELECT count(*)::int AS n FROM ranked', args)) as any[])[0]?.n ?? 0);
	const mine = o.viewerId ? ((await db.query(RANK_CTE + ' SELECT * FROM ranked WHERE "userId" = $5', [...args, o.viewerId])) as any[]).map(pack)[0] ?? null : null;
	return { total, mine, rows };
}

// ---- pair record + the opponents it has faced (Reclub Stats team summary) ----------------------------------------
export interface PairOpp { opponentIds: string[]; matches: number; wins: number; pointsFor: number; pointsAgainst: number; lastAt: string }

export async function pairSummary(db: DataSource, a: string, b: string, sport: string, limit: number, viewerId: string | null): Promise<{ matches: number; wins: number; pointsFor: number; pointsAgainst: number; opponents: PairOpp[] }> {
	const [lim] = pageArgs(limit, 0);
	const pts = `(SELECT COALESCE(sum((g->>0)::int), 0) FROM jsonb_array_elements(l.games) g)`, ptsA = `(SELECT COALESCE(sum((g->>1)::int), 0) FROM jsonb_array_elements(l.games) g)`;
	const tot = (await db.query(
		`SELECT count(*)::int AS n, COALESCE(sum(CASE WHEN won THEN 1 ELSE 0 END), 0)::int AS w, COALESCE(sum(${pts}), 0)::int AS pf, COALESCE(sum(${ptsA}), 0)::int AS pa
		 FROM gb_rating_log l WHERE l."userId" = $1 AND l."partnerId" = $2 AND l.sport = $3 AND NOT l.skipped AND ${logVisible('l', '$4')}`, [a, b, sport, viewerId ?? '']))[0] ?? {};
	const opp = await db.query(
		`SELECT (SELECT array_agg(x ORDER BY x) FROM unnest(l."opponentIds") x) AS opp, count(*)::int AS n, sum(CASE WHEN won THEN 1 ELSE 0 END)::int AS w,
		        sum(${pts})::int AS pf, sum(${ptsA})::int AS pa, max(l."playedAt") AS last
		 FROM gb_rating_log l WHERE l."userId" = $1 AND l."partnerId" = $2 AND l.sport = $3 AND NOT l.skipped AND ${logVisible('l', '$5')}
		 GROUP BY 1 ORDER BY n DESC, last DESC LIMIT $4`, [a, b, sport, lim, viewerId ?? '']) as { opp: string[]; n: number; w: number; pf: number; pa: number; last: Date }[];
	return {
		matches: Number(tot.n ?? 0), wins: Number(tot.w ?? 0), pointsFor: Number(tot.pf ?? 0), pointsAgainst: Number(tot.pa ?? 0),
		opponents: opp.map((x) => ({ opponentIds: x.opp ?? [], matches: Number(x.n), wins: Number(x.w), pointsFor: Number(x.pf), pointsAgainst: Number(x.pa), lastAt: new Date(x.last).toISOString() })),
	};
}

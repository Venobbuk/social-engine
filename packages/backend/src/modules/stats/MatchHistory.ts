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

export type Source = 'meet' | 'competition' | 'openplay';
export type PlayerRef = { userId: string | null; name: string | null };
export interface HistoryRow {
	source: Source; matchId: string; contextId: string | null; contextName: string | null; venueName: string | null;
	playedAt: string; round: number | null; courtIndex: number | null;
	partners: PlayerRef[]; opponents: PlayerRef[];
	games: [number, number][];   // from the player's side: [theirs-side-of-player, opponents]
	won: boolean | null; forfeit: boolean; ratingDelta: number | null;
}

const MAX_OFFSET = 5000;
const pageArgs = (limit: number, offset: number): [number, number] => [Math.max(1, Math.min(100, limit | 0)), Math.max(0, Math.min(MAX_OFFSET, offset | 0))];

/** Competition score sets [{t1,t2,type}] → [[t1,t2]] (the 'extra' rows are not games — GbRating's rule). */
function compGames(raw: unknown): [number, number][] {
	return (Array.isArray(raw) ? raw : []).filter((g: any) => g && g.type !== 'extra').map((g: any) => [Number(g.t1), Number(g.t2)] as [number, number]);
}
function meetGames(raw: unknown): [number, number][] {
	return (Array.isArray(raw) ? raw : []).map((g: any) => [Number(g[0]), Number(g[1])] as [number, number]);
}

// The SQL that lists a player's scored matches (newest first). $1 player, $2 sport, $3 viewer ('' = anonymous),
// $4 limit, $5 offset, $6 context id or NULL, $7 partner id or NULL, $8 opponent ids (varchar[]) or NULL.
const HISTORY_SQL = `
WITH h AS (
	SELECT 'meet'::text AS source, mm.id AS "matchId", m.id AS "contextId", m.name AS "contextName", m."venueName" AS "venueName",
	       m."startAt" AS "playedAt", mm.round, mm."courtIndex", (CASE WHEN p.id = ANY(mm."team1Ids") THEN 1 ELSE 2 END)::int AS side,
	       mm.scores AS games, mm."forfeitTeam" AS "forfeitTeam", mm."team1Ids" AS t1, mm."team2Ids" AS t2,
	       NULL::varchar[] AS u1, NULL::varchar[] AS u2, NULL::varchar AS "logPartner", NULL::varchar[] AS "logOpp", NULL::text AS result
	FROM meet_participant p
	JOIN meet_match mm ON mm."meetId" = p."meetId" AND (p.id = ANY(mm."team1Ids") OR p.id = ANY(mm."team2Ids"))
	JOIN meet m ON m.id = mm."meetId"
	WHERE p."userId" = $1 AND m.sport = $2 AND m.status <> 'cancelled' AND jsonb_array_length(mm.scores) > 0
	  AND ($3 = $1 OR m.visibility = 'public' OR m."hostId" = $3 OR EXISTS (SELECT 1 FROM meet_participant vp WHERE vp."meetId" = m.id AND vp."userId" = $3))
	  AND ($6::varchar IS NULL OR m.id = $6)
	UNION ALL
	SELECT 'competition', cm.id, c.id, c.name, c."venueName", COALESCE(cm."startAt", cm."updatedAt"), cm.round, cm."courtIndex",
	       (CASE WHEN cm."entry1Id" = e.id THEN 1 ELSE 2 END)::int, cm.scores, NULL::int, NULL::varchar[], NULL::varchar[],
	       e1."userIds", e2."userIds", NULL::varchar, NULL::varchar[], cm.result::text
	FROM competition_entry e
	JOIN competition_match cm ON cm."competitionId" = e."competitionId" AND (cm."entry1Id" = e.id OR cm."entry2Id" = e.id)
	JOIN competition c ON c.id = cm."competitionId"
	LEFT JOIN competition_entry e1 ON e1.id = cm."entry1Id" LEFT JOIN competition_entry e2 ON e2.id = cm."entry2Id"
	WHERE $1 = ANY(e."userIds") AND c.sport = $2 AND cm.status = 'completed' AND jsonb_array_length(cm.scores) > 0
	  AND ($3 = $1 OR c.visibility = 'public' OR c."hostId" = $3)
	  AND ($6::varchar IS NULL OR c.id = $6)
	UNION ALL
	SELECT 'openplay', l."matchId", NULL, NULL, NULL, l."playedAt", NULL, NULL, 1, l.games, NULL, NULL, NULL, NULL, NULL,
	       l."partnerId", l."opponentIds", NULL
	FROM gb_rating_log l WHERE l.source = 'openplay' AND l."userId" = $1 AND l.sport = $2 AND NOT l.skipped AND $6::varchar IS NULL
)
SELECT h.* FROM h
WHERE ($7::varchar IS NULL AND $8::varchar[] IS NULL) OR EXISTS (
	SELECT 1 FROM gb_rating_log f WHERE f.source = h.source AND f."matchId" = h."matchId" AND f."userId" = $1 AND NOT f.skipped
	  AND ($7::varchar IS NULL OR f."partnerId" = $7) AND ($8::varchar[] IS NULL OR f."opponentIds" @> $8))
ORDER BY h."playedAt" DESC, h."matchId" DESC LIMIT $4 OFFSET $5`;

type RawHist = { source: Source; matchId: string; contextId: string | null; contextName: string | null; venueName: string | null; playedAt: Date; round: number | null; courtIndex: number | null; side: number; games: unknown; forfeitTeam: number | null; t1: string[] | null; t2: string[] | null; u1: string[] | null; u2: string[] | null; logPartner: string | null; logOpp: string[] | null; result: string | null };

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
	const deltas = new Map<string, number>();
	for (const x of await db.query('SELECT source, "matchId", pre, post FROM gb_rating_log WHERE "userId" = $1 AND NOT skipped AND "matchId" = ANY($2)', [o.userId, raw.map((r) => r.matchId)]) as { source: string; matchId: string; pre: string; post: string }[]) {
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
			if (r.result === 'entry1' || r.result === 'entry2') won = (r.result === 'entry1') === (side === 1);
			else { const w = winnerOf(g); won = w == null ? null : w === side; }
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
	const withRating = (p: PlayerRef) => { const l = p.userId ? logs.get(p.userId) : undefined; return { ...p, ratingPre: l ? l.pre : null, ratingPost: l ? l.post : null }; };
	if (source === 'meet') {
		const r = (await db.query(
			`SELECT mm.id, mm.round, mm."courtIndex", mm."team1Ids", mm."team2Ids", mm.scores, mm."forfeitTeam", mm."duprStatus", mm."duprSubmittedById", mm."duprSubmittedAt", mm."duprRef", mm."duprError",
			        m.id AS "meetId", m.name, m."startAt", m."venueName", m.visibility
			 FROM meet_match mm JOIN meet m ON m.id = mm."meetId"
			 WHERE mm.id = $1 AND m.status <> 'cancelled'
			   AND (m.visibility = 'public' OR m."hostId" = $2 OR EXISTS (SELECT 1 FROM meet_participant vp WHERE vp."meetId" = m.id AND vp."userId" = $2))`, [matchId, viewer]))[0];
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
			dupr: { status: r.duprStatus ?? null, submittedById: r.duprSubmittedById ?? null, submittedAt: r.duprSubmittedAt ? new Date(r.duprSubmittedAt).toISOString() : null, ref: r.duprRef ?? null, error: r.duprError ?? null },
		};
	}
	if (source === 'competition') {
		const r = (await db.query(
			`SELECT cm.id, cm.round, cm."courtIndex", cm.stage, cm.pool, cm.scores, cm.result, cm."entry1Status", cm."entry2Status", COALESCE(cm."startAt", cm."updatedAt") AS "playedAt",
			        c.id AS "compId", c.name, c."startAt", c."venueName", c.visibility, e1."userIds" AS u1, e2."userIds" AS u2, e1.name AS n1, e2.name AS n2
			 FROM competition_match cm JOIN competition c ON c.id = cm."competitionId"
			 LEFT JOIN competition_entry e1 ON e1.id = cm."entry1Id" LEFT JOIN competition_entry e2 ON e2.id = cm."entry2Id"
			 WHERE cm.id = $1 AND (c.visibility = 'public' OR c."hostId" = $2 OR $2 = ANY(COALESCE(e1."userIds", '{}')) OR $2 = ANY(COALESCE(e2."userIds", '{}')))`, [matchId, viewer]))[0];
		if (!r) return null;
		await loadLogs();
		const games = compGames(r.scores);
		const f1 = r.entry1Status === 'forfeit', f2 = r.entry2Status === 'forfeit';
		const w = r.result === 'entry1' ? 1 : r.result === 'entry2' ? 2 : f1 !== f2 ? (f1 ? 2 : 1) : winnerOf(games);
		const team = (side: 1 | 2, list: string[] | null, ff: boolean) => ({ side, players: (list ?? []).map((u) => withRating({ userId: u, name: null })), winner: w === side, forfeited: ff });
		return {
			source, matchId, context: { kind: 'competition', id: r.compId, name: r.name, startAt: r.startAt ? new Date(r.startAt).toISOString() : null, venueName: r.venueName, visibility: r.visibility },
			playedAt: r.playedAt ? new Date(r.playedAt).toISOString() : null, round: r.round, courtIndex: r.courtIndex, stage: r.stage, pool: r.pool,
			teams: [team(1, r.u1, f1), team(2, r.u2, f2)], games, dupr: null,
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
			  AND ($3 = $1 OR m.visibility = 'public' OR m."hostId" = $3 OR EXISTS (SELECT 1 FROM meet_participant vp WHERE vp."meetId" = m.id AND vp."userId" = $3))
			GROUP BY m.id
			UNION ALL
			SELECT 'competition', c.id, c.name, c."startAt", c."venueName", c."hostId" = $1,
			       (SELECT count(*) FROM competition_entry ce WHERE ce."competitionId" = c.id AND ce.status IN ('confirmed', 'forfeit'))::int
			FROM competition c
			WHERE c.sport = $2 AND c.status <> 'cancelled' AND c."startAt" < now()
			  AND (c."hostId" = $1 OR EXISTS (SELECT 1 FROM competition_entry ce WHERE ce."competitionId" = c.id AND $1 = ANY(ce."userIds")))
			  AND ($3 = $1 OR c.visibility = 'public' OR c."hostId" = $3)
		)
		SELECT * FROM a WHERE ($4 = 'all' OR kind = $4) ORDER BY "startAt" DESC, id DESC LIMIT $5 OFFSET $6`,
		[o.userId, o.sport, o.viewerId ?? '', o.kind, limit, offset]) as { kind: 'meet' | 'competition'; id: string; name: string; startAt: Date; venueName: string | null; hosted: boolean; players: number }[];
	if (!rows.length) return [];
	// the player's record in each activity of THIS page (bounded by the page's activities)
	const rec = new Map<string, { matches: number; wins: number; losses: number }>();
	for (const a of rows) {
		const h = await historyPage(db, { userId: o.userId, viewerId: o.viewerId, sport: o.sport, limit: 100, offset: 0, contextId: a.id });
		rec.set(a.id, { matches: h.length, wins: h.filter((x) => x.won === true).length, losses: h.filter((x) => x.won === false).length });
	}
	return rows.map((a) => ({ kind: a.kind, id: a.id, name: a.name, startAt: new Date(a.startAt).toISOString(), venueName: a.venueName, hosted: !!a.hosted, players: Number(a.players) || 0, ...(rec.get(a.id) ?? { matches: 0, wins: 0, losses: 0 }) }));
}

// ---- rankings (Reclub Statistics › Rankings, on the GripBat rating) ------------------------------------------------
export interface RankRow { rank: number; userId: string; rating: number; matches: number; wins: number; opponents: number; provisional: boolean }

const RANK_CTE = `
WITH base AS (
	SELECT l."userId", l.won, l."opponentIds" FROM gb_rating_log l
	WHERE l.sport = $1 AND NOT l.skipped AND (l."partnerId" IS NOT NULL) = $2
),
agg AS (SELECT "userId", count(*)::int AS matches, sum(CASE WHEN won THEN 1 ELSE 0 END)::int AS wins FROM base GROUP BY "userId"),
opp AS (SELECT b."userId", count(DISTINCT o)::int AS opponents FROM base b CROSS JOIN LATERAL unnest(b."opponentIds") o GROUP BY b."userId"),
ranked AS (
	SELECT a."userId", r.rating::float AS rating, r.matches::int AS total, a.matches, a.wins, COALESCE(opp.opponents, 0) AS opponents,
	       rank() OVER (ORDER BY r.rating DESC) AS rank
	FROM agg a JOIN gb_player_rating r ON r."userId" = a."userId" AND r.sport = $1
	LEFT JOIN opp ON opp."userId" = a."userId"
	LEFT JOIN meet_player_level pl ON pl."userId" = a."userId" AND pl.sport = $1
	WHERE ($3::varchar IS NULL OR pl.gender = $3)
)`;

/** One page of the GripBat ranking table for singles or doubles + the viewer's own row. Aggregated in SQL. */
export async function rankingsPage(db: DataSource, o: { sport: string; type: 'singles' | 'doubles'; gender: string | null; limit: number; offset: number; viewerId: string | null }): Promise<{ total: number; mine: RankRow | null; rows: RankRow[] }> {
	const [limit, offset] = pageArgs(o.limit, o.offset);
	const args = [o.sport, o.type === 'doubles', o.gender];
	const pack = (x: any): RankRow => ({ rank: Number(x.rank), userId: x.userId, rating: Math.round(Number(x.rating) * 1000) / 1000, matches: Number(x.matches), wins: Number(x.wins), opponents: Number(x.opponents), provisional: Number(x.total) < 10 });
	const rows = (await db.query(RANK_CTE + ' SELECT * FROM ranked ORDER BY rank, "userId" LIMIT $4 OFFSET $5', [...args, limit, offset]) as any[]).map(pack);
	const total = Number(((await db.query(RANK_CTE + ' SELECT count(*)::int AS n FROM ranked', args)) as any[])[0]?.n ?? 0);
	const mine = o.viewerId ? ((await db.query(RANK_CTE + ' SELECT * FROM ranked WHERE "userId" = $4', [...args, o.viewerId])) as any[]).map(pack)[0] ?? null : null;
	return { total, mine, rows };
}

// ---- pair record + the opponents it has faced (Reclub Stats team summary) ----------------------------------------
export interface PairOpp { opponentIds: string[]; matches: number; wins: number; pointsFor: number; pointsAgainst: number; lastAt: string }

export async function pairSummary(db: DataSource, a: string, b: string, sport: string, limit: number): Promise<{ matches: number; wins: number; pointsFor: number; pointsAgainst: number; opponents: PairOpp[] }> {
	const [lim] = pageArgs(limit, 0);
	const pts = `(SELECT COALESCE(sum((g->>0)::int), 0) FROM jsonb_array_elements(l.games) g)`, ptsA = `(SELECT COALESCE(sum((g->>1)::int), 0) FROM jsonb_array_elements(l.games) g)`;
	const tot = (await db.query(
		`SELECT count(*)::int AS n, COALESCE(sum(CASE WHEN won THEN 1 ELSE 0 END), 0)::int AS w, COALESCE(sum(${pts}), 0)::int AS pf, COALESCE(sum(${ptsA}), 0)::int AS pa
		 FROM gb_rating_log l WHERE l."userId" = $1 AND l."partnerId" = $2 AND l.sport = $3 AND NOT l.skipped`, [a, b, sport]))[0] ?? {};
	const opp = await db.query(
		`SELECT (SELECT array_agg(x ORDER BY x) FROM unnest(l."opponentIds") x) AS opp, count(*)::int AS n, sum(CASE WHEN won THEN 1 ELSE 0 END)::int AS w,
		        sum(${pts})::int AS pf, sum(${ptsA})::int AS pa, max(l."playedAt") AS last
		 FROM gb_rating_log l WHERE l."userId" = $1 AND l."partnerId" = $2 AND l.sport = $3 AND NOT l.skipped
		 GROUP BY 1 ORDER BY n DESC, last DESC LIMIT $4`, [a, b, sport, lim]) as { opp: string[]; n: number; w: number; pf: number; pa: number; last: Date }[];
	return {
		matches: Number(tot.n ?? 0), wins: Number(tot.w ?? 0), pointsFor: Number(tot.pf ?? 0), pointsAgainst: Number(tot.pa ?? 0),
		opponents: opp.map((x) => ({ opponentIds: x.opp ?? [], matches: Number(x.n), wins: Number(x.w), pointsFor: Number(x.pf), pointsAgainst: Number(x.pa), lastAt: new Date(x.last).toISOString() })),
	};
}

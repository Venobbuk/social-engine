/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { DataSource } from 'typeorm';

// GB-RATING-V1 (2026-09-19, operator: "new players not on hkpl — use our open play, tournaments and social matches, the
// way hkpl does it, not copied from hkpl players"). GripBat's OWN rating + Edge analytics, from GripBat's own matches:
//   sources  meet_match (meets + casual games; team ids are meet_participant ids) and competition_match (entries →
//            competition_entry.userIds). Only matches whose every player is a GripBat user and that carry a score.
//   rating   one number per (user, sport) on the DUPR-like 2–8 scale. Seeds from the player's own level row (DUPR
//            doubles if linked, else self level, else 3.0). Expected = hkpl's curve p = 1/(1+10^(−Δ×1.2)); actual =
//            half the win + half the point share; Δrating = K × (actual − expected), K 0.12 for the first 10 rated
//            matches then 0.05. It is GripBat's number — DUPR's formula is not imitated (it is not public).
//   log      gb_rating_log: one row per (source, match, player) with pre/post rating, team + opponent average, expected,
//            result, games, partner, opponents — the Edge reads nothing else. Idempotent: a match is rated once.
// The minute sweep (MeetSweepProcessorService) calls processRatings(); the backfill is the same call looping.

const CURVE = 1.2;
export const expectedOf = (a: number, b: number): number => 1 / (1 + Math.pow(10, -(a - b) * CURVE));
const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x));

type Side = { userIds: string[] };
type Raw = { source: 'meet' | 'competition' | 'openplay'; id: string; playedAt: Date; sport: string; sides: [Side, Side]; games: [number, number][] };

async function pendingMatches(db: DataSource, limit: number): Promise<Raw[]> {
	const meet = await db.query(
		`SELECT mm.id, m."startAt" AS "playedAt", m.sport, mm."team1Ids", mm."team2Ids", mm.scores
		 FROM meet_match mm JOIN meet m ON m.id = mm."meetId"
		 WHERE m.status <> 'cancelled' AND jsonb_array_length(mm.scores) > 0 AND m."startAt" < now()
		   AND NOT EXISTS (SELECT 1 FROM gb_rating_log l WHERE l.source = 'meet' AND l."matchId" = mm.id)
		   -- SEC-CASUAL-CONSENT-V1: a casual game counts only when every account player on the match is confirmed;
		   -- a pending ('invited') or declined player keeps the game out of the rating until they confirm.
		   AND (NOT ('casual' = ANY(m.flags)) OR NOT EXISTS (
		         SELECT 1 FROM meet_participant pu
		          WHERE pu."meetId" = mm."meetId"
		            AND (pu.id = ANY(mm."team1Ids") OR pu.id = ANY(mm."team2Ids"))
		            AND pu."userId" IS NOT NULL AND pu.status <> 'confirmed'))
		 ORDER BY m."startAt" ASC LIMIT $1`, [limit]) as { id: string; playedAt: Date; sport: string; team1Ids: string[]; team2Ids: string[]; scores: [number, number][] }[];
	const pids = [...new Set(meet.flatMap((r) => [...(r.team1Ids ?? []), ...(r.team2Ids ?? [])]))];
	const pmap = new Map<string, string | null>();
	if (pids.length) for (const p of await db.query('SELECT id, "userId" FROM meet_participant WHERE id = ANY($1)', [pids]) as { id: string; userId: string | null }[]) pmap.set(p.id, p.userId);
	const out: Raw[] = [];
	for (const r of meet) {
		const s1 = (r.team1Ids ?? []).map((i) => pmap.get(i) ?? null), s2 = (r.team2Ids ?? []).map((i) => pmap.get(i) ?? null);
		out.push({ source: 'meet', id: r.id, playedAt: new Date(r.playedAt), sport: r.sport || 'pickleball', sides: [{ userIds: s1 as string[] }, { userIds: s2 as string[] }], games: (r.scores ?? []).map((g) => [Number(g[0]), Number(g[1])] as [number, number]) });
	}
	const comp = await db.query(
		`SELECT cm.id, COALESCE(cm."startAt", cm."updatedAt") AS "playedAt", c.sport, e1."userIds" AS u1, e2."userIds" AS u2, cm.scores
		 FROM competition_match cm JOIN competition c ON c.id = cm."competitionId"
		 LEFT JOIN competition_entry e1 ON e1.id = cm."entry1Id" LEFT JOIN competition_entry e2 ON e2.id = cm."entry2Id"
		 WHERE cm.status = 'completed' AND jsonb_array_length(cm.scores) > 0
		   AND NOT EXISTS (SELECT 1 FROM gb_rating_log l WHERE l.source = 'competition' AND l."matchId" = cm.id)
		 ORDER BY 2 ASC LIMIT $1`, [limit]) as { id: string; playedAt: Date; sport: string; u1: string[] | null; u2: string[] | null; scores: { t1: number; t2: number; type: string }[] }[];
	for (const r of comp) {
		out.push({ source: 'competition', id: r.id, playedAt: new Date(r.playedAt), sport: r.sport || 'pickleball', sides: [{ userIds: r.u1 ?? [] }, { userIds: r.u2 ?? [] }], games: (r.scores ?? []).filter((g) => g.type !== 'extra').map((g) => [Number(g.t1), Number(g.t2)] as [number, number]) });
	}
	out.push(...await pendingOpenPlay(db, limit).catch(() => [] as Raw[]));   // GB-OPENPLAY-V1
	out.sort((a, b) => a.playedAt.getTime() - b.playedAt.getTime());
	return out;
}

async function currentRating(db: DataSource, userId: string, sport: string): Promise<{ rating: number; matches: number }> {
	const r = (await db.query('SELECT rating, matches FROM gb_player_rating WHERE "userId" = $1 AND sport = $2', [userId, sport]))[0];
	if (r) return { rating: Number(r.rating), matches: Number(r.matches) };
	const l = (await db.query('SELECT "duprDoubles", "selfLevel" FROM meet_player_level WHERE "userId" = $1 AND sport = $2', [userId, sport]))[0];
	const seed = l && l.duprDoubles != null ? Number(l.duprDoubles) : l && l.selfLevel != null ? Number(l.selfLevel) : 3.0;
	return { rating: clamp(seed, 1.5, 8), matches: 0 };
}

/** Rates up to `limit` unrated matches in play order. Returns how many were rated / skipped (a guest or no winner). */
export async function processRatings(db: DataSource, limit = 200): Promise<{ rated: number; skipped: number }> {
	const ms = await pendingMatches(db, limit);
	let rated = 0, skipped = 0;
	for (const m of ms) {
		const [A, B] = m.sides;
		let w1 = 0, w2 = 0, p1 = 0, p2 = 0;
		for (const [a, b] of m.games) { if (a > b) w1++; else if (b > a) w2++; p1 += a; p2 += b; }
		const ok = A.userIds.length > 0 && B.userIds.length > 0 && A.userIds.length === B.userIds.length && [...A.userIds, ...B.userIds].every(Boolean) && w1 !== w2;
		if (!ok) {   // a guest (no account), a bye or a drawn/unfinished score: logged as skipped so it is not re-read every minute
			await db.query('INSERT INTO gb_rating_log (source, "matchId", "userId", skipped, "playedAt") VALUES ($1, $2, $3, true, $4) ON CONFLICT DO NOTHING', [m.source, m.id, '-', m.playedAt]);
			skipped++; continue;
		}
		const cur = new Map<string, { rating: number; matches: number }>();
		for (const u of [...A.userIds, ...B.userIds]) cur.set(u, await currentRating(db, u, m.sport));
		const avg = (ids: string[]) => ids.reduce((s, u) => s + cur.get(u)!.rating, 0) / ids.length;
		const rA = avg(A.userIds), rB = avg(B.userIds);
		const eA = expectedOf(rA, rB);
		const shareA = p1 + p2 > 0 ? p1 / (p1 + p2) : (w1 > w2 ? 1 : 0);
		const actA = 0.5 * (w1 > w2 ? 1 : 0) + 0.5 * clamp((shareA - 0.5) * 2.5 + 0.5, 0, 1);
		for (const [side, ids, opp, eMine, actMine, rMine, rOpp, gamesMine] of [
			[1, A.userIds, B.userIds, eA, actA, rA, rB, m.games] as const,
			[2, B.userIds, A.userIds, 1 - eA, 1 - actA, rB, rA, m.games.map(([a, b]) => [b, a] as [number, number])] as const,
		]) {
			for (const u of ids) {
				const c = cur.get(u)!;
				const K = c.matches < 10 ? 0.12 : 0.05;
				const post = clamp(c.rating + K * (actMine - eMine), 1.5, 8);
				const partner = ids.find((x) => x !== u) ?? null;
				await db.query(
					`INSERT INTO gb_rating_log (source, "matchId", "userId", sport, side, "partnerId", "opponentIds", pre, post, "teamRating", "oppRating", expected, won, games, "playedAt")
					 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) ON CONFLICT DO NOTHING`,
					[m.source, m.id, u, m.sport, side, partner, opp, c.rating, post, rMine, rOpp, eMine, (side === 1 ? w1 > w2 : w2 > w1), JSON.stringify(gamesMine), m.playedAt]);
				await db.query(
					`INSERT INTO gb_player_rating ("userId", sport, rating, matches, "updatedAt") VALUES ($1,$2,$3,1,now())
					 ON CONFLICT ("userId", sport) DO UPDATE SET rating = $3, matches = gb_player_rating.matches + 1, "updatedAt" = now()`, [u, m.sport, post]);
			}
		}
		rated++;
	}
	return { rated, skipped };
}

type LogRow = { matchId: string; source: string; partnerId: string | null; opponentIds: string[]; pre: number; post: number; teamRating: number; oppRating: number; expected: number; won: boolean; games: [number, number][]; playedAt: Date };

/** The Edge for one player from their GripBat matches: rating + trend, partner chemistry, clutch, form, upsets. */
export async function edgeOf(db: DataSource, userId: string, sport = 'pickleball'): Promise<Record<string, unknown>> {
	/* FRESH-EYES P1-2 (2026-09-20) — A RATING ROW CANNOT OUTLIVE THE MATCH THAT JUSTIFIED IT.
	 *
	 * pendingMatches() above refuses to rate a match in a cancelled meet, and MeetService.cancel() now takes back
	 * what a meet had already written. This is the same rule applied where it cannot be bypassed: on the READ. A row
	 * survives its match in two ways — the meet is cancelled after the rating ran, or the match row is deleted
	 * outright (a probe tidying up after itself; measured 2026-09-20: 6 such rows in the sandbox, 3 of them one
	 * player's, and they were the entire "GRIPBAT RATING 3.32 · 3 matches · On fire · Upsets 3" her Statistics
	 * printed above "0 Meets played"). Nobody can check a row whose match is gone, so it does not count.
	 *
	 * The counter is asked with the SAME condition rather than read off gb_player_rating, because that column is a
	 * running total and would keep reporting matches this query has just excluded — which is the contradiction. */
	const GUARD = `(source <> 'meet' OR EXISTS (SELECT 1 FROM meet_match mm JOIN meet m ON m.id = mm."meetId" WHERE mm.id = gb_rating_log."matchId" AND m.status <> 'cancelled'))`;
	const rows = (await db.query(
		`SELECT "matchId", source, "partnerId", "opponentIds", pre, post, "teamRating", "oppRating", expected, won, games, "playedAt"
		 FROM gb_rating_log WHERE "userId" = $1 AND sport = $2 AND NOT skipped AND ${GUARD} ORDER BY "playedAt" DESC LIMIT 300`, [userId, sport]) as LogRow[])
		.map((r) => ({ ...r, pre: Number(r.pre), post: Number(r.post), teamRating: Number(r.teamRating), oppRating: Number(r.oppRating), expected: Number(r.expected) }));
	const rt = (await db.query('SELECT rating, matches FROM gb_player_rating WHERE "userId" = $1 AND sport = $2', [userId, sport]))[0];
	const counted = Number(((await db.query(
		`SELECT count(*)::int AS n FROM gb_rating_log WHERE "userId" = $1 AND sport = $2 AND NOT skipped AND ${GUARD}`, [userId, sport]))[0] ?? { n: 0 }).n);
	// No countable match means no rating to state: printing the stored number beside "No rated matches yet" is the
	// contradiction this whole change exists to remove.
	const rating = counted && rt ? Number(rt.rating) : null;
	if (!rows.length) return { userId, sport, rating: null, matches: 0, provisional: true, empty: true };
	// rating trend: last 30 days vs the rating before them
	const monthAgo = Date.now() - 30 * 86400e3;
	const older = rows.find((r) => new Date(r.playedAt).getTime() < monthAgo);
	const trend30 = rating != null ? rating - (older ? older.post : rows[rows.length - 1].pre) : null;
	// partner chemistry
	const byP = new Map<string, { partnerId: string; matches: number; wins: number; expected: number }>();
	for (const r of rows) {
		if (!r.partnerId) continue;
		const o = byP.get(r.partnerId) ?? { partnerId: r.partnerId, matches: 0, wins: 0, expected: 0 };
		o.matches++; if (r.won) o.wins++; o.expected += r.expected; byP.set(r.partnerId, o);
	}
	const partners = [...byP.values()].filter((o) => o.matches >= 2).map((o) => ({ ...o, winRate: o.wins / o.matches, expectedRate: o.expected / o.matches, edge: (o.wins - o.expected) / o.matches })).sort((a, b) => b.edge - a.edge).slice(0, 8);
	// clutch
	let close = 0, closeWon = 0, dec = 0, decWon = 0;
	for (const r of rows) {
		const gs = r.games ?? [];
		for (const [a, b] of gs) if (Math.abs(a - b) <= 2 && a !== b) { close++; if (a > b) closeWon++; }
		if (gs.length >= 3) { dec++; const l = gs[gs.length - 1]; if (l[0] > l[1]) decWon++; }
	}
	// form: last 10
	const recent = rows.slice(0, 10);
	const wins = recent.filter((r) => r.won).length, exp = recent.reduce((s, r) => s + r.expected, 0);
	const gap = recent.length ? (wins - exp) / recent.length : null;
	let streak = 0; for (const r of rows) { if (r.won !== rows[0].won) break; streak++; }
	// upsets: beat a team ≥ 0.25 higher / lost to one ≥ 0.25 lower
	const upWon = rows.filter((r) => r.won && r.oppRating - r.teamRating >= 0.25).length;
	const upLost = rows.filter((r) => !r.won && r.teamRating - r.oppRating >= 0.25).length;
	return {
		userId, sport, rating, matches: counted, provisional: counted < 10, trend30,
		history: rows.slice(0, 30).map((r) => ({ at: r.playedAt, rating: r.post })).reverse(),
		partners,
		clutch: { closeGames: close, closeWon, closeRate: close ? closeWon / close : null, deciders: dec, decidersWon: decWon, deciderRate: dec ? decWon / dec : null },
		form: { matches: recent.length, wins, expectedWins: Math.round(exp * 100) / 100, gap, label: gap == null ? null : gap >= 0.15 ? 'hot' : gap <= -0.15 ? 'cold' : 'steady', streak: { won: rows[0].won, n: streak } },
		upsets: { won: upWon, lost: upLost, underrated: upWon >= 3 && upWon > upLost * 2 },
	};
}

/** Fairest doubles pairing of four players on GripBat ratings, nudged by their GripBat partner chemistry. */
export async function fairTeamsOf(db: DataSource, userIds: string[], sport = 'pickleball', viewerId: string | null = null): Promise<{ teamA: string[]; teamB: string[]; teamAWinPct: number; fairness: number }[]> {
	const r = await Promise.all(userIds.map((u) => currentRating(db, u, sport).then((x) => x.rating)));
	const chem = async (a: string, b: string): Promise<number> => {
		const x = (await db.query(`SELECT count(*)::int n, sum(CASE WHEN won THEN 1 ELSE 0 END)::float w, sum(expected)::float e FROM gb_rating_log WHERE "userId" = $1 AND "partnerId" = $2 AND sport = $3 AND NOT skipped`, [a, b, sport]))[0];
		const c = x && x.n >= 2 ? (x.w - x.e) / x.n : 0;
		// SEC-ANON-CHEM-V1 (2026-09-21, permission-sweep hole 5): a NEGATIVE chemistry score is private to the two
		// players it is about, and it is recoverable from teamAWinPct by comparing the three splits against the
		// ratings. So a caller who is not one of the pair sees the pair's chemistry only when it is positive — the
		// same rule gb-edge and gb-pairs apply. Balancing still works: ratings carry it, good chemistry still counts.
		if (c < 0 && !(viewerId && (viewerId === a || viewerId === b))) return 0;
		return c;
	};
	const pairs: [number[], number[]][] = [[[0, 1], [2, 3]], [[0, 2], [1, 3]], [[0, 3], [1, 2]]];
	const out = [];
	for (const [A, B] of pairs) {
		let p = expectedOf((r[A[0]] + r[A[1]]) / 2, (r[B[0]] + r[B[1]]) / 2);
		p = clamp(p + ((await chem(userIds[A[0]], userIds[A[1]])) - (await chem(userIds[B[0]], userIds[B[1]]))) / 2, 0.03, 0.97);
		out.push({ teamA: A.map((i) => userIds[i]), teamB: B.map((i) => userIds[i]), teamAWinPct: Math.round(p * 100), fairness: Math.round(100 - Math.abs(p - 0.5) * 200) });
	}
	return out.sort((a, b) => b.fairness - a.fairness);
}

/** Current GripBat ratings for a batch of users (for chips / roster). */
export async function ratingsOf(db: DataSource, userIds: string[], sport = 'pickleball'): Promise<{ userId: string; rating: number; matches: number; provisional: boolean }[]> {
	if (!userIds.length) return [];
	const rows = await db.query('SELECT "userId", rating, matches FROM gb_player_rating WHERE "userId" = ANY($1) AND sport = $2', [userIds, sport]) as { userId: string; rating: string; matches: number }[];
	return rows.map((x) => ({ userId: x.userId, rating: Number(x.rating), matches: Number(x.matches), provisional: Number(x.matches) < 10 }));
}

/** Rising players: the biggest 30-day GripBat rating gains (≥ 5 rated matches in the window) — the "upset radar". */
export async function risingOf(db: DataSource, sport = 'pickleball', limit = 20): Promise<{ userId: string; rating: number; gain: number; matches: number; upsets: number }[]> {
	const rows = await db.query(
		`WITH w AS (
		   SELECT "userId", count(*)::int AS n,
		          (array_agg(pre ORDER BY "playedAt" ASC))[1] AS first_pre,
		          (array_agg(post ORDER BY "playedAt" DESC))[1] AS last_post,
		          sum(CASE WHEN won AND "oppRating" - "teamRating" >= 0.25 THEN 1 ELSE 0 END)::int AS upsets
		   FROM gb_rating_log WHERE sport = $1 AND NOT skipped AND "playedAt" > now() - interval '30 days'
		   GROUP BY "userId")
		 SELECT "userId", last_post AS rating, (last_post - first_pre) AS gain, n AS matches, upsets FROM w
		 WHERE n >= 5 AND last_post > first_pre ORDER BY gain DESC LIMIT $2`, [sport, limit]) as { userId: string; rating: string; gain: string; matches: number; upsets: number }[];
	return rows.map((r) => ({ userId: r.userId, rating: Number(r.rating), gain: Number(r.gain), matches: Number(r.matches), upsets: Number(r.upsets) }));
}

/** A pair's record together (GripBat matches): matches, wins, expected wins — the scouting line under a team. */
export async function pairsOf(db: DataSource, pairs: [string, string][], sport = 'pickleball'): Promise<{ a: string; b: string; matches: number; wins: number; expected: number }[]> {
	const out = [];
	for (const [a, b] of pairs.slice(0, 40)) {
		const x = (await db.query(`SELECT count(*)::int n, coalesce(sum(CASE WHEN won THEN 1 ELSE 0 END),0)::int w, coalesce(sum(expected),0)::float e FROM gb_rating_log WHERE "userId" = $1 AND "partnerId" = $2 AND sport = $3 AND NOT skipped`, [a, b, sport]))[0];
		out.push({ a, b, matches: x ? x.n : 0, wins: x ? x.w : 0, expected: x ? Math.round(x.e * 100) / 100 : 0 });
	}
	return out;
}

// ---- GB-OPENPLAY-V1: open-play games (hkpl open play, the app's "Open play") count toward the GripBat rating --------
// Every 5 minutes the sweep pulls PLAYED games for this engine's host from hkpl (GET /api/v1/social/openplay/played,
// x-social-secret) into gb_openplay_game; pendingMatches() then rates them as source 'openplay'. Open play stores DUPR
// ids as player refs; a ref maps to a GripBat user through meet_player_level.duprId. A game with a guest is skipped.
let openPlayAt = 0;
export async function importOpenPlay(db: DataSource, host: string): Promise<number> {
	if (Date.now() - openPlayAt < 5 * 60e3) return 0;
	openPlayAt = Date.now();
	const base = (process.env.ADAPTER_HKPL_URL ?? '').replace(/\/+$/, ''), secret = process.env.ADAPTER_HKPL_S2S_SECRET ?? '';
	if (!base || !secret || !host) return 0;
	const since = (await db.query('SELECT max("playedAt") AS s FROM gb_openplay_game'))[0]?.s;
	const url = `${base}/api/v1/social/openplay/played?host=${encodeURIComponent(host)}&limit=200` + (since ? '&since=' + encodeURIComponent(new Date(since).toISOString()) : '');
	const r = await fetch(url, { headers: { 'x-social-secret': secret } });
	if (!r.ok) throw new Error('openplay feed ' + r.status);
	const j = await r.json() as { games?: { id: string; played_at: string; format: string; refs: (string | null)[]; score_a: number; score_b: number }[] };
	let n = 0;
	for (const g of j.games ?? []) {
		await db.query('INSERT INTO gb_openplay_game (id, "playedAt", format, refs, "scoreA", "scoreB") VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING',
			[g.id, new Date(g.played_at), g.format || 'doubles', (g.refs ?? []).map((x) => (x ?? '').trim()), g.score_a, g.score_b]);
		n++;
	}
	return n;
}

async function pendingOpenPlay(db: DataSource, limit: number): Promise<Raw[]> {
	const rows = await db.query(
		`SELECT g.id, g."playedAt", g.format, g.refs, g."scoreA", g."scoreB" FROM gb_openplay_game g
		 WHERE NOT EXISTS (SELECT 1 FROM gb_rating_log l WHERE l.source = 'openplay' AND l."matchId" = g.id)
		 ORDER BY g."playedAt" ASC LIMIT $1`, [limit]) as { id: string; playedAt: Date; format: string; refs: string[]; scoreA: number; scoreB: number }[];
	const refs = [...new Set(rows.flatMap((r) => r.refs.filter(Boolean).map((x) => x.toUpperCase())))];
	const map = new Map<string, string>();
	if (refs.length) for (const x of await db.query('SELECT "userId", upper("duprId") AS d FROM meet_player_level WHERE upper("duprId") = ANY($1)', [refs]) as { userId: string; d: string }[]) map.set(x.d, x.userId);
	return rows.map((r) => {
		const u = r.refs.map((x) => (x ? map.get(x.toUpperCase()) ?? '' : ''));
		const doubles = r.format !== 'singles';
		return { source: 'openplay' as const, id: r.id, playedAt: new Date(r.playedAt), sport: 'pickleball',
			sides: [{ userIds: doubles ? [u[0], u[1]] : [u[0]] }, { userIds: doubles ? [u[2], u[3]] : [u[1]] }] as [Side, Side],
			games: [[Number(r.scoreA), Number(r.scoreB)]] as [number, number][] };
	});
}

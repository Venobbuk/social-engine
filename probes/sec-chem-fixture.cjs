// sec-chem-fixture.cjs — SEC-CHEM-V2 (2026-09-24, lane sec-chemistry): the REAL partner-chemistry fixture.
//
// WHY THIS REPLACED THE PLANTED ROWS. sec-perm-fixes.setup.cjs used to INSERT gb_rating_log rows with source='probe'
// and a made-up matchId. On 2026-09-23 ACCOUNT-BUGS-V1 (48e39a904e) put GbRating.liveLog() in front of every
// chemistry read — a row counts only when its match exists and its meet / competition is live — and 'probe' is none of
// 'meet' | 'competition' | 'openplay'. From then on the engine could not see the fixture at all: every caller read the
// same gb-fair number (72% = the bare rating split, chemistry 0) and gb-pairs read 0 matches, while the setup's own
// read-back (a plain SELECT without the engine's guard) kept declaring the fixture real. A check that could not fail
// (G16.1), and a read-back that did not use the rule it was checking (G16.5).
//
// So the fixture is now made the way a user makes it: casual doubles games logged through meets/matches/log-casual,
// every other player confirming through meets/respond (SEC-CASUAL-CONSENT-V1), the host making the game public
// through meets/update, and the ENGINE's own minute rating pass (MeetSweepProcessorService → processRatings) writing
// gb_rating_log. It is read back through the same visibility + liveness rule the doors apply (logVisible), and it is
// taken down through meets/cancel, whose retireRatings() gives every persona their rating back.
//
//   g1, g2  A+B  5-11  C+E   public   → pair A+B NEGATIVE (lost twice)            [the private fact]
//   g3, g4  C+D  11-5  A+E   public   → pair C+D POSITIVE (won twice)             [what may stay public]
//   g5      A+C  11-6  B+D   PRIVATE  → pair A+C played once, in a private game  [G15.5: never counted for outsiders]
//   and an ENDORSEMENT E → A filed on g1 (public), for the kudos roll-up of a public meet.
'use strict';
const { execFileSync } = require('child_process');

function sqlOn(db) {
	return (text) => execFileSync('docker', ['exec', '-i', 'social-engine-db-1', 'psql', '-U', 'social', '-d', db, '-tAq', '-v', 'ON_ERROR_STOP=1', '-f', '-'], { input: text, encoding: 'utf8' }).trim();
}
const one = (sql, text) => { const s = sql(text); return s ? JSON.parse(s.split('\n')[0]) : null; };

/** An INDEPENDENT re-statement of MatchHistory.logVisible (engine) in the probe: a gb_rating_log row `l` counts for viewer
 *  V ('' = anonymous) when it is open play, or its meet / competition match still exists, is not cancelled, and V may
 *  see where it was played (public, host, on the roster / an entrant). Written out here on purpose — a probe that
 *  imported the engine's own predicate would agree with any bug in it. */
const visSql = (v) => `(l.source = 'openplay'
	OR (l.source = 'meet' AND EXISTS (SELECT 1 FROM meet_match vmm JOIN meet vm ON vm.id = vmm."meetId" WHERE vmm.id = l."matchId" AND vm.status <> 'cancelled'
	    AND (vm.visibility = 'public' OR vm."hostId" = '${v}' OR EXISTS (SELECT 1 FROM meet_participant vp WHERE vp."meetId" = vm.id AND vp."userId" = '${v}'))))
	OR (l.source = 'competition' AND EXISTS (SELECT 1 FROM competition_match vcm JOIN competition vc ON vc.id = vcm."competitionId" WHERE vcm.id = l."matchId" AND vc.status <> 'cancelled'
	    AND (vc.visibility = 'public' OR vc."hostId" = '${v}' OR EXISTS (SELECT 1 FROM competition_entry ve WHERE ve."competitionId" = vc.id AND '${v}' = ANY(ve."userIds"))))))`;

/** The chemistry of pair a+b as a given viewer's doors must compute it: rows of a with partner b, NOT skipped, visible. */
function guardedPair(sql, a, b, viewer) {
	const v = viewer || '';
	return one(sql, `SELECT row_to_json(t) FROM (SELECT count(*)::int n, coalesce(sum(CASE WHEN l.won THEN 1 ELSE 0 END),0)::int w, coalesce(sum(l.expected),0)::float e
		FROM gb_rating_log l WHERE l."userId" = '${a}' AND l."partnerId" = '${b}' AND l.sport = 'pickleball' AND NOT l.skipped AND ${visSql(v)}) t;`);
}

/** G15.3 addendum (c): a player's rating as viewer V may know it — the newest post of the rows V may see (by playedAt,
 *  then createdAt) and how many — or null (then the doors fall back to the level seed). */
function visibleRating(sql, userId, viewer) {
	const v = viewer || '';
	return one(sql, `SELECT row_to_json(t) FROM (SELECT count(*)::int n, (array_agg(l.post::float ORDER BY l."playedAt" DESC, l."createdAt" DESC))[1] AS rating
		FROM gb_rating_log l WHERE l."userId" = '${userId}' AND l.sport = 'pickleball' AND NOT l.skipped AND ${visSql(v)} HAVING count(*) > 0) t;`);
}
/** The seed GbRating falls back to: the level row (DUPR doubles, else self level), else 3.0, clamped 1.5..8. */
function seedRating(sql, userId) {
	const l = one(sql, `SELECT row_to_json(t) FROM (SELECT "duprDoubles"::float d, "selfLevel"::float s FROM meet_player_level WHERE "userId"='${userId}' AND sport='pickleball') t;`);
	const x = l && l.d != null ? l.d : l && l.s != null ? l.s : 3.0;
	return Math.max(1.5, Math.min(8, x));
}
/** G15.3 addendum (b): the one chemistry rule, re-stated — the pair sees its true value; anyone else only CLEAR positive. */
const CLEAR_N = 3, CLEAR_EDGE = 0.05;
const chemRule = (edge, n, viewer, a, b) => (viewer && (viewer === a || viewer === b)) ? edge : (n >= CLEAR_N && edge >= CLEAR_EDGE ? edge : 0);
const edgeOfRec = (r) => (r && r.n > 0 ? (r.w - r.e) / r.n : 0);

/**
 * build({ A, B, C, D, E }, { TAG, se, db, log }) — personas are { id, token, slug }.
 * Returns the fixture description, or throws with the precondition that failed (the caller refuses to measure).
 */
async function build(P, o) {
	const { A, B, C, D, E } = P;
	const sql = sqlOn(o.db || 'se_sbx');
	const log = o.log || console.log;
	const se = o.se;
	const made = o.made || [];   // { meetId, host } — for teardown; the CALLER's array, so it survives a throw here
	const ratingsBefore = sql(`SELECT coalesce(json_agg(t), '[]') FROM (SELECT "userId", rating::float, matches FROM gb_player_rating WHERE "userId" IN ('${A.id}','${B.id}','${C.id}','${D.id}','${E.id}') AND sport = 'pickleball' ORDER BY 1) t;`);
	const game = async (name, host, team1, team2, scores, hoursAgo, makePublic) => {
		const g = await se('meets/matches/log-casual', { name: o.TAG + ' ' + name, team1: team1.map((p) => ({ userId: p.id })), team2: team2.map((p) => ({ userId: p.id })), scores, playedAt: new Date(Date.now() - hoursAgo * 3600e3).toISOString() }, host.token);
		const meetId = g.json && g.json.meet ? g.json.meet.id : null;
		const matchId = g.json && g.json.match ? g.json.match.id : null;
		if (meetId) made.push({ meetId, host });
		if (g.status !== 200 || !meetId) throw new Error('log-casual ' + name + ' -> ' + g.status + ' ' + String(g.text).slice(0, 200));
		for (const p of [...team1, ...team2]) {
			if (p.id === host.id) continue;
			const r = await se('meets/respond', { meetId, answer: 'accept' }, p.token);
			if (r.status !== 200 && r.status !== 204) throw new Error('respond ' + p.slug + ' on ' + name + ' -> ' + r.status + ' ' + String(r.text).slice(0, 200));
		}
		if (makePublic) {
			const u = await se('meets/update', { meetId, visibility: 'public' }, host.token);
			if (u.status !== 200) throw new Error('meets/update visibility ' + name + ' -> ' + u.status + ' ' + String(u.text).slice(0, 200));
		}
		log('INFO game ' + name + ' meet=' + meetId + ' match=' + matchId + (makePublic ? ' public' : ' private'));
		return { meetId, matchId };
	};
	const fx = { made, ratingsBefore: JSON.parse(ratingsBefore) };
	fx.g1 = await game('chem g1', A, [A, B], [C, E], [[5, 11]], 6, true);
	fx.g2 = await game('chem g2', A, [A, B], [C, E], [[6, 11]], 5, true);
	fx.g3 = await game('chem g3', C, [C, D], [A, E], [[11, 5]], 4, true);
	fx.g4 = await game('chem g4', C, [C, D], [A, E], [[11, 6]], 3, true);
	// SEC-CHEM-V3: C+D reach 3 matches (CLEAR positive) — and LOSE this one, so their edge stays moderate: two wins as big
	// underdogs already give ~+0.85, which drove the negative-pair member's gb-fair reading onto the 3% clamp (planted2).
	fx.g6 = await game('chem g6', C, [C, D], [A, E], [[7, 11]], 2.5, true);
	fx.g5 = await game('chem g5 private', A, [A, C], [B, D], [[11, 6]], 1, false);
	const en = await se('meets/reviews/upsert', { meetId: fx.g1.meetId, targetUserId: A.id, type: 'endorsement', body: 'Great partner' }, E.token);
	if (en.status !== 200) throw new Error('endorsement E->A on g1 -> ' + en.status + ' ' + String(en.text).slice(0, 200));
	fx.pubEndorsement = one(sql, `SELECT row_to_json(t) FROM (SELECT id, "authorId", "targetUserId", type, "meetId" FROM meet_review WHERE "authorId" = '${E.id}' AND "targetUserId" = '${A.id}' AND type = 'endorsement' AND "meetId" = '${fx.g1.meetId}') t;`);
	if (!fx.pubEndorsement) throw new Error('the public endorsement E->A on g1 did not land in meet_review');

	// ── the engine's OWN rating pass: wait for gb_rating_log rows of all SIX matches (4 rows each, none skipped) ──
	const matchIds = [fx.g1, fx.g2, fx.g3, fx.g4, fx.g5, fx.g6].map((g) => g.matchId);
	const inList = matchIds.map((x) => `'${x}'`).join(',');
	let rated = 0;
	for (let i = 0; i < 30; i++) {
		rated = Number(sql(`SELECT count(*) FROM gb_rating_log WHERE source = 'meet' AND "matchId" IN (${inList}) AND NOT skipped;`));
		if (rated >= 24) break;
		await new Promise((r) => setTimeout(r, 10000));
	}
	log('INFO engine rating pass wrote ' + rated + ' / 24 gb_rating_log rows for the six fixture matches');
	if (rated < 24) throw new Error('the engine did not rate the fixture within 300 s (' + rated + '/24 rows) — refusing to measure an unrated fixture');

	// ── READ BACK through the doors' own rule (G16.5), as an OUTSIDER ('' — public, live) and as members ─────────
	fx.neg = { pair: [A.id, B.id], outsider: guardedPair(sql, A.id, B.id, ''), member: guardedPair(sql, A.id, B.id, A.id) };
	fx.pos = { pair: [C.id, D.id], outsider: guardedPair(sql, C.id, D.id, ''), member: guardedPair(sql, C.id, D.id, C.id) };
	fx.priv = { pair: [A.id, C.id], outsider: guardedPair(sql, A.id, C.id, ''), rosterViewer: guardedPair(sql, A.id, C.id, D.id) };
	fx.negAE = { pair: [A.id, E.id], member: guardedPair(sql, A.id, E.id, A.id) };
	fx.unclear = { pair: [C.id, E.id], outsider: guardedPair(sql, C.id, E.id, ''), member: guardedPair(sql, C.id, E.id, C.id) };   // SEC-CHEM-V3: positive, but 2 matches
	fx.ratingA = { outsider: visibleRating(sql, A.id, ''), self: visibleRating(sql, A.id, A.id) };   // G15.3 addendum (c)
	fx.edges = { neg: edgeOfRec(fx.neg.outsider), pos: edgeOfRec(fx.pos.outsider) };
	const fails = [];
	const must = (c, what, d) => { log((c ? 'PRECONDITION ok   ' : 'PRECONDITION FAIL ') + what + ' — ' + JSON.stringify(d)); if (!c) fails.push(what); };
	must(fx.neg.outsider && fx.neg.outsider.n === 2 && fx.edges.neg < 0, 'pair A+B has 2 PUBLIC live rated matches and a NEGATIVE edge (the private fact)', fx.neg);
	must(fx.pos.outsider && fx.pos.outsider.n === 3 && fx.edges.pos >= CLEAR_EDGE, 'pair C+D has 3 PUBLIC live rated matches and a CLEAR positive edge (>= +5 pts) — the public control', fx.pos);
	must(fx.unclear.outsider && fx.unclear.outsider.n === 2 && edgeOfRec(fx.unclear.outsider) > 0, 'pair C+E is positive but NOT clear (2 matches < 3) — must read neutral to outsiders (addendum (b))', fx.unclear);
	must(fx.ratingA.outsider && fx.ratingA.self && fx.ratingA.outsider.n < fx.ratingA.self.n && Math.abs(fx.ratingA.outsider.rating - fx.ratingA.self.rating) > 1e-6, 'player A has PRIVATE rated games: the outsider view of A (count, newest post) differs from A own view — so addendum (c) is measurable', fx.ratingA);
	must(fx.priv.outsider && fx.priv.outsider.n === 0 && fx.priv.rosterViewer && fx.priv.rosterViewer.n === 1, 'pair A+C: 0 matches an outsider may see, 1 a roster member (D) may see — g5 is private', fx.priv);
	must(fx.negAE.member && fx.negAE.member.n === 3 && edgeOfRec(fx.negAE.member) < 0, 'pair A+E is negative too (A\'s Edge has TWO negative partners, each private to its own pair)', fx.negAE);
	const vis = sql(`SELECT string_agg(id || ':' || visibility || ':' || status, ',' ORDER BY "startAt") FROM meet WHERE id IN ('${fx.g1.meetId}','${fx.g2.meetId}','${fx.g3.meetId}','${fx.g4.meetId}','${fx.g5.meetId}','${fx.g6.meetId}');`);
	must(vis.split(',').filter((x) => /:public:active$/.test(x)).length === 5 && vis.split(',').filter((x) => /:private:active$/.test(x)).length === 1, 'meets: five public + one private, all active', vis);
	if (fails.length) throw new Error('CHEM FIXTURE IS NOT REAL — ' + fails.join(' | '));
	return fx;
}

/** Take the fixture down through the engine (meets/cancel → retireRatings), then prove the rows are gone. */
async function teardown(fx, o) {
	const sql = sqlOn(o.db || 'se_sbx');
	const log = o.log || console.log;
	const out = { cancelled: 0, failed: [] };
	for (const m of (fx && fx.made) || []) {
		const r = await o.se('meets/cancel', { meetId: m.meetId }, m.host.token).catch((e) => ({ status: 0, text: String(e) }));
		if (r.status === 200 || r.status === 204) out.cancelled++; else out.failed.push(m.meetId + ':' + r.status);
	}
	const ids = ((fx && fx.made) || []).map((m) => `'${m.meetId}'`).join(',');
	out.logRowsLeft = ids ? Number(sql(`SELECT count(*) FROM gb_rating_log l JOIN meet_match mm ON mm.id = l."matchId" WHERE l.source = 'meet' AND mm."meetId" IN (${ids});`)) : 0;
	out.liveMeetsLeft = ids ? Number(sql(`SELECT count(*) FROM meet WHERE id IN (${ids}) AND status <> 'cancelled';`)) : 0;
	log('INFO chem fixture teardown — ' + JSON.stringify(out));
	return out;
}

module.exports = { build, teardown, guardedPair, visibleRating, seedRating, chemRule, visSql, edgeOfRec, sqlOn, CLEAR_N, CLEAR_EDGE };

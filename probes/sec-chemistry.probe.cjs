// sec-chemistry.probe.cjs — lane sec-chemistry (2026-09-24). G15.3 (negative partner chemistry is private to the two
// players) and G15.4 (a warning's author is anonymous to the person warned; endorsements attributed — to the person
// endorsed) on EVERY door of the two families, measured per caller class, on a REAL fixture, then the FULL permission
// sweep's verdict — and the same two rules read signed-out on PRODUCTION (read-only).
//
//   bash /root/social-engine/probes/run.sh sec-chemistry.probe.cjs            (PHASE=after by default)
//   PHASE=planted bash … — the planted-fault leg: the SAME run against the pre-fix engine must FAIL.
//
// ONE PROCESS, back to back (the reason sec-perm-fixes.run.cjs is one process): setup → fairfour → the sweep → cleanup.
// The fixture is built at the start of EVERY run (it does not survive the 04:30 UAT re-clone, and must not), and is
// torn down in `finally` through the engine (meets/cancel → retireRatings), whether the run passed, failed or threw.
//
// G16 in this file: the fixture is rated by the engine's own pass and read back through the doors' rule before a door
// is asked (sec-chem-fixture.cjs); the leak predicates are self-tested on planted leak shapes (SELFTEST in the sweep);
// the sweep's output must carry the chemistry/review assertion families or the run REFUSES (G16.6); the verdict is
// "pass" only with 0 leaks AND 0 broken across the whole sweep, the prod reads clean, and the cleanup proven.
'use strict';
require('/root/social-engine/probes/_guard.cjs');
const fs = require('fs');
const { spawnSync, execFileSync } = require('child_process');
const D = '/root/social-engine/probes/';
const PHASE = process.env.PHASE || 'after';
const OUT = '/root/gen/sec-chemistry-' + PHASE + '.json';
const VERDICT = D + (PHASE === 'after' ? 'sec-chemistry.verdict.json' : 'sec-chemistry.' + PHASE + '.verdict.json');
const PROD = process.env.PROD_BASE || 'https://social.silkvo.com';

const evidence = [];
const say = (s) => { console.log(s); evidence.push(s); };
const step = (script, env, label) => {
	console.log('\n==== ' + label + ' ====');
	const r = spawnSync('node', [D + script], { cwd: D, env: { ...process.env, PROBE_UNWRAPPED: 'i-will-sweep-myself', ...env }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
	const text = (r.stdout || '') + (r.stderr || '');
	console.log(text.split('\n').filter((l) => !/probe-guard/.test(l)).join('\n').slice(-9000));
	return { code: r.status, text };
};
const sqlOn = (db) => (t) => execFileSync('docker', ['exec', '-i', 'social-engine-db-1', 'psql', '-U', 'social', '-d', db, '-tAq', '-v', 'ON_ERROR_STOP=1', '-f', '-'], { input: t, encoding: 'utf8' }).trim();

/** PRODUCTION, signed out, read-only: the rules on real rows. Candidates are FOUND in the prod database, never typed. */
async function prodReads() {
	const sql = sqlOn('social');
	const out = { checks: [], ok: true };
	const rec = (id, pass, got) => { out.checks.push({ id, ok: !!pass, got }); if (!pass) out.ok = false; say((pass ? 'PASS ' : 'FAIL ') + 'PROD ' + id + ' — ' + JSON.stringify(got).slice(0, 300)); };
	const call = async (ep, body) => { const r = await fetch(PROD + '/api/' + ep, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) { /* */ } return { status: r.status, json: j, text: t, ctype: r.headers.get('content-type') }; };
	// a NEGATIVE pair whose matches are all public and live (so the pre-fix door would have answered it to anyone)
	const neg = sql(`SELECT row_to_json(t) FROM (SELECT l."userId" a, l."partnerId" b, count(*)::int n, sum(CASE WHEN l.won THEN 1 ELSE 0 END)::int w, sum(l.expected)::float e
		FROM gb_rating_log l JOIN meet_match mm ON mm.id = l."matchId" JOIN meet m ON m.id = mm."meetId"
		WHERE l.source = 'meet' AND NOT l.skipped AND l."partnerId" IS NOT NULL AND m.status <> 'cancelled' AND m.visibility = 'public'
		GROUP BY 1, 2 HAVING count(*) >= 2 AND sum(CASE WHEN l.won THEN 1 ELSE 0 END) < sum(l.expected) ORDER BY (sum(CASE WHEN l.won THEN 1 ELSE 0 END) - sum(l.expected)) / count(*) ASC LIMIT 1) t;`);
	if (!neg) rec('fixture.negative-pair-exists', false, 'no negative public pair on prod — nothing to measure (no_verdict for this leg)');
	else {
		const p = JSON.parse(neg);
		const r = await call('stats/gb-pairs', { pairs: [[p.a, p.b]] });
		const row = Array.isArray(r.json) ? r.json[0] : null;
		const keys = row ? Object.keys(row).sort().join(',') : '';
		const edge = row && typeof row.wins === 'number' && typeof row.expected === 'number' && row.matches ? (row.wins - row.expected) / row.matches : null;
		rec('gb-pairs.signed-out.negative-pair-reads-neutral', r.status === 200 && /json/.test(r.ctype || '') && keys === 'a,b,expected,matches,wins' && edge !== null && edge >= -1e-9, { status: r.status, row, db: { n: p.n, w: p.w, e: Math.round(p.e * 1000) / 1000 } });
		const e = await call('stats/gb-edge', { userId: p.a });
		const partners = e.json && Array.isArray(e.json.partners) ? e.json.partners : null;
		rec('gb-edge.signed-out.no-negative-partner', e.status === 200 && partners !== null && partners.every((x) => x.edge >= 0) && !partners.some((x) => x.partnerId === p.b), { status: e.status, partners: (partners || []).map((x) => ({ id: x.partnerId, edge: x.edge })) });
	}
	// an ENDORSEMENT on a public meet: its author must not reach a signed-out caller through show, list or meet-summary
	const en = sql(`SELECT row_to_json(t) FROM (SELECT r."targetUserId" target, r."authorId" author, r."meetId" meet FROM meet_review r JOIN meet m ON m.id = r."meetId"
		WHERE r.type = 'endorsement' AND r."archivedAt" IS NULL AND m.visibility = 'public' ORDER BY r."createdAt" DESC LIMIT 1) t;`);
	if (!en) rec('fixture.public-endorsement-exists', false, 'no endorsement on a public meet on prod');
	else {
		const x = JSON.parse(en);
		const s = await call('meets/reviews/show', { userId: x.target });
		rec('reviews/show.signed-out.endorser-hidden', s.status === 200 && Array.isArray(s.json && s.json.endorsements) && s.json.endorsements.length > 0 && !s.text.includes(x.author), { status: s.status, endorsements: ((s.json && s.json.endorsements) || []).length, authorIdInBody: s.text.includes(x.author) });
		const l = await call('meets/reviews/list', { userId: x.target });
		rec('reviews/list.signed-out.endorser-hidden', l.status === 200 && !l.text.includes(x.author), { status: l.status, authorIdInBody: l.text.includes(x.author) });
		const m = await call('meets/reviews/meet-summary', { meetId: x.meet });
		rec('reviews/meet-summary.signed-out.givers-hidden', m.status === 200 && Array.isArray(m.json && m.json.dims) && !m.text.includes(x.author), { status: m.status, dims: ((m.json && m.json.dims) || []).length, authorIdInBody: m.text.includes(x.author) });
	}
	// ── G15.3 addendum on PRODUCTION rows (read-only, signed out) ─────────────────────────────────────────────────
	const X = require('/root/social-engine/probes/sec-chem-fixture.cjs');
	// (b) a positive pair that is NOT clear (fewer than 3 matches signed-out may see) must read neutral
	const up = sql(`SELECT row_to_json(t) FROM (SELECT l."userId" a, l."partnerId" b, count(*)::int n, sum(CASE WHEN l.won THEN 1 ELSE 0 END)::int w, sum(l.expected)::float e
		FROM gb_rating_log l WHERE NOT l.skipped AND l."partnerId" IS NOT NULL AND ${X.visSql('')}
		GROUP BY 1, 2 HAVING count(*) BETWEEN 1 AND 2 AND sum(CASE WHEN l.won THEN 1 ELSE 0 END) > sum(l.expected) LIMIT 1) t;`);
	if (!up) rec('fixture.unclear-positive-pair-exists', false, 'no unclear positive pair on prod');
	else {
		const p = JSON.parse(up);
		const r = await call('stats/gb-pairs', { pairs: [[p.a, p.b]] });
		const row = Array.isArray(r.json) ? r.json[0] : null;
		rec('(b) gb-pairs.signed-out.unclear-positive-reads-neutral', r.status === 200 && !!row && row.wins === row.expected && Object.keys(row).sort().join(',') === 'a,b,expected,matches,wins', { status: r.status, row, db: { n: p.n, w: p.w, e: Math.round(p.e * 1000) / 1000 } });
	}
	// (a) a public rated match: no before/after, no deltas, no rating series for a signed-out caller
	const pm = sql(`SELECT row_to_json(t) FROM (SELECT l."matchId" m, l."userId" u FROM gb_rating_log l JOIN meet_match mm ON mm.id = l."matchId" JOIN meet m ON m.id = mm."meetId"
		WHERE l.source = 'meet' AND NOT l.skipped AND m.visibility = 'public' AND m.status <> 'cancelled' ORDER BY l."playedAt" DESC LIMIT 1) t;`);
	if (!pm) rec('fixture.public-rated-match-exists', false, 'no public rated match on prod');
	else {
		const x = JSON.parse(pm);
		const ms = await call('stats/match-summary', { source: 'meet', matchId: x.m });
		const pl = ((ms.json && ms.json.teams) || []).flatMap((t) => t.players || []);
		rec('(a) match-summary.signed-out.no-per-match-ratings', ms.status === 200 && pl.length > 0 && pl.every((q) => q.ratingPre == null && q.ratingPost == null), { status: ms.status, players: pl.length, withRatings: pl.filter((q) => q.ratingPre != null || q.ratingPost != null).length });
		const mt = await call('stats/matches', { userId: x.u, limit: 20 });
		const mrows = Array.isArray(mt.json) ? mt.json : null;
		rec('(a) matches.signed-out.no-rating-deltas', mt.status === 200 && !!mrows && mrows.length > 0 && mrows.every((q) => q.ratingDelta == null), { status: mt.status, rows: mrows ? mrows.length : null, withDelta: mrows ? mrows.filter((q) => q.ratingDelta != null).length : null });
		const ed = await call('stats/gb-edge', { userId: x.u });
		rec('(a) gb-edge.signed-out.no-rating-series', ed.status === 200 && Array.isArray(ed.json && ed.json.history) && ed.json.history.length === 0 && ed.json.trend30 == null, { status: ed.status, history: ed.json && Array.isArray(ed.json.history) ? ed.json.history.length : null, trend30: ed.json && ed.json.trend30 });
	}
	// (c) a player with PRIVATE rated games: the signed-out chip counts only what signed-out may see
	const pv = sql(`SELECT row_to_json(t) FROM (SELECT l."userId" u FROM gb_rating_log l JOIN meet_match mm ON mm.id = l."matchId" JOIN meet m ON m.id = mm."meetId"
		WHERE NOT l.skipped AND l.source = 'meet' AND m.status <> 'cancelled' AND m.visibility <> 'public' LIMIT 1) t;`);
	if (!pv) rec('fixture.player-with-private-games', true, 'no prod player has a live private rated game — (c) not measurable on prod (recorded, not a failure)');
	else {
		const u = JSON.parse(pv).u;
		const want = X.visibleRating(sql, u, '');
		const r = await call('stats/gb-ratings', { userIds: [u] });
		const row = Array.isArray(r.json) ? r.json.find((q) => q.userId === u) || null : null;
		rec('(c) gb-ratings.signed-out.public-games-only', r.status === 200 && (want ? !!row && row.matches === want.n && Math.abs(row.rating - want.rating) < 1e-6 : row === null), { status: r.status, row, want });
	}
	return out;
}

(async () => {
	say('INFO phase=' + PHASE + ' target=http://127.0.0.1:3961 (web-uat) + ' + PROD + ' signed-out');
	const img = (c) => { try { return execFileSync('docker', ['inspect', '-f', '{{.Image}} {{index .Config.Labels "org.opencontainers.image.revision"}}', c], { encoding: 'utf8' }).trim(); } catch (e) { return 'unknown'; } };
	say('INFO engines — web ' + img('social-engine-web-1') + ' · web-uat ' + img('social-engine-web-uat-1'));
	let sweep = null, cleanupOk = false, lastFail = null;
	const ATTEMPTS = Number(process.env.ATTEMPTS || 2);
	for (let i = 1; i <= ATTEMPTS && !sweep; i++) {
		console.log('\n######## ATTEMPT ' + i + ' of ' + ATTEMPTS + ' ########');
		try {
			const s = step('sec-perm-fixes.setup.cjs', {}, 'FIXTURE (real, rated by the engine)');
			if (s.code !== 0) { lastFail = 'setup exit ' + s.code; continue; }
			const f = step('sec-perm-fixes.fairfour.cjs', {}, 'gb-fair: the four and the predicted readings');
			if (f.code !== 0) { lastFail = 'fairfour exit ' + f.code; continue; }
			const a = step('sec-perm-fixes.probe.cjs', { PHASE, TARGET: 'http://127.0.0.1:3961', OUT }, 'THE FULL PERMISSION SWEEP — ' + PHASE);
			if (a.code !== 0) { lastFail = 'sweep exit ' + a.code; continue; }
			sweep = JSON.parse(fs.readFileSync(OUT, 'utf8'));
			const F = JSON.parse(fs.readFileSync('/root/gen/secperm2-fixtures.json', 'utf8'));
			say('INFO fixture ' + F.tag + ' — negative pair edge ' + (F.chem && F.chem.edges.neg.toFixed(3)) + ', positive pair edge ' + (F.chem && F.chem.edges.pos.toFixed(3)) + ' (read back through the doors\' rule); gb-fair predictions ' + JSON.stringify(F.fairPredict && { member: F.fairPredict.negPairMemberPct, outsider: F.fairPredict.outsiderPct, bare: F.fairPredict.bareRatingPct }));
		} finally {
			const c = step('sec-perm-fixes.cleanup.cjs', {}, 'CLEANUP (finally) — through meets/cancel, then SQL for the rest');
			const left = /chemistry fixture rating rows left: (\d+)/.exec(c.text);
			const liveLeft = Number(sqlOn('se_sbx')(`SELECT count(*) FROM meet WHERE name LIKE '[probe] SPX-%' AND status <> 'cancelled';`));
			cleanupOk = c.code === 0 && liveLeft === 0 && (!left || left[1] === '0');
			say((cleanupOk ? 'PASS ' : 'FAIL ') + 'cleanup — exit ' + c.code + ', live [probe] SPX meets ' + liveLeft + ', chemistry rating rows left ' + (left ? left[1] : 'n/a'));
		}
	}
	const prod = await prodReads().catch((e) => ({ ok: false, checks: [{ id: 'prod.threw', ok: false, got: String(e) }] }));

	let verdict = 'no_verdict';
	if (!sweep) say('NO VERDICT — the sweep never measured (' + lastFail + ')');
	else {
		const arr = Array.isArray(sweep.results) ? sweep.results : null;
		// G16.6: an empty or wrong-shaped result must FAIL loudly, never count to zero
		const fam = (p) => (arr || []).filter((o) => o.id.startsWith(p)).length;
		const need = { 'SELFTEST.': 1, 'H3.gbpairs.': 12, 'H3E.gbedge.': 6, 'H4.endorsement.': 8, 'H4.meetsummary.': 8, 'H5.gbfair.': 7, 'HB.': 9, 'HA.': 18, 'HC.': 16 };
		const short = Object.entries(need).filter(([p, n]) => fam(p) < n).map(([p, n]) => p + fam(p) + '/' + n);
		if (!arr || arr.length === 0 || short.length) { say('FAIL the sweep output lacks assertion families: ' + (arr ? short.join(' ') : 'no results array')); verdict = 'fail'; }
		else {
			const leaks = arr.filter((o) => o.kind === 'leak' && !o.ok), broken = arr.filter((o) => (o.kind === 'feature' || o.kind === 'control') && !o.ok);
			say('INFO sweep: ' + arr.length + ' assertions, leaks ' + leaks.length + ', broken ' + broken.length);
			for (const l of leaks) say('LEAK ' + l.id + ' ' + JSON.stringify(l.got).slice(0, 260));
			for (const l of broken) say('BROKEN ' + l.id + ' ' + JSON.stringify(l.got).slice(0, 260));
			const chemFam = arr.filter((o) => /^(SELFTEST|H3|H3E|H4|H5|HA|HB|HC)\./.test(o.id));
			say('INFO chemistry + review families: ' + chemFam.length + ' assertions, ' + chemFam.filter((o) => !o.ok).length + ' failing');
			verdict = leaks.length === 0 && broken.length === 0 && prod.ok && cleanupOk ? 'pass' : 'fail';
		}
	}
	if (!prod.ok) say('FAIL production signed-out reads (see PROD lines)');
	const v = { id: 'sec-chemistry' + (PHASE === 'after' ? '' : '.' + PHASE), at: new Date().toISOString(), phase: PHASE, condition_fired: true, verdict, sweep_output: OUT, prod: prod.checks, evidence };
	fs.writeFileSync(VERDICT, JSON.stringify(v, null, 1));
	console.log('\n' + verdict + ' -> ' + VERDICT);
	process.exit(verdict === 'pass' ? 0 : 1);
})().catch((e) => { console.error('PROBE ERROR ' + (e && e.stack ? e.stack : e)); process.exit(1); });

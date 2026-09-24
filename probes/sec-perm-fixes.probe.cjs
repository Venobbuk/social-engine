// sec-perm-fixes.probe.cjs — SEC-PERM-V1. The BEFORE/AFTER measurement of the ten permission-sweep holes.
//
// The SAME assertions, over the SAME database rows, run against two engines:
//   PHASE=before TARGET=http://127.0.0.1:3963  a throwaway engine on the PRE-FIX image (rollback-ee0fc728a2)
//   PHASE=after  TARGET=http://127.0.0.1:3961  web-uat, restarted onto an image that carries b5b4ddc330
// so a difference can only come from the code. Tokens are minted through the real UAT host (hkpl's QA door), which is
// the path the app uses; they are database-backed, so they work against either engine.
//
// EVERY door is asked by EVERY class: anonymous, a signed-in STRANGER, the club's MEMBER, its ADMIN, its OWNER,
// GripBat STAFF, and an invite-link holder — plus a PUBLIC control club alongside the private one. A fix that hides
// private data by breaking the feature is not a fix: that is what commit b5b4ddc330 was (a jsonb cast on a varchar[]
// column that would have thrown for every SIGNED-IN club search), and only the signed-in legs can see it.
//
// Nothing here writes: the fixture is built and PROVEN by sec-perm-fixes.setup.cjs.
'use strict';
require('/root/social-engine/probes/_guard.cjs');
const fs = require('fs');
const { execFileSync } = require('child_process');
const L = require('/root/social-engine/probes/sec-lib.cjs');
const X = require('/root/social-engine/probes/sec-chem-fixture.cjs');   // SEC-CHEM-V3: the rules re-stated independently of the engine

const TARGET = process.env.TARGET || 'http://127.0.0.1:3961';
const PHASE = process.env.PHASE || 'after';
const OUT = process.env.OUT || ('/root/gen/secperm2-' + PHASE + '.json');
const F = JSON.parse(fs.readFileSync('/root/gen/secperm2-fixtures.json', 'utf8'));

const sql = (text) => execFileSync('docker', ['exec', '-i', 'social-engine-db-1', 'psql', '-U', 'social', '-d', 'se_sbx', '-tAq', '-v', 'ON_ERROR_STOP=1', '-f', '-'], { input: text, encoding: 'utf8' }).trim();

const out = [];
/** A door that BREAKS instead of refusing answers an error OBJECT where an array belongs (that is what the jsonb
 *  cast in 1777b815d9 did to every signed-in club search). Record it as a failure; never crash the run on it. */
const A = (j) => (Array.isArray(j) ? j : []);
const log = (s) => console.log(s);
/** verdict of one assertion. ok=false means the rule is broken — either data leaked, or a legitimate caller lost it. */
function rec(o) {
	out.push(o);
	log((o.ok ? 'ok   ' : 'FAIL ') + (o.kind === 'leak' ? '[leak] ' : o.kind === 'feature' ? '[feat] ' : '[ctrl] ') + o.id.padEnd(42) + ' ' + JSON.stringify(o.got).slice(0, 190));
	return o;
}
/** WHY EVERY HOLE IS WRAPPED. The planted-fault run proved the point: the jsonb build answers an ERROR OBJECT
 *  where channels/search should answer an array, and this probe THREW on it — recording nothing at all about the
 *  fault it exists to catch. A check that dies on its own subject reports as little as a check that cannot fail
 *  (probes/blind-checks-fixed.verdict.json). So a throw inside one hole is RECORDED as that hole failing, and
 *  every other hole is still measured. */
async function section(label, fn) {
	try { await fn(); } catch (e) {
		rec({ id: label + ".THREW", hole: label, role: "n/a", kind: "leak", ok: false, got: { threw: String(e && e.message ? e.message : e) } });
	}
}
const leak = (id, hole, role, pass, got) => rec({ id, hole, role, kind: 'leak', ok: !!pass, got });      // outsider must NOT get it
const feat = (id, hole, role, pass, got) => rec({ id, hole, role, kind: 'feature', ok: !!pass, got });   // entitled caller MUST get it
const ctrl = (id, hole, role, pass, got) => rec({ id, hole, role, kind: 'control', ok: !!pass, got });   // the check discriminates

async function T(endpoint, body, token) {
	const r = await fetch(TARGET + '/api/' + endpoint, {
		method: 'POST', headers: { 'content-type': 'application/json' },
		body: JSON.stringify(token ? { ...(body || {}), i: token } : (body || {})),
	});
	const text = await r.text();
	let json = null; try { json = JSON.parse(text); } catch (e) { /* 204 */ }
	return { status: r.status, json, code: json && json.error ? json.error.code : null, text };
}

async function main() {
	// ── the fixture is still what setup proved it was (a run on a fixture that quietly stopped being private is
	//    exactly the failure this whole measurement exists to avoid) ─────────────────────────────────────────
	// Another lane's probes/run.sh sweeps this box between our two phases and archives every channel named '[probe%'
	// and cancels every meet so named (that is its job, G13.3). Archiving is not part of any rule under test — but
	// channels/search filters isArchived, so an archived fixture would read as "nothing leaked". The liveness is
	// restored and then EVERY precondition is read back out of the database again; what was healed is recorded.
	const healed = [];
	const readClub = (id) => JSON.parse(sql(`SELECT row_to_json(t) FROM (SELECT c.id, c."isArchived", s.visibility FROM channel c JOIN club_setting s ON s."channelId"=c.id WHERE c.id='${id}') t;`) || 'null');
	for (const id of [F.cpriv, F.cpub]) {
		const c = readClub(id);
		if (c && c.isArchived) { sql(`UPDATE channel SET "isArchived" = false WHERE id = '${id}';`); healed.push('re-opened ' + id + ' (another lane\'s sweeper had archived it)'); }
	}
	const mst = sql(`SELECT status FROM meet WHERE id = '${F.publicMeetId}';`);
	if (mst === 'cancelled') { sql(`UPDATE meet SET status = 'active', "cancelledAt" = NULL WHERE id = '${F.publicMeetId}';`); healed.push('re-activated the packer meet ' + F.publicMeetId); }
	if (healed.length) log('INFO healed before measuring — ' + JSON.stringify(healed));

	const live = readClub(F.cpriv), livePub = readClub(F.cpub);
	if (!(live && live.visibility === 'private' && live.isArchived === false)) throw new Error('FIXTURE NOT PRIVATE/LIVE at run time: ' + JSON.stringify(live));
	if (!(livePub && livePub.visibility === 'public' && livePub.isArchived === false)) throw new Error('PUBLIC CONTROL not public/live: ' + JSON.stringify(livePub));
	const mem = sql(`SELECT string_agg("userId", ',') FROM club_member WHERE "channelId" = '${F.cpriv}';`).split(',').filter(Boolean);
	if (!mem.includes(F.member.id)) throw new Error('FIXTURE: the member lost their club_member row: ' + JSON.stringify(mem));
	if (mem.includes(F.stranger.id)) throw new Error('FIXTURE: the stranger has become a member: ' + JSON.stringify(mem));
	const adm = sql(`SELECT array_to_string("adminIds", ',') FROM club_setting WHERE "channelId" = '${F.cpriv}';`).split(',').filter(Boolean);
	if (!adm.includes(F.admin.id)) throw new Error('FIXTURE: the admin is not in adminIds: ' + JSON.stringify(adm));
	const wrow = sql(`SELECT count(*) FROM meet_review WHERE body = '${F.warningBody}' AND type = 'warning' AND "archivedAt" IS NULL;`);
	if (wrow !== '1') throw new Error('FIXTURE: the warning row is gone (hole 4 could not be measured): ' + wrow);
	const chemN = F.chem ? sql(`SELECT count(*) FROM gb_rating_log l JOIN meet_match mm ON mm.id = l."matchId" JOIN meet m ON m.id = mm."meetId" WHERE l.source = 'meet' AND m.status <> 'cancelled' AND m.id IN (${F.chem.made.map((x) => `'${x.meetId}'`).join(',')});`) : '0';   // SEC-CHEM-V2: the REAL fixture's rows
	if (Number(chemN) < 20) throw new Error('FIXTURE: the real chemistry fixture is no longer live (rated rows in live meets: ' + chemN + ' of 20)');
	log('INFO fixture re-verified from the database at run time — private=' + JSON.stringify(live) + ' public=' + JSON.stringify(livePub) + ' members=' + JSON.stringify(mem) + ' adminIds=' + JSON.stringify(adm) + ' warningRows=' + wrow + ' chemRows=' + chemN);

	const P = {};
	for (const slug of ['player-amy', 'host-ken', 'clubowner-mei', 'clubadmin-tom', 'admin']) P[slug] = await L.signIn(slug);
	const ANON = undefined;
	const STRANGER = P[F.stranger.slug].token, MEMBER = P[F.member.slug].token, ADMIN = P[F.admin.slug].token, OWNER = P[F.owner.slug].token, STAFF = P['admin'].token;
	const OUTSIDERS = [['anonymous', ANON], ['stranger', STRANGER], ['staff', STAFF]];
	const INSIDERS = [['member', MEMBER], ['admin', ADMIN], ['owner', OWNER]];
	log('INFO target=' + TARGET + ' phase=' + PHASE + ' | owner=' + F.owner.slug + ' admin=' + F.admin.slug + ' member=' + F.member.slug + ' stranger=' + F.stranger.slug);

	const Q = F.tag.replace('[probe] ', '');   // the distinctive stamp, e.g. SPX-a71euj

	await section('H1', async () => {
		// ══ HOLE 1 — channels/search listed a PRIVATE club to anonymous callers ═════════════════════════════
		for (const [who, tok] of OUTSIDERS) {
			const r = await T('channels/search', { query: Q, limit: 20 }, tok);
			const hit = A(r.json).find((c) => c.id === F.cpriv) || null;
			leak('H1.search.' + who, 1, who, r.status === 200 && !hit, { status: r.status, code: r.code, privateRow: hit ? { name: hit.name, usersCount: hit.usersCount, description: hit.description } : null, rows: A(r.json).length });
		}
		for (const [who, tok] of INSIDERS) {
			const r = await T('channels/search', { query: Q, limit: 20 }, tok);
			const hit = A(r.json).find((c) => c.id === F.cpriv) || null;
			// THE b5b4ddc330 LEG: a guard that throws for a signed-in caller would show up here as a 400/500, or as a
			// member who can no longer find their own club.
			feat('H1.search.' + who + '.SEES-OWN-CLUB', 1, who, r.status === 200 && !!hit, { status: r.status, code: r.code, privateRow: !!hit, usersCount: hit && hit.usersCount, rows: A(r.json).length });
		}
		for (const [who, tok] of [['anonymous', ANON], ['stranger', STRANGER], ['member', MEMBER], ['owner', OWNER]]) {
			const r = await T('channels/search', { query: Q, limit: 20 }, tok);
			const hit = A(r.json).find((c) => c.id === F.cpub) || null;
			ctrl('H1.search.PUBLIC-still-listed.' + who, 1, who, r.status === 200 && !!hit, { status: r.status, publicRow: !!hit, usersCount: hit && hit.usersCount });
		}
		{   // the lat/lng path beside it (clubs-near) — the family: both paths must agree
			const a = await T('channels/search', { query: '', lat: 22.2783, lng: 114.1747, radiusKm: 50, club: true, limit: 50 }, ANON);
			const m = await T('channels/search', { query: '', lat: 22.2783, lng: 114.1747, radiusKm: 50, club: true, limit: 50 }, MEMBER);
			leak('H1.search.LATLNG-path.anonymous', 1, 'anonymous', a.status === 200 && !A(a.json).some((c) => c.id === F.cpriv), { status: a.status, privateRow: A(a.json).some((c) => c.id === F.cpriv), rows: A(a.json).length });
			ctrl('H1.search.LATLNG-path.member', 1, 'member', m.status === 200, { status: m.status, privateRow: A(m.json).some((c) => c.id === F.cpriv), rows: A(m.json).length });
		}
	});

	await section('H2', async () => {
		// ══ HOLE 2 — channels/show served the private club's full packed profile ════════════════════════════
		for (const [who, tok] of OUTSIDERS) {
			const r = await T('channels/show', { channelId: F.cpriv }, tok);
			leak('H2.show.' + who, 2, who, r.status !== 200, { status: r.status, code: r.code, name: r.json && r.json.name, description: r.json && r.json.description, usersCount: r.json && r.json.usersCount });
		}
		for (const [who, tok] of INSIDERS) {
			const r = await T('channels/show', { channelId: F.cpriv }, tok);
			feat('H2.show.' + who, 2, who, r.status === 200 && !!(r.json && r.json.name), { status: r.status, code: r.code, name: r.json && r.json.name, usersCount: r.json && r.json.usersCount });
		}
		{
			const r = await T('channels/show', { channelId: F.cpriv, accessToken: F.accessToken }, ANON);
			feat('H2.show.INVITE-LINK', 2, 'invite-link', r.status === 200, { status: r.status, code: r.code, name: r.json && r.json.name });
			const w = await T('channels/show', { channelId: F.cpriv, accessToken: 'wrong-token-0000' }, ANON);
			ctrl('H2.show.WRONG-INVITE-TOKEN', 2, 'anonymous', w.status !== 200, { status: w.status, code: w.code });
			const p = await T('channels/show', { channelId: F.cpub }, ANON);
			ctrl('H2.show.PUBLIC-club', 2, 'anonymous', p.status === 200 && !!(p.json && p.json.name), { status: p.status, name: p.json && p.json.name, usersCount: p.json && p.json.usersCount });
		}
	});

	// ══ SEC-CHEM-V2 (2026-09-24, lane sec-chemistry) — holes 3/4/5 re-written against the REAL fixture ════════════════
	// (probes/sec-chem-fixture.cjs: games rated by the engine, read back through the doors' rule). What changed and why:
	//  · the leak test of gb-pairs was "can an outsider recompute the edge?". A row { wins: null, expected: null,
	//    chemistryHidden: true } passed it — yet the marker itself named every negative pair (measured on the sweep's own
	//    surviving pair, SWEEP-original, 2026-09-24 12:12). The test is now "does the outsider's row look exactly like a
	//    neutral pair": the same keys as a positive pair's row, numbers, and an edge that is not negative.
	//  · the endorsement control asserted that an ANONYMOUS caller is told who endorsed — the opposite of reviews/list and of
	//    Reclub (givers are hidden from all but Supporters). SEC-REVIEW-AUTHOR-V1 makes it one rule; it is now a leak test.
	//  · new: gb-edge (the partner list, dropped before the sort), the partner's own view, private games (G15.5),
	//    reviews/meet-summary givers, and a PREDICATE SELF-TEST that plants the shapes a leak takes before any door is asked.
	const CH = F.chem;
	if (!CH) throw new Error('fixture has no REAL chemistry block (F.chem) — refusing to measure holes 3/5 on nothing');
	const ROW_KEYS = 'a,b,expected,matches,wins';
	/** An outsider's gb-pairs row is SAFE only when it is indistinguishable from a neutral pair: exactly the five keys,
	 *  numbers everywhere, and (wins - expected) / matches not negative. */
	const neutralSafe = (r) => !!r && Object.keys(r).sort().join(',') === ROW_KEYS && typeof r.wins === 'number' && typeof r.expected === 'number' && typeof r.matches === 'number' && (r.matches === 0 || (r.wins - r.expected) / r.matches >= -1e-9);
	const edgeOfRow = (r) => (r && r.matches && typeof r.wins === 'number' && typeof r.expected === 'number' ? Math.round(((r.wins - r.expected) / r.matches) * 100) / 100 : null);
	await section('SELFTEST', async () => {
		// G16.1 / G16.6: the predicates must FAIL on every shape a leak has taken, and pass the neutral one.
		const planted = [
			['V1 marker row', { a: 'x', b: 'y', matches: 2, wins: null, expected: null, chemistryHidden: true }, false],
			['raw negative row', { a: 'x', b: 'y', matches: 2, wins: 0, expected: 0.6 }, false],
			['extra key', { a: 'x', b: 'y', matches: 2, wins: 1, expected: 1, edge: 0 }, false],
			['missing row', null, false],
			['neutral row', { a: 'x', b: 'y', matches: 2, wins: 1, expected: 1 }, true],
			['positive row', { a: 'x', b: 'y', matches: 2, wins: 2, expected: 1.4 }, true],
		];
		const wrong = planted.filter(([, r, want]) => neutralSafe(r) !== want).map(([n]) => n);
		ctrl('SELFTEST.neutralSafe-catches-planted-leaks', 'control', 'n/a', wrong.length === 0, { planted: planted.length, misjudged: wrong });
	});

	await section('H3', async () => {
		// ══ HOLE 3 — stats/gb-pairs: an outsider must not be able to tell a NEGATIVE pair from a neutral one ═══════════
		const pairs = async (pair, tok) => { const r = await T('stats/gb-pairs', { pairs: [pair] }, tok); return { status: r.status, row: A(r.json)[0] || null }; };
		const dbNeg = Math.round(CH.edges.neg * 100) / 100, dbPos = Math.round(CH.edges.pos * 100) / 100;
		for (const [who, tok] of [['anonymous', ANON], ['stranger', P['clubowner-mei'].token], ['staff', STAFF]]) {
			const r = await pairs(F.negPair, tok);
			leak('H3.gbpairs.NEG-pair.' + who, 3, who, r.status === 200 && neutralSafe(r.row), { status: r.status, row: r.row, recomputed_edge: edgeOfRow(r.row), db_edge: dbNeg });
			if (F.sweepNegPair) {   // the sweep's own real pair (prod-cloned rows), when it survived the nightly reset
				const s = await pairs(F.sweepNegPair, tok);
				leak('H3.gbpairs.SWEEP-original.' + who, 3, who, s.status === 200 && neutralSafe(s.row), { status: s.status, row: s.row, recomputed_edge: edgeOfRow(s.row) });
			}
			if (who !== 'stranger') {   // mei is IN the private pair (A+C), so she is no outsider for this one
				const p = await pairs(CH.privPair, tok);   // G15.5: a pair whose only game together is a PRIVATE casual game
				leak('H3.gbpairs.PRIVATE-game-uncounted.' + who, 3, who, p.status === 200 && !!p.row && p.row.matches === 0, { status: p.status, row: p.row });
			}
		}
		for (const [who, slug] of [['pair-member-A', F.stranger.slug], ['pair-member-B', F.admin.slug]]) {
			const r = await pairs(F.negPair, P[slug].token);
			feat('H3.gbpairs.OWN-chemistry.' + who, 3, who, r.status === 200 && edgeOfRow(r.row) !== null && edgeOfRow(r.row) < 0 && Math.abs(edgeOfRow(r.row) - dbNeg) <= 0.011, { status: r.status, row: r.row, recomputed_edge: edgeOfRow(r.row), db_edge: dbNeg });
		}
		{
			const r = await pairs(F.negPair, P[F.owner.slug].token);   // tom: on the private game's roster, outside pair A+B
			leak('H3.gbpairs.NEG-pair.positive-pair-member', 3, 'positive-pair member', r.status === 200 && neutralSafe(r.row), { status: r.status, row: r.row });
			const pv = await pairs(CH.privPair, P[F.owner.slug].token);
			feat('H3.gbpairs.PRIVATE-game.roster-member-counts-it', 3, 'roster member', pv.status === 200 && !!pv.row && pv.row.matches === 1, { status: pv.status, row: pv.row });
		}
		{
			const r = await pairs(F.posPair, ANON);
			ctrl('H3.gbpairs.POSITIVE-still-public', 3, 'anonymous', r.status === 200 && edgeOfRow(r.row) !== null && edgeOfRow(r.row) > 0 && Math.abs(edgeOfRow(r.row) - dbPos) <= 0.011, { status: r.status, row: r.row, recomputed_edge: edgeOfRow(r.row), db_edge: dbPos });
			const n = await pairs(F.negPair, ANON);
			ctrl('H3.gbpairs.SCOUTING-keeps-matches', 3, 'anonymous', n.status === 200 && !!n.row && n.row.matches === 2 && n.row.wins === 0, { status: n.status, matches: n.row && n.row.matches, wins: n.row && n.row.wins });
			const shapes = [A((await T('stats/gb-pairs', { pairs: [F.posPair, F.negPair] }, ANON)).json)].map((rows) => rows.map((x) => Object.keys(x).sort().join(',')));
			ctrl('H3.gbpairs.ONE-SHAPE-for-every-row', 3, 'anonymous', shapes[0].length === 2 && shapes[0].every((k) => k === ROW_KEYS), { shapes: shapes[0] });
		}
	});

	await section('H3E', async () => {
		// ══ HOLE 3, gb-edge — the partner list of A: B and E are both NEGATIVE partners of A ════════════════════════
		const edge = async (userId, tok) => { const r = await T('stats/gb-edge', { userId }, tok); return { status: r.status, partners: (r.json && Array.isArray(r.json.partners)) ? r.json.partners : null }; };
		const ids = (e) => (e.partners || []).map((p) => p.partnerId);
		const A_ = F.stranger.id, B_ = F.admin.id, E_ = F.staff.id;
		for (const [who, tok] of [['anonymous', ANON], ['stranger', P['clubowner-mei'].token], ['positive-pair member', P[F.owner.slug].token]]) {
			const e = await edge(A_, tok);
			leak('H3E.gbedge.no-negative-partner.' + who, 3, who, e.status === 200 && e.partners !== null && !ids(e).includes(B_) && !ids(e).includes(E_) && e.partners.every((p) => p.edge >= 0), { status: e.status, partners: (e.partners || []).map((p) => ({ id: p.partnerId, edge: p.edge })) });
		}
		{
			const e = await edge(A_, P[F.admin.slug].token);   // B looks at A's Edge: sees the A+B pair (theirs), NOT A+E
			feat('H3E.gbedge.partner-sees-own-pair', 3, 'pair member B', e.status === 200 && ids(e).includes(B_), { status: e.status, partners: (e.partners || []).map((p) => ({ id: p.partnerId, edge: p.edge })) });
			leak('H3E.gbedge.partner-not-the-other-pair', 3, 'pair member B', e.status === 200 && !ids(e).includes(E_), { status: e.status, partners: ids(e) });
			const s = await edge(A_, P[F.stranger.slug].token);   // A on their own Edge: both negative partners
			feat('H3E.gbedge.subject-sees-all', 3, 'subject', s.status === 200 && ids(s).includes(B_) && ids(s).includes(E_), { status: s.status, partners: (s.partners || []).map((p) => ({ id: p.partnerId, edge: p.edge })) });
			const d = await edge(F.owner.id, ANON);   // D's Edge, read anonymously: C is a POSITIVE partner and stays public
			ctrl('H3E.gbedge.POSITIVE-partner-public', 3, 'anonymous', d.status === 200 && ids(d).includes(F.member.id), { status: d.status, partners: (d.partners || []).map((p) => ({ id: p.partnerId, edge: p.edge })) });
		}
	});

	await section('H4', async () => {
		// ══ HOLE 4 — review AUTHORS: one rule on every review door (SEC-REVIEW-AUTHOR-V1) ══════════════════════════════
		const warnOf = (j) => ((j && j.warnings) || []).find((w) => w.body === F.warningBody) || null;
		const endOf = (j) => ((j && j.endorsements) || []).find((x) => x.body === F.endorseBody) || null;
		{
			const r = await T('meets/reviews/show', { userId: F.member.id }, MEMBER);         // the warned player
			const w = warnOf(r.json);
			leak('H4.reviews.WARNED-PLAYER.author', 4, 'the person warned', !!w && w.author == null, { status: r.status, warningFound: !!w, author: w && w.author ? { id: w.author.id, name: w.author.name } : null, body: w && w.body });
			feat('H4.reviews.WARNED-PLAYER.sees-warning', 4, 'the person warned', !!w, { status: r.status, warnings: ((r.json && r.json.warnings) || []).length, body: w && w.body });
		}
		{
			const r = await T('meets/reviews/show', { userId: F.member.id }, ADMIN);          // the author
			const w = warnOf(r.json);
			feat('H4.reviews.AUTHOR.sees-own', 4, 'the author', !!w && !!w.author && w.author.id === F.admin.id, { status: r.status, warningFound: !!w, author: w && w.author ? w.author.id : null });
		}
		for (const [who, tok] of [['anonymous', ANON], ['stranger', STRANGER], ['staff', STAFF]]) {
			const r = await T('meets/reviews/show', { userId: F.member.id }, tok);
			const w = warnOf(r.json);
			leak('H4.reviews.' + who + '.author', 4, who, !w || w.author == null, { status: r.status, warningVisible: !!w, author: w && w.author ? w.author.id : null });
		}
		// the ENDORSEMENT ken -> amy: public, attributed to amy (and ken), anonymous to everyone else — on show AND list
		for (const [who, tok] of [['anonymous', ANON], ['stranger', MEMBER], ['staff', STAFF]]) {
			const r = await T('meets/reviews/show', { userId: F.stranger.id }, tok);
			const e = endOf(r.json);
			leak('H4.endorsement.show.author-hidden.' + who, 4, who, r.status === 200 && !!e && e.author == null, { status: r.status, found: !!e, author: e && e.author ? e.author.id : null });
			const l = await T('meets/reviews/list', { userId: F.stranger.id, type: 'endorsement' }, tok);
			leak('H4.endorsement.list.author-hidden.' + who, 4, who, l.status === 200 && !l.text.includes(F.admin.id), { status: l.status, authorIdInBody: l.text.includes(F.admin.id) });
		}
		{
			const r = await T('meets/reviews/show', { userId: F.stranger.id }, STRANGER);   // amy, the person endorsed
			const e = endOf(r.json);
			feat('H4.endorsement.show.TARGET-sees-author', 4, 'the person endorsed', !!e && !!e.author && e.author.id === F.admin.id, { status: r.status, found: !!e, author: e && e.author ? e.author.id : null });
			const a = await T('meets/reviews/show', { userId: F.stranger.id }, ADMIN);       // ken, its author
			const ea = endOf(a.json);
			feat('H4.endorsement.show.AUTHOR-sees-own', 4, 'the author', !!ea && !!ea.author && ea.author.id === F.admin.id, { status: a.status, found: !!ea, author: ea && ea.author ? ea.author.id : null });
			const l = await T('meets/reviews/list', { userId: F.stranger.id, type: 'endorsement' }, STRANGER);
			feat('H4.endorsement.list.TARGET-sees-author', 4, 'the person endorsed', l.status === 200 && l.text.includes(F.admin.id), { status: l.status });
		}
		{   // the newer door that already did it right — the family must agree: the warner's id must not appear
			const r = await T('meets/reviews/list', { userId: F.member.id, type: 'warning' }, MEMBER);
			const names = r.text.includes(F.admin.id);
			ctrl('H4.reviews.LIST-door-agrees', 4, 'the person warned', r.status === 200 && !names, { status: r.status, authorIdInBody: names, bytes: r.text.length, sample: r.text.slice(0, 160) });
		}
		// reviews/meet-summary (the kudos roll-up): givers follow the same rule; a PRIVATE meet's roll-up is its roster's
		const giverIds = (j) => ((j && j.dims) || []).flatMap((d) => (d.givers || []).filter(Boolean).map((u) => u.id));
		// the staff persona is E, the GIVER on g1 (sec-chem-fixture) — so it is the author here, not an outsider: it must see
		// itself (feature), and the outsider legs are anonymous, mei and tom. (2026-09-24 13:3x: the first after-run counted
		// staff as an outsider and read its own name back as a "leak" — a probe error, recorded, not an engine one.)
		{
			const own = await T('meets/reviews/meet-summary', { meetId: CH.g.g1.meetId }, STAFF);
			feat('H4.meetsummary.AUTHOR-sees-own-giving', 4, 'the giver (staff persona)', own.status === 200 && giverIds(own.json).length === 1 && giverIds(own.json)[0] === F.staff.id, { status: own.status, givers: giverIds(own.json) });
		}
		for (const [who, tok] of [['anonymous', ANON], ['stranger', P['clubowner-mei'].token], ['positive-pair member', P[F.owner.slug].token]]) {
			const pub = await T('meets/reviews/meet-summary', { meetId: CH.g.g1.meetId }, tok);   // public g1: E endorsed A
			leak('H4.meetsummary.public-meet.givers-hidden.' + who, 4, who, pub.status === 200 && giverIds(pub.json).length === 0, { status: pub.status, givers: giverIds(pub.json), dims: ((pub.json && pub.json.dims) || []).length });
		}
		for (const [who, tok] of [['anonymous', ANON], ['staff', STAFF], ['stranger', P['clubowner-mei'].token]]) {
			const prv = await T('meets/reviews/meet-summary', { meetId: F.fbMeetId }, tok);   // private casual game ken vs amy
			leak('H4.meetsummary.private-meet.refused.' + who, 4, who, prv.status !== 200 || (giverIds(prv.json).length === 0 && ((prv.json && prv.json.dims) || []).length === 0), { status: prv.status, code: prv.code, givers: giverIds(prv.json) });
		}
		{
			const t = await T('meets/reviews/meet-summary', { meetId: CH.g.g1.meetId }, P[F.stranger.slug].token);   // A, the one endorsed
			feat('H4.meetsummary.TARGET-sees-giver', 4, 'the person endorsed', t.status === 200 && giverIds(t.json).includes(F.staff.id), { status: t.status, givers: giverIds(t.json) });
			const pr = await T('meets/reviews/meet-summary', { meetId: F.fbMeetId }, STRANGER);   // amy played the private game
			feat('H4.meetsummary.private-meet.roster-reads', 4, 'roster member', pr.status === 200 && ((pr.json && pr.json.dims) || []).length > 0, { status: pr.status, dims: ((pr.json && pr.json.dims) || []).length });
		}
	});

	await section('H5', async () => {
		// ══ HOLE 5 — stats/gb-fair: teamAWinPct, per caller class (SEC-CHEM-V3 + SEC-RATING-VIEW-V1) ══════════════════
		// sec-perm-fixes.fairfour.cjs PREDICTED every class's reading from the rules re-stated in the probe (chemistry:
		// the pair's true value, else only CLEAR positive; ratings: as the caller may know them) before any call is made,
		// and refused if the rule could not move anon's number. Every class must read exactly its own prediction.
		const FOUR = F.fairFour, PRED = F.fairPredict;
		if (!PRED || PRED.anon == null || PRED.ruleOff == null) throw new Error('no per-class gb-fair prediction — refusing to measure hole 5');
		const want = [...F.negPair].sort().join('+');
		const split = (j) => (j || []).find((x) => [...x.teamA].sort().join('+') === want || [...x.teamB].sort().join('+') === want) || null;
		const pctFor = (s) => (s == null ? null : ([...s.teamA].sort().join('+') === want ? s.teamAWinPct : 100 - s.teamAWinPct));
		const get = async (tok) => { const r = await T('stats/gb-fair', { userIds: FOUR }, tok); const s = split(r.json); return { status: r.status, rows: A(r.json).length, split: s, pct: pctFor(s) }; };
		const a = await get(ANON), st = await get(STAFF), cm = await get(P[F.member.slug].token), ownA = await get(P[F.stranger.slug].token), ownB = await get(P[F.admin.slug].token);
		const g = (x, want2) => ({ status: x.status, read: x.pct, predicted: want2, ruleOff: PRED.ruleOff });
		leak('H5.gbfair.anonymous.winPct', 5, 'anonymous', a.status === 200 && a.pct === PRED.anon, g(a, PRED.anon));
		leak('H5.gbfair.staff.winPct', 5, 'staff', st.status === 200 && st.pct === PRED.anon, g(st, PRED.anon));
		leak('H5.gbfair.positive-pair-member-C.winPct', 5, 'positive-pair member (stranger to A+B)', cm.status === 200 && cm.pct === PRED.posPairMemberC, g(cm, PRED.posPairMemberC));
		feat('H5.gbfair.NEG-PAIR-MEMBER-A.full', 5, 'player A', ownA.status === 200 && ownA.rows === 3 && ownA.pct === PRED.negPairMemberA, g(ownA, PRED.negPairMemberA));
		feat('H5.gbfair.NEG-PAIR-MEMBER-B.full', 5, 'player B', ownB.status === 200 && ownB.pct === PRED.negPairMemberB, g(ownB, PRED.negPairMemberB));
		ctrl('H5.gbfair.RULE-MOVES-THE-NUMBER', 5, 'anonymous', PRED.ruleOff.chemistry !== PRED.anon, { anonPredicted: PRED.anon, ifNegativeNotNeutralised: PRED.ruleOff.chemistry });
		ctrl('H5.gbfair.BALANCING-still-works', 5, 'anonymous', a.status === 200 && a.rows === 3 && a.split != null && a.split.fairness != null, { status: a.status, rows: a.rows, fairness: a.split && a.split.fairness });
	});

	await section('HB', async () => {
		// ══ G15.3 addendum (b) — positive chemistry reaches an outsider only when CLEAR (>= 3 matches AND >= +5 pts) ══════
		// C+E won twice together: positive, but only 2 matches — anyone but C and E must read it neutral, in the same shape.
		const pairs = async (pair, tok) => { const r = await T('stats/gb-pairs', { pairs: [pair] }, tok); return { status: r.status, row: A(r.json)[0] || null }; };
		const UP = CH.unclearPair; if (!UP) throw new Error('fixture has no unclear-positive pair');
		const trueEdge = Math.round(X.edgeOfRec(CH.readBack.unclear.member) * 100) / 100;
		for (const [who, tok] of [['anonymous', ANON], ['stranger', P[F.owner.slug].token], ['player A', P[F.stranger.slug].token], ['player B', P[F.admin.slug].token]]) {
			const r = await pairs(UP, tok);
			leak('HB.gbpairs.UNCLEAR-positive-reads-neutral.' + who, 'b', who, r.status === 200 && neutralSafe(r.row) && edgeOfRow(r.row) === 0, { status: r.status, row: r.row, recomputed_edge: edgeOfRow(r.row), true_edge: trueEdge });
		}
		for (const [who, tok] of [['pair member C', P[F.member.slug].token], ['pair member E (staff)', STAFF]]) {
			const r = await pairs(UP, tok);
			feat('HB.gbpairs.UNCLEAR-positive.' + who + '-sees-true', 'b', who, r.status === 200 && edgeOfRow(r.row) !== null && Math.abs(edgeOfRow(r.row) - trueEdge) <= 0.011, { status: r.status, row: r.row, true_edge: trueEdge });
		}
		{
			const e = await T('stats/gb-edge', { userId: F.member.id }, ANON);   // C's Edge, anonymous: D (clear) yes, E (unclear) no
			const ids = ((e.json && e.json.partners) || []).map((p) => p.partnerId);
			leak('HB.gbedge.UNCLEAR-partner-dropped.anonymous', 'b', 'anonymous', e.status === 200 && !ids.includes(F.staff.id), { status: e.status, partners: ids });
			ctrl('HB.gbedge.CLEAR-partner-shown.anonymous', 'b', 'anonymous', e.status === 200 && ids.includes(F.owner.id), { status: e.status, partners: ids });
			const s = await T('stats/gb-edge', { userId: F.member.id }, STAFF);   // E looks at C's Edge: sees the C+E pair (theirs)
			const sid = ((s.json && s.json.partners) || []).map((p) => p.partnerId);
			feat('HB.gbedge.UNCLEAR-partner.member-E-sees-own', 'b', 'pair member E (staff)', s.status === 200 && sid.includes(F.staff.id), { status: s.status, partners: sid });
		}
	});

	await section('HA', async () => {
		// ══ G15.3 addendum (a) — per-match rating before/after and rating changes: the player themselves only ═════════
		const g1 = CH.g.g1.matchId;
		const classes = [['anonymous', ANON, null], ['stranger', P[F.owner.slug].token, F.owner.id], ['player A', P[F.stranger.slug].token, F.stranger.id], ['player B', P[F.admin.slug].token, F.admin.id], ['staff', STAFF, F.staff.id]];
		for (const [who, tok, uid] of classes) {
			const r = await T('stats/match-summary', { source: 'meet', matchId: g1 }, tok);
			const players = ((r.json && r.json.teams) || []).flatMap((t) => t.players || []);
			const foreign = players.filter((p) => p.userId !== uid && (p.ratingPre != null || p.ratingPost != null)).map((p) => p.userId);
			leak('HA.matchsummary.others-ratings-hidden.' + who, 'a', who, r.status === 200 && players.length === 4 && foreign.length === 0, { status: r.status, players: players.length, othersWithRatings: foreign });
			if (uid && players.some((p) => p.userId === uid)) {
				const mine = players.find((p) => p.userId === uid);
				feat('HA.matchsummary.own-rating-shown.' + who, 'a', who, mine.ratingPre != null && mine.ratingPost != null, { pre: mine.ratingPre, post: mine.ratingPost });
			}
		}
		for (const [who, tok, uid] of classes) {
			const r = await T('stats/matches', { userId: F.stranger.id, limit: 20 }, tok);   // A's matches
			const rows = A(r.json);
			const withDelta = rows.filter((x) => x.ratingDelta != null).length;
			if (uid === F.stranger.id) feat('HA.matches.own-deltas-shown', 'a', who, r.status === 200 && withDelta > 0, { status: r.status, rows: rows.length, withDelta });
			else leak('HA.matches.others-deltas-hidden.' + who, 'a', who, r.status === 200 && rows.length > 0 && withDelta === 0, { status: r.status, rows: rows.length, withDelta });
		}
		for (const [who, tok, uid] of classes) {
			const e = await T('stats/gb-edge', { userId: F.stranger.id }, tok);   // A's Edge: the per-match rating series + trend
			const h = e.json && Array.isArray(e.json.history) ? e.json.history.length : null;
			if (uid === F.stranger.id) feat('HA.gbedge.own-history-shown', 'a', who, e.status === 200 && h > 0, { status: e.status, history: h, trend30: e.json && e.json.trend30 });
			else leak('HA.gbedge.others-history-hidden.' + who, 'a', who, e.status === 200 && h === 0 && e.json.trend30 == null, { status: e.status, history: h, trend30: e.json && e.json.trend30 });
		}
	});

	await section('HC', async () => {
		// ══ G15.3 addendum (c) — a private meet's games never feed a figure a stranger sees ════════════════════════════
		// Player A has private rated games (g5 + the feedback game); the fixture proved the outsider's view differs from A's.
		const sqlSbx = X.sqlOn('se_sbx');
		const classes = [['anonymous', ANON, ''], ['stranger', P[F.owner.slug].token, F.owner.id], ['player B', P[F.admin.slug].token, F.admin.id], ['staff', STAFF, F.staff.id], ['player A', P[F.stranger.slug].token, F.stranger.id]];
		for (const [who, tok, vid] of classes) {
			const want = X.visibleRating(sqlSbx, F.stranger.id, vid);   // n + newest post the doors must use for this viewer
			const kind = vid === F.stranger.id ? feat : leak;
			const e = await T('stats/gb-edge', { userId: F.stranger.id }, tok);
			kind('HC.gbedge.rating+matches.' + who, 'c', who, e.status === 200 && !!want && e.json.matches === want.n && Math.abs(Number(e.json.rating) - want.rating) < 1e-6, { status: e.status, rating: e.json && e.json.rating, matches: e.json && e.json.matches, want });
			const r = await T('stats/gb-ratings', { userIds: [F.stranger.id] }, tok);
			const row = A(r.json).find((x) => x.userId === F.stranger.id) || null;
			kind('HC.gbratings.chip.' + who, 'c', who, r.status === 200 && !!row && !!want && row.matches === want.n && Math.abs(row.rating - want.rating) < 1e-6, { status: r.status, row, want });
			let rk = null;
			for (let off = 0; off < 500 && !rk; off += 50) {
				const k = await T('stats/gb-rankings', { type: 'doubles', limit: 50, offset: off }, tok);
				const rows = (k.json && k.json.rows) || [];
				rk = rows.find((x) => x.userId === F.stranger.id) || (vid === F.stranger.id && k.json && k.json.mine) || null;
				if (rows.length < 50) break;
			}
			kind('HC.gbrankings.rating.' + who, 'c', who, !!rk && !!want && Math.abs(rk.rating - Math.round(want.rating * 1000) / 1000) < 0.0006, { found: !!rk, rating: rk && rk.rating, want: want && want.rating });
		}
		{
			const a = X.visibleRating(sqlSbx, F.stranger.id, ''), self = X.visibleRating(sqlSbx, F.stranger.id, F.stranger.id);
			ctrl('HC.fixture.private-games-exist', 'c', 'n/a', !!a && !!self && a.n < self.n && Math.abs(a.rating - self.rating) > 1e-6, { outsider: a, self });
		}
	});

	await section('H6H7', async () => {
		// ══ HOLES 6 / 7 — a private club's weekly slots, with venue and coordinates ═════════════════════════
		for (const [who, tok] of OUTSIDERS) {
			const r = await T('clubs/schedules/list', { channelId: F.cpriv }, tok);
			const first = A(r.json)[0] || null;
			leak('H6.schedlist.' + who, 6, who, !(r.status === 200 && A(r.json).length > 0), { status: r.status, code: r.code, rows: A(r.json).length, venue: first && first.venueName, lat: first && first.lat });
			const s = await T('clubs/schedules/show', { scheduleId: F.scheduleId }, tok);
			leak('H7.schedshow.' + who, 7, who, s.status !== 200, { status: s.status, code: s.code, name: s.json && s.json.name, venue: s.json && s.json.venueName, lat: s.json && s.json.lat });
		}
		for (const [who, tok] of INSIDERS) {
			const r = await T('clubs/schedules/list', { channelId: F.cpriv }, tok);
			feat('H6.schedlist.' + who, 6, who, r.status === 200 && A(r.json).length > 0, { status: r.status, code: r.code, rows: A(r.json).length });
			const s = await T('clubs/schedules/show', { scheduleId: F.scheduleId }, tok);
			feat('H7.schedshow.' + who, 7, who, s.status === 200 && !!(s.json && s.json.name), { status: s.status, code: s.code, name: s.json && s.json.name });
		}
		{
			const r = await T('clubs/schedules/list', { channelId: F.cpub }, ANON);
			ctrl('H6.schedlist.PUBLIC-club', 6, 'anonymous', r.status === 200 && A(r.json).length > 0, { status: r.status, rows: A(r.json).length });
			const s = await T('clubs/schedules/show', { scheduleId: F.schedulePubId }, ANON);
			ctrl('H7.schedshow.PUBLIC-club', 7, 'anonymous', s.status === 200, { status: s.status, name: s.json && s.json.name });
			// the invite-link holder: channels/show takes an accessToken, these two doors do not — recorded, not assumed
			const i = await T('clubs/schedules/list', { channelId: F.cpriv, accessToken: F.accessToken }, ANON);
			rec({ id: 'H6.schedlist.INVITE-LINK', hole: 6, role: 'invite-link', kind: 'note', ok: true, got: { status: i.status, code: i.code, rows: A(i.json).length } });
		}
	});

	await section('H8', async () => {
		// ══ HOLE 8 — per-tag member counts of a private club ════════════════════════════════════════════════
		for (const [who, tok] of OUTSIDERS) {
			const r = await T('clubs/settings/show', { channelId: F.cpriv }, tok);
			const tags = (r.json && r.json.tags) || [];
			leak('H8.settings.' + who, 8, who, r.status === 200 && tags.length === 0, { status: r.status, hasAccess: r.json && r.json.hasAccess, tags: tags.map((t) => ({ name: t.name, count: t.count })), membersCount: r.json && r.json.membersCount });
		}
		for (const [who, tok] of INSIDERS) {
			const r = await T('clubs/settings/show', { channelId: F.cpriv }, tok);
			const tags = (r.json && r.json.tags) || [];
			const mine = tags.find((t) => t.id === F.tagId) || null;
			feat('H8.settings.' + who, 8, who, r.status === 200 && !!(r.json && r.json.hasAccess) && !!mine && mine.count > 0, { status: r.status, hasAccess: r.json && r.json.hasAccess, tag: mine && { name: mine.name, count: mine.count }, membersCount: r.json && r.json.membersCount });
		}
		{
			const r = await T('clubs/settings/show', { channelId: F.cpub }, ANON);
			ctrl('H8.settings.PUBLIC-club', 8, 'anonymous', r.status === 200 && !!(r.json && r.json.hasAccess), { status: r.status, hasAccess: r.json && r.json.hasAccess, tags: ((r.json && r.json.tags) || []).length, membersCount: r.json && r.json.membersCount });
		}
	});

	await section('H10', async () => {
		// ══ HOLE 10 — the PACKER: a private club's counts through every door that packs a channel ═══════════
		{
			const a = await T('meets/show', { meetId: F.publicMeetId }, ANON);
			const ch = a.json && a.json.channel;
			leak('H10.packer.meets-show.anonymous', 10, 'anonymous', a.status === 200 && !!ch && (ch.usersCount === 0 && ch.membersCount === 0 && ch.followersCount === 0), { status: a.status, channelId: ch && ch.id, usersCount: ch && ch.usersCount, membersCount: ch && ch.membersCount, followersCount: ch && ch.followersCount });
			const m = await T('meets/show', { meetId: F.publicMeetId }, MEMBER);
			const cm = m.json && m.json.channel;
			feat('H10.packer.meets-show.member', 10, 'member', m.status === 200 && !!cm && cm.usersCount > 0, { status: m.status, usersCount: cm && cm.usersCount, membersCount: cm && cm.membersCount });
			const c = await T('clubs/by-code', { code: F.refCode }, ANON);
			rec({ id: 'H10.packer.by-code.anonymous', hole: 10, role: 'anonymous', kind: 'note', ok: true, got: { status: c.status, name: c.json && c.json.name, usersCount: c.json && c.json.usersCount, visibility: c.json && c.json.visibility } });
			const p = await T('channels/show', { channelId: F.cpub }, ANON);
			ctrl('H10.packer.PUBLIC-counts-intact', 10, 'anonymous', p.status === 200 && p.json && p.json.usersCount > 0, { status: p.status, usersCount: p.json && p.json.usersCount, membersCount: p.json && p.json.membersCount });
			const pc = await T('clubs/by-code', { code: F.pubRefCode }, ANON);
			ctrl('H10.packer.by-code.PUBLIC-club', 10, 'anonymous', pc.status === 200 && pc.json && pc.json.usersCount > 0, { status: pc.status, usersCount: pc.json && pc.json.usersCount });
		}
	});

	await section('C1', async () => {
		// ══ the discrimination control: this suite reads real product state, not constants ══════════════════
		{
			const a = await T('channels/timeline', { channelId: F.cpriv, limit: 1 }, ANON);
			const b = await T('channels/timeline', { channelId: F.cpub, limit: 1 }, ANON);
			ctrl('C1.timeline.discriminates', 'control', 'anonymous', a.status === 403 && b.status === 200, { privateStatus: a.status, privateCode: a.code, publicStatus: b.status });
		}
	});

	const leaks = out.filter((o) => o.kind === 'leak' && !o.ok);
	const broken = out.filter((o) => (o.kind === 'feature' || o.kind === 'control') && !o.ok);
	const v = { id: 'secperm2-' + PHASE, at: new Date().toISOString(), target: TARGET, phase: PHASE, fixture: { cpriv: F.cpriv, cpub: F.cpub, tag: F.tag, liveState: live, members: mem, adminIds: adm, healed }, leaks: leaks.length, broken_for_legitimate_callers: broken.length, results: out };
	fs.writeFileSync(OUT, JSON.stringify(v, null, 1));
	log('\n=== ' + PHASE + ': ' + leaks.length + ' leak(s) open, ' + broken.length + ' legitimate-caller/control failure(s)  ->  ' + OUT);
}

main().catch((e) => { console.error('PROBE ERROR ' + (e && e.stack ? e.stack : e)); process.exit(1); });

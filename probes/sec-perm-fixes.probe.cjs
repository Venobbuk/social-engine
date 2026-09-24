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
		for (const [who, tok] of [['anonymous', ANON], ['stranger', P['clubowner-mei'].token], ['staff', STAFF]]) {
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
		// ══ HOLE 5 — stats/gb-fair leaked the same chemistry through teamAWinPct ════════════════════════════
		{
			// The four are chosen by sec-perm-fixes.fairfour.cjs so the split holding the negative pair lands where the
			// chemistry term cannot be clamped away — and the readings are PREDICTED from the engine's own arithmetic over
			// the REAL rated rows (read through the doors' rule) before the call is made.
			const FOUR = F.fairFour, PRED = F.fairPredict;
			if (!PRED || PRED.negPairMemberPct === PRED.outsiderPct) throw new Error('no usable gb-fair prediction — refusing to measure hole 5');
			const want = [...F.negPair].sort().join('+');
			const split = (j) => (j || []).find((x) => [...x.teamA].sort().join('+') === want || [...x.teamB].sort().join('+') === want) || null;
			const pctFor = (s) => (s == null ? null : ([...s.teamA].sort().join('+') === want ? s.teamAWinPct : 100 - s.teamAWinPct));
			const get = async (tok) => { const r = await T('stats/gb-fair', { userIds: FOUR }, tok); const s = split(r.json); return { status: r.status, rows: A(r.json).length, split: s, pct: pctFor(s) }; };
			const a = await get(ANON), st = await get(STAFF), posm = await get(P[F.member.slug].token), own = await get(P[F.stranger.slug].token), own2 = await get(P[F.admin.slug].token);
			leak('H5.gbfair.anonymous.winPct', 5, 'anonymous', a.status === 200 && a.pct === PRED.outsiderPct, { status: a.status, anonWinPct: a.pct, predicted_outsider: PRED.outsiderPct, predicted_negPairMember: PRED.negPairMemberPct, rows: a.rows });
			leak('H5.gbfair.staff.winPct', 5, 'staff', st.status === 200 && st.pct === PRED.outsiderPct, { status: st.status, staffWinPct: st.pct, predicted_outsider: PRED.outsiderPct });
			feat('H5.gbfair.NEG-PAIR-MEMBER-A.full', 5, 'negative-pair member', own.status === 200 && own.rows === 3 && own.pct === PRED.negPairMemberPct, { status: own.status, rows: own.rows, winPct: own.pct, predicted: PRED.negPairMemberPct });
			feat('H5.gbfair.NEG-PAIR-MEMBER-B.full', 5, 'negative-pair member', own2.status === 200 && own2.pct === PRED.negPairMemberPct, { status: own2.status, winPct: own2.pct, predicted: PRED.negPairMemberPct });
			// POSITIVE chemistry is not private: a member of the positive pair (outside the negative one) reads exactly what
			// an outsider reads — and that reading carries the positive term (outsiderPct != the bare-rating split).
			ctrl('H5.gbfair.POSITIVE-pair-member-matches-outsider', 5, 'positive-pair member', posm.status === 200 && posm.pct === a.pct && posm.pct === PRED.outsiderPct, { status: posm.status, posPairMemberWinPct: posm.pct, anonWinPct: a.pct, predicted_outsider: PRED.outsiderPct });
			ctrl('H5.gbfair.POSITIVE-term-present', 5, 'anonymous', PRED.outsiderPct !== PRED.bareRatingPct && a.pct === PRED.outsiderPct, { outsider: PRED.outsiderPct, bareRatingSplit: PRED.bareRatingPct, anon: a.pct });
			ctrl('H5.gbfair.BALANCING-still-works', 5, 'anonymous', a.status === 200 && a.rows === 3 && a.split != null && a.split.fairness != null, { status: a.status, rows: a.rows, fairness: a.split && a.split.fairness });
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

// invite-access.probe.cjs — INVITE-ACCESS-V1. The BEFORE/AFTER measurement of the two side-effects SEC-PERM-V1 left:
//   FIX 1  the invite link lost the schedule   (clubs/schedules/list + /show refused the ?at= holder)
//   FIX 2  a private club's join preview showed 0 members (clubs/by-code, channels/show + the packer)
//
// THE SAME assertions, over the SAME database rows, against whichever engine TARGET names:
//   BEFORE  http://127.0.0.1:3961  web-uat on master b5b4ddc330 (the fixes, with the side-effects)
//   AFTER   http://127.0.0.1:3965  a throwaway engine on the image carrying this lane's commit
//   PLANT   http://127.0.0.1:3963  sha-3ea789f, the build where the schedule door had NO gate at all —
//                                  every privacy leg here MUST fail against it, or the leg proves nothing.
//
// Three kinds of assertion, and all three have to hold:
//   [leak]    an outsider with NO code and NO token must still be refused / still see 0 — the privacy rule, unloosened
//   [feature] the entitled caller (token holder, code holder, member, admin, owner) must GET their data
//   [ctrl]    the check discriminates: a WRONG token is refused, the PUBLIC control club is unaffected
//
// ENTITLED_AS=stranger runs every entitled leg with an OUTSIDER credential (wrong token, stranger's session). Every
// [feature] leg must then FAIL — that is self-test P3, and it is what stops "ok" from being a constant.
'use strict';
require('/root/social-engine/probes/_guard.cjs');
const fs = require('fs');
const { execFileSync } = require('child_process');
const L = require('/root/social-engine/probes/sec-lib.cjs');

const TARGET = process.env.TARGET || 'http://127.0.0.1:3961';
const PHASE = process.env.PHASE || 'after';
const OUT = process.env.OUT || ('/root/gen/invite-access-' + PHASE + '.json');
const ENTITLED_AS = process.env.ENTITLED_AS || '';
const F = JSON.parse(fs.readFileSync('/root/gen/secperm2-fixtures.json', 'utf8'));

const sql = (t) => execFileSync('docker', ['exec', '-i', 'social-engine-db-1', 'psql', '-U', 'social', '-d', 'se_sbx', '-tAq', '-v', 'ON_ERROR_STOP=1', '-f', '-'], { input: t, encoding: 'utf8' }).trim();
const log = (s) => console.log(s);
const out = [];
function rec(o) {
	out.push(o);
	log((o.ok ? 'ok   ' : 'FAIL ') + '[' + o.kind.slice(0, 4) + '] ' + o.id.padEnd(40) + ' ' + JSON.stringify(o.got).slice(0, 170));
	return o;
}
const leak = (id, fix, pass, got) => rec({ id, fix, kind: 'leak', ok: !!pass, got });
const feat = (id, fix, pass, got) => rec({ id, fix, kind: 'feature', ok: !!pass, got });
const ctrl = (id, fix, pass, got) => rec({ id, fix, kind: 'control', ok: !!pass, got });

async function T(endpoint, body, token) {
	const r = await fetch(TARGET + '/api/' + endpoint, {
		method: 'POST', headers: { 'content-type': 'application/json' },
		body: JSON.stringify(token ? { ...(body || {}), i: token } : (body || {})),
	});
	const text = await r.text();
	let json = null; try { json = JSON.parse(text); } catch (e) { /* 204 */ }
	return { status: r.status, json, code: json && json.error ? json.error.code : null, text };
}
/** a refusal, in the shape both doors use: 400 + the NO_SUCH_* code, and NO payload */
const refused = (r, code) => r.status !== 200 && r.code === code;
const A = (j) => (Array.isArray(j) ? j : []);
async function section(label, fn) {
	try { await fn(); } catch (e) { rec({ id: label + '.THREW', fix: 0, kind: 'leak', ok: false, got: { threw: String(e && e.message ? e.message : e) } }); }
}

async function main() {
	// ── preconditions, read out of the DATABASE immediately before measuring. Another lane's probes/run.sh sweeps every
	//    '[probe%' artefact on this box and has eaten this fixture mid-run three times; an archived club reads as
	//    "nothing leaked", which is the one failure this measurement must not make. ───────────────────────────────
	const healed = [];
	const readClub = (id) => JSON.parse(sql(`SELECT row_to_json(t) FROM (SELECT c.id, c."isArchived", c."userId" AS owner, s.visibility, s."refCode", s."accessToken" FROM channel c JOIN club_setting s ON s."channelId"=c.id WHERE c.id='${id}') t;`) || 'null');
	for (const id of [F.cpriv, F.cpub]) {
		const c = readClub(id);
		if (c && c.isArchived) { sql(`UPDATE channel SET "isArchived" = false WHERE id = '${id}';`); healed.push('re-opened ' + id); }
	}
	if (sql(`SELECT status FROM meet WHERE id = '${F.publicMeetId}';`) === 'cancelled') {
		sql(`UPDATE meet SET status='active', "cancelledAt"=NULL WHERE id='${F.publicMeetId}';`); healed.push('re-activated ' + F.publicMeetId);
	}
	if (healed.length) log('INFO healed before measuring — ' + JSON.stringify(healed));

	const priv = readClub(F.cpriv), pub = readClub(F.cpub);
	const FIXTURE_PRIVATE = !!priv && priv.visibility === 'private';   // self-test P1 flips this on purpose
	if (!priv || priv.isArchived) throw new Error('FIXTURE: the private club is gone/archived: ' + JSON.stringify(priv));
	if (!(pub && pub.visibility === 'public' && !pub.isArchived)) throw new Error('PUBLIC CONTROL not public/live: ' + JSON.stringify(pub));
	if (priv.accessToken !== F.accessToken || priv.refCode !== F.refCode) throw new Error('FIXTURE: the club rotated its code/token: ' + JSON.stringify(priv));
	const sched = JSON.parse(sql(`SELECT row_to_json(t) FROM (SELECT id, "channelId", "venueName", lat FROM club_schedule WHERE id='${F.scheduleId}') t;`) || 'null');
	if (!(sched && sched.channelId === F.cpriv && sched.venueName && sched.lat != null)) throw new Error('FIXTURE: the private weekly slot is gone: ' + JSON.stringify(sched));
	const schedPub = JSON.parse(sql(`SELECT row_to_json(t) FROM (SELECT id, "channelId" FROM club_schedule WHERE id='${F.schedulePubId}') t;`) || 'null');
	if (!(schedPub && schedPub.channelId === F.cpub)) throw new Error('FIXTURE: the public control lost its slot: ' + JSON.stringify(schedPub));
	const mem = sql(`SELECT string_agg("userId", ',') FROM club_member WHERE "channelId"='${F.cpriv}';`).split(',').filter(Boolean);
	if (!mem.includes(F.member.id) || mem.includes(F.stranger.id)) throw new Error('FIXTURE: the roster moved: ' + JSON.stringify(mem));
	// the number the join preview must print: club_member rows + the owner, counted the way club-tiers counts it
	const EXPECT_PRIV = Number(sql(`SELECT count(*) FROM (SELECT "userId" FROM club_member WHERE "channelId"='${F.cpriv}' UNION SELECT '${priv.owner}') u;`));
	const EXPECT_PUB = Number(sql(`SELECT count(*) FROM (SELECT "userId" FROM club_member WHERE "channelId"='${F.cpub}' UNION SELECT '${pub.owner}') u;`));
	log('INFO preconditions — priv=' + JSON.stringify({ visibility: priv.visibility, members: EXPECT_PRIV }) + ' pub=' + JSON.stringify({ visibility: pub.visibility, members: EXPECT_PUB }) + ' venue=' + JSON.stringify(sched.venueName));

	// ── credentials. ENTITLED_AS=stranger hands every entitled leg an OUTSIDER's (self-test P3). ────────────────
	const P = {};
	for (const slug of [F.owner.slug, F.admin.slug, F.member.slug, F.stranger.slug, F.staff.slug]) P[slug] = await L.signIn(slug);
	const STRANGER = P[F.stranger.slug], STAFF = P[F.staff.slug];
	const swap = ENTITLED_AS === 'stranger';
	const OWNER = swap ? STRANGER : P[F.owner.slug];
	const ADMIN = swap ? STRANGER : P[F.admin.slug];
	const MEMBER = swap ? STRANGER : P[F.member.slug];
	const AT = swap ? pub.accessToken : F.accessToken;          // the invite-link token (?at=) — or the wrong club's
	const CODE = swap ? F.pubRefCode : F.refCode;               // the six-char club code — or the wrong club's
	const WRONG_AT = pub.accessToken;                           // the PUBLIC control's token, never valid on the private club
	if (swap) log('INFO ENTITLED_AS=stranger — every [feature] leg is being run with an outsider credential and MUST fail');

	// ══ FIX 1 — clubs/schedules/list ══════════════════════════════════════════════════════════════════════════
	const slotOf = (r) => { const a = A(r.json); const s = a.find((x) => x && x.id === F.scheduleId) || a[0]; return s ? { rows: a.length, venue: s.venueName ?? null, lat: s.lat ?? null } : { rows: a.length, venue: null, lat: null }; };
	await section('F1.list', async () => {
		const anon = await T('clubs/schedules/list', { channelId: F.cpriv });
		leak('F1.list.anon.noToken', 1, refused(anon, 'NO_SUCH_CLUB'), { status: anon.status, code: anon.code, rows: A(anon.json).length });
		const str = await T('clubs/schedules/list', { channelId: F.cpriv }, STRANGER.token);
		leak('F1.list.stranger.noToken', 1, refused(str, 'NO_SUCH_CLUB'), { status: str.status, code: str.code, rows: A(str.json).length });
		const stf = await T('clubs/schedules/list', { channelId: F.cpriv }, STAFF.token);
		leak('F1.list.staff.noToken', 1, refused(stf, 'NO_SUCH_CLUB'), { status: stf.status, code: stf.code, rows: A(stf.json).length });

		const at = await T('clubs/schedules/list', { channelId: F.cpriv, accessToken: AT });
		const g = slotOf(at);
		feat('F1.list.anon.inviteToken', 1, at.status === 200 && g.rows > 0 && g.venue === sched.venueName && g.lat != null, { status: at.status, code: at.code, ...g });
		const atStr = await T('clubs/schedules/list', { channelId: F.cpriv, accessToken: AT }, STRANGER.token);
		feat('F1.list.strangerWithToken', 1, atStr.status === 200 && A(atStr.json).length > 0, { status: atStr.status, code: atStr.code, rows: A(atStr.json).length });

		const bad = await T('clubs/schedules/list', { channelId: F.cpriv, accessToken: WRONG_AT });
		ctrl('F1.list.anon.WRONGtoken', 1, refused(bad, 'NO_SUCH_CLUB'), { status: bad.status, code: bad.code, rows: A(bad.json).length });
		const junk = await T('clubs/schedules/list', { channelId: F.cpriv, accessToken: 'ffffffffffffffff' });
		ctrl('F1.list.anon.junkToken', 1, refused(junk, 'NO_SUCH_CLUB'), { status: junk.status, code: junk.code });

		for (const [who, cred] of [['member', MEMBER], ['admin', ADMIN], ['owner', OWNER]]) {
			const r = await T('clubs/schedules/list', { channelId: F.cpriv }, cred.token);
			feat('F1.list.' + who, 1, r.status === 200 && A(r.json).length > 0, { status: r.status, code: r.code, rows: A(r.json).length });
		}
		const pubAnon = await T('clubs/schedules/list', { channelId: F.cpub });
		ctrl('F1.list.PUBLIC-control.anon', 1, pubAnon.status === 200 && A(pubAnon.json).length > 0, { status: pubAnon.status, rows: A(pubAnon.json).length });
	});

	// ══ FIX 1 — clubs/schedules/show (the same slot, one hop along) ═══════════════════════════════════════════
	await section('F1.show', async () => {
		const anon = await T('clubs/schedules/show', { scheduleId: F.scheduleId });
		leak('F1.show.anon.noToken', 1, refused(anon, 'NO_SUCH_CLUB'), { status: anon.status, code: anon.code, venue: anon.json && anon.json.venueName });
		const str = await T('clubs/schedules/show', { scheduleId: F.scheduleId }, STRANGER.token);
		leak('F1.show.stranger.noToken', 1, refused(str, 'NO_SUCH_CLUB'), { status: str.status, code: str.code, venue: str.json && str.json.venueName });
		const at = await T('clubs/schedules/show', { scheduleId: F.scheduleId, accessToken: AT });
		feat('F1.show.anon.inviteToken', 1, at.status === 200 && at.json && at.json.venueName === sched.venueName && at.json.lat != null, { status: at.status, code: at.code, venue: at.json && at.json.venueName, lat: at.json && at.json.lat });
		const bad = await T('clubs/schedules/show', { scheduleId: F.scheduleId, accessToken: WRONG_AT });
		ctrl('F1.show.anon.WRONGtoken', 1, refused(bad, 'NO_SUCH_CLUB'), { status: bad.status, code: bad.code });
		const m = await T('clubs/schedules/show', { scheduleId: F.scheduleId }, MEMBER.token);
		feat('F1.show.member', 1, m.status === 200 && m.json && m.json.venueName === sched.venueName, { status: m.status, code: m.code, venue: m.json && m.json.venueName });
		const pubAnon = await T('clubs/schedules/show', { scheduleId: F.schedulePubId });
		ctrl('F1.show.PUBLIC-control.anon', 1, pubAnon.status === 200 && !!(pubAnon.json && pubAnon.json.id), { status: pubAnon.status, id: pubAnon.json && pubAnon.json.id });
	});

	// ══ FIX 2 — the join preview's member count ═══════════════════════════════════════════════════════════════
	const counts = (j) => (j ? { usersCount: j.usersCount, membersCount: j.membersCount, followersCount: j.followersCount } : null);
	await section('F2.bycode', async () => {
		const r = await T('clubs/by-code', { code: CODE });
		feat('F2.by-code.anon.clubCode', 2, r.status === 200 && r.json && r.json.usersCount === EXPECT_PRIV && r.json.membersCount === EXPECT_PRIV && r.json.visibility === (swap ? 'public' : 'private'), { status: r.status, code: r.code, expect: EXPECT_PRIV, ...counts(r.json), visibility: r.json && r.json.visibility });
		const rp = await T('clubs/by-code', { code: F.pubRefCode });
		ctrl('F2.by-code.PUBLIC-control', 2, rp.status === 200 && rp.json && rp.json.usersCount === EXPECT_PUB, { status: rp.status, expect: EXPECT_PUB, ...counts(rp.json) });
		const rb = await T('clubs/by-code', { code: 'ZZZZ99' });
		ctrl('F2.by-code.bogusCode', 2, rb.status !== 200 && rb.code === 'NO_SUCH_CLUB', { status: rb.status, code: rb.code });
	});
	await section('F2.show', async () => {
		const anon = await T('channels/show', { channelId: F.cpriv });
		leak('F2.channels-show.anon.noToken', 2, refused(anon, 'NO_SUCH_CHANNEL'), { status: anon.status, code: anon.code, ...counts(anon.json) });
		const str = await T('channels/show', { channelId: F.cpriv }, STRANGER.token);
		leak('F2.channels-show.stranger.noToken', 2, refused(str, 'NO_SUCH_CHANNEL'), { status: str.status, code: str.code, ...counts(str.json) });
		const at = await T('channels/show', { channelId: F.cpriv, accessToken: AT });
		feat('F2.channels-show.anon.inviteToken', 2, at.status === 200 && at.json && at.json.usersCount === EXPECT_PRIV && at.json.membersCount === EXPECT_PRIV, { status: at.status, code: at.code, expect: EXPECT_PRIV, ...counts(at.json) });
		const bad = await T('channels/show', { channelId: F.cpriv, accessToken: WRONG_AT });
		ctrl('F2.channels-show.anon.WRONGtoken', 2, refused(bad, 'NO_SUCH_CHANNEL'), { status: bad.status, code: bad.code, ...counts(bad.json) });
		const m = await T('channels/show', { channelId: F.cpriv }, MEMBER.token);
		feat('F2.channels-show.member', 2, m.status === 200 && m.json && m.json.usersCount === EXPECT_PRIV, { status: m.status, code: m.code, expect: EXPECT_PRIV, ...counts(m.json) });
		const pubAnon = await T('channels/show', { channelId: F.cpub });
		ctrl('F2.channels-show.PUBLIC-control.anon', 2, pubAnon.status === 200 && pubAnon.json && pubAnon.json.usersCount === EXPECT_PUB, { status: pubAnon.status, expect: EXPECT_PUB, ...counts(pubAnon.json) });
	});
	// the packer door hole 10 came through: a PUBLIC meet inside the PRIVATE club. Its caller holds NO club token,
	// so the club's audience size must STILL be 0 — this is the leg that proves FIX 2 did not make counts public.
	await section('F2.packer', async () => {
		const anon = await T('meets/show', { meetId: F.publicMeetId });
		const ch = anon.json && anon.json.channel;
		leak('F2.meets-show.anon.noClubToken', 2, anon.status === 200 && ch && ch.usersCount === 0 && ch.membersCount === 0, { status: anon.status, channel: counts(ch) });
		const m = await T('meets/show', { meetId: F.publicMeetId }, MEMBER.token);
		const chm = m.json && m.json.channel;
		feat('F2.meets-show.member', 2, m.status === 200 && chm && chm.usersCount === EXPECT_PRIV, { status: m.status, expect: EXPECT_PRIV, channel: counts(chm) });
	});
	// the token READS; it has never written, and this fix must not have changed that (mayPostInClub, untouched).
	await section('F2.write', async () => {
		const w = await T('notes/create', { text: '[probe] SPX invite-token write attempt', channelId: F.cpriv }, STRANGER.token);
		leak('F0.write.strangerWithToken.refused', 0, w.status !== 200, { status: w.status, code: w.code });
		if (w.status === 200 && w.json && w.json.createdNote) sql(`DELETE FROM note WHERE id = '${w.json.createdNote.id}';`);
	});

	const leaks = out.filter((o) => o.kind === 'leak' && !o.ok);
	const feats = out.filter((o) => o.kind === 'feature' && !o.ok);
	const ctrls = out.filter((o) => o.kind === 'control' && !o.ok);
	const summary = { phase: PHASE, target: TARGET, at: new Date().toISOString(), entitled_as: ENTITLED_AS || 'real', fixture_private: FIXTURE_PRIVATE, assertions: out.length, leaks_open: leaks.length, feature_failures: feats.length, control_failures: ctrls.length, expect: { priv: EXPECT_PRIV, pub: EXPECT_PUB }, results: out };
	fs.writeFileSync(OUT, JSON.stringify(summary, null, 1));
	log('\n' + PHASE + ' @ ' + TARGET + ' — ' + out.length + ' assertions: ' + leaks.length + ' leak(s) open, ' + feats.length + ' entitled caller(s) refused, ' + ctrls.length + ' control failure(s)  -> ' + OUT);
}

main().catch((e) => { console.error('PROBE ERROR ' + (e && e.stack ? e.stack : e)); process.exit(1); });

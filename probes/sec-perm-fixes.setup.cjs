// sec-perm-fixes.setup.cjs — SEC-PERM-V1 verification: build the fixture ONCE and PROVE it is real.
//
// WHY THIS FILE EXISTS SEPARATELY. The first attempt at this measurement planted a "private" club with a raw INSERT
// that failed on a column type (club_setting."adminIds" is varchar[], not jsonb) — so the club was never private and
// the run PRINTED RESULTS THAT LOOKED LIKE A PASS. Nothing here is believed because an API call returned 200: every
// precondition is READ BACK OUT OF THE DATABASE and the setup refuses to write the fixture file if one is wrong.
//
// The fixture is built once, then the SAME rows are measured against the pre-fix engine (:3963) and the fixed one
// (:3961), so a before/after difference can only come from the code.
//
// G13: every artifact is named '[probe] SPX-<stamp>'; sec-perm-fixes.cleanup.cjs removes them.
'use strict';
require('/root/social-engine/probes/_guard.cjs');
const fs = require('fs');
const { execFileSync } = require('child_process');
const L = require('/root/social-engine/probes/sec-lib.cjs');

const OUT = '/root/gen/secperm2-fixtures.json';
// the pair permission-sweep proved has a NEGATIVE chemistry edge on UAT. Kept as the ORIGINAL reproduction for hole 3
// when its rows survive the nightly reset; the personas' own planted pair below always gives the check an entitled caller.
const SWEEP_NEG = ['ar7uzhlxs64a00qs', 'ar7uzi4vs64a00r6'];

const TAG = '[probe] SPX-' + L.stamp;
const log = (s) => console.log(s);

/** psql on the SANDBOX database, SQL on stdin — never through a shell string (nested quoting strips quotes). */
function sql(text, db) {
	return execFileSync('docker', ['exec', '-i', 'social-engine-db-1', 'psql', '-U', 'social', '-d', db || 'se_sbx', '-tAq', '-v', 'ON_ERROR_STOP=1', '-f', '-'], { input: text, encoding: 'utf8' }).trim();
}
function row(text) { const s = sql(text); return s ? JSON.parse(s.split('\n')[0]) : null; }
const rows = (text) => sql(text).split('\n').filter(Boolean).map((l) => JSON.parse(l));

const FAILS = [];
const must = (cond, what, detail) => {
	const line = (cond ? 'PRECONDITION ok   ' : 'PRECONDITION FAIL ') + what + (detail !== undefined ? ' — ' + JSON.stringify(detail).slice(0, 300) : '');
	log(line);
	if (!cond) FAILS.push(line);
	return !!cond;
};

async function main() {
	const P = {};
	for (const slug of ['player-amy', 'host-ken', 'clubowner-mei', 'clubadmin-tom', 'admin']) P[slug] = await L.signIn(slug);
	log('INFO identities — ' + JSON.stringify(Object.fromEntries(Object.entries(P).map(([k, v]) => [k, v.id]))));

	const OWNER = P['clubadmin-tom'];      // will be channel.userId of the private club
	const ADMIN = P['host-ken'];           // will be in club_setting."adminIds"
	const MEMBER = P['clubowner-mei'];     // will have a club_member row
	const STRANGER = P['player-amy'];      // no row at all
	const STAFF = P['admin'];

	// ── 1. two clubs: the private fixture and the PUBLIC CONTROL beside it ───────────────────────────────
	// channels/create is capped at 10 per hour per user, and this setup may have to run more than once (another lane's
	// probes/run.sh sweeps this box and archives every channel named '[probe%' — see the probe's heal step), so a
	// club this same lane made earlier is re-opened and renamed instead of a new one being spent.
	const mk = async (kind) => {
		const name = TAG + ' ' + kind + ' club';
		const old = row(`SELECT row_to_json(t) FROM (SELECT id FROM channel WHERE "userId" = '${OWNER.id}' AND name LIKE '[probe] SPX-% ${kind} club' ORDER BY id DESC LIMIT 1) t;`);
		if (old) {
			const u = await L.se('channels/update', { channelId: old.id, name, isArchived: false }, OWNER.token);
			if (u.status === 200) {
				// SEC-CHEM-V3: channels/update answered 200 yet left a club this lane's own cleanup had archived still archived
				// (2026-09-24 attempt 2 of planted2) — the row is the fact, so it is re-opened here and re-checked below.
				sql(`UPDATE channel SET "isArchived" = false WHERE id = '${old.id}' AND "isArchived" = true;`);
				log('INFO club REUSED ' + old.id + ' -> ' + name); return old.id;
			}
			log('INFO could not reuse ' + old.id + ' (' + u.status + '), creating a new one');
		}
		const c = await L.se('channels/create', { name, description: 'sec-perm fixture' }, OWNER.token);
		if (c.status !== 200) throw new Error('channels/create ' + name + ' -> ' + c.status + ' ' + JSON.stringify(c.json).slice(0, 200));
		log('INFO club created ' + c.json.id + ' ' + name);
		return c.json.id;
	};
	const CPRIV = await mk('private');
	const CPUB = await mk('public');

	// membership is taken while the club is OPEN, then it is turned private — a real member and real outsiders,
	// without going through the approval queue.
	await L.se('clubs/settings/update', { channelId: CPRIV, visibility: 'public', gateType: 'open' }, OWNER.token);
	await L.se('clubs/settings/update', { channelId: CPUB, visibility: 'public', gateType: 'open' }, OWNER.token);
	const jm = await L.se('clubs/join', { channelId: CPRIV }, MEMBER.token);
	const ja = await L.se('clubs/join', { channelId: CPRIV }, ADMIN.token);
	const pr = await L.se('clubs/members/update', { channelId: CPRIV, userId: ADMIN.id, role: 'admin' }, OWNER.token);
	const jp = await L.se('clubs/join', { channelId: CPUB }, STRANGER.token);   // the stranger belongs to the PUBLIC one
	log('INFO joins — member ' + jm.status + ', admin ' + ja.status + ', promote ' + pr.status + ', stranger→public ' + jp.status);
	await L.se('clubs/settings/update', { channelId: CPRIV, visibility: 'private', gateType: 'approval' }, OWNER.token);

	// ── 2. a tag with a real member count (hole 8 is about the COUNT, not only the name) ─────────────────
	const t = await L.se('clubs/tags/upsert', { channelId: CPRIV, name: TAG + ' coaches', visibility: 'all' }, OWNER.token);
	const tagId = t.json && t.json.id;
	const tm = tagId ? await L.se('clubs/tags/member', { channelId: CPRIV, tagId, userId: MEMBER.id, on: true }, OWNER.token) : { status: 0 };
	log('INFO tags/upsert ' + t.status + ' id=' + tagId + ', tags/member ' + tm.status);

	// ── 3. the weekly slots: when and where the club plays (holes 6/7) ───────────────────────────────────
	const sc = await L.se('clubs/schedules/create', { channelId: CPRIV, name: TAG + ' secret Tuesday', weekday: 2, startTime: '19:00', durationMinutes: 90, capacity: 8, venueName: TAG + ' secret court', lat: 22.2783, lng: 114.1747 }, OWNER.token);
	const scheduleId = sc.json && sc.json.id;
	const scPub = await L.se('clubs/schedules/create', { channelId: CPUB, name: TAG + ' open Wednesday', weekday: 3, startTime: '20:00', durationMinutes: 60, capacity: 8, venueName: TAG + ' public court', lat: 22.3, lng: 114.2 }, OWNER.token);
	const schedulePubId = scPub.json && scPub.json.id;
	log('INFO schedules/create private ' + sc.status + ' public ' + scPub.status);

	// ── 4. a PUBLIC meet inside the PRIVATE club — the packer door (hole 10) ─────────────────────────────
	const startAt = new Date(Date.now() + 3 * 86400e3).toISOString();
	const m = await L.se('meets/create', { name: TAG + ' club meet', channelId: CPRIV, startAt, durationMinutes: 90, capacity: 4, visibility: 'public', sport: 'pickleball', venueName: TAG + ' court' }, OWNER.token);
	const publicMeetId = m.json && m.json.id;
	log('INFO meets/create ' + m.status + ' ' + publicMeetId);

	// ── 5. the reviews (hole 4). A casual game leaves the other player PENDING (SEC-CASUAL-CONSENT-V1) and
	//      assertPlayedTogether refuses a review until they confirm — which is why the first attempt at this
	//      measurement recorded 0 warnings and could not have proved anything. So they accept first.
	const casual = async (host, other, name) => {
		const g = await L.se('meets/matches/log-casual', { name: TAG + ' ' + name, team1: [{ userId: host.id }], team2: [{ userId: other.id }], scores: [[11, 7]] }, host.token);
		const meetId = g.json && g.json.meet ? g.json.meet.id : null;
		const acc = meetId ? await L.se('meets/respond', { meetId, answer: 'accept' }, other.token) : { status: 0 };
		log('INFO casual ' + name + ' -> ' + g.status + ' meet=' + meetId + ' respond=' + acc.status);
		return meetId;
	};
	const warnMeetId = await casual(ADMIN, MEMBER, 'warning game');
	const fbMeetId = await casual(ADMIN, STRANGER, 'feedback game');
	const warningBody = TAG + ' unsafe play';
	const wn = warnMeetId ? await L.se('meets/reviews/upsert', { meetId: warnMeetId, targetUserId: MEMBER.id, type: 'warning', body: warningBody }, ADMIN.token) : { status: 0 };
	const endorseBody = TAG + ' On time';
	const en = fbMeetId ? await L.se('meets/reviews/upsert', { meetId: fbMeetId, targetUserId: STRANGER.id, type: 'endorsement', body: endorseBody }, ADMIN.token) : { status: 0 };
	log('INFO reviews — warning ken->mei ' + wn.status + ', endorsement ken->amy ' + en.status);

	// ── 6. the chemistry fixture (holes 3 and 5) — SEC-CHEM-V2: REAL games rated by the engine ─────────────────
	// The planted source='probe' rows this used to INSERT became invisible to the engine on 2026-09-23 (GbRating.liveLog
	// counts a row only when its match lives), so every caller read the same bare-rating number and the check could not
	// fail. probes/sec-chem-fixture.cjs logs real casual doubles games, has them confirmed and made public, waits for the
	// engine's own rating pass and reads the rows back through the doors' rule. It REFUSES (throws) on an unrated fixture.
	sql(`DELETE FROM gb_rating_log WHERE source = 'probe';`);   // the legacy planted rows, if an old run left any
	const CHEM_MADE = [];
	const CHEM = await require('/root/social-engine/probes/sec-chem-fixture.cjs').build(
		{ A: STRANGER, B: ADMIN, C: MEMBER, D: OWNER, E: STAFF },
		{ TAG, se: L.se, db: 'se_sbx', log, made: CHEM_MADE },
	).catch((e) => { must(false, 'the REAL chemistry fixture was built and rated by the engine', String(e && e.message ? e.message : e)); return null; });

	// ══ PRECONDITIONS — read back out of the database, not off an API's 200 ═════════════════════════════
	const cs = rows(`SELECT row_to_json(t) FROM (SELECT c.id, c.name, c."isArchived", c."userId" AS owner, s.visibility, s."adminIds", s."refCode", s."accessToken", jsonb_array_length(s.tags) AS ntags FROM channel c JOIN club_setting s ON s."channelId" = c.id WHERE c.id IN ('${CPRIV}','${CPUB}')) t;`);
	const priv = cs.find((r) => r.id === CPRIV), pub = cs.find((r) => r.id === CPUB);
	must(!!priv && priv.visibility === 'private', 'club_setting.visibility of the PRIVATE fixture is private', priv && { id: priv.id, visibility: priv.visibility });
	must(!!priv && priv.isArchived === false, 'the private fixture club is LIVE (not archived)', priv && priv.isArchived);
	must(!!pub && pub.visibility === 'public', 'club_setting.visibility of the PUBLIC control is public', pub && { id: pub.id, visibility: pub.visibility });
	must(!!pub && pub.isArchived === false, 'the public control club is LIVE', pub && pub.isArchived);
	must(!!priv && priv.owner === OWNER.id, 'channel.userId of the private club is the OWNER persona', priv && priv.owner);
	must(!!priv && Array.isArray(priv.adminIds) && priv.adminIds.includes(ADMIN.id), 'club_setting."adminIds" (varchar[]) contains the ADMIN persona', priv && priv.adminIds);

	const mem = rows(`SELECT row_to_json(t) FROM (SELECT "userId", via FROM club_member WHERE "channelId" = '${CPRIV}') t;`).map((r) => r.userId);
	must(mem.includes(MEMBER.id), 'the MEMBER persona has a club_member row on the private club', mem);
	must(mem.includes(ADMIN.id), 'the ADMIN persona has one too', mem);
	must(!mem.includes(STRANGER.id), 'the STRANGER persona has NO club_member row on the private club', mem);
	const inv = sql(`SELECT count(*) FROM club_invitation WHERE "channelId" = '${CPRIV}' AND "userId" = '${STRANGER.id}' AND status = 'pending';`);
	must(inv === '0', 'the STRANGER has no pending invitation either (mayReadClub would let one read)', inv);

	const schd = row(`SELECT row_to_json(t) FROM (SELECT id, "channelId", name, "venueName", lat, lng FROM club_schedule WHERE id = '${scheduleId}') t;`);
	must(!!schd && schd.channelId === CPRIV, 'the weekly slot belongs to the private club', schd);
	must(!!schd && schd.lat != null && schd.venueName != null, 'the slot carries the venue and its coordinates (what holes 6/7 are about)', schd && { venueName: schd.venueName, lat: schd.lat });
	const schdPub = row(`SELECT row_to_json(t) FROM (SELECT id, "channelId" FROM club_schedule WHERE id = '${schedulePubId}') t;`);
	must(!!schdPub && schdPub.channelId === CPUB, 'the public control club has a slot of its own', schdPub);

	const tg = row(`SELECT row_to_json(t) FROM (SELECT tag->>'id' AS id, tag->>'name' AS name, (SELECT count(*) FROM jsonb_object_keys(tag->'members')) AS members FROM club_setting s, jsonb_array_elements(s.tags) tag WHERE s."channelId" = '${CPRIV}' AND tag->>'id' = '${tagId}') t;`);
	must(!!tg && Number(tg.members) > 0, 'the tag has at least one member, so its count is a real audience fact (hole 8)', tg);

	const mt = row(`SELECT row_to_json(t) FROM (SELECT id, "channelId", visibility, status FROM meet WHERE id = '${publicMeetId}') t;`);
	must(!!mt && mt.channelId === CPRIV && mt.visibility === 'public', 'a PUBLIC meet sits inside the private club (the packer door, hole 10)', mt);

	const wr = row(`SELECT row_to_json(t) FROM (SELECT id, "authorId", "targetUserId", type, body FROM meet_review WHERE body = '${warningBody}') t;`);
	must(!!wr && wr.type === 'warning' && wr.authorId === ADMIN.id && wr.targetUserId === MEMBER.id, 'a real WARNING row exists, written by the admin persona about the member (hole 4)', wr);
	const er = row(`SELECT row_to_json(t) FROM (SELECT id, "authorId", "targetUserId", type FROM meet_review WHERE body = '${endorseBody}') t;`);
	must(!!er && er.type === 'endorsement', 'an ENDORSEMENT row exists too — attribution must SURVIVE the fix (control)', er);

	const neg = CHEM ? { ...CHEM.neg.outsider, edge: Math.round(CHEM.edges.neg * 1000) / 1000 } : null;
	const pos = CHEM ? { ...CHEM.pos.outsider, edge: Math.round(CHEM.edges.pos * 1000) / 1000 } : null;
	must(!!neg && neg.n >= 2 && neg.edge < 0, 'the NEGATIVE-chemistry pair: n >= 2 and negative THROUGH THE DOORS\' RULE (public, live, rated)', neg);
	must(!!pos && pos.n >= 2 && pos.edge > 0, 'the POSITIVE-chemistry pair: n >= 2 and positive through the same rule', pos);
	const sweepNeg = row(`SELECT row_to_json(t) FROM (SELECT count(*)::int n, sum(CASE WHEN won THEN 1 ELSE 0 END)::int w, sum(expected)::float e FROM gb_rating_log WHERE "userId"='${SWEEP_NEG[0]}' AND "partnerId"='${SWEEP_NEG[1]}' AND sport='pickleball' AND NOT skipped) t;`);
	const sweepUsable = !!sweepNeg && sweepNeg.n >= 2 && (sweepNeg.w - sweepNeg.e) < 0;
	log('INFO the sweep\'s own negative pair ' + (sweepUsable ? 'SURVIVED the nightly reset and is measured as well' : 'did NOT survive the nightly UAT reset — the planted pair carries hole 3') + ' — ' + JSON.stringify(sweepNeg));

	if (FAILS.length) {
		try { fs.writeFileSync(OUT + '.partial', JSON.stringify({ tag: TAG, chemMade: CHEM_MADE.map((m) => ({ meetId: m.meetId, host: m.host.slug })) })); } catch (e) { /* best effort */ }
		console.error('\nFIXTURE IS NOT REAL — ' + FAILS.length + ' precondition(s) failed. No fixture file written; the measurement would have been meaningless.');
		process.exit(4);
	}

	const F = {
		tag: TAG, at: new Date().toISOString(),
		cpriv: CPRIV, cpub: CPUB,
		owner: { slug: 'clubadmin-tom', id: OWNER.id },
		admin: { slug: 'host-ken', id: ADMIN.id },
		member: { slug: 'clubowner-mei', id: MEMBER.id },
		stranger: { slug: 'player-amy', id: STRANGER.id },
		staff: { slug: 'admin', id: STAFF.id },
		scheduleId, schedulePubId, tagId, publicMeetId,
		warnMeetId, fbMeetId, warningBody, endorseBody,
		refCode: priv.refCode, accessToken: priv.accessToken, pubRefCode: pub.refCode,
		negPair: [STRANGER.id, ADMIN.id], posPair: [MEMBER.id, OWNER.id],
		sweepNegPair: sweepUsable ? SWEEP_NEG : null,
		chem: CHEM ? { g: { g1: CHEM.g1, g2: CHEM.g2, g3: CHEM.g3, g4: CHEM.g4, g5: CHEM.g5, g6: CHEM.g6 }, unclearPair: CHEM.unclear.pair, made: CHEM.made.map((m) => ({ meetId: m.meetId, host: m.host.slug })), privPair: CHEM.priv.pair, negAE: CHEM.negAE.pair, pubEndorsement: CHEM.pubEndorsement, edges: CHEM.edges, readBack: { neg: CHEM.neg, pos: CHEM.pos, priv: CHEM.priv, negAE: CHEM.negAE, unclear: CHEM.unclear, ratingA: CHEM.ratingA }, ratingsBefore: CHEM.ratingsBefore } : null,
		preconditions: { priv, pub, members: mem, schedule: schd, tag: tg, meet: mt, warning: wr, endorsement: er, chem: { neg, pos, sweepNeg, sweepUsable } },
	};
	fs.writeFileSync(OUT, JSON.stringify(F, null, 1));
	log('\nFIXTURE REAL — all preconditions read back from the database. -> ' + OUT);
	// CLUB-PRIVATE-V1 caches the private-club map for 30 s in each engine process; the visibility was just changed.
	log('INFO waiting 35 s for ClubService.privateClubs() caches to expire in both engines');
	await L.sleep(35000);
	log('done');
}

main().catch((e) => { console.error('SETUP ERROR ' + (e && e.stack ? e.stack : e)); process.exit(1); });

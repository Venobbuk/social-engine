require('./_guard.cjs');   // G13.3: launched through probes/run.sh, which sweeps afterwards
// t3-competitions.probe.cjs — COMP-T3-V1 proof on LIVE UAT (uat.social.silkvo.com → web-uat → se_sbx), real SSO personas.
// Every built item is PERFORMED through its real registered door (endpoint-list.ts), READ BACK (API and, where it is a
// stored fact, the se_sbx row), and REFUSED for someone who should not have it. Fixtures are '[probe] ' named, owned by
// this run, cancelled + deleted in the finally; run.sh sweeps whatever is left.
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const L = require('./w1-b4-lib.cjs');

const checks = [];
const ck = (item, what, pass, ev) => { checks.push({ item, what, pass: !!pass, evidence: typeof ev === 'string' ? ev : JSON.stringify(ev) }); console.log((pass ? 'pass ' : 'FAIL ') + item + ' | ' + what + ' -> ' + (typeof ev === 'string' ? ev : JSON.stringify(ev)).slice(0, 260)); };
const code = (r) => (r && r.json && r.json.error && r.json.error.code) || null;
const esql = (q) => execFileSync('docker', ['exec', 'social-engine-db-1', 'psql', '-U', 'social', '-d', 'se_sbx', '-tA', '-F', '|', '-c', q]).toString().trim();
const q1 = (s) => String(s).replace(/'/g, "''");
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

async function upload(token, name) {
  const fd = new FormData();
  fd.append('i', token);
  fd.append('name', name);
  fd.append('file', new Blob([PNG], { type: 'image/png' }), name);
  const r = await fetch(L.BASE + '/api/drive/files/create', { method: 'POST', body: fd });
  let j = null; try { j = await r.json(); } catch (e) { /* */ }
  return { status: r.status, json: j };
}
async function notesOf(token) { const r = await L.se('i/notifications', { limit: 30 }, token); return JSON.stringify(r.json || []); }

(async () => {
  const made = []; const files = []; let follow = null;
  const S = {};
  try {
    for (const k of ['ken', 'amy', 'mei', 'tom', 'tester1', 'tester2', 'admin']) S[k] = await L.signIn(k);
    const ok = Object.values(S).every((s) => s.token && s.me && s.me.id);
    ck('setup.signin', 'seven personas signed in through the real UAT SSO', ok, Object.fromEntries(Object.entries(S).map(([k, s]) => [k, !!(s.me && s.me.id)])));
    if (!ok) throw new Error('sign-in failed');
    const { ken, amy, mei, tom, tester1, tester2, admin } = S;
    const id = (s) => s.me.id;
    const hhmm = new Date().toISOString().slice(11, 16).replace(':', '');
    const day = 86400e3, now = Date.now();
    const base = { format: 'roundRobin', participantType: 'doubles', maxEntries: 8, visibility: 'public', autoApprove: true, sport: 'pickleball' };

    // ---- D-comp-create.08 timeline ordering (engine refuses out-of-order; the right order saves)
    const badTl = await L.se('competitions/create', { ...base, name: '[probe] T3 timeline ' + hhmm, startAt: new Date(now + 3 * day).toISOString(), registrationOpenAt: new Date(now + 1 * day).toISOString(), registrationCloseAt: new Date(now + 5 * day).toISOString() }, ken.token);
    ck('D-comp-create.08.refuse', 'registration deadline after the start is refused (COMPETITION_BAD_TIMELINE)', badTl.status === 400 && code(badTl) === 'COMPETITION_BAD_TIMELINE', { status: badTl.status, code: code(badTl), msg: badTl.json && badTl.json.error && badTl.json.error.message });

    // ---- a public doubles round robin carrying the new fields (D-match-format.02/.06/.14, D-comp-sublocations.01, D-comp-create.13)
    // D-comp-confirm-publish.02: amy follows ken first, so ken's publish must reach her
    const fl = await L.se('following/create', { userId: id(ken) }, amy.token);
    follow = fl.status === 200 || code(fl) === 'ALREADY_FOLLOWING' ? (fl.status === 200 ? 'made' : 'existed') : null;
    const cr = await L.se('competitions/create', { ...base, name: '[probe] T3 main ' + hhmm, startAt: new Date(now + 3 * day).toISOString(), registrationOpenAt: new Date(now - day).toISOString(), earlyBirdAt: new Date(now + day).toISOString(), registrationCloseAt: new Date(now + 2 * day).toISOString(),
      roundRobinCycles: 2, courtLabels: ['Centre', ' Court B '], stageNames: { regular: 'Group stage', playoff: 'Knockouts' }, matchRules: 'Rally to 11, win by 2.', feeType: 'perEntry', feeAmount: 200, feeFreeAgentAmount: 100, feeFreeAgentEarlyBirdAmount: 80 }, ken.token);
    const cid = cr.json && cr.json.id; if (cid) made.push(cid);
    ck('setup.create', 'host creates a [probe] public doubles round robin with the new fields', !!cid && cr.status === 200, { status: cr.status, code: code(cr) });
    if (!cid) throw new Error('create failed');
    const row = esql(`select "roundRobinCycles", array_to_string("courtLabels", ','), "stageNames"::text, "matchRules", "feeFreeAgentAmount", "feeFreeAgentEarlyBirdAmount" from competition where id='${cid}'`).split('|');
    ck('D-match-format.02.stored', 'double round robin stored (roundRobinCycles=2, se_sbx row)', row[0] === '2', { row0: row[0] });
    ck('D-comp-sublocations.01.stored', 'court labels stored trimmed', row[1] === 'Centre,Court B', { labels: row[1] });
    ck('D-match-format.06.stored', 'stage names stored', /Group stage/.test(row[2]) && /Knockouts/.test(row[2]), { stageNames: row[2] });
    ck('D-match-format.14.stored', 'match rules stored', row[3] === 'Rally to 11, win by 2.', { matchRules: row[3] });
    ck('D-comp-create.13.stored', 'free-agent fee + early bird stored', row[4] === '100' && row[5] === '80', { fa: row[4], faEb: row[5] });
    const shown = (await L.se('competitions/show', { competitionId: cid }, tester1.token)).json || {};
    ck('t3.pack', 'competitions/show carries the batch (t3 marker + fields) to a stranger', shown.t3 === 1 && shown.roundRobinCycles === 2 && (shown.courtLabels || []).length === 2 && shown.matchRules && shown.feeFreeAgentAmount === 100, { t3: shown.t3, cycles: shown.roundRobinCycles, labels: shown.courtLabels });
    const upTl = await L.se('competitions/update', { competitionId: cid, registrationOpenAt: new Date(now + 4 * day).toISOString() }, ken.token);
    ck('D-comp-create.08.update', 'an update that puts registration open after the start is refused', code(upTl) === 'COMPETITION_BAD_TIMELINE', { status: upTl.status, code: code(upTl) });

    await L.se('competitions/status', { competitionId: cid, action: 'publish' }, ken.token);
    await L.sleep(1500);
    const amyN = await notesOf(amy.token);
    ck('D-comp-confirm-publish.02', 'publishing a public competition notified the host\'s follower (amy: "New competition")', follow && amyN.includes('New competition') && amyN.includes('[probe] T3 main ' + hhmm), { follow, found: amyN.includes('[probe] T3 main ' + hhmm) });

    // ---- spectators (D-comp-join.05 family)
    const chatBefore = await L.se('competitions/chat', { competitionId: cid }, tester2.token);
    const sp = await L.se('competitions/spectate', { competitionId: cid }, tester2.token);
    const spEnt = ((await L.se('competitions/entries', { competitionId: cid }, ken.token)).json || []).filter((e) => e.status === 'spectator');
    const chatAfter = await L.se('competitions/chat', { competitionId: cid }, tester2.token);
    ck('D-comp-join.05', 'join as a spectator: mySpectator set, spectatorsCount 1, a spectator row holding no seat', sp.status === 200 && sp.json.mySpectator && sp.json.spectatorsCount === 1 && sp.json.spotsLeft === 8 && spEnt.length === 1, { status: sp.status, mySpectator: sp.json && sp.json.mySpectator, count: sp.json && sp.json.spectatorsCount, spotsLeft: sp.json && sp.json.spotsLeft });
    ck('D-comp-join.05.chat', 'a spectator opens the general chat; before spectating it was refused', chatBefore.status !== 200 && chatAfter.status === 200 && chatAfter.json.roomId, { before: code(chatBefore), after: chatAfter.status });
    const annSp = await L.se('competitions/announcements/post', { competitionId: cid, text: '[probe] spectators hear this ' + hhmm }, ken.token);
    await L.sleep(1200);
    ck('D-comp-detail.38.announce', 'an announcement reaches the spectator', annSp.status === 200 && (await notesOf(tester2.token)).includes('spectators hear this ' + hhmm), { status: annSp.status });
    const spLeave = await L.se('competitions/spectate', { competitionId: cid, leave: true }, tester2.token);
    ck('D-comp-detail.66.leave', 'the spectator cancels (leave) — mySpectator null, count 0', spLeave.status === 200 && !spLeave.json.mySpectator && spLeave.json.spectatorsCount === 0, { mySpectator: spLeave.json && spLeave.json.mySpectator, count: spLeave.json && spLeave.json.spectatorsCount });

    // ---- teams: amy + mei, tom + admin (partners accept)
    await L.se('competitions/enter', { competitionId: cid, name: '[probe] Team A', partnerIds: [id(mei)] }, amy.token);
    await L.se('competitions/enter', { competitionId: cid, name: '[probe] Team B', partnerIds: [id(admin)] }, tom.token);
    let ents = (await L.se('competitions/entries', { competitionId: cid }, ken.token)).json || [];
    const A = ents.find((e) => e.captainId === id(amy)), B = ents.find((e) => e.captainId === id(tom));
    await L.se('competitions/invitations/respond', { competitionId: cid, entryId: A.id, accept: true }, mei.token);
    await L.se('competitions/invitations/respond', { competitionId: cid, entryId: B.id, accept: true }, admin.token);

    // ---- D-comp-team-detail.06 leave team (member) ≠ withdraw the team
    const lv = await L.se('competitions/withdraw', { competitionId: cid }, mei.token);
    const aAfter = esql(`select status, array_to_string("userIds", ',') from competition_entry where id='${A.id}'`).split('|');
    ck('D-comp-team-detail.06', 'a non-captain member leaves the TEAM: the team stays confirmed, mei is out (se_sbx row)', lv.status === 200 && aAfter[0] === 'confirmed' && aAfter[1] === id(amy), { status: lv.status, row: aAfter });
    await L.sleep(1000);
    ck('D-comp-team-detail.06.notify', 'the captain heard it ("Player left your team")', (await notesOf(amy.token)).includes('Player left your team'), {});
    await L.se('competitions/entries/partners', { competitionId: cid, entryId: A.id, invite: [id(mei)] }, amy.token);
    await L.se('competitions/invitations/respond', { competitionId: cid, entryId: A.id, accept: true }, mei.token);

    // ---- D-comp-upsert-team.02/.03/.06 the captain edits the team (name, description, avatar)
    const up = await upload(amy.token, 'probe-t3-avatar.png'); if (up.json && up.json.id) files.push({ id: up.json.id, token: amy.token });
    const upKen = await upload(ken.token, 'probe-t3-ken.png'); if (upKen.json && upKen.json.id) files.push({ id: upKen.json.id, token: ken.token });
    const ed = await L.se('competitions/entries/edit', { competitionId: cid, entryId: A.id, name: '[probe] Team Alpha', notes: 'We play fast.', avatarFileId: up.json && up.json.id }, amy.token);
    const edRow = esql(`select name, notes, "avatarFileId" from competition_entry where id='${A.id}'`).split('|');
    ck('D-comp-upsert-team.06', 'the captain renames the team + writes its description (se_sbx row)', ed.status === 200 && edRow[0] === '[probe] Team Alpha' && edRow[1] === 'We play fast.', { status: ed.status, row: edRow.slice(0, 2) });
    ck('D-comp-upsert-team.02', 'the team avatar is the captain\'s uploaded image; packEntry carries avatarUrl', ed.json && ed.json.avatarUrl && edRow[2] === (up.json && up.json.id), { avatarUrl: !!(ed.json && ed.json.avatarUrl), fileId: edRow[2] });
    const edBad = await L.se('competitions/entries/edit', { competitionId: cid, entryId: A.id, avatarFileId: upKen.json && upKen.json.id }, amy.token);
    ck('D-comp-upsert-team.02.refuse', 'someone else\'s drive file is refused (NO_SUCH_FILE)', code(edBad) === 'NO_SUCH_FILE', { code: code(edBad) });
    const edTom = await L.se('competitions/entries/edit', { competitionId: cid, entryId: A.id, name: 'hijack' }, tom.token);
    ck('D-comp-upsert-team.03.refuse', 'a player of another team cannot edit it (COMPETITION_FORBIDDEN)', code(edTom) === 'COMPETITION_FORBIDDEN', { code: code(edTom) });

    // ---- eligibility (D-comp-detail.36/.42/.43): a cap of 2.0 flags; the host's call wins; reasons for the team only
    await L.se('competitions/update', { competitionId: cid, maxLevel: 2.0 }, ken.token);
    const eHost = ((await L.se('competitions/entries', { competitionId: cid }, ken.token)).json || []).find((e) => e.id === A.id) || {};
    const eStr = ((await L.se('competitions/entries', { competitionId: cid }, tester1.token)).json || []).find((e) => e.id === A.id) || {};
    ck('D-comp-detail.36.auto', 'with a 2.0 cap the automatic rule flags members (no rating / above the cap) — reasons to the host', (eHost.ineligibleUserIds || []).length > 0 && Object.keys(eHost.eligibilityReasons || {}).length > 0, { ineligible: eHost.ineligibleUserIds, reasons: eHost.eligibilityReasons });
    ck('D-comp-detail.36.private', 'a stranger sees the tag but not the reasons', (eStr.ineligibleUserIds || []).length === (eHost.ineligibleUserIds || []).length && !Object.keys(eStr.eligibilityReasons || {}).length, { strangerReasons: eStr.eligibilityReasons });
    const flagged = (eHost.ineligibleUserIds || [])[0];
    const ov = await L.se('competitions/entries/update', { competitionId: cid, entryId: A.id, eligibleUserId: flagged, eligible: true }, ken.token);
    const ovRow = esql(`select eligibility::text from competition_entry where id='${A.id}'`);
    ck('D-comp-detail.43.eligible', 'the host marks the member eligible: the override is stored and the tag clears', ov.status === 200 && !(ov.json.ineligibleUserIds || []).includes(flagged) && ovRow.includes(flagged), { status: ov.status, row: ovRow });
    const ovNo = await L.se('competitions/entries/update', { competitionId: cid, entryId: A.id, eligibleUserId: id(amy), eligible: false }, ken.token);
    await L.sleep(1000);
    ck('D-comp-detail.42', 'marked ineligible: tagged, and the player is told ("Marked ineligible")', ovNo.status === 200 && (ovNo.json.ineligibleUserIds || []).includes(id(amy)) && (await notesOf(amy.token)).includes('Marked ineligible'), { tagged: (ovNo.json.ineligibleUserIds || []).includes(id(amy)) });
    const ovTom = await L.se('competitions/entries/update', { competitionId: cid, entryId: A.id, eligibleUserId: id(amy), eligible: true }, tom.token);
    ck('D-comp-detail.43.refuse', 'a player cannot set eligibility (COMPETITION_NOT_HOST)', code(ovTom) === 'COMPETITION_NOT_HOST', { code: code(ovTom) });
    await L.se('competitions/entries/update', { competitionId: cid, entryId: A.id, eligibleUserId: id(amy), eligible: null }, ken.token);
    await L.se('competitions/update', { competitionId: cid, maxLevel: null }, ken.token);

    // ---- draw: double round robin (D-match-format.02)
    await L.se('competitions/status', { competitionId: cid, action: 'start' }, ken.token);
    let ms = (await L.se('competitions/matches/list', { competitionId: cid }, ken.token)).json || [];
    const reg = ms.filter((m) => m.stage === 'regular');
    ck('D-match-format.02', 'double round robin: 2 teams meet twice, sides swapped, round 2 after round 1', reg.length === 2 && reg[0].entry1Id === reg[1].entry2Id && reg[0].entry2Id === reg[1].entry1Id && reg[1].round === reg[0].round + 1, { n: reg.length, rounds: reg.map((m) => m.round), sides: reg.map((m) => [m.entry1Id === A.id ? 'A' : 'B', m.entry2Id === A.id ? 'A' : 'B']) });
    const m1 = reg[0], m2 = reg[1];
    // family fix (ApiCallService headerSafe): an existing refusal whose message carries an em dash answers 400, not 500
    const dx = await L.se('competitions/update', { competitionId: cid, roundRobinCycles: 3 }, ken.token);
    ck('family.header-safe', 'a refusal with a non-ASCII message ("The draw is generated — reset…") is a 400 with its code, not a 500', dx.status === 400 && code(dx) === 'COMPETITION_DRAW_EXISTS' && /—/.test((dx.json && dx.json.error && dx.json.error.message) || ''), { status: dx.status, code: code(dx) });

    // ---- per-match referee (D-comp-match-manage.03 / D-comp-detail.63 / .46)
    const rf = await L.se('competitions/matches/upsert', { competitionId: cid, matchId: m1.id, refereeIds: [id(tester1)] }, ken.token);
    const rfRow = esql(`select array_to_string("refereeIds", ',') from competition_match where id='${m1.id}'`);
    ck('D-comp-match-manage.03', 'the host assigns a referee to one match (se_sbx row) and it is packed (isMyRef for them)', rf.status === 200 && rfRow === id(tester1), { status: rf.status, row: rfRow });
    const rfTom = await L.se('competitions/matches/upsert', { competitionId: cid, matchId: m1.id, refereeIds: [id(tom)] }, tom.token);
    ck('D-comp-match-manage.03.refuse', 'a player of the match cannot assign referees (COMPETITION_NOT_HOST)', code(rfTom) === 'COMPETITION_NOT_HOST', { code: code(rfTom) });
    const asRef = (await L.se('competitions/matches/list', { competitionId: cid }, tester1.token)).json || [];
    const m1r = asRef.find((m) => m.id === m1.id) || {};
    ck('D-comp-detail.63', 'the match referee reads isMyRef and canScore on that match only', m1r.isMyRef === true && m1r.canScore === true && !(asRef.find((m) => m.id === m2.id) || {}).canScore, { isMyRef: m1r.isMyRef, canScore: m1r.canScore });
    const sc = await L.se('competitions/matches/upsert', { competitionId: cid, matchId: m1.id, scores: [{ t1: 11, t2: 7, type: 'standard', name: 'Opener' }, { t1: 9, t2: 11 }, { t1: 5, t2: 3, type: 'tiebreaker', name: 'Decider' }] }, tester1.token);
    const scRow = esql(`select status, scores::text from competition_match where id='${m1.id}'`).split('|');
    ck('D-comp-detail.46.ref-official', 'the match referee\'s score is official (completed) and keeps set names + the tiebreaker type', sc.status === 200 && scRow[0] === 'completed' && /Opener/.test(scRow[1]) && /tiebreaker/.test(scRow[1]), { status: sc.status, row: scRow });

    // ---- availability (D-comp-availability.01 / D-comp-match-detail.04 / .07)
    const av = await L.se('competitions/matches/availability', { competitionId: cid, matchId: m2.id, status: 'maybe' }, mei.token);
    const avHost = await L.se('competitions/matches/availability', { competitionId: cid, matchId: m2.id, userId: id(tom), status: 'no' }, ken.token);
    const avRow = esql(`select availability::text from competition_match where id='${m2.id}'`);
    ck('D-comp-availability.01', 'a player sets their own availability; the host sets it for a player (se_sbx row)', av.status === 200 && avHost.status === 200 && avRow.includes(id(mei)) && avRow.includes('"maybe"') && avRow.includes(id(tom)) && avRow.includes('"no"'), { row: avRow });
    const avBad = await L.se('competitions/matches/availability', { competitionId: cid, matchId: m2.id, userId: id(tom), status: 'yes' }, mei.token);
    ck('D-comp-availability.01.refuse', 'a player cannot set another team\'s player (COMPETITION_FORBIDDEN)', code(avBad) === 'COMPETITION_FORBIDDEN', { code: code(avBad) });
    const avStr = ((await L.se('competitions/matches/list', { competitionId: cid }, tester2.token)).json || []).find((m) => m.id === m2.id) || {};
    ck('D-comp-match-detail.04.private', 'a stranger reads no availability; the players pane is for the match\'s people', Object.keys(avStr.availability || {}).length === 0, { strangerAvail: avStr.availability });

    // ---- extra match + remove / restore (D-comp-add-match.01, D-comp-detail.48, D-comp-match-detail.02)
    const ex = await L.se('competitions/matches/upsert', { competitionId: cid, entry1Id: A.id, entry2Id: B.id }, ken.token);
    const exId = ex.json && ex.json.id;
    ck('D-comp-add-match.01', 'the host adds an extra match (isExtra)', ex.status === 200 && ex.json.isExtra === true, { status: ex.status });
    const rm = await L.se('competitions/matches/upsert', { competitionId: cid, matchId: exId, remove: true }, ken.token);
    const rmTom = await L.se('competitions/matches/upsert', { competitionId: cid, matchId: m2.id, remove: true }, tom.token);
    const rmRow = esql(`select status from competition_match where id='${exId}'`);
    ck('D-comp-match-detail.02.remove', 'Remove match sets it aside (cancelled, se_sbx); a player asking is refused', rm.status === 200 && rmRow === 'cancelled' && code(rmTom) === 'COMPETITION_NOT_HOST', { row: rmRow, player: code(rmTom) });
    const rs = await L.se('competitions/matches/upsert', { competitionId: cid, matchId: exId, restore: true }, ken.token);
    ck('D-comp-match-detail.02.restore', 'Unremove puts it back (pending)', rs.status === 200 && esql(`select status from competition_match where id='${exId}'`) === 'pending', { status: rs.status });

    // ---- photos (D-comp-detail.60): an image in the competition chat is on the Media pane, for the audience
    const room = (await L.se('competitions/chat', { competitionId: cid }, amy.token)).json || {};
    const pic = await upload(amy.token, 'probe-t3-photo.png'); if (pic.json && pic.json.id) files.push({ id: pic.json.id, token: amy.token });
    const post = await L.se('chat/messages/create-to-room', { toRoomId: room.roomId, fileId: pic.json && pic.json.id }, amy.token);
    const photosAnon = await L.se('competitions/photos/list', { competitionId: cid });
    ck('D-comp-detail.60', 'a photo posted in the competition chat is on its Media pane, readable anonymously for a public competition', post.status === 200 && photosAnon.status === 200 && (photosAnon.json || []).some((p) => p.fileId === (pic.json && pic.json.id)), { post: post.status, n: (photosAnon.json || []).length });

    // ---- cancel with a message (D-comp-confirm-cancel.02/.03)
    const cx = await L.se('competitions/cancel', { competitionId: cid, message: '[probe] rain, sorry ' + hhmm }, ken.token);
    await L.sleep(1200);
    const annRow = esql(`select announcements::text from competition where id='${cid}'`);
    ck('D-comp-confirm-cancel.03', 'the cancellation message rides on the notice and stays as an announcement', cx.status === 200 && annRow.includes('rain, sorry ' + hhmm) && (await notesOf(mei.token)).includes('rain, sorry ' + hhmm), { status: cx.status });

    // ---- private: photos refused to a stranger (the competition audience gate)
    const pv = await L.se('competitions/create', { ...base, name: '[probe] T3 private ' + hhmm, visibility: 'private', startAt: new Date(now + 3 * day).toISOString() }, ken.token);
    const pid = pv.json && pv.json.id; if (pid) made.push(pid);
    const pvPh = await L.se('competitions/photos/list', { competitionId: pid }, tester1.token);
    ck('D-comp-detail.60.private', 'a private competition\'s photos are refused to a stranger (COMPETITION_PRIVATE)', code(pvPh) === 'COMPETITION_PRIVATE', { code: code(pvPh) });

    // ---- manual playoff seeding (D-comp-manage-seeds.01/.02/.03, D-comp-detail.52): singles single elimination, 4 players
    const se = await L.se('competitions/create', { ...base, name: '[probe] T3 seeds ' + hhmm, participantType: 'singles', format: 'singleElim', thirdPlaceMatch: false, startAt: new Date(now + 3 * day).toISOString() }, ken.token);
    const sid = se.json && se.json.id; if (sid) made.push(sid);
    await L.se('competitions/status', { competitionId: sid, action: 'publish' }, ken.token);
    const E = {};
    for (const k of ['amy', 'mei', 'tom', 'admin']) E[k] = ((await L.se('competitions/entries/update', { competitionId: sid, userIds: [id(S[k])] }, ken.token)).json || {}).id;
    // the pairs a 4-seed bracket makes from an order (inner-outer 1v4 2v3, or natural 1v2 3v4 — whichever the library uses);
    // the host's order must produce its own pairs, and they differ from the sign-up order's pairs
    const pairsOf = (o, inner) => (inner ? [[o[0], o[3]], [o[1], o[2]]] : [[o[0], o[1]], [o[2], o[3]]]).map((p) => p.slice().sort().join('+')).sort();
    const order1 = [E.amy, E.tom, E.admin, E.mei];
    const signup = [E.amy, E.mei, E.tom, E.admin];
    const d1 = await L.se('competitions/draw', { competitionId: sid, stage: 'playoff', seedOrder: order1 }, ken.token);
    const r1 = ((d1.json && d1.json.matches) || []).filter((m) => m.round === 1).map((m) => [m.entry1Id, m.entry2Id].sort().join('+')).sort();
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const inner = same(r1, pairsOf(order1, true)), natural = same(r1, pairsOf(order1, false));
    const wasDefault = same(r1, pairsOf(signup, inner || !natural));
    ck('D-comp-manage-seeds.02', 'the host\'s seed order draws the bracket (its own first-round pairs, not the sign-up order\'s) and marks manual seeding', d1.status === 200 && (inner || natural) && !wasDefault && esql(`select "manualSeeding" from competition where id='${sid}'`) === 't', { status: d1.status, layout: inner ? 'inner_outer' : natural ? 'natural' : 'neither', wasDefault });
    const dq = await L.se('competitions/draw', { competitionId: sid, stage: 'playoff', resetPlayoff: true, seedOrder: [E.amy, E.mei, E.tom] }, ken.token);
    const nIn = new Set(((dq.json && dq.json.matches) || []).flatMap((m) => [m.entry1Id, m.entry2Id]).filter(Boolean));
    ck('D-comp-manage-seeds.03', 'Update seeds re-arranges the bracket; a disqualified entry (admin) is out', dq.status === 200 && !nIn.has(E.admin) && nIn.has(E.amy), { status: dq.status, admin_in: nIn.has(E.admin) });
    const dBad = await L.se('competitions/draw', { competitionId: sid, stage: 'playoff', resetPlayoff: true, seedOrder: [E.amy, A.id] }, ken.token);
    const koAfterBad = ((await L.se('competitions/matches/list', { competitionId: sid }, ken.token)).json || []).filter((m) => m.stage === 'playoff').length;
    ck('D-comp-manage-seeds.02.refuse', 'a seed that is not a confirmed entry of THIS competition is refused (NO_SUCH_ENTRY) and the refused order does not cost the bracket', code(dBad) === 'NO_SUCH_ENTRY' && koAfterBad > 0, { status: dBad.status, code: code(dBad), playoffMatchesAfter: koAfterBad });
    const dTom = await L.se('competitions/draw', { competitionId: sid, stage: 'playoff', resetPlayoff: true, seedOrder: [E.tom, E.amy] }, tom.token);
    ck('D-comp-manage-seeds.01.refuse', 'a player cannot reseed (COMPETITION_NOT_HOST)', code(dTom) === 'COMPETITION_NOT_HOST', { code: code(dTom) });
    await L.se('competitions/status', { competitionId: sid, action: 'start' }, ken.token);
    const kms = (await L.se('competitions/matches/list', { competitionId: sid }, ken.token)).json || [];
    const playable = kms.find((m) => m.entry1Id && m.entry2Id && m.entry1Status !== 'bye' && m.entry2Status !== 'bye');
    await L.se('competitions/matches/upsert', { competitionId: sid, matchId: playable.id, scores: [{ t1: 11, t2: 4 }] }, ken.token);
    const dLock = await L.se('competitions/draw', { competitionId: sid, stage: 'playoff', resetPlayoff: true, seedOrder: [E.mei, E.amy, E.tom] }, ken.token);
    ck('D-comp-manage-seeds.01.lock', '"Seeds cannot be changed after playoff matches have already started."', code(dLock) === 'COMPETITION_BRACKET_LOCKED', { code: code(dLock) });

    // ---- delete (D-comp-detail.08)
    const dPeople = await L.se('competitions/delete', { competitionId: sid }, ken.token);
    ck('D-comp-detail.08.refuse-people', 'a competition with people in it cannot be deleted (cancel first)', code(dPeople) === 'COMPETITION_CANNOT_DELETE', { code: code(dPeople) });
    const dStranger = await L.se('competitions/delete', { competitionId: pid }, tom.token);
    ck('D-comp-detail.08.refuse-owner', 'only the owner deletes', code(dStranger) === 'COMPETITION_NOT_HOST', { code: code(dStranger) });
    const del = await L.se('competitions/delete', { competitionId: pid }, ken.token);
    const gone = await L.se('competitions/show', { competitionId: pid }, ken.token);
    ck('D-comp-detail.08', 'the owner deletes an empty competition: show answers NO_SUCH_COMPETITION, the row is gone', del.status === 200 && del.json.deleted === true && code(gone) === 'NO_SUCH_COMPETITION' && esql(`select count(*) from competition where id='${pid}'`) === '0', { del: del.status, show: code(gone) });
    made.splice(made.indexOf(pid), 1);

    // ---- club members only (D-comp-detail.65)
    const club = esql(`select c.id from channel c where c."userId"='${id(mei)}' and c."isArchived"=false order by c.id limit 1`);
    if (club) {
      const tomMember = esql(`select count(*) from club_member where "channelId"='${club}' and "userId"='${id(tom)}'`) !== '0';
      const t2Member = esql(`select count(*) from club_member where "channelId"='${club}' and "userId"='${id(tester2)}'`) !== '0';
      const mo = await L.se('competitions/create', { ...base, participantType: 'singles', name: '[probe] T3 members ' + hhmm, channelId: club, membersOnly: true, startAt: new Date(now + 3 * day).toISOString(), publish: true }, mei.token);
      const moId = mo.json && mo.json.id; if (moId) made.push(moId);
      const out = await L.se('competitions/enter', { competitionId: moId }, tester2.token);
      ck('D-comp-detail.65.refuse', 'a non-member cannot enter a members-only club competition (COMPETITION_MEMBERS_ONLY)', !t2Member && code(out) === 'COMPETITION_MEMBERS_ONLY', { t2Member, code: code(out) });
      if (tomMember) {
        const inn = await L.se('competitions/enter', { competitionId: moId }, tom.token);
        ck('D-comp-detail.65', 'a club member enters it', inn.status === 200, { status: inn.status, code: code(inn) });
      } else {
        await L.se('competitions/update', { competitionId: moId, membersOnly: false }, mei.token);
        const inn = await L.se('competitions/enter', { competitionId: moId }, tester2.token);
        ck('D-comp-detail.65', 'no member persona in the club: switching membersOnly off admits the same player (the gate is the switch)', inn.status === 200, { status: inn.status, code: code(inn) });
      }
      const sh = (await L.se('competitions/show', { competitionId: moId }, tester2.token)).json || {};
      ck('D-comp-detail.65.pack', 'show carries membersOnly + mayJoinMembersOnly for the reader', sh.membersOnly !== undefined && sh.mayJoinMembersOnly !== undefined, { membersOnly: sh.membersOnly, may: sh.mayJoinMembersOnly });
    } else ck('D-comp-detail.65', 'mei owns a club to test with', false, 'no club found for mei');
  } catch (e) {
    ck('run', 'probe ran to the end', false, String((e && e.stack) || e).slice(0, 500));
  } finally {
    try {
      const ken = S.ken;
      for (const cid of made) {
        const host = esql(`select "hostId" from competition where id='${q1(cid)}'`);
        const who = Object.values(S).find((s) => s.me && s.me.id === host) || ken;
        await L.se('competitions/cancel', { competitionId: cid }, who.token);
        const d = await L.se('competitions/delete', { competitionId: cid }, who.token);
        console.log('cleanup: competition', cid, 'delete', d.status);
      }
      for (const f of files) { const d = await L.se('drive/files/delete', { fileId: f.id }, f.token); console.log('cleanup: file', f.id, d.status); }
      if (follow === 'made') { const u = await L.se('following/delete', { userId: S.ken.me.id }, S.amy.token); console.log('cleanup: unfollow', u.status); }
    } catch (e) { console.log('cleanup error', String(e.message)); }
  }
  const v = L.verdict('t3-competitions.probe', checks, {});
  fs.writeFileSync(__dirname + '/t3-competitions.probe.verdict.json', JSON.stringify(v, null, 2));
  console.log('VERDICT', v.verdict, 'fails', v.fails, 'of', checks.length);
  process.exit(v.fails ? 1 : 0);
})();

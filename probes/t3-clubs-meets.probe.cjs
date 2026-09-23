require('./_guard.cjs');   // G13.3: probes run through probes/run.sh, which sweeps afterwards
// T3-CLUBS-MEETS probe (lane t3-clubs-meets, 2026-09-23) — the ENGINE half of the Reclub T3 tail (clubs / meet host tools /
// meet form), on the DEPLOYED UAT engine, as the UAT personas. Every door is asked by its REAL registered name
// (endpoint-list.ts: meets/delete, meets/chat-refresh, meets/join, meets/show, meets/participants/update,
// clubs/invitations/mine, clubs/polls/voters, channels/create, channels/update) and every "yes" has its "no":
//   D  meets/delete: a stranger is refused; an empty meet is deleted and meets/show then says NO_SUCH_MEET, its room gone;
//      a meet with a player → MEET_HAS_PARTICIPANTS; a meet with a match → MEET_HAS_MATCHES
//   R  meets/chat-refresh: a confirmed player who left the room is put back (members list read back); a player is refused
//   P  "Request +1" after confirming: the guest row exists (read back); a second one → MEET_GUEST_LIMIT
//   B  hostBlockedMe: true for the blocked viewer, false for another (planted: unblocked → false again)
//   C  Can't go: a declined invitee is on meets/show as 'declined' and the seat counter did not move
//   F  forceSkill: the host sets it and reads it back; a player may not
//   N  channels/create "[probe] GripBat …" → CLUB_NAME_RESERVED; a plain "[probe] …" name passes; a rename into it is refused
//   I  clubs/invitations/mine: the invited player sees the club; another player does not; after cancel it is gone
//   V  clubs/polls/voters: a member sees the voters of a club poll; a non-member → CLUB_NOT_MEMBER; a public poll → CLUB_NO_SUCH_NOTE
// Everything created is "[probe] "-named and removed in finally. Verdict → probes/t3-clubs-meets.api.json
'use strict';
const fs = require('fs');
const BASE = process.env.BASE || 'https://uat.social.silkvo.com';
const QA_P = process.env.QA_P || (fs.readFileSync('/root/hkpl-server/.env', 'utf8').match(/^QA_BYPASS_PASSWORD=(.+)$/m) || [])[1] || 'hkpl-uat-2026';
const PERSONAS = JSON.parse(fs.readFileSync('/root/uat-personas.json', 'utf8')).personas;
const P = (slug) => PERSONAS.find((p) => p.slug === slug);
const checks = []; const ok = (n, p, d) => { checks.push({ name: n, pass: !!p, detail: d }); console.log((p ? 'PASS ' : 'FAIL ') + n + ' — ' + JSON.stringify(d).slice(0, 300)); };
const cleanup = [];

async function session(email) {
  const r = await fetch(BASE + '/api/v1/auth/qa/by-email/' + encodeURIComponent(email) + '?p=' + encodeURIComponent(QA_P), { redirect: 'manual' });
  const raw = (r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie')].filter(Boolean)).map((c) => c.split(';')[0]);
  if (r.status !== 302 || !raw.length) throw new Error('qa/by-email ' + email + ' → ' + r.status);
  return raw.map((c) => { const i = c.indexOf('='); return { name: c.slice(0, i), value: c.slice(i + 1) }; });
}
async function se(endpoint, body, token) {
  const r = await fetch(BASE + '/api/' + endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(token ? { ...body, i: token } : body) });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch (e) { /* 204 */ }
  return { status: r.status, json, text };
}
async function login(slug) {
  const cookies = await session(P(slug).email);
  const m = await (await fetch(BASE + '/api/v1/auth/sso/social', { headers: { cookie: cookies.map((c) => c.name + '=' + c.value).join('; ') } })).json();
  const r = await se('adapter/sso', { jwt: m.jwt });
  if (!r.json || !r.json.token) throw new Error('adapter/sso ' + slug + ': ' + r.status);
  const me = await se('i', {}, r.json.token);
  return { token: r.json.token, id: me.json && me.json.id, slug };
}
const code = (r) => r && r.json && r.json.error ? r.json.error.code : null;
const inHours = (h) => new Date(Date.now() + h * 3600e3).toISOString();
async function newMeet(host, extra) {
  const r = await se('meets/create', { name: '[probe] t3 ' + extra.tag + ' ' + Date.now().toString(36), sport: 'pickleball', startAt: inHours(extra.h || 30), durationMinutes: 60, capacity: 6, hostPlays: true, autoApprove: true, allowPlusOne: !!extra.plus, visibility: 'public', feeType: 'free', sendNotifications: false }, host.token);
  if (!r.json || !r.json.id) throw new Error('meets/create ' + extra.tag + ': ' + r.status + ' ' + r.text.slice(0, 200));
  cleanup.push(async () => { await se('meets/cancel', { meetId: r.json.id }, host.token); });
  return r.json;
}
const show = (id, who) => se('meets/show', { meetId: id }, who.token).then((r) => r.json);

(async () => {
  const ken = await login('host-ken'); const tom = await login('clubadmin-tom'); const mei = await login('clubowner-mei'); const amy = await login('player-amy');
  try {
    // ---------------- D: meets/delete
    const A = await newMeet(ken, { tag: 'delete-empty' });
    const Ashow = await show(A.id, ken);
    const dStr = await se('meets/delete', { meetId: A.id }, tom.token);
    ok('D1 a stranger cannot delete someone else\'s meet (MEET_NOT_HOST)', code(dStr) === 'MEET_NOT_HOST', { status: dStr.status, code: code(dStr) });
    const dA = await se('meets/delete', { meetId: A.id }, ken.token);
    ok('D2 the host deletes an empty meet → {deleted:true}', dA.status === 200 && dA.json && dA.json.deleted === true, { status: dA.status, body: dA.json });
    const gone = await se('meets/show', { meetId: A.id }, ken.token);
    ok('D3 read back: meets/show of the deleted meet → NO_SUCH_MEET (L6)', code(gone) === 'NO_SUCH_MEET', { status: gone.status, code: code(gone) });
    if (Ashow && Ashow.chatRoomId) { const room = await se('chat/rooms/show', { roomId: Ashow.chatRoomId }, ken.token); ok('D4 its native chat room is gone too', room.status !== 200, { status: room.status, code: code(room) }); }
    const B = await newMeet(ken, { tag: 'delete-roster' });
    await se('meets/join', { meetId: B.id }, tom.token);
    const dB = await se('meets/delete', { meetId: B.id }, ken.token);
    ok('D5 a meet with a player on it → MEET_HAS_PARTICIPANTS (cancel instead)', code(dB) === 'MEET_HAS_PARTICIPANTS', { status: dB.status, code: code(dB) });
    const Bstill = await show(B.id, ken);
    ok('D6 …and it still exists with its player (nothing half-deleted)', Bstill && Bstill.id === B.id && (Bstill.participants || []).some((p) => p.userId === tom.id), { status: Bstill && Bstill.status, n: Bstill && (Bstill.participants || []).length });
    const C = await newMeet(ken, { tag: 'delete-match' });
    const Cg = await se('meets/participants/add', { meetId: C.id, displayName: '[probe] guest', status: 'confirmed' }, ken.token);
    const Cs = await show(C.id, ken);
    const hostP = (Cs.participants || []).find((p) => p.userId === ken.id); const guestP = (Cs.participants || []).find((p) => !p.userId);
    const mC = hostP && guestP ? await se('meets/matches/upsert', { meetId: C.id, round: 1, team1Ids: [hostP.id], team2Ids: [guestP.id] }, ken.token) : { status: 0 };
    const dC = await se('meets/delete', { meetId: C.id }, ken.token);
    ok('D7 a meet with a match → MEET_HAS_MATCHES', code(dC) === 'MEET_HAS_MATCHES', { guestAdd: Cg.status, match: mC.status, status: dC.status, code: code(dC) });

    // ---------------- R: meets/chat-refresh
    const members = async (roomId) => { const r = await se('chat/rooms/members', { roomId, limit: 100 }, ken.token); return Array.isArray(r.json) ? r.json.map((m) => m.userId || (m.user && m.user.id)) : []; };
    const Bs = await show(B.id, ken);
    if (Bs.chatRoomId) {
      const before = await members(Bs.chatRoomId);
      const lv = await se('chat/rooms/leave', { roomId: Bs.chatRoomId }, tom.token);
      const mid = await members(Bs.chatRoomId);
      ok('R0 planted: the confirmed player left the room natively (not a member any more)', before.includes(tom.id) && !mid.includes(tom.id), { leave: lv.status, before: before.includes(tom.id), after: mid.includes(tom.id) });
      const rTom = await se('meets/chat-refresh', { meetId: B.id }, tom.token);
      ok('R1 a player cannot refresh the meet chat (MEET_NOT_HOST)', code(rTom) === 'MEET_NOT_HOST', { status: rTom.status, code: code(rTom) });
      const rKen = await se('meets/chat-refresh', { meetId: B.id }, ken.token);
      const after = await members(Bs.chatRoomId);
      ok('R2 the host refreshes: {added>=1} and the player is back in the room (read back)', rKen.status === 200 && rKen.json && rKen.json.added >= 1 && after.includes(tom.id), { status: rKen.status, body: rKen.json, back: after.includes(tom.id) });
      const rAgain = await se('meets/chat-refresh', { meetId: B.id }, ken.token);
      ok('R3 a second refresh adds nobody (idempotent)', rAgain.status === 200 && rAgain.json && rAgain.json.added === 0, { body: rAgain.json });
    } else ok('R* meet B has a chat room', false, { chatRoomId: Bs.chatRoomId });

    // ---------------- P: Request +1 after confirming
    const D = await newMeet(ken, { tag: 'plus-one', plus: true });
    const jT = await se('meets/join', { meetId: D.id }, tom.token);
    const mine0 = (jT.json && jT.json.participants || []).find((p) => p.userId === tom.id);
    const p1 = await se('meets/join', { meetId: D.id, plusOnes: 1 }, tom.token);
    const Ds = await show(D.id, ken);
    const guest = (Ds.participants || []).find((p) => p.kind === 'plusOne' && p.sponsorId === tom.id);
    ok('P1 a confirmed player asks for a +1 afterwards → the guest row exists (read back)', mine0 && mine0.status === 'confirmed' && p1.status === 200 && !!guest, { first: mine0 && mine0.status, status: p1.status, guest: guest && { status: guest.status, name: guest.displayName } });
    const p2 = await se('meets/join', { meetId: D.id, plusOnes: 1 }, tom.token);
    ok('P2 a second +1 → MEET_GUEST_LIMIT', code(p2) === 'MEET_GUEST_LIMIT', { status: p2.status, code: code(p2) });
    const p0 = await se('meets/join', { meetId: D.id, plusOnes: 0 }, tom.token);
    ok('P3 planted: a plain re-join by a confirmed player is still refused (MEET_ALREADY_PARTICIPANT)', code(p0) === 'MEET_ALREADY_PARTICIPANT', { status: p0.status, code: code(p0) });

    // ---------------- B: hostBlockedMe
    const bl = await se('blocking/create', { userId: amy.id }, ken.token);
    cleanup.push(async () => { await se('blocking/delete', { userId: amy.id }, ken.token); });
    const amyView = await show(D.id, amy); const meiView = await show(D.id, mei);
    ok('B1 the viewer the host blocked reads hostBlockedMe=true before tapping Join', amyView && amyView.hostBlockedMe === true, { block: bl.status, amy: amyView && amyView.hostBlockedMe });
    ok('B2 another viewer reads hostBlockedMe=false', meiView && meiView.hostBlockedMe === false, { mei: meiView && meiView.hostBlockedMe });
    const jA = await se('meets/join', { meetId: D.id }, amy.token);
    ok('B3 …and the engine still refuses the blocked viewer\'s join (MEET_BLOCKED)', code(jA) === 'MEET_BLOCKED', { status: jA.status, code: code(jA) });
    await se('blocking/delete', { userId: amy.id }, ken.token);
    const amyAfter = await show(D.id, amy);
    ok('B4 planted: after the unblock hostBlockedMe reads false again', amyAfter && amyAfter.hostBlockedMe === false, { amy: amyAfter && amyAfter.hostBlockedMe });

    // ---------------- C: Can't go (declined rows on the roster)
    const inv = await se('meets/participants/add', { meetId: D.id, userId: mei.id, status: 'invited' }, ken.token);
    const beforeC = await show(D.id, ken);
    const dec = await se('meets/respond', { meetId: D.id, answer: 'decline' }, mei.token);
    const afterC = await show(D.id, ken);
    const meiRow = (afterC.participants || []).find((p) => p.userId === mei.id);
    ok('C1 the declined invitee is on the roster as declined (Can\'t go), read back', inv.status === 200 && dec.status === 200 && meiRow && meiRow.status === 'declined', { invite: inv.status, respond: dec.status, row: meiRow && meiRow.status });
    ok('C2 …and holds no seat: confirmed / spotsLeft unchanged', afterC.confirmed === beforeC.confirmed && afterC.spotsLeft === beforeC.spotsLeft, { before: [beforeC.confirmed, beforeC.spotsLeft], after: [afterC.confirmed, afterC.spotsLeft] });

    // ---------------- F: forceSkill
    const tomRow = (afterC.participants || []).find((p) => p.userId === tom.id);
    const fS = await se('meets/participants/update', { meetId: D.id, participantId: tomRow.id, forceSkill: 4.5 }, ken.token);
    const fRead = ((await show(D.id, ken)).participants || []).find((p) => p.id === tomRow.id);
    ok('F1 the host sets a per-meet skill override and reads it back (forceSkill 4.5)', fS.status === 200 && fRead && fRead.forceSkill === 4.5, { status: fS.status, forceSkill: fRead && fRead.forceSkill });
    const fT = await se('meets/participants/update', { meetId: D.id, participantId: tomRow.id, forceSkill: 5.5 }, tom.token);
    ok('F2 a player may not set it (MEET_NOT_HOST)', code(fT) === 'MEET_NOT_HOST', { status: fT.status, code: code(fT) });

    // ---------------- N: reserved club names
    const nBad = await se('channels/create', { name: '[probe] GripBat t3 club' }, tom.token);
    ok('N1 a club named with the brand → CLUB_NAME_RESERVED', code(nBad) === 'CLUB_NAME_RESERVED', { status: nBad.status, code: code(nBad) });
    const nBad2 = await se('channels/create', { name: '[probe] grip bat t3' }, tom.token);
    ok('N2 …spacing and case do not get round it', code(nBad2) === 'CLUB_NAME_RESERVED', { status: nBad2.status, code: code(nBad2) });
    const nOk = await se('channels/create', { name: '[probe] t3 plain club' }, tom.token);
    if (nOk.json && nOk.json.id) cleanup.push(async () => { await se('channels/update', { channelId: nOk.json.id, isArchived: true }, tom.token); });
    ok('N3 planted: a plain name still creates (the rule is not a wall)', nOk.status === 200 && nOk.json && nOk.json.id, { status: nOk.status });
    if (nOk.json && nOk.json.id) { const rn = await se('channels/update', { channelId: nOk.json.id, name: '[probe] GripBat renamed' }, tom.token); ok('N4 a rename into the brand is refused', code(rn) === 'CLUB_NAME_RESERVED', { status: rn.status, code: code(rn) }); }

    // ---------------- I: clubs/invitations/mine + V: clubs/polls/voters (mei's own club)
    const meiClubs = (await se('clubs/mine', { tier: 'member' }, mei.token)).json || [];
    const club = meiClubs.find((c) => c.role === 'owner') || meiClubs[0];
    if (!club) { ok('I* mei owns a club on UAT', false, { n: meiClubs.length }); }
    else {
      const roster = ((await se('clubs/members', { channelId: club.id, limit: 200 }, mei.token)).json || {}).members || [];
      const isMem = (id) => roster.some((m) => m.userId === id);
      const target = [amy, ken, tom].find((u) => !isMem(u.id));
      if (!target) ok('I* a persona outside mei\'s club exists', false, { club: club.name });
      else {
        const ic = await se('clubs/invitations/create', { channelId: club.id, userId: target.id }, mei.token);
        cleanup.push(async () => { await se('clubs/invitations/cancel', { channelId: club.id, userId: target.id }, mei.token); });
        const mineT = await se('clubs/invitations/mine', {}, target.token);
        const other = [amy, ken, tom].find((u) => u.id !== target.id);
        const mineO = await se('clubs/invitations/mine', {}, other.token);
        ok('I1 the invited player sees the club in clubs/invitations/mine', ic.status === 200 && Array.isArray(mineT.json) && mineT.json.some((c) => c.id === club.id), { invite: ic.status, n: mineT.json && mineT.json.length, who: target.slug });
        ok('I2 another player does not (only their own invitations)', Array.isArray(mineO.json) && !mineO.json.some((c) => c.id === club.id), { who: other.slug, n: mineO.json && mineO.json.length });
        await se('clubs/invitations/cancel', { channelId: club.id, userId: target.id }, mei.token);
        const mineT2 = await se('clubs/invitations/mine', {}, target.token);
        ok('I3 planted: after the admin cancels, it is gone from the list', Array.isArray(mineT2.json) && !mineT2.json.some((c) => c.id === club.id), { n: mineT2.json && mineT2.json.length });

        const poll = await se('notes/create', { text: '[probe] t3 club poll', channelId: club.id, poll: { choices: ['[probe] A', '[probe] B'], multiple: false } }, mei.token);
        const pollId = poll.json && (poll.json.createdNote ? poll.json.createdNote.id : poll.json.id);
        if (pollId) cleanup.push(async () => { await se('notes/delete', { noteId: pollId }, mei.token); });
        const vote = pollId ? await se('notes/polls/vote', { noteId: pollId, choice: 1 }, mei.token) : { status: 0 };
        const vMei = pollId ? await se('clubs/polls/voters', { noteId: pollId }, mei.token) : { status: 0 };
        const grp = Array.isArray(vMei.json) ? vMei.json.find((g) => g.choice === 1) : null;
        ok('V1 a club member reads who voted: choice B lists mei (read back)', vote.status === 204 || vote.status === 200 ? !!(grp && grp.voters.some((u) => u.id === mei.id) && grp.count === 1) : false, { vote: vote.status, status: vMei.status, groups: vMei.json });
        const vOut = pollId ? await se('clubs/polls/voters', { noteId: pollId }, target.token) : { status: 0 };
        ok('V2 a non-member → CLUB_NOT_MEMBER (the voters stay in the club)', code(vOut) === 'CLUB_NOT_MEMBER', { who: target.slug, status: vOut.status, code: code(vOut) });
        const pub = await se('notes/create', { text: '[probe] t3 public poll', poll: { choices: ['[probe] x', '[probe] y'] }, visibility: 'specified', visibleUserIds: [] }, mei.token);
        const pubId = pub.json && (pub.json.createdNote ? pub.json.createdNote.id : pub.json.id);
        if (pubId) cleanup.push(async () => { await se('notes/delete', { noteId: pubId }, mei.token); });
        const vPub = pubId ? await se('clubs/polls/voters', { noteId: pubId }, mei.token) : { status: 0 };
        ok('V3 a poll outside any club → CLUB_NO_SUCH_NOTE (Misskey\'s own polls stay private)', code(vPub) === 'CLUB_NO_SUCH_NOTE', { status: vPub.status, code: code(vPub) });
      }
    }
  } catch (e) {
    ok('probe ran to the end', false, { error: String(e && e.stack || e).slice(0, 500) });
  } finally {
    for (const f of cleanup.reverse()) { try { await f(); } catch (e) { /* keep cleaning */ } }
    const pass = checks.filter((c) => c.pass).length;
    const out = { id: 't3-clubs-meets.api', at: new Date().toISOString(), base: BASE, pass, fail: checks.length - pass, checks };
    fs.writeFileSync('/root/social-engine/probes/t3-clubs-meets.api.json', JSON.stringify(out, null, 1));
    console.log('\n' + pass + '/' + checks.length + ' pass');
    process.exit(checks.length && pass === checks.length ? 0 : 1);
  }
})();

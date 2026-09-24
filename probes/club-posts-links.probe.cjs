// CLUB-POSTS-LINKS probe (lane club-posts-links, 2026-09-24) — the ENGINE half of the lane's rows on the DEPLOYED UAT engine,
// as the UAT personas (QA door → hkpl sso/social → engine adapter/sso). Every door by its REAL registered name
// (endpoint-list.ts: notes/create, notes/show, notes/children, channels/timeline, clubs/settings/update, clubs/settings/show,
// clubs/by-code, clubs/handle-available, clubs/chat, chat/messages/create-to-room, notes/polls/vote, notes/polls/unvote,
// notes/polls/add-choice, meets/promote {preview}), every "yes" with its "no", state read back from the engine:
//   A  per-post audience (B-content-editor.07, G15.5): owner mei posts Public / Members / Admins in a [probe] club;
//      member amy, NON-member tom and anonymous each read channels/timeline + notes/show; a comment inherits its post's audience
//   T  title = native cw, MFM kept in the text (B-content-editor.02 / .03)
//   O  outside activity links (B-set-comms.03 / .09 / E-chat-room.21): setting OFF → amy's post, comment and club-chat
//      message carrying another club's (or a club-less) meet → 400 OUTSIDE_LINK_BLOCKED; the club's own meet passes; the
//      admin passes; PLANTED: setting ON → the same post passes (the refusal is the setting's, not an accident)
//   H  club handle (B-set-profile.03 / B-link-club.02): available → saved → read back → by-code {handle} → taken for another
//      club → reserved word refused; a PRIVATE club's handle answers NO_SUCH_CLUB to a non-member (G15.5)
//   P  polls (B-create-poll.02 / .03): vote → native re-vote ALREADY_VOTED (planted) → replace → unvote → add-choice (member),
//      duplicate refused, non-member refused, poll without the switch refused; counts read back from notes/show
//   F  promote filters (A-promote-meet.04): PREVIEW ONLY (never a send): reach(all) vs female / male / a level band /
//      Select All; a bad level value is refused by the engine
//   S  short link: meets/show {referenceCode} resolves (the door pages/link uses); https://uat.gripbat.com/m/<code> status noted
// Before the engine batch ships this probe MUST fail (the planted-fault run); after, every check must pass.
// Everything created is "[probe] club-posts-links …"-named and removed in finally. Verdict → probes/club-posts-links.verdict.json
'use strict';
const fs = require('fs');
const path = require('path');
const BASE = process.env.BASE || 'https://uat.social.silkvo.com';
const BRAND = process.env.BRAND || 'https://uat.gripbat.com';
const QA_P = process.env.QA_P || (fs.readFileSync('/root/hkpl-server/.env', 'utf8').match(/^QA_BYPASS_PASSWORD=(.+)$/m) || [])[1] || 'hkpl-uat-2026';
const PERSONAS = JSON.parse(fs.readFileSync('/root/uat-personas.json', 'utf8')).personas;
const P = (slug) => PERSONAS.find((p) => p.slug === slug);
const OUT = process.env.OUT || path.join(__dirname, 'club-posts-links.verdict.json');
const checks = []; const ok = (id, n, p, d) => { checks.push({ id, name: n, pass: !!p, detail: d }); console.log((p ? 'PASS ' : 'FAIL ') + id + ' ' + n + ' — ' + JSON.stringify(d).slice(0, 260)); };
const cleanup = [];
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const { execSync } = require('child_process');
/** psql on the UAT database (se_sbx) — fixture read-back, the independent audience count, the litter count. */
const PGU = execSync('docker exec social-engine-db-1 printenv POSTGRES_USER').toString().trim();
const sql = (q) => execSync('docker exec -i social-engine-db-1 psql -U ' + PGU + ' -d se_sbx -Atq', { input: q }).toString().trim();
/** notes/delete carries Misskey's minInterval (1 s): space the deletes, retry a 429 once. */
async function delNote(id, who) { await sleep(1200); const d = await se('notes/delete', { noteId: id }, who.token); if (d.status === 429) { await sleep(3000); await se('notes/delete', { noteId: id }, who.token); } }
let mei, amy, tom, ken;
const TAG = '[probe] club-posts-links ' + Date.now().toString(36);

async function session(email) {
  const r = await fetch(BASE + '/api/v1/auth/qa/by-email/' + encodeURIComponent(email) + '?p=' + encodeURIComponent(QA_P), { redirect: 'manual' });
  const raw = (r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie')].filter(Boolean)).map((c) => c.split(';')[0]);
  if (r.status !== 302 || !raw.length) throw new Error('qa/by-email ' + email + ' → ' + r.status);
  return raw.join('; ');
}
async function se(endpoint, body, token) {
  const r = await fetch(BASE + '/api/' + endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(token ? { ...body, i: token } : body) });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch (e) { /* 204 */ }
  return { status: r.status, json, text };
}
async function login(slug) {
  const cookie = await session(P(slug).email);
  const m = await (await fetch(BASE + '/api/v1/auth/sso/social', { headers: { cookie } })).json();
  const r = await se('adapter/sso', { jwt: m.jwt });
  if (!r.json || !r.json.token) throw new Error('adapter/sso ' + slug + ': ' + r.status);
  const me = await se('i', {}, r.json.token);
  return { token: r.json.token, id: me.json && me.json.id, slug };
}
const code = (r) => (r && r.json && r.json.error ? r.json.error.code : null);
const inHours = (h) => new Date(Date.now() + h * 3600e3).toISOString();
const ids = (r) => (Array.isArray(r.json) ? r.json.map((n) => n.id) : []);

async function note(who, body) {
  const r = await se('notes/create', body, who.token);
  const n = r.json && r.json.createdNote;
  if (n) cleanup.push(async () => { await delNote(n.id, who); });
  return { r, n };
}
async function club(owner, name, visibility) {
  const r = await se('channels/create', { name }, owner.token);
  if (!r.json || !r.json.id) throw new Error('channels/create ' + r.status + ' ' + r.text.slice(0, 200));
  cleanup.push(async () => { await se('clubs/settings/update', { channelId: r.json.id, handle: null }, owner.token).catch(() => undefined); await se('channels/update', { channelId: r.json.id, isArchived: true }, owner.token); });
  if (visibility) await se('clubs/settings/update', { channelId: r.json.id, visibility }, owner.token);
  const s = await se('clubs/settings/show', { channelId: r.json.id }, owner.token);
  if (!s.json || (visibility && s.json.visibility !== visibility)) throw new Error('fixture club not as asked: ' + JSON.stringify(s.json && s.json.visibility));   // G16.5
  return r.json;
}
async function meet(host, tag, extra) {
  const r = await se('meets/create', { name: TAG + ' ' + tag, sport: 'pickleball', startAt: inHours(extra && extra.h || 30), durationMinutes: 60, capacity: 8, hostPlays: true, autoApprove: true, visibility: 'public', feeType: 'free', sendNotifications: false, ...(extra && extra.channelId ? { channelId: extra.channelId } : {}) }, host.token);
  if (!r.json || !r.json.id) throw new Error('meets/create ' + tag + ': ' + r.status + ' ' + r.text.slice(0, 200));
  cleanup.push(async () => { await se('meets/cancel', { meetId: r.json.id }, host.token); });
  return r.json;
}

(async () => {
  mei = await login('clubowner-mei'); amy = await login('player-amy'); tom = await login('clubadmin-tom'); ken = await login('host-ken');
  const ep = await se('endpoint', { endpoint: 'notes/polls/add-choice' });
  const engineHas = !!(ep.json && ep.json.params);
  ok('E0', 'engine carries the CLUB-POSTS-LINKS-V1 doors (notes/polls/add-choice registered)', engineHas, { status: ep.status });
  try {
    const C = await club(mei, TAG + ' club');
    const j = await se('clubs/join', { channelId: C.id }, amy.token);
    const role = await se('clubs/settings/show', { channelId: C.id }, amy.token);
    if (!(role.json && role.json.isMember)) throw new Error('amy is not a member of the fixture club: ' + j.status + ' ' + JSON.stringify(role.json && role.json.tier));
    const tomRole = await se('clubs/settings/show', { channelId: C.id }, tom.token);
    if (tomRole.json && (tomRole.json.isMember || tomRole.json.isAdmin)) throw new Error('tom must be a non-member');

    // ---------------- A: audience
    const pub = await note(mei, { channelId: C.id, text: TAG + ' public post' });
    const mem = await note(mei, { channelId: C.id, text: TAG + ' members post', visibility: 'followers' });
    const adm = await note(mei, { channelId: C.id, text: TAG + ' admins post', visibility: 'specified' });
    ok('A0', 'the three posts are stored with their audience (public / followers / specified)', pub.n && mem.n && adm.n && pub.n.visibility === 'public' && mem.n.visibility === 'followers' && adm.n.visibility === 'specified', { pub: pub.n && pub.n.visibility, mem: mem.n && mem.n.visibility, adm: adm.n && adm.n.visibility, err: code(mem.r) || code(adm.r) });
    if (pub.n && mem.n && adm.n) {
      const tl = async (who) => ids(await se('channels/timeline', { channelId: C.id, limit: 30 }, who && who.token));
      const [tMei, tAmy, tTom, tAnon] = [await tl(mei), await tl(amy), await tl(tom), await tl(null)];
      const has = (l, n) => l.includes(n.n.id);
      ok('A1', 'owner/admin reads all three in the club feed', has(tMei, pub) && has(tMei, mem) && has(tMei, adm), { n: tMei.length });
      ok('A2', 'member reads Public + Members, NOT Admins', has(tAmy, pub) && has(tAmy, mem) && !has(tAmy, adm), { pub: has(tAmy, pub), mem: has(tAmy, mem), adm: has(tAmy, adm) });
      ok('A3', 'NON-member (signed in) reads Public only', has(tTom, pub) && !has(tTom, mem) && !has(tTom, adm), { pub: has(tTom, pub), mem: has(tTom, mem), adm: has(tTom, adm) });
      ok('A4', 'anonymous reads Public only', has(tAnon, pub) && !has(tAnon, mem) && !has(tAnon, adm), { pub: has(tAnon, pub), mem: has(tAnon, mem), adm: has(tAnon, adm) });
      const sTom = await se('notes/show', { noteId: mem.n.id }, tom.token);
      ok('A5', 'NON-member opening the members post by id gets no text (hidden)', sTom.json && (sTom.json.isHidden === true || sTom.json.text == null) && !String(sTom.json.text || '').includes('members post'), { status: sTom.status, isHidden: sTom.json && sTom.json.isHidden, text: sTom.json && sTom.json.text });
      const sAmy = await se('notes/show', { noteId: adm.n.id }, amy.token);
      ok('A6', 'member opening the admins post by id gets no text (hidden)', sAmy.json && sAmy.json.text == null, { status: sAmy.status, isHidden: sAmy.json && sAmy.json.isHidden });
      const rep = await note(amy, { replyId: mem.n.id, text: TAG + ' member comment' });
      ok('A7', 'a comment on the members post inherits its audience (followers)', rep.n && rep.n.visibility === 'followers', { status: rep.r.status, vis: rep.n && rep.n.visibility, err: code(rep.r) });
      const chMei = ids(await se('notes/children', { noteId: mem.n.id, limit: 30 }, mei.token));
      const chTom = ids(await se('notes/children', { noteId: mem.n.id, limit: 30 }, tom.token));
      ok('A8', 'the comment is listed for the owner and NOT for the non-member (notes/children)', rep.n && chMei.includes(rep.n.id) && !chTom.includes(rep.n.id), { mei: rep.n && chMei.includes(rep.n.id), tom: rep.n && chTom.includes(rep.n.id) });
      const rTom = await se('notes/create', { replyId: mem.n.id, text: TAG + ' outsider comment' }, tom.token);
      ok('A9', 'a non-member cannot comment on a members post', rTom.status >= 400, { status: rTom.status, code: code(rTom) });
      if (rTom.json && rTom.json.createdNote) cleanup.push(async () => { await delNote(rTom.json.createdNote.id, tom); });
    }

    // ---------------- T: title (cw) + MFM
    const t = await note(amy, { channelId: C.id, cw: 'Saturday ladder', text: '**Bring water** and <i>smile</i> [rules](https://example.com/rules)' });
    const tShow = t.n ? await se('notes/show', { noteId: t.n.id }, tom.token) : { json: null };
    ok('T1', 'title = native cw and the MFM text read back unchanged (public post, read by a non-member)', tShow.json && tShow.json.cw === 'Saturday ladder' && String(tShow.json.text).includes('**Bring water**'), { cw: tShow.json && tShow.json.cw, text: tShow.json && tShow.json.text });

    // ---------------- O: outside links
    const other = await meet(ken, 'club-less meet');              // not this club's
    const own = await meet(mei, 'own club meet', { channelId: C.id });
    const setOff = await se('clubs/settings/update', { channelId: C.id, allowOutsideLinks: false }, mei.token);
    const rb = await se('clubs/settings/show', { channelId: C.id }, amy.token);
    ok('O0', 'setting saved and read back: allowOutsideLinks false', setOff.status === 200 && rb.json && rb.json.allowOutsideLinks === false, { status: setOff.status, read: rb.json && rb.json.allowOutsideLinks });
    const link = (m) => BRAND + '/app/pages/meet/index?id=' + m.id;
    const o1 = await note(amy, { channelId: C.id, text: TAG + ' join this ' + link(other) });
    ok('O1', 'member post with another activity\'s link → OUTSIDE_LINK_BLOCKED', code(o1.r) === 'OUTSIDE_LINK_BLOCKED', { status: o1.r.status, code: code(o1.r) });
    const o2 = await note(amy, { channelId: C.id, text: TAG + ' short ' + BRAND + '/m/' + other.referenceCode });
    ok('O2', 'the /m/<code> short link of it → OUTSIDE_LINK_BLOCKED', other.referenceCode && code(o2.r) === 'OUTSIDE_LINK_BLOCKED', { code: other.referenceCode, status: o2.r.status, err: code(o2.r) });
    const o3 = await note(amy, { channelId: C.id, text: TAG + ' ours ' + link(own) });
    ok('O3', 'the club\'s OWN meet link passes', o3.r.status === 200, { status: o3.r.status, err: code(o3.r) });
    const o4 = await note(mei, { channelId: C.id, text: TAG + ' admin shares ' + link(other) });
    ok('O4', 'the owner/admin is exempt', o4.r.status === 200, { status: o4.r.status, err: code(o4.r) });
    if (pub.n) {
      const o5 = await note(amy, { replyId: pub.n.id, text: TAG + ' comment ' + link(other) });
      ok('O5', 'a member COMMENT with it → OUTSIDE_LINK_BLOCKED', code(o5.r) === 'OUTSIDE_LINK_BLOCKED', { status: o5.r.status, err: code(o5.r) });
    }
    const room = await se('clubs/chat', { channelId: C.id }, amy.token);
    const roomId = room.json && room.json.roomId;
    if (roomId) {
      const c1 = await se('chat/messages/create-to-room', { toRoomId: roomId, meetId: other.id }, amy.token);
      ok('O6', 'club chat: a meet CARD of another activity → OUTSIDE_LINK_BLOCKED', code(c1) === 'OUTSIDE_LINK_BLOCKED', { status: c1.status, err: code(c1) });
      const c2 = await se('chat/messages/create-to-room', { toRoomId: roomId, text: TAG + ' ' + link(other) }, amy.token);
      ok('O7', 'club chat: a text link to it → OUTSIDE_LINK_BLOCKED', code(c2) === 'OUTSIDE_LINK_BLOCKED', { status: c2.status, err: code(c2) });
      const c3 = await se('chat/messages/create-to-room', { toRoomId: roomId, meetId: own.id }, amy.token);
      ok('O8', 'club chat: the club\'s own meet card passes', c3.status === 200, { status: c3.status, err: code(c3) });
      const tlc = await se('chat/messages/room-timeline', { roomId, limit: 20 }, mei.token);
      const stored = (Array.isArray(tlc.json) ? tlc.json : []).some((m) => m.text && m.text.includes(other.id));
      ok('O9', 'read back: the refused message is NOT stored in the room', tlc.status === 200 && !stored, { status: tlc.status, stored });
    } else ok('O6', 'club chat room opened', false, { status: room.status, err: code(room) });
    await se('clubs/settings/update', { channelId: C.id, allowOutsideLinks: true }, mei.token);
    const o10 = await note(amy, { channelId: C.id, text: TAG + ' now allowed ' + link(other) });
    ok('O10', 'PLANTED: setting back ON → the same member post passes (the refusal is the setting\'s)', o10.r.status === 200, { status: o10.r.status, err: code(o10.r) });

    // ---------------- H: club handle
    const h = 'pcl_' + Date.now().toString(36);
    const av = await se('clubs/handle-available', { handle: h }, mei.token);
    ok('H1', 'a fresh handle is available', av.json && av.json.available === true, { status: av.status, body: av.json });
    const sv = await se('clubs/settings/update', { channelId: C.id, handle: h }, mei.token);
    const shH = await se('clubs/settings/show', { channelId: C.id }, tom.token);
    ok('H2', 'saved and read back on the club (public club: readable)', sv.status === 200 && shH.json && shH.json.handle === h, { status: sv.status, read: shH.json && shH.json.handle });
    const bh = await se('clubs/by-code', { handle: '@' + h });
    ok('H3', 'clubs/by-code {handle} resolves the club (what /clubs/@handle opens)', bh.json && bh.json.id === C.id, { status: bh.status, id: bh.json && bh.json.id });
    const C2 = await club(tom, TAG + ' private club', 'private');
    const tk = await se('clubs/handle-available', { handle: h, channelId: C2.id }, tom.token);
    ok('H4', 'the same handle for another club → taken', tk.json && tk.json.available === false && tk.json.reason === 'taken', { body: tk.json });
    const tk2 = await se('clubs/settings/update', { channelId: C2.id, handle: h }, tom.token);
    ok('H5', 'saving a taken handle is refused (CLUB_HANDLE_TAKEN)', code(tk2) === 'CLUB_HANDLE_TAKEN', { status: tk2.status, err: code(tk2) });
    const rs = await se('clubs/settings/update', { channelId: C2.id, handle: 'gripbat_fans' }, tom.token);
    ok('H6', 'a reserved handle is refused (CLUB_HANDLE_RESERVED)', code(rs) === 'CLUB_HANDLE_RESERVED', { status: rs.status, err: code(rs) });
    const h2 = 'pcl_priv_' + Date.now().toString(36);
    await se('clubs/settings/update', { channelId: C2.id, handle: h2 }, tom.token);
    const privAmy = await se('clubs/by-code', { handle: h2 }, amy.token);
    const privAnon = await se('clubs/by-code', { handle: h2 });
    const privTom = await se('clubs/by-code', { handle: h2 }, tom.token);
    ok('H7', 'G15.5: a PRIVATE club by its handle → NO_SUCH_CLUB for a non-member and anonymous; its owner resolves it', code(privAmy) === 'NO_SUCH_CLUB' && code(privAnon) === 'NO_SUCH_CLUB' && privTom.json && privTom.json.id === C2.id, { amy: code(privAmy), anon: code(privAnon), owner: privTom.json && privTom.json.id === C2.id });
    const shPriv = await se('clubs/settings/show', { channelId: C2.id }, amy.token);
    ok('H8', 'G15.5: a private club\'s settings show no handle to a non-member', !(shPriv.json && shPriv.json.handle), { status: shPriv.status, handle: shPriv.json && shPriv.json.handle, err: code(shPriv) });

    // ---------------- P: polls
    const pl = await note(mei, { channelId: C.id, text: TAG + ' poll', poll: { choices: ['A', 'B'], multiple: false, allowAddChoices: true } });
    if (pl.n) {
      const pc = (who) => se('notes/show', { noteId: pl.n.id }, who.token).then((r) => (r.json && r.json.poll) || null);
      ok('P0', 'poll stored with allowAddChoices', pl.n.poll && pl.n.poll.allowAddChoices === true, { poll: pl.n.poll });
      await se('notes/polls/vote', { noteId: pl.n.id, choice: 0 }, amy.token);
      const again = await se('notes/polls/vote', { noteId: pl.n.id, choice: 1 }, amy.token);
      ok('P1', 'PLANTED: a native second vote is still refused (ALREADY_VOTED)', code(again) === 'ALREADY_VOTED', { status: again.status, err: code(again) });
      const ch = await se('notes/polls/vote', { noteId: pl.n.id, choice: 1, replace: true }, amy.token);
      const p1 = await pc(amy);
      ok('P2', 'change vote (replace): my vote moves A → B, counts read back', ch.status === 204 && p1 && p1.choices[0].votes === 0 && p1.choices[1].votes === 1 && p1.choices[1].isVoted && !p1.choices[0].isVoted, { status: ch.status, choices: p1 && p1.choices });
      const un = await se('notes/polls/unvote', { noteId: pl.n.id }, amy.token);
      const p2 = await pc(amy);
      ok('P3', 'take my vote back: counts back to 0 and nothing marked mine', un.json && un.json.removed === 1 && p2 && p2.choices.every((c) => !c.votes && !c.isVoted), { status: un.status, body: un.json, choices: p2 && p2.choices });
      const ad = await se('notes/polls/add-choice', { noteId: pl.n.id, text: 'Option C' }, amy.token);
      const p3 = await pc(mei);
      ok('P4', 'a member adds an option; read back with addedBy = the member', ad.status === 200 && p3 && p3.choices.length === 3 && p3.choices[2].text === 'Option C' && p3.choices[2].addedBy === amy.id, { status: ad.status, choices: p3 && p3.choices });
      const dup = await se('notes/polls/add-choice', { noteId: pl.n.id, text: 'option c' }, mei.token);
      ok('P5', 'a duplicate option is refused', code(dup) === 'POLL_DUPLICATE_OPTION', { status: dup.status, err: code(dup) });
      const out = await se('notes/polls/add-choice', { noteId: pl.n.id, text: 'Outsider' }, tom.token);
      ok('P6', 'a NON-member cannot add an option', code(out) === 'CLUB_NOT_MEMBER', { status: out.status, err: code(out) });
      const v3 = await se('notes/polls/vote', { noteId: pl.n.id, choice: 2 }, amy.token);
      const p4 = await pc(amy);
      ok('P7', 'the added option takes votes', v3.status === 204 && p4 && p4.choices[2].votes === 1, { status: v3.status, c: p4 && p4.choices[2] });
    } else ok('P0', 'poll created', false, { status: pl.r.status, err: code(pl.r) });
    const pl2 = await note(mei, { channelId: C.id, text: TAG + ' fixed poll', poll: { choices: ['X', 'Y'] } });
    if (pl2.n) { const na = await se('notes/polls/add-choice', { noteId: pl2.n.id, text: 'Z' }, amy.token); ok('P8', 'a poll without the switch refuses new options', code(na) === 'POLL_ADD_NOT_ALLOWED', { status: na.status, err: code(na) }); }
    const pm = await note(mei, { channelId: C.id, text: TAG + ' members poll', visibility: 'followers', poll: { choices: ['1', '2'] } });
    if (pm.n) { const vt = await se('notes/polls/vote', { noteId: pm.n.id, choice: 0 }, tom.token); ok('P9', 'G15.5: a non-member cannot vote on a members-only poll', vt.status >= 400, { status: vt.status, err: code(vt) }); }

    // ---------------- F: promote filters (PREVIEW ONLY — never a send)
    // A club meet (mei hosts) whose audience 'club' = the club's members minus the host: amy + tom + ken join, so the reach
    // cannot be a blind 0 (G16.6). The expected numbers are counted independently in SQL from the players' own level rows.
    for (const u of [tom, ken]) await se('clubs/join', { channelId: C.id }, u.token);
    const pmeet = await meet(mei, 'promote preview', { h: 20, channelId: C.id });
    const prev = (extra) => se('meets/promote', { meetId: pmeet.id, preview: true, audience: 'club', ...extra }, mei.token);
    const all = await prev({}); const fem = await prev({ genders: ['female'] }); const mal = await prev({ genders: ['male'] });
    const adult = await prev({ ageGroups: ['adult'] }); const sel = await prev({ ageGroups: ['junior', 'adult', 'senior'] });
    const lv = await prev({ levels: ['3.0', '3.5'] });
    const bad = await prev({ levels: ['9.9'] });
    const R = (r) => (r.json ? r.json.reach : null);
    const aud = [amy.id, tom.id, ken.id].map((x) => "'" + x + "'").join(',');
    const cnt = (cond) => Number(sql(`SELECT count(DISTINCT u) FROM unnest(ARRAY[${aud}]::varchar[]) u WHERE ${cond};`));
    const exp = {
      all: 3,
      female: cnt(`EXISTS (SELECT 1 FROM meet_player_level l WHERE l."userId" = u AND l.gender = 'female')`),
      male: cnt(`EXISTS (SELECT 1 FROM meet_player_level l WHERE l."userId" = u AND l.gender = 'male')`),
      adult: cnt(`EXISTS (SELECT 1 FROM meet_player_level l WHERE l."userId" = u AND l."ageGroup" = 'adult')`),
      lv: cnt(`EXISTS (SELECT 1 FROM meet_player_level l WHERE l."userId" = u AND l.sport = 'pickleball' AND COALESCE(l."selfLevel", NULL) >= 3.0 AND COALESCE(l."selfLevel", NULL) < 4.0)`),
    };
    ok('F0', 'preview answers (gate ok), sent:false, and the club audience is the 3 members (not a blind 0)', all.json && all.json.gate === 'ok' && all.json.sent === false && R(all) === exp.all, { status: all.status, reach: R(all), expected: exp.all, gate: all.json && all.json.gate });
    ok('F1', 'gender filter = the members whose own level row says female / male (independent SQL count)', R(fem) === exp.female && R(mal) === exp.male, { female: R(fem), expFemale: exp.female, male: R(mal), expMale: exp.male });
    ok('F2', 'age-group filter (adult) and level band (3.0 + 3.5) match the SQL count', R(adult) === exp.adult && R(lv) === exp.lv, { adult: R(adult), expAdult: exp.adult, lv: R(lv), expLv: exp.lv });
    ok('F3', 'Select All (every age group) = no filter', R(sel) === R(all), { all: R(all), selectAll: R(sel) });
    ok('F4', 'a level value outside the list is refused by the engine', bad.status === 400, { status: bad.status, err: code(bad) });
    const after = await se('meets/show', { meetId: pmeet.id }, mei.token);
    ok('F5', 'nothing was sent: the meet is not marked promoted', after.json && !after.json.promotedAt && !(after.json.flags || []).some((f) => /PROMOTED$/.test(f)), { promotedAt: after.json && after.json.promotedAt });

    // ---------------- S: short link door
    const bc = await se('meets/show', { referenceCode: other.referenceCode });
    ok('S1', 'meets/show {referenceCode} resolves the meet (the pages/link door)', bc.json && bc.json.id === other.id, { status: bc.status });
    const sl = await fetch(BRAND + '/m/' + other.referenceCode, { redirect: 'manual' });
    ok('S2', BRAND + '/m/<code> answers a 302 to /app/pages/link/index?m=<code> (nginx)', sl.status === 302 && String(sl.headers.get('location') || '').includes('/app/pages/link/index?m=' + other.referenceCode), { status: sl.status, location: sl.headers.get('location') });
  } catch (e) {
    ok('Z', 'probe ran to the end', false, { error: String(e && e.stack || e).slice(0, 500) });
  } finally {
    for (const f of cleanup.reverse()) { try { await f(); } catch (e) { /* keep cleaning */ } }
    // G13.2: anything of THIS lane still in the DB (a delete that lost a rate limit, an earlier crashed run) goes too, by its author
    let left = -1;
    try {
      const who = Object.fromEntries([mei, amy, tom, ken].filter(Boolean).map((u) => [u.id, u]));
      const rows = sql(`SELECT id || '|' || "userId" FROM note WHERE text LIKE '[probe] club-posts-links%';`).split('\n').filter(Boolean);
      for (const row of rows) { const [id, uid] = row.split('|'); if (who[uid]) await delNote(id, who[uid]); }
      left = Number(sql(`SELECT count(*) FROM note WHERE text LIKE '[probe] club-posts-links%';`))
        + Number(sql(`SELECT count(*) FROM meet WHERE name LIKE '[probe] club-posts-links%' AND status <> 'cancelled';`))
        + Number(sql(`SELECT count(*) FROM channel WHERE name LIKE '[probe] club-posts-links%' AND "isArchived" = false;`));
    } catch (e) { console.log('litter count failed: ' + e); }
    ok('Z1', 'cleanup: no [probe] club-posts-links note / live meet / live club left on UAT (read from the DB)', left === 0, { left });
    const pass = checks.filter((c) => c.pass).length;
    const out = { id: 'club-posts-links', at: new Date().toISOString(), base: BASE, condition_fired: true, verdict: checks.length && pass === checks.length ? 'pass' : 'fail', pass, fail: checks.length - pass, evidence: checks };
    fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
    console.log('\n' + pass + '/' + checks.length + ' pass → ' + OUT);
    process.exit(checks.length && pass === checks.length ? 0 : 1);
  }
})();

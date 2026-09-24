require('./_guard.cjs'); // G13.3 — run through probes/run.sh
// fix-S2 L6 probe (2026-09-24) — closes the S2 re-check quality issues (gen/l6-scope/S2-competitions-b/recheck.json) at
// 390 px on UAT, EN + 繁 (+ 简 where the row is a language row), and verifies D-comp-match-detail.06 "Submitted by {name}"
// with a DUPR receipt made by the REAL engine path through the UAT sandbox cage (web-uat DUPR_SUBMIT_SANDBOX=1 answers
// sandbox:<id> without any HTTP to hkpl) — safety-gated, proven at the destination (nginx access log window), never SQL.
//
//   Run: bash /root/gen/browser-slot.sh bash /root/social-engine/probes/run.sh fix-S2.probe.cjs            (PHASE=after)
//        PHASE=before … on the UNFIXED app = the planted fault: every must-fail row must FAIL there.
// Fixtures: '[probe] fix-S2 <stamp> …' competitions made through the engine API (se_sbx), cancelled + deleted in finally.
// The only SQL write: two personas' DUPR link (meet_player_level."duprId" = a fake PRB… id) for the seconds between the
// preview and the caged submit — the same fixture uat-dupr-cage.probe.cjs uses — restored at once and again in finally.
// @claims route pages/tournament-match/index :: fix-S2 :: referee-rule · removed-readonly · reserved-guest · clear-time · submitted-by
// @claims route pages/tournament-team/index :: fix-S2 :: match-state · host-not-stranger
// @claims route pages/tournament/index :: fix-S2 :: one-invitation · round-labels-zh · dupr-reasons
'use strict';
const fs = require('fs');
const { execSync, execFileSync } = require('child_process');
const PHASE = process.env.PHASE || 'after';
const DIR = '/root/social-engine/probes';
const SHOTS = DIR + '/fix-S2-shots';
process.env.MU_SHOTS = SHOTS;
fs.mkdirSync(SHOTS, { recursive: true });
const MU = require('/root/gen/mop-up/mu-lib.cjs');
const HIT = require('./_fixs2-hit.cjs');   // FRONTEND_UAT_STANDARD 5B / 5C (AGENT_RULES rule 20)
const { sleep, se, who } = MU;
const stamp = Date.now().toString(36).slice(-5);
const PFX = '[probe] fix-S2 ' + stamp;
const R = { id: 'fix-S2', phase: PHASE, at: new Date().toISOString(), stamp, rows: [], controls: [], errors: [], cleanup: {}, fx: {} };
const ACCESS = '/var/log/nginx/access.log';

function ck(row, what, pass, ev, shot, extra) { const r = { row, what, pass: !!pass, ev: ev === undefined ? null : ev, shot: shot ? 'probes/fix-S2-shots/' + shot + '.png' : null, ...(extra || {}) }; R.rows.push(r); console.log((pass ? 'PASS ' : 'FAIL ') + row + ' | ' + what + ' -> ' + JSON.stringify(r.ev).slice(0, 300)); }
function ctl(name, what, pass, ev) { R.controls.push({ name, what, pass: !!pass, ev }); console.log((pass ? 'CTL-PASS ' : 'CTL-FAIL ') + name + ' | ' + what + ' -> ' + JSON.stringify(ev).slice(0, 300)); }
async function step(name, fn) { try { await fn(); } catch (e) { R.errors.push(name + ': ' + (e && e.stack || e)); console.log('STEP CRASH ' + name + ': ' + (e && e.message)); } }
const sql = (q) => execFileSync('docker', ['exec', '-i', 'social-engine-db-1', 'psql', '-U', 'social', '-d', 'se_sbx', '-At', '-F', '|'], { input: q, encoding: 'utf8' }).trim();
async function must(ep, body, tok) { const r = await se(ep, body, tok); if (r.status >= 300) throw new Error(ep + ' -> ' + r.status + ' ' + JSON.stringify(r.json).slice(0, 240)); return r.json; }
const txt = (p) => MU.text(p).catch(() => '');
const lines = (t, re) => t.split('\n').filter((l) => re.test(l)).slice(0, 8).join(' | ');

async function snap(p, key) { await sleep(500); await p.screenshot({ path: SHOTS + '/' + PHASE + '-' + key + '.png', fullPage: true }).catch(() => undefined); const t = await txt(p); const over = await MU.overflowRight(p).catch(() => []); R.fx['screen:' + key] = { chars: t.length, overflow: over.length, failed: (p.__failed || []).slice(-6), errors: (p.__errors || []).slice(-4) }; return t; }
async function visit(p, route, key, lang) { await MU.open(p, route, lang || 'en'); await sleep(1500); let t = await txt(p); if (/I agree/.test(t)) { await MU.clickText(p, 'I agree').catch(() => undefined); await sleep(800); } return key ? snap(p, key) : txt(p); }
async function tryClick(p, needle, opts) { try { await MU.clickText(p, needle, opts || {}); await sleep((opts && opts.after) || 1200); return true; } catch (e) { return false; } }
async function kebab(p) { const ok = await p.evaluate(() => { const a = [...document.querySelectorAll('.ah-act')].filter((e) => e.getBoundingClientRect().width > 0); const b = a[a.length - 1]; if (!b) return false; b.setAttribute('data-fx', 'keb'); return true; }); if (!ok) return false; await p.click('[data-fx="keb"]'); await sleep(1200); return true; }
/** Visible innermost elements whose own text is exactly `label` (buttons are counted once, not per wrapper). */
const countExact = (p, label) => p.evaluate((label) => [...document.querySelectorAll('*')].filter((e) => { const r = e.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return false; if ((e.innerText || '').trim() !== label) return false; return ![...e.children].some((c) => (c.innerText || '').trim() === label); }).length, label);
/** The value column of a kit Row whose name is `name` (text of the row minus the name). */
const rowText = (p, name) => p.evaluate((name) => { const r = [...document.querySelectorAll('.pg-row')].find((e) => e.getBoundingClientRect().width > 0 && ((e.querySelector('.pg-row-name') || {}).innerText || '').trim() === name); return r ? r.innerText.replace(/\s+/g, ' ').trim() : null; }, name);
const RAW_CODE = /\b[a-z]+_[a-z_]+\b/;   // a bare engine code such as not_connected / uneven_teams

(async () => {
  const made = []; let b = null; const P = {}; const plUndo = [];
  const restoreLinks = () => { while (plUndo.length) { const u = plUndo.pop(); try { if (u.existed) sql(`update meet_player_level set "duprId"=${u.oldD === '' ? 'null' : `'${u.oldD}'`}, "updatedAt"=now() where id='${u.plId}'`); else sql(`delete from meet_player_level where id='${u.plId}'`); } catch (e) { R.errors.push('restore link ' + u.plId + ': ' + e.message); } } };
  try {
    for (const [k, key] of [['host', 'admin'], ['amy', 'player-amy'], ['mei', 'clubowner-mei'], ['tom', 'clubadmin-tom'], ['ken', 'host-ken']]) P[k] = await who(key);
    for (const k of Object.keys(P)) { const me = await must('i', {}, P[k].token); P[k].name = me.name || me.username; }
    const H = P.host.token;
    R.fx.engineRev = execSync("docker inspect -f '{{index .Config.Labels \"org.opencontainers.image.revision\"}}' social-engine-web-uat-1", { encoding: 'utf8' }).trim();
    R.fx.appBundle = ((await (await fetch('https://uat.gripbat.com/app/')).text()).match(/js\/app\.[a-z0-9]+\.js/) || [''])[0];
    const day = 86400e3, now = Date.now();
    const timeline = { startAt: new Date(now + 3 * day).toISOString(), registrationOpenAt: new Date(now - day).toISOString(), registrationCloseAt: new Date(now + 2 * day).toISOString() };
    const mk = async (tag, o) => { const c = await must('competitions/create', { name: PFX + ' ' + tag, sport: 'pickleball', maxEntries: 8, visibility: 'private', autoApprove: true, ...timeline, ...o }, H); made.push(c.id); await must('competitions/status', { competitionId: c.id, action: 'publish' }, H); const sh = await must('competitions/show', { competitionId: c.id }, H); return { id: c.id, at: sh.accessToken }; };
    const ents = async (cid) => (await must('competitions/entries', { competitionId: cid }, H)) || [];
    const q = (C) => 'id=' + C.id + '&at=' + encodeURIComponent(C.at || '');
    b = await MU.browser();
    const ctx = {};
    const page = async (k) => { if (!ctx[k]) ctx[k] = await MU.newCtx(b, { host: 'admin', amy: 'player-amy', mei: 'clubowner-mei', tom: 'clubadmin-tom', ken: 'host-ken' }[k], 390); return ctx[k].page; };

    // ============================================================ C1: team round robin (Team A amy+mei, Team B tom + reserved guest)
    const C1 = await mk('C1', { format: 'roundRobin', participantType: 'team', teamMinSize: 2, teamMaxSize: 3 });
    R.fx.C1 = C1.id;
    let TA, TB, M1, M2, M3;
    await must('competitions/enter', { competitionId: C1.id, name: '[probe] fix-S2 Team A', partnerIds: [P.mei.userId], accessToken: C1.at }, P.amy.token);
    TA = (await ents(C1.id)).find((x) => x.captainId === P.amy.userId);
    // a team needs 2–3 at entry: tom enters with ken invited, then cancels ken (the recheck's own fixture path) — ken stays a stranger
    await must('competitions/enter', { competitionId: C1.id, name: '[probe] fix-S2 Team B', partnerIds: [P.ken.userId], accessToken: C1.at }, P.tom.token);
    TB = (await ents(C1.id)).find((x) => x.captainId === P.tom.userId);
    await must('competitions/entries/partners', { competitionId: C1.id, entryId: TB.id, cancel: [P.ken.userId] }, P.tom.token);
    await must('competitions/entries/partners', { competitionId: C1.id, entryId: TB.id, reserve: { name: '[probe] fix-S2 guest' } }, P.tom.token);
    TB = (await ents(C1.id)).find((x) => x.id === TB.id);
    R.fx.TB = { openSlots: TB.openSlots, reserved: (TB.reservedPlaces || []).length, invitedA: (TA.invitedUserIds || []).length };
    ctl('fixture.C1', 'Team A has mei INVITED (not in); Team B has tom + one reserved place and an open place (read back)', !(TA.userIds || []).includes(P.mei.userId) && (TA.invitedUserIds || []).includes(P.mei.userId) && (TB.reservedPlaces || []).length === 1 && (TB.openSlots || 0) > 0, R.fx.TB);

    // ---- 4a. ONE invitation for the invited player (card + footer showed two Accept buttons)
    await step('4a.invite', async () => {
      const mp = await page('mei');
      const t0 = await visit(mp, 'tournament/index?' + q(C1), 'hub-invited-mei-en');
      const n = await countExact(mp, 'Accept invitation'); const h4a = await HIT.hit(mp, '.tv-cta taro-button-core');
      const hasWho = t0.includes(P.amy.name + ' invited you to play in the team [probe] fix-S2 Team A.');
      const hasDecline = (await countExact(mp, 'Decline')) >= 1;
      await visit(mp, 'tournament/index?' + q(C1), 'hub-invited-mei-zhHant', 'zh_Hant');
      const nz = await countExact(mp, '接受邀請');
      // press the one Accept (the footer) → the engine has mei in Team A
      await visit(mp, 'tournament/index?' + q(C1));
      const pressed = await tryClick(mp, 'Accept invitation', { after: 2500 });
      const ta = (await ents(C1.id)).find((x) => x.id === TA.id);
      const t1 = await snap(mp, 'hub-accepted-mei-en');
      ck('D-comp-detail.67', 'invited player: exactly ONE "Accept invitation" (EN) / 接受邀請 (繁) on the hub, the line names who invited them + Decline; pressing it puts them in the team (engine)', n === 1 && nz === 1 && hasWho && hasDecline && pressed && h4a.ok && (ta.userIds || []).includes(P.mei.userId) && /You are in/.test(t1), { hit5B: h4a, acceptButtonsEn: n, acceptButtonsZh: nz, hasWho, hasDecline, pressed, meiIn: (ta.userIds || []).includes(P.mei.userId), footer: lines(t0, /invited|Accept|Decline/) }, 'hub-invited-mei-en',
        { item: '4a', vsReclub: 'better — Reclub footer has Accept only; ours names who invited you and offers Decline, one set of buttons' });
    });

    // ---- 4b. a host NOT on the team sees host actions, never the stranger "Ask to join"
    await step('4b.host-not-stranger', async () => {
      const hp = await page('host');
      const route = 'tournament-team/index?id=' + C1.id + '&e=' + TB.id + '&at=' + encodeURIComponent(C1.at);
      const t0 = await visit(hp, route, 'team-B-host-en'); const h4b = await HIT.hit(hp, '.ctm-btns taro-button-core');
      const kp = await page('ken');
      const tk = await visit(kp, route, 'team-B-stranger-ken-en');
      ctl('4b.stranger', 'POSITIVE CONTROL: a stranger (ken, no entry) DOES see "This team has a free place." + Ask to join on the same page — the check can see the card', /This team has a free place\./.test(tk) && /Ask to join/.test(tk), { line: lines(tk, /free place|Ask to join/) });
      await visit(hp, route, 'team-B-host-zhHant', 'zh_Hant');
      ck('D-comp-team-detail.04', 'host (not on the team) on an open team page: host actions (Invite a partner / Assign player / Reserve a spot) and NO stranger card "This team has a free place. · Ask to join"', !/This team has a free place\./.test(t0) && !/Ask to join/.test(t0) && /Invite a partner/.test(t0) && /Assign player/.test(t0) && h4b.ok, { hit5B: h4b, host: lines(t0, /free place|Ask to join|Invite a partner|Assign player|Reserve a spot/) }, 'team-B-host-en',
        { item: '4b', vsReclub: 'equal — Reclub shows the manager the slot actions only; the contradictory stranger card is gone' });
    });

    // ---- start; M1 completed (DUPR Manager reasons), M2 in progress with a score, M3 removed; ken = staff referee
    await step('C1.start', async () => {
      const st = await se('competitions/staff/update', { competitionId: C1.id, userId: P.ken.userId, role: 'referee' }, H); R.fx.staffRef = st.status;
      await must('competitions/status', { competitionId: C1.id, action: 'start' }, H);
      const ms = await must('competitions/matches/list', { competitionId: C1.id }, H);
      M1 = ms[0];
      await must('competitions/matches/upsert', { competitionId: C1.id, matchId: M1.id, scores: [{ t1: 11, t2: 7, type: 'standard' }], finalize: true }, H);
      M2 = await must('competitions/matches/upsert', { competitionId: C1.id, entry1Id: TA.id, entry2Id: TB.id, name: 'fix-S2 live' }, H);
      await must('competitions/matches/upsert', { competitionId: C1.id, matchId: M2.id, scores: [{ t1: 11, t2: 5, type: 'standard' }], finalize: false }, H);
      await must('competitions/matches/upsert', { competitionId: C1.id, matchId: M2.id, startAt: new Date(now + day).toISOString() }, H);
      M3 = await must('competitions/matches/upsert', { competitionId: C1.id, entry1Id: TA.id, entry2Id: TB.id, name: 'fix-S2 removed' }, H);
      await must('competitions/matches/upsert', { competitionId: C1.id, matchId: M3.id, remove: true }, H);
      const all = await must('competitions/matches/list', { competitionId: C1.id }, H);
      const by = (id) => all.find((x) => x.id === id) || {};
      R.fx.M = { M1: [M1.id, by(M1.id).status], M2: [M2.id, by(M2.id).status, (by(M2.id).scores || []).length, by(M2.id).startAt], M3: [M3.id, by(M3.id).status], refs: (by(M2.id).referees || []).length };
      ctl('fixture.matches', 'M1 completed, M2 inProgress with a score and a time, M3 cancelled (removed), ken is a staff referee (read back)', by(M1.id).status === 'completed' && by(M2.id).status === 'inProgress' && (by(M2.id).scores || []).length === 1 && !!by(M2.id).startAt && by(M3.id).status === 'cancelled' && R.fx.staffRef === 200, R.fx.M);
    });
    const mRoute = (m) => 'tournament-match/index?id=' + C1.id + '&m=' + m.id + '&at=' + encodeURIComponent(C1.at);

    // ---- 3a. team page lists each match WITH its state (Removed / Match in progress + running score)
    await step('3a.team-matches', async () => {
      const ap = await page('amy');
      const route = 'tournament-team/index?id=' + C1.id + '&e=' + TA.id + '&at=' + encodeURIComponent(C1.at);
      const t0 = await visit(ap, route, 'team-A-amy-en'); const h3a = await HIT.hit(ap, '.pg-row.is-tap');
      const rows = await ap.evaluate(() => [...document.querySelectorAll('.pg-row')].filter((e) => e.getBoundingClientRect().width > 0 && /^vs /.test(((e.querySelector('.pg-row-name') || {}).innerText || '').trim())).map((e) => e.innerText.replace(/\s+/g, ' ').trim()));
      const removedRow = rows.find((r) => /Removed/.test(r));
      const liveRow = rows.find((r) => /Match in progress/.test(r) && /11–5/.test(r));
      const doneRow = rows.find((r) => /\b[WL] [01]–[01]\b/.test(r));
      const tz = await visit(ap, route, 'team-A-amy-zhHant', 'zh_Hant');
      ck('D-comp-team-detail.01', 'team page Matches: the removed match reads "Removed", the in-progress match "Match in progress" + its running score 11–5, the finished one W 1–0 (EN); 繁: 已移除 / 比賽進行中', !!removedRow && !!liveRow && !!doneRow && /已移除/.test(tz) && /比賽進行中/.test(tz) && h3a.ok, { hit5B: h3a, rows, zh: lines(tz, /已移除|比賽進行中|第 1 輪/) }, 'team-A-amy-en',
        { item: '3a', vsReclub: 'better — Reclub team matches show a status chip; ours adds the live score of a match in progress' });
      ck('D-comp-team-detail.07', 'same list, same rule (duplicate of .01): no removed match looks like a live one', !!removedRow && !rows.some((r) => /fix-S2 removed/.test(r) && !/Removed/.test(r)), { removedRow }, 'team-A-amy-en', { item: '3a', vsReclub: 'equal' });
    });

    // ---- 3b. removed match is read-only; ONE referee rule on every match for every role
    await step('3b.removed-and-referee', async () => {
      const hp = await page('host'); const ap = await page('amy');
      const t3 = await visit(hp, mRoute(M3), 'm3-removed-host-en');
      const swap3 = await countExact(hp, '⇅ Swap sides');
      const ref3 = await rowText(hp, 'Referees');
      await visit(hp, mRoute(M3), 'm3-removed-host-zhHant', 'zh_Hant');
      ck('D-comp-match-detail.09', 'removed match (host): "This match is no longer available.", NO Swap sides, NO Referees row (nobody referees a removed match), no Input score', /This match is no longer available\./.test(t3) && swap3 === 0 && ref3 == null && !/Input score|Edit score/.test(t3), { swap3, ref3, head: lines(t3, /Removed|no longer|Swap|Referee/) }, 'm3-removed-host-en',
        { item: '3b', vsReclub: 'equal — Reclub shows "no longer available" with no actions; ours keeps the teams/time readable (read-only)' });
      await visit(hp, mRoute(M2), 'm2-live-host-en'); const h3b = await HIT.hit(hp, '.cmx-swap'); R.fx.hit3b = h3b; const refHost = await rowText(hp, 'Referees'); const swap2 = await countExact(hp, '⇅ Swap sides');
      await visit(ap, mRoute(M2), 'm2-live-amy-en'); const refAmy = await rowText(ap, 'Referees');
      ctl('3b.swap-live', 'CONTROL: a live match still offers Swap sides (the removed-match check is not blind to the control)', swap2 === 1, { swap2 });
      ck('D-comp-match-detail.09', 'ONE referee rule: the live match reads the SAME referee for the host and a player — the competition referee Ken Wong (no match referee set) — never "No referee" for one and a name for the other', refHost && refAmy && refHost === refAmy && refHost.includes(P.ken.name) && !/No referee/.test(refHost) && R.fx.hit3b.ok, { refHost, refAmy, hit5B: R.fx.hit3b }, 'm2-live-host-en', { item: '3b', vsReclub: 'better — Reclub shows only the match ref; ours shows who actually referees (the competition referee) consistently' });
    });

    // ---- 4c. the schedule card: "Clear time" (an action), never an "Unscheduled" chip beside a set time
    await step('4c.clear-time', async () => {
      const hp = await page('host');
      const t0 = await visit(hp, mRoute(M2), 'm2-schedule-host-en'); const h4c = await HIT.hit(hp, '.cmx-btns taro-button-core'); const st4c = await HIT.selfTest(hp, '.cmx-btns taro-button-core'); R.fx.selfTest4c = st4c;
      const card = lines(t0, /Schedule match|Save time|Unscheduled|Clear time|Assign court/);
      const hasTime = !/Time\s*\n?\s*Unscheduled/.test(t0) && !!R.fx.M.M2[3];
      await visit(hp, mRoute(M2), 'm2-schedule-host-zhHant', 'zh_Hant'); const tz = await txt(hp);
      await visit(hp, mRoute(M2));
      const pressed = await tryClick(hp, 'Clear time', { after: 2500 });
      const m2 = (await must('competitions/matches/list', { competitionId: C1.id }, H)).find((x) => x.id === M2.id) || {};
      const t1 = await snap(hp, 'm2-cleared-host-en');
      ck('D-comp-match-detail.05', 'host schedule card with a set time: the clear action reads "Clear time" (繁 清除時間), no "Unscheduled" word beside the time; pressed → engine startAt null and the Time row then reads Unscheduled', hasTime && h4c.ok && st4c.caught && /Clear time/.test(t0) && !/Unscheduled/.test(t0) && /清除時間/.test(tz) && pressed && m2.startAt == null && /Unscheduled/.test(t1), { hit5B: h4c, selfTest: st4c, card, pressed, startAtAfter: m2.startAt, after: lines(t1, /Time|Unscheduled/) }, 'm2-schedule-host-en',
        { item: '4c', vsReclub: 'equal — Reclub "clear schedule" is an action; the state word no longer sits beside a set time' });
    });

    // ---- 5. the players pane shows a team's reserved guest
    await step('5.reserved-guest', async () => {
      const hp = await page('host');
      const t0 = await visit(hp, mRoute(M2), 'm2-players-host-en');
      const players = lines(t0, /Amy|Mei|Tom|guest|Reserved/);
      await visit(hp, mRoute(M2), 'm2-players-host-zhHant', 'zh_Hant'); const tz = await txt(hp);
      ck('D-comp-match-detail.04', 'match Players pane lists Team B\'s reserved place "[probe] fix-S2 guest" · Team B · Reserved (繁 預留) beside the seated players', /\[probe\] fix-S2 guest/.test(t0) && /\[probe\] fix-S2 Team B · Reserved/.test(t0) && /預留/.test(tz), { players }, 'm2-players-host-en',
        { item: '5', vsReclub: 'equal — Reclub lists the reserved participant in the match roster' });
    });

    // ---- 2. Draw tab round labels in 繁 / 简 (were "小組 1 · Round 1")
    await step('2.round-labels', async () => {
      const hp = await page('host');
      const te = await visit(hp, 'tournament/index?' + q(C1) + '&tab=draw', 'draw-host-en');
      const th = await visit(hp, 'tournament/index?' + q(C1) + '&tab=draw', 'draw-host-zhHant', 'zh_Hant');
      const ts = await visit(hp, 'tournament/index?' + q(C1) + '&tab=draw', 'draw-host-zhHans', 'zh_Hans');
      ctl('2.en', 'CONTROL: the EN draw tab shows "Round 1" (the label exists, so the zh check reads a real label)', /Round 1/.test(te), { en: lines(te, /Round \d/) });
      ck('D-match-format.08', 'Draw tab round labels translated: 繁 "第 1 輪", 简 "第 1 轮", no English "Round n" left on either', /第 1 輪/.test(th) && /第 1 轮/.test(ts) && !/Round \d/.test(th) && !/Round \d/.test(ts), { zhHant: lines(th, /輪|Round/), zhHans: lines(ts, /轮|Round/) }, 'draw-host-zhHant',
        { item: '2', vsReclub: 'equal — Reclub localises round names' });
    });

    // ---- 1. DUPR Manager reasons: sentences, no raw code, names the players without a DUPR link
    await step('1.dupr-reasons', async () => {
      const hp = await page('host');
      const read = async (lang, key) => { await visit(hp, 'tournament/index?' + q(C1), null, lang); await kebab(hp); await tryClick(hp, lang === 'en' ? 'DUPR Manager' : 'DUPR 管理', { after: 2500 }); if (lang !== 'en') await tryClick(hp, 'DUPR Manager', { after: 2000 }); const t = await snap(hp, key); const sub = await hp.evaluate(() => { const s = [...document.querySelectorAll('.cmt-sheet *')].filter((e) => e.getBoundingClientRect().width > 0 && !e.children.length).map((e) => (e.innerText || '').trim()).filter(Boolean); return s; }); return { t, sub }; };
      const en = await read('en', 'dupr-manager-host-en');
      const reason = en.sub.find((s) => /players|DUPR ID|linked/.test(s)) || '';
      const sent = ((hp.__req || []).filter((r) => /submit-dupr/.test(r.url))).length;
      const zh = await read('zh_Hant', 'dupr-manager-host-zhHant');
      const reasonZh = zh.sub.find((s) => /雙方|DUPR ID|DUPR 帳戶/.test(s)) || '';
      ck('D-dupr-activity-manager.07', 'DUPR Manager reason line = sentences only: "The two sides have a different number of players. · No linked DUPR ID: <names>" — no raw code, no ".,"; 繁 the same in Chinese; nothing submitted', reason.includes('The two sides have a different number of players.') && /No linked DUPR ID: .*(Amy|Mei|Tom)/.test(reason) && !RAW_CODE.test(reason) && !/\.,/.test(reason) && /雙方球員人數不同。/.test(reasonZh) && /未連結 DUPR ID/.test(reasonZh) && !RAW_CODE.test(reasonZh) && sent === 0, { reason, reasonZh, submitRequests: sent }, 'dupr-manager-host-en',
        { item: '1', vsReclub: 'better — Reclub names the error; ours names the players who still need to link DUPR' });
    });

    // ============================================================ 6. "Submitted by {name}" — a receipt made by the engine through the UAT cage
    await step('6.submitted-by', async () => {
      const C2 = await mk('C2 singles', { format: 'roundRobin', participantType: 'singles' });
      R.fx.C2 = C2.id;
      await must('competitions/enter', { competitionId: C2.id, accessToken: C2.at }, P.amy.token);
      await must('competitions/enter', { competitionId: C2.id, accessToken: C2.at }, P.tom.token);
      await must('competitions/status', { competitionId: C2.id, action: 'start' }, H);
      const mm = (await must('competitions/matches/list', { competitionId: C2.id }, H))[0];
      await must('competitions/matches/upsert', { competitionId: C2.id, matchId: mm.id, scores: [{ t1: 11, t2: 8, type: 'standard' }], finalize: true }, H);
      const route = 'tournament-match/index?id=' + C2.id + '&m=' + mm.id + '&at=' + encodeURIComponent(C2.at);
      // negative control: before any submit the page has no "Submitted by"
      const hp = await page('host');
      const t0 = await visit(hp, route, 'c2-before-submit-host-en');
      ctl('6.neg', 'CONTROL: before the caged submit the match page shows no "Submitted by" (the check can tell)', !/Submitted by/.test(t0), { dupr: lines(t0, /DUPR|Submitted/) });
      // SAFETY GATE: the cage must be live on web-uat (env + marker from CODE in the running built tree)
      const env = execFileSync('docker', ['exec', 'social-engine-web-uat-1', 'printenv', 'DUPR_SUBMIT_SANDBOX'], { encoding: 'utf8' }).trim();
      const mark = Number(execFileSync('docker', ['exec', 'social-engine-web-uat-1', 'sh', '-c', "grep -rl 'uat_cage_env_missing' /misskey/packages/backend/built | wc -l"], { encoding: 'utf8' }).trim());
      ctl('6.gate', 'SAFETY GATE: web-uat carries DUPR_SUBMIT_SANDBOX=1 and runs the cage code (marker in the built tree)', env === '1' && mark > 0, { env, mark });
      if (!(env === '1' && mark > 0)) throw new Error('SAFETY: the cage is not live on web-uat — nothing pressed');
      // link a FAKE DUPR id for the two players (fixture), only around the caged submit
      for (const uid of [P.amy.userId, P.tom.userId]) {
        const r0 = sql(`select id, coalesce("duprId",'') from meet_player_level where "userId"='${uid}' and sport='pickleball' limit 1`); const prb = 'PRBFS2' + uid.slice(-5).toUpperCase();
        if (r0) { const [plId, oldD] = r0.split('|'); plUndo.push({ plId, existed: true, oldD }); sql(`update meet_player_level set "duprId"='${prb}', "updatedAt"=now() where id='${plId}'`); }
        else { const plId = 'plfs2' + uid.slice(0, 12); plUndo.push({ plId, existed: false }); sql(`insert into meet_player_level (id,"userId",sport,"duprId","updatedAt","source") values ('${plId}','${uid}','pickleball','${prb}',now(),'probe')`); }
      }
      const off = fs.statSync(ACCESS).size;
      let pv, sent;
      try {
        pv = await must('competitions/matches/submit-dupr', { competitionId: C2.id, matchId: mm.id }, H);
        if (!pv.willSubmit) throw new Error('preview would not submit: ' + JSON.stringify(pv.eligibility) + ' ' + JSON.stringify(pv.consent));
        sent = await must('competitions/matches/submit-dupr', { competitionId: C2.id, matchId: mm.id, confirm: true }, H);
      } finally { restoreLinks(); }
      await sleep(3000);
      const buf = fs.readFileSync(ACCESS); const win = buf.length < off ? null : buf.slice(off).toString();
      const hits = win == null ? -1 : win.split('\n').filter((l) => l.includes('/api/v1/social/dupr/submit')).length;
      const row = sql(`select "duprStatus", "duprRef", "duprError", "duprSubmittedById" from competition_match where id='${mm.id}'`);
      R.fx.receipt = { row, hits, match: sent && sent.match ? { duprStatus: sent.match.duprStatus, duprRef: sent.match.duprRef, duprError: sent.match.duprError } : null };
      ctl('6.receipt', 'the caged engine path wrote the receipt: submitted | sandbox:<id> | sandbox_not_sent | submitted by the host; 0 hits on hkpl /api/v1/social/dupr/submit in the window', row === `submitted|sandbox:${mm.id}|sandbox_not_sent|${P.host.userId}` && hits === 0, R.fx.receipt);
      const t1 = await visit(hp, route, 'c2-submitted-host-en'); const dupr = await rowText(hp, 'DUPR');
      const ap = await page('amy'); await visit(ap, route, 'c2-submitted-amy-en'); const duprAmy = await rowText(ap, 'DUPR');
      await visit(hp, route, 'c2-submitted-host-zhHant', 'zh_Hant'); const tz = await txt(hp);
      ck('D-comp-match-detail.06', 'match page DUPR row after a real (caged) engine submit: "Test only" + "Submitted by ' + P.host.name + ' · <when>" + "Test environment — not sent to DUPR" — for the host and a player; 繁 renders the line', !!dupr && dupr.includes('Submitted by ' + P.host.name) && /Test only/.test(dupr) && /Test environment — not sent to DUPR/.test(dupr) && !!duprAmy && duprAmy.includes('Submitted by ' + P.host.name) && tz.includes(P.host.name) && hits === 0, { dupr, duprAmy, zh: lines(tz, /DUPR|提交/) }, 'c2-submitted-host-en',
        { item: '6', vsReclub: 'equal — Reclub badge "Submitted by {name}"; ours adds when, and says honestly on UAT that nothing reached DUPR' });
    });
  } catch (e) {
    R.errors.push('main: ' + (e && e.stack || e)); console.log('CRASH ' + (e && e.message));
  } finally {
    restoreLinks();
    try { if (b) await b.close(); } catch (e) { /* */ }
    const H = P.host && P.host.token;
    for (const cid of made) {
      try { await se('competitions/cancel', { competitionId: cid, message: 'fix-S2 fixture' }, H); const d = await se('competitions/delete', { competitionId: cid }, H); R.cleanup[cid] = d.status; } catch (e) { R.cleanup[cid] = 'error ' + e.message; }
    }
    try { R.cleanup.left = Number(sql(`select count(*) from competition where name like '${PFX.replace(/'/g, "''")}%' and status <> 'cancelled'`)); R.cleanup.rows = Number(sql(`select count(*) from competition where name like '${PFX.replace(/'/g, "''")}%'`)); } catch (e) { R.cleanup.left = 'error'; }
    try { R.cleanup.linksLeft = Number(sql(`select count(*) from meet_player_level where "duprId" like 'PRBFS2%'`)); } catch (e) { R.cleanup.linksLeft = 'error'; }
    const fails = R.rows.filter((r) => !r.pass).length, ctlFails = R.controls.filter((c) => !c.pass).length;
    R.summary = { rows: R.rows.length, pass: R.rows.length - fails, fail: fails, controls: R.controls.length, controlFails: ctlFails, errors: R.errors.length };
    fs.writeFileSync(DIR + '/fix-S2.' + PHASE + '.json', JSON.stringify(R, null, 1));
    console.log('WROTE fix-S2.' + PHASE + '.json', JSON.stringify(R.summary), 'cleanup', JSON.stringify(R.cleanup));
    process.exit(0);
  }
})();

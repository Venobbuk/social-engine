// mop-up-comp.probe.cjs — lane mop-up, sub-lane mop-up-comp (2026-09-24). Run: bash /root/gen/browser-slot.sh node probes/mop-up-comp.probe.cjs
// LIVE UAT: app https://uat.gripbat.com/app/ at 390 px, engine web-uat (se_sbx). Personas sign in NATIVELY (probes/_native-session.cjs
// through /root/gen/mop-up/mu-lib.cjs). Every write pressed in the browser is READ BACK from the se_sbx row; every refusal is asked of
// a role that must be refused; a fault is planted before a check is trusted (G16.1). NO DUPR SUBMIT IS EVER SENT (a DUPR receipt is
// PLANTED in se_sbx for the "Submitted by" row; nothing reaches hkpl).
//   ITEM 1  reserve ONE place on a competition team (engine competitions/entries/partners reserve / releasePlaceId / swapPlaceId)
//   ITEM 2  the comp-fixes-b rows that were at L5 — pressed, before/after, read back (detail.45, manage-seeds.02, match-detail.01/.02/.06,
//           comp-score-sets.01, comp-score.04, score-board.02, sublocations.01, match-format.13/.16/.17, match-share-image.02 (the PNG is
//           captured and its bytes checked), the Score values modal + the two other copy bugs)
// Fixtures: '[probe] mop-up comp <stamp> …' competitions, cancelled + deleted in finally (the verdict says loudly if not).
// @claims endpoint competitions/entries/partners :: mop-up-comp :: reserve,release,swap
'use strict';
const fs = require('fs');
const { execSync } = require('child_process');
process.env.MU_SHOTS = process.env.MU_SHOTS || '/root/social-engine/probes/mop-up-comp-shots';
const MU = require('/root/gen/mop-up/mu-lib.cjs');
const { sleep, se, who } = MU;
const OUT = '/root/social-engine/probes/mop-up-comp.verdict.json';
const stamp = Date.now().toString(36).slice(-5);
const PFX = '[probe] mop-up comp ' + stamp;
const R = { id: 'mop-up-comp', at: new Date().toISOString(), condition_fired: true, checks: [], errors: [], cleanup: {}, shots: [] };
const code = (r) => (r && r.json && r.json.error && r.json.error.code) || null;
function ck(item, what, pass, ev) { R.checks.push({ item, what, pass: !!pass, evidence: ev }); console.log((pass ? 'PASS ' : 'FAIL ') + item + ' | ' + what + ' -> ' + JSON.stringify(ev === undefined ? null : ev).slice(0, 300)); }
async function step(name, fn) { try { await fn(); } catch (e) { R.errors.push(name + ': ' + (e && e.stack || e)); ck(name, 'step crashed', false, String(e && e.message || e)); } }
function sql(q) { return execSync('docker exec -i social-engine-db-1 psql -U social -d se_sbx -At -F "|" -v ON_ERROR_STOP=1', { input: q, encoding: 'utf8' }).trim(); }
async function must(ep, body, tok) { const r = await se(ep, body, tok); if (r.status >= 300) throw new Error(ep + ' -> ' + r.status + ' ' + JSON.stringify(r.json).slice(0, 240)); return r.json; }
const places = (eid) => JSON.parse(sql(`select "reservedPlaces"::text from competition_entry where id='${eid}'`) || '[]');
const users = (eid) => sql(`select array_to_string("userIds", ',') from competition_entry where id='${eid}'`).split(',').filter(Boolean);
const invited = (eid) => sql(`select array_to_string("invitedUserIds", ',') from competition_entry where id='${eid}'`).split(',').filter(Boolean);

// ------------------------------------------------------------------------------------------------ browser helpers
const txt = (p) => MU.text(p).catch(() => '');
async function click(p, needle, opts) { try { await MU.clickText(p, needle, opts || {}); await sleep(1200); return true; } catch (e) { return false; } }
async function mustClick(p, needle, opts) { await MU.clickText(p, needle, opts || {}); await sleep(1300); }
async function dlg(p, label) { return mustClick(p, label, { within: '.nut-dialog' }); }
async function kebab(p) { await p.evaluate(() => { const a = [...document.querySelectorAll('.ah-act')].filter((e) => e.getBoundingClientRect().width > 0); const b = a[a.length - 1]; if (b) b.click(); }); await sleep(1200); }
async function shot(p, key) { const s = await MU.shot(p, key).catch(() => null); if (s) R.shots.push(s); return s; }
async function visit(p, route, key, lang) {
  await MU.open(p, route, lang || 'en'); await sleep(2000);
  let t = await txt(p);
  if (/I agree/.test(t)) { await click(p, 'I agree'); t = await txt(p); }
  for (const w of ['Skip', 'Not now', 'Later']) if (/Four quick questions|Allow location|Use my location/.test(t)) { await click(p, w); t = await txt(p); }
  if (key) await shot(p, key);
  return t;
}
async function typeInto(p, sel, value) {
  const h = await p.evaluateHandle((sel) => [...document.querySelectorAll(sel)].filter((e) => e.getBoundingClientRect().width > 0).pop(), sel);
  const el = h.asElement(); if (!el) throw new Error('no input ' + sel);
  await el.click({ clickCount: 3 }); await p.keyboard.press('Backspace');
  await el.type(value, { delay: 25 }); await sleep(500);
}
/** The open dialog: its text, the leaf elements that read as a button (OK / Cancel / Confirm / 取消 / 確定 …), the content's word-break. */
const dialogInfo = (p) => p.evaluate(() => { const d = [...document.querySelectorAll('.nut-dialog')].find((e) => e.getBoundingClientRect().width > 0); if (!d) return null; const c = d.querySelector('.ak-content'); const leaves = [...d.querySelectorAll('*')].filter((e) => !e.children.length && e.getBoundingClientRect().width > 0).map((e) => (e.innerText || '').trim()); return { text: d.innerText, buttons: leaves.filter((t) => /^(OK|Cancel|Confirm|取消|確定|确定|確認|确认)$/.test(t)), wb: c ? getComputedStyle(c).wordBreak : null }; });
const inputValues = (p) => p.evaluate(() => [...document.querySelectorAll('input')].filter((e) => e.getBoundingClientRect().width > 0).map((e) => e.value));

(async () => {
  const made = []; let H = null, b = null;
  try {
    // ------------------------------------------------------------------------------------------ sign-in (native)
    const P = {};
    for (const [k, key] of [['host', 'admin'], ['amy', 'player-amy'], ['mei', 'clubowner-mei'], ['tom', 'clubadmin-tom'], ['ken', 'host-ken']]) P[k] = await who(key);
    for (const k of Object.keys(P)) { const me = await must('i', {}, P[k].token); P[k].name = me.name || me.username; P[k].username = me.username; }
    ck('setup.signin', 'five personas (the native logins that exist: admin = host, amy, mei, tom, ken) signed in natively (engine token, /api/i answers)', Object.values(P).every((s) => s.token && s.userId), Object.fromEntries(Object.entries(P).map(([k, s]) => [k, s.username])));
    H = P.host.token;
    const day = 86400e3, now = Date.now();
    const timeline = { startAt: new Date(now + 3 * day).toISOString(), registrationOpenAt: new Date(now - day).toISOString(), registrationCloseAt: new Date(now + 2 * day).toISOString() };
    b = await MU.browser();
    const HB = await MU.newCtx(b, 'admin', 390);
    const hp = HB.page;
    // capture every blob the page turns into a download (the share image) — URL.createObjectURL is the one door share-card.ts uses
    await hp.evaluateOnNewDocument(() => { const o = URL.createObjectURL.bind(URL); window.__blobs = []; URL.createObjectURL = (x) => { try { if (x instanceof Blob) window.__blobs.push(x); } catch (e) { /* */ } return o(x); }; });

    // ================================================================= ITEM 1 — reserve ONE place on a team (C0, open, teams of 2–3)
    const c0 = await must('competitions/create', { name: PFX + ' places', sport: 'pickleball', format: 'roundRobin', participantType: 'team', teamMinSize: 2, teamMaxSize: 3, maxEntries: 8, visibility: 'public', autoApprove: true, ...timeline }, H);
    made.push(c0.id); const C0 = c0.id;
    await must('competitions/status', { competitionId: C0, action: 'publish' }, H);
    const A = await must('competitions/entries/update', { competitionId: C0, userIds: [P.amy.userId, P.mei.userId], name: '[probe] mop-up Team A' }, H);
    // Team R: captain tom alone (he names ken, then cancels the invitation); Team S: ken with an invitation tester2 never answers
    const Rr = await must('competitions/enter', { competitionId: C0, name: '[probe] mop-up Team R', partnerIds: [P.ken.userId] }, P.tom.token);
    const R0 = (await must('competitions/entries', { competitionId: C0 }, H)).find((e) => e.captainId === P.tom.userId);
    await must('competitions/entries/partners', { competitionId: C0, entryId: R0.id, cancel: [P.ken.userId] }, P.tom.token);
    ck('I1.setup', 'fixture is real: open team competition (2–3 per team); Team A amy+mei (1 open place), Team R captain tom alone (his invitation to ken cancelled)', A.openSlots === 1 && users(R0.id).join() === P.tom.userId && invited(R0.id).length === 0 && !!Rr, { A: A.openSlots, R: users(R0.id).length });

    await step('I1.engine', async () => {
      const pk = async (eid, tok) => (await must('competitions/entries', { competitionId: C0 }, tok || H)).find((e) => e.id === eid);
      const r0 = await pk(R0.id);
      ck('I1.engine.plant-incomplete', 'PLANT/CONTROL: tom alone in a 2–3 team is NOT complete (complete false) and has 2 open places', r0.complete === false && r0.openSlots === 2, { complete: r0.complete, openSlots: r0.openSlots });
      const r1 = await se('competitions/entries/partners', { competitionId: C0, entryId: R0.id, reserve: { name: '[probe] mop-up guest R', gender: 'male', level: 3.5 } }, P.tom.token);
      const pl = places(R0.id);
      ck('I1.engine.captain-reserve', 'the CAPTAIN reserves one place under a name (row: 1 reserved place, name/gender/level stored); the team is now complete with 1 open place', r1.status === 200 && pl.length === 1 && pl[0].name === '[probe] mop-up guest R' && pl[0].gender === 'male' && pl[0].level === 3.5 && r1.json.complete === true && r1.json.openSlots === 1 && r1.json.reservedPlaces.length === 1, { status: r1.status, row: pl, complete: r1.json && r1.json.complete, openSlots: r1.json && r1.json.openSlots });
      const st = await se('competitions/entries/partners', { competitionId: C0, entryId: R0.id, reserve: { name: 'x' } }, P.ken.token);
      const pm = await se('competitions/entries/partners', { competitionId: C0, entryId: R0.id, reserve: { name: 'x' } }, P.mei.token);
      ck('I1.engine.refuse-stranger', 'a player with no role on Team R (ken) and another team player (mei) may not reserve on Team R (COMPETITION_FORBIDDEN); row unchanged', code(st) === 'COMPETITION_FORBIDDEN' && code(pm) === 'COMPETITION_FORBIDDEN' && places(R0.id).length === 1, { ken: code(st), mei: code(pm) });
      const r2 = await se('competitions/entries/partners', { competitionId: C0, entryId: R0.id, reserve: {} }, P.tom.token);
      const full = await se('competitions/entries/partners', { competitionId: C0, entryId: R0.id, reserve: { name: 'one too many' } }, P.tom.token);
      const inv = await se('competitions/entries/partners', { competitionId: C0, entryId: R0.id, invite: [P.host.userId] }, P.tom.token);
      ck('I1.engine.full', 'PLANT: a team of 3 holding 1 player + 2 reserved places is full — a 3rd reserve AND a partner invite are refused (COMPETITION_TEAM_FULL); the 2nd place took the default name', r2.status === 200 && places(R0.id).length === 2 && places(R0.id)[1].name === 'Reserved spot' && code(full) === 'COMPETITION_TEAM_FULL' && code(inv) === 'COMPETITION_TEAM_FULL', { second: r2.status, full: code(full), invite: code(inv) });
      const rel = await se('competitions/entries/partners', { competitionId: C0, entryId: R0.id, releasePlaceId: places(R0.id)[1].id }, P.tom.token);
      ck('I1.engine.release', 'the captain releases a place: 1 left, 1 open place again', rel.status === 200 && places(R0.id).length === 1 && rel.json.openSlots === 1, { status: rel.status, left: places(R0.id).length });
      const pid = places(R0.id)[0].id;
      const sw = await se('competitions/entries/partners', { competitionId: C0, entryId: R0.id, swapPlaceId: pid, swapUserId: P.host.userId }, P.tom.token);
      ck('I1.engine.captain-swap', 'Swap from community by the CAPTAIN invites the player (consent): the place is gone, admin waits in invitedUserIds, not seated', sw.status === 200 && places(R0.id).length === 0 && invited(R0.id).includes(P.host.userId) && !users(R0.id).includes(P.host.userId), { status: sw.status, invited: invited(R0.id), users: users(R0.id).length });
      await must('competitions/invitations/respond', { competitionId: C0, entryId: R0.id, accept: false }, P.host.token);
      await must('competitions/entries/partners', { competitionId: C0, entryId: R0.id, reserve: { name: '[probe] mop-up guest R' } }, P.tom.token);
      const bad = await se('competitions/entries/partners', { competitionId: C0, entryId: R0.id, releasePlaceId: 'aaaaaaaaaaaaaaaa' }, P.tom.token);
      ck('I1.engine.no-such-place', 'an unknown place id is refused (NO_SUCH_ENTRY), the real one stays', code(bad) === 'NO_SUCH_ENTRY' && places(R0.id).length === 1, { code: code(bad) });
    });

    await step('I1.ui-captain', async () => {
      // the CAPTAIN in the browser: Team R has 1 open place; press Reserve a spot, save the default
      const TB = await MU.newCtx(b, 'clubadmin-tom', 390); const tp = TB.page;
      const t = await visit(tp, 'tournament-team/index?id=' + C0 + '&e=' + R0.id, 'i1-captain-team');
      const before = places(R0.id).length;
      await mustClick(tp, 'Reserve a spot');
      const ed = await txt(tp); await shot(tp, 'i1-captain-editor');
      await mustClick(tp, 'Save');
      await sleep(1500); const after = places(R0.id); const t2 = await txt(tp); await shot(tp, 'i1-captain-reserved');
      ck('I1.ui.captain-reserve', 'captain tom presses Reserve a spot → the editor (Name / Gender / Age group / Level) → Save: a 2nd reserved place is stored and both show as Reserved on the team page', /Reserve a spot/.test(t) && /Gender/.test(ed) && /Age group/.test(ed) && before === 1 && after.length === 2 && (t2.match(/Reserved/g) || []).length >= 2, { before, after: after.map((x) => x.name) });
      await TB.ctx.close();
      await must('competitions/entries/partners', { competitionId: C0, entryId: R0.id, releasePlaceId: after[1].id }, P.tom.token);
    });

    await step('I1.ui-host', async () => {
      const route = 'tournament-team/index?id=' + C0 + '&e=' + A.id;
      let t = await visit(hp, route, 'i1-host-team-before');
      ck('I1.ui.before', 'Team A (1 open place): the host sees Reserve a spot beside Invite a partner; no Reserved row yet', /Reserve a spot/.test(t) && /Invite a partner/.test(t) && places(A.id).length === 0, {});
      // reserve
      await mustClick(hp, 'Reserve a spot');
      await typeInto(hp, 'input[placeholder="Reserved spot name (optional)"]', '[probe] mop-up guest');
      await mustClick(hp, 'Female'); await mustClick(hp, 'Save'); await sleep(1500);
      let pl = places(A.id); t = await txt(hp); await shot(hp, 'i1-host-reserved');
      ck('I1.ui.reserve', 'host presses Reserve a spot, names it, picks Female, Save → stored ({name, gender female}); the row reads "[probe] mop-up guest · Reserved · Female"; the team is full so Reserve a spot is gone', pl.length === 1 && pl[0].name === '[probe] mop-up guest' && pl[0].gender === 'female' && /\[probe\] mop-up guest/.test(t) && /Reserved · Female/.test(t) && !/Reserve a spot/.test(t), { row: pl });
      // edit
      await mustClick(hp, '[probe] mop-up guest');
      const sheet = await txt(hp); await shot(hp, 'i1-place-sheet');
      await mustClick(hp, 'Edit reserved info');
      await typeInto(hp, 'input[placeholder="e.g. 3.5"]', '4.0'); await mustClick(hp, 'Save'); await sleep(1500);
      pl = places(A.id); t = await txt(hp);
      ck('I1.ui.edit', 'the Reserved row opens Reclub\'s options (Edit reserved info · Swap from community · Remove reserved spot); Edit reserved info → level 4.0 stored and shown', /Edit reserved info/.test(sheet) && /Swap from community/.test(sheet) && /Remove reserved spot/.test(sheet) && pl.length === 1 && pl[0].level === 4 && pl[0].gender === 'female' && /Level 4\.0/.test(t), { row: pl });
      // release
      await mustClick(hp, '[probe] mop-up guest'); await mustClick(hp, 'Remove reserved spot');
      const q = await txt(hp); await dlg(hp, 'Confirm'); await sleep(1500);
      t = await txt(hp); await shot(hp, 'i1-host-released');
      ck('I1.ui.release', 'Remove reserved spot asks first, then the place is released (row: none) and Reserve a spot is back', /Remove this reserved spot\? The team has an open place again\./.test(q) && places(A.id).length === 0 && /Reserve a spot/.test(t) && !/mop-up guest/.test(t), {});
      // reserve again, then Swap from community: admin takes the place (the host seats at once)
      await mustClick(hp, 'Reserve a spot'); await typeInto(hp, 'input[placeholder="Reserved spot name (optional)"]', '[probe] mop-up guest 2'); await mustClick(hp, 'Save'); await sleep(1500);
      const pid = (places(A.id)[0] || {}).id;
      await mustClick(hp, '[probe] mop-up guest 2'); await mustClick(hp, 'Swap from community');
      await typeInto(hp, 'input[placeholder="Search players"]', P.ken.username); await sleep(2500);
      await shot(hp, 'i1-swap-search');
      await mustClick(hp, P.ken.name, { contains: true, sel: '[class*="row"]' }).catch(async () => mustClick(hp, P.ken.name, { contains: true }));
      await sleep(2000); t = await txt(hp); await shot(hp, 'i1-host-swapped');
      ck('I1.ui.swap', 'Swap from community (host): the searched player takes the reserved place — stored in userIds, the place is gone, the row shows the player', !!pid && places(A.id).length === 0 && users(A.id).includes(P.ken.userId) && t.includes(P.ken.name), { users: users(A.id).length, places: places(A.id).length });
      const ns = await must('i/notifications', { limit: 20 }, P.ken.token);
      const hit = (ns || []).find((n) => JSON.stringify(n).includes('placed you in [probe] mop-up Team A'));
      ck('I1.ui.swap-notified', 'the seated player is told: the i/notifications of ken carry "The host placed you in [probe] mop-up Team A for …" (the sentence the app already translates)', !!hit, { body: hit && (hit.body || hit.customBody || '').slice(0, 120) });
    });

    await step('I1.i18n', async () => {
      for (const [lang, want, eng] of [['zh_Hant', /從社群換入/, /Swap from community|Remove reserved spot/], ['zh_Hans', /从社区换入/, /Swap from community|Remove reserved spot/]]) {
        await visit(hp, 'tournament-team/index?id=' + C0 + '&e=' + R0.id, null, lang);
        await mustClick(hp, '[probe] mop-up guest R');
        const t = await txt(hp); await shot(hp, 'i1-sheet-' + lang);
        ck('I1.i18n.' + lang, lang + ': the reserved place\'s sheet is in ' + lang + ' (Swap from community / Remove reserved spot translated, no English left)', want.test(t) && !eng.test(t), { sample: (t.match(/[^\n]*換入[^\n]*|[^\n]*换入[^\n]*/) || [''])[0] });
        await hp.keyboard.press('Escape').catch(() => undefined);
      }
    });

    await step('I1.start', async () => {
      const st = await se('competitions/status', { competitionId: C0, action: 'start' }, H);
      const rows = sql(`select id||':'||status from competition_entry where "competitionId"='${C0}' and id in ('${R0.id}','${A.id}') order by id`).split('\n');
      const s = Object.fromEntries(rows.map((r) => r.split(':')));
      ck('I1.start', 'at the start a team completed by a reserved place plays (Team R = tom + 1 reserved place stays confirmed; the same team WITHOUT the place read complete=false, the plant above)', st.status === 200 && s[R0.id] === 'confirmed' && s[A.id] === 'confirmed', { status: st.status, R: s[R0.id], A: s[A.id] });
      const late = await se('competitions/entries/partners', { competitionId: C0, entryId: R0.id, reserve: { name: 'late' } }, P.tom.token);
      ck('I1.started-refused', 'after the start the roster is fixed: reserve refused (COMPETITION_STARTED)', code(late) === 'COMPETITION_STARTED', { code: code(late) });
    });

    // ================================================================= ITEM 2 — comp-fixes-b rows to L6
    const c1 = await must('competitions/create', { name: PFX + ' RR', sport: 'pickleball', format: 'roundRobin', participantType: 'team', teamMinSize: 2, teamMaxSize: 3, maxEntries: 8, visibility: 'public', autoApprove: true, setsPerMatch: 3, courtLabels: ['Centre', 'Court B'], scoreSetDefaults: [{ name: 'Opener', type: 'standard' }, { name: 'Decider', type: 'tiebreaker' }], ...timeline }, H);
    made.push(c1.id); const C1 = c1.id;
    await must('competitions/status', { competitionId: C1, action: 'publish' }, H);
    const TA = await must('competitions/entries/update', { competitionId: C1, userIds: [P.amy.userId, P.mei.userId], name: '[probe] mop-up Team A' }, H);
    const TB2 = await must('competitions/entries/update', { competitionId: C1, userIds: [P.tom.userId, P.ken.userId], name: '[probe] mop-up Team B' }, H);
    await must('competitions/status', { competitionId: C1, action: 'start' }, H);
    let ms = await must('competitions/matches/list', { competitionId: C1 }, H);
    const find = (a, x) => ms.find((m) => (m.entry1Id === a && m.entry2Id === x) || (m.entry1Id === x && m.entry2Id === a));
    const mBC = find(TA.id, TB2.id);
    ck('I2.setup', 'fixture is real: started team round robin (Team A amy+mei, Team B tom+ken) with named default sets (Opener / Decider tiebreaker) and court labels; its generated match', ms.length === 1 && !!mBC, { matches: ms.length });
    await must('competitions/matches/upsert', { competitionId: C1, matchId: mBC.id, scores: [{ t1: 9, t2: 11 }, { t1: 11, t2: 6 }], finalize: false, courtIndex: 0 }, H);

    await step('I2.format-pane', async () => {
      const t = await visit(hp, 'tournament/index?id=' + C1 + '&tab=draw', 'i2-draw');
      ck('BUG.draw-hidden-copy', 'a STARTED competition\'s Draw tab says everyone sees the matchups (never "Only you can see the matchups until the start")', /The competition has started: everyone can see the matchups\./.test(t) && !/Only you can see the matchups until the start/.test(t), {});
      await mustClick(hp, 'How points work');
      const m = await dialogInfo(hp);
      await shot(hp, 'i2-score-values');
      ck('BUG.score-values', 'Score values modal (EN): one OK button (no 取消), whole words, "Draw: 1 point" singular — observed rendered', !!m && m.buttons.join('|') === 'OK' && !/取消/.test(m.text) && m.wb === 'normal' && /Draw: 1 point/.test(m.text) && !/1 points/.test(m.text), m);
      await dlg(hp, 'OK');
      for (const [link, want] of [['Learn more about competition formats', /Competition formats[\s\S]*Consolation bracket/], ['Learn more about point calculation', /Point calculation[\s\S]*Tiebreakers/]]) {
        await mustClick(hp, link); const lm = await txt(hp); await shot(hp, 'i2-' + link.split(' ').pop());
        ck('D-match-format.17.' + link.split(' ').pop(), 'pressing "' + link + '" opens its help (' + want + ') and OK closes it', want.test(lm), {});
        await dlg(hp, 'OK');
      }
      ck('D-comp-detail.45.pane', 'the format pane lists Standings Calculation and Tiebreaker priority beside the two Learn more links and Reset matches', /Standings Calculation/.test(t) && /Tiebreaker priority/.test(t) && /Reset matches/.test(t), {});
    });

    await step('I2.single-elim-copy', async () => {
      const c3 = await must('competitions/create', { name: PFX + ' KO', sport: 'pickleball', format: 'singleElim', participantType: 'singles', maxEntries: 8, visibility: 'public', autoApprove: true, ...timeline }, H);
      made.push(c3.id);
      await must('competitions/status', { competitionId: c3.id, action: 'publish' }, H);
      for (const k of ['amy', 'mei']) await must('competitions/entries/update', { competitionId: c3.id, userIds: [P[k].userId] }, H);
      const t = await visit(hp, 'tournament/index?id=' + c3.id + '&tab=draw', 'i2-ko-draw');
      ck('BUG.single-elim-copy', 'single elimination: the seeding line reads "Automatic: by the seeds", never "by the pool standings"', /Automatic: by the seeds/.test(t) && !/pool standings/.test(t), {});
    });

    await step('I2.match-detail', async () => {
      const route = 'tournament-match/index?id=' + C1 + '&m=' + mBC.id;
      let t = await visit(hp, route, 'i2-match');
      const order = () => hp.evaluate(() => [...document.querySelectorAll('.cmx-name')].map((e) => e.innerText.trim()));
      const o1 = await order(); await mustClick(hp, '⇅ Swap sides'); const o2 = await order(); await shot(hp, 'i2-swapped');
      ck('D-comp-match-detail.01', 'header names the stage ("Round robin · Round n"); pressing Swap sides flips the two teams on screen (before/after)', /Round robin · Round \d/.test(t) && o1.length === 2 && o1[0] === o2[1] && o1[1] === o2[0], { o1, o2 });
      await mustClick(hp, '⇅ Swap sides');
      // kebab → Edit match: rename, read back
      await kebab(hp); const k = await txt(hp); await shot(hp, 'i2-kebab');
      await mustClick(hp, 'Edit match');
      await typeInto(hp, 'input[placeholder="Optional: e.g. Exhibition, Rematch"]', 'Mop-up final'); await mustClick(hp, 'Update match'); await sleep(1500);
      const nm = sql(`select coalesce(name,'') from competition_match where id='${mBC.id}'`);
      // kebab → Set availability: ken → Can go, read back
      await kebab(hp); await mustClick(hp, 'Set availability'); await mustClick(hp, P.ken.name, { within: '.ak-list' }); await mustClick(hp, 'Can go', { within: '.ak-list' }); await sleep(1500);
      const av = JSON.parse(sql(`select coalesce(availability,'{}')::text from competition_match where id='${mBC.id}'`) || '{}');
      // kebab → Clear all assignment: line-ups planted by the host first, then cleared in the browser
      await must('competitions/matches/upsert', { competitionId: C1, matchId: mBC.id, lineups: [{ set: 0, side: mBC.entry1Id === TB2.id ? 1 : 2, userIds: [P.tom.userId, P.ken.userId] }] }, H);
      const planted = JSON.parse(sql(`select scores::text from competition_match where id='${mBC.id}'`))[0];
      await visit(hp, route); await kebab(hp); await mustClick(hp, 'Clear all assignment'); await dlg(hp, 'Clear'); await sleep(1500);
      const cleared = JSON.parse(sql(`select scores::text from competition_match where id='${mBC.id}'`))[0];
      ck('D-comp-match-detail.02', 'the match kebab (Share image · Manage score sets · Assign players · Clear all assignment · Edit match · Set availability) — Edit match renames (read back), Set availability stores ken = yes, Clear all assignment empties the planted line-up', ['Share image', 'Manage score sets', 'Assign players', 'Edit match', 'Set availability'].every((w) => k.includes(w)) && nm === 'Mop-up final' && av[P.ken.userId] === 'yes' && (planted.p1 || planted.p2) && !(cleared.p1 && cleared.p1.length) && !(cleared.p2 && cleared.p2.length), { name: nm, ken: av[P.ken.userId], planted: !!(planted.p1 || planted.p2), cleared: { p1: cleared.p1 || null, p2: cleared.p2 || null } });
    });

    await step('I2.share-image', async () => {
      await visit(hp, 'tournament-match/index?id=' + C1 + '&m=' + mBC.id);
      await hp.evaluate(() => { window.__blobs = []; });
      await kebab(hp); await mustClick(hp, 'Share image'); await sleep(2500);
      const got = await hp.evaluate(async () => { const x = (window.__blobs || []).slice(-1)[0]; if (!x) return null; const buf = new Uint8Array(await x.arrayBuffer()); let s = ''; for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]); return { type: x.type, size: x.size, b64: btoa(s) }; });
      let info = null;
      if (got) {
        const bytes = Buffer.from(got.b64, 'base64'); const f = MU.SHOTS + '/i2-share-image.png'; fs.writeFileSync(f, bytes);
        info = { type: got.type, size: bytes.length, sig: bytes.slice(0, 8).toString('hex'), width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), file: execSync('file -b ' + f, { encoding: 'utf8' }).trim(), path: 'probes/mop-up-comp-shots/i2-share-image.png' };
      }
      await shot(hp, 'i2-share-toast');
      ck('D-match-share-image.02', 'Share image pressed in the browser GENERATES the card: a PNG blob (signature 89504e47…), 1080×1080, > 20 KB, written to disk and read by `file`', !!info && info.type === 'image/png' && info.sig === '89504e470d0a1a0a' && info.width === 1080 && info.height === 1080 && info.size > 20000 && /PNG image data, 1080 x 1080/.test(info.file), info);
    });

    await step('I2.score-sheet', async () => {
      const route = 'tournament-match/index?id=' + C1 + '&m=' + mBC.id;
      await visit(hp, route); await kebab(hp); await mustClick(hp, 'Manage score sets');
      const sh = await txt(hp); await shot(hp, 'i2-score-sheet');
      await mustClick(hp, 'See stat definitions'); const sd = await txt(hp); await shot(hp, 'i2-stat-defs');
      ck('D-score-board.02', 'the score sheet\'s "See stat definitions" pressed opens the definitions (TB W/L, Score Diff) and OK closes them', /See stat definitions/.test(sh) && /Stat definitions/.test(sd) && /TB W\/L/.test(sd) && /Score Diff/.test(sd), {});
      await dlg(hp, 'OK');
      // stopwatch counts up; the Timer counts DOWN from a picked duration
      await mustClick(hp, 'Start'); await sleep(2300);
      const clock = () => hp.evaluate(() => { const e = document.querySelector('[data-act="match-clock"]'); return e ? e.innerText.trim() : ''; });
      const w1 = await clock();
      await mustClick(hp, 'Timer'); await mustClick(hp, '5 min'); const tset = await clock();
      await mustClick(hp, 'Start'); await sleep(2600); const t1 = await clock(); await sleep(1500); const t2 = await clock(); await shot(hp, 'i2-timer');
      ck('D-comp-score.04', 'Stopwatch Start counts up (00:0n); Timer → 5 min reads 05:00 and Start counts DOWN (04:5x, then lower)', /^00:0[1-9]$/.test(w1) && tset === '05:00' && /^04:5\d$/.test(t1) && t2 < t1, { stopwatch: w1, set: tset, t1, t2 });
      await click(hp, 'Pause');
      // Remove game on a scored game: Cancel keeps it; Remove game removes it; Save stores 1 game
      const games = () => JSON.parse(sql(`select scores::text from competition_match where id='${mBC.id}'`)).length;
      const g0 = games();
      await mustClick(hp, 'Remove game'); const q = await txt(hp); await dlg(hp, 'Cancel');
      const g1 = games();
      await mustClick(hp, 'Remove game'); await dlg(hp, 'Remove game'); await mustClick(hp, 'Save'); await sleep(2000);
      const g2 = games(); await shot(hp, 'i2-removed-game');
      ck('D-comp-score-sets.01', 'Remove game on a scored game asks first ("This game has scores…"); Cancel keeps 2 games, Remove game + Save stores 1 (read back)', /This game has scores\. Are you sure you want to remove it\?/.test(q) && g0 === 2 && g1 === 2 && g2 === 1, { g0, g1, g2 });
    });

    await step('I2.default-sets', async () => {
      // a FRESH match (no games) opens its score sheet on the competition's default sets
      const x = await must('competitions/matches/upsert', { competitionId: C1, entry1Id: TA.id, entry2Id: TB2.id, name: 'Mop-up fresh' }, H);
      await visit(hp, 'tournament-match/index?id=' + C1 + '&m=' + x.id, 'i2-fresh-match');
      await mustClick(hp, 'Input score').catch(async () => { await kebab(hp); await mustClick(hp, 'Manage score sets'); });
      await sleep(800); const vals = await inputValues(hp); const t = await txt(hp); await shot(hp, 'i2-fresh-sheet');
      // control: the sheet of a match WITH games opens on its own games, not the defaults
      ck('D-match-format.13', 'a fresh match\'s score sheet opens on the competition\'s default sets: two games named Opener and Decider (the second marked Tiebreaker)', (vals.includes('Opener') || /Opener/.test(t)) && (vals.includes('Decider') || /Decider/.test(t)) && /Tiebreaker/.test(t), { inputs: vals.filter(Boolean).slice(0, 6) });
      R.fresh = x.id;
    });

    await step('I2.submitted-by', async () => {
      const mAB = await must('competitions/matches/upsert', { competitionId: C1, entry1Id: TA.id, entry2Id: TB2.id, name: 'Mop-up receipt' }, H);
      const route = 'tournament-match/index?id=' + C1 + '&m=' + mAB.id;
      await must('competitions/matches/upsert', { competitionId: C1, matchId: mAB.id, scores: [{ t1: 11, t2: 4 }, { t1: 11, t2: 7 }], finalize: true }, H);
      const before = await visit(hp, route, 'i2-before-receipt');
      sql(`update competition_match set "duprStatus"='submitted', "duprSubmittedById"='${P.host.userId}', "duprSubmittedAt"=now(), "duprRef"='sandbox:mop-up', "duprError"='sandbox_not_sent' where id='${mAB.id}' and "competitionId"='${C1}'`);
      const after = await visit(hp, route, 'i2-after-receipt');
      const re = new RegExp('Submitted by ' + P.host.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      ck('D-comp-match-detail.06', 'before/after: without a receipt no "Submitted by"; with a (planted, sandbox, never sent) receipt the DUPR row reads "Submitted by <host name>"', !re.test(before) && re.test(after), { name: P.host.name });
    });

    await step('I2.sublocations', async () => {
      // the host renames court 1 in the wizard (Customize courts) and the team page's match row follows
      const before = await visit(hp, 'tournament-team/index?id=' + C1 + '&e=' + TB2.id, 'i2-team-before');
      await visit(hp, 'tournament-create/index?id=' + C1 + '&step=2', 'i2-wizard');
      const inp = await hp.evaluate(() => { const i = [...document.querySelectorAll('input')].find((e) => e.value === 'Centre'); if (!i) return false; i.setAttribute('data-mu', 'court0'); return true; });
      if (!inp) throw new Error('no Centre court input');
      await typeInto(hp, 'input[data-mu="court0"]', 'Show court');
      await mustClick(hp, 'Update'); await mustClick(hp, 'Confirm'); await sleep(2500);
      const labels = sql(`select array_to_string("courtLabels", ',') from competition where id='${C1}'`);
      const after = await visit(hp, 'tournament-team/index?id=' + C1 + '&e=' + TB2.id, 'i2-team-after');
      ck('D-comp-sublocations.01', 'the host renames court 1 in the wizard (Centre → Show court, saved: courtLabels read back) and the team page\'s match row follows (before Centre, after Show court)', /Centre/.test(before) && labels.startsWith('Show court') && /Show court/.test(after) && !/Centre/.test(after), { labels });
    });

    // ------------------------------------------------------------------ C2: pools + consolation (manage seeds, match-format.16)
    await step('I2.pools', async () => {
      const c2 = await must('competitions/create', { name: PFX + ' Pools', sport: 'pickleball', format: 'poolPlayKnockout', participantType: 'singles', maxEntries: 8, numGroups: 2, numContinue: 1, thirdPlaceMatch: false, consolationBracket: true, visibility: 'public', autoApprove: true, ...timeline }, H);
      made.push(c2.id); const C2 = c2.id;
      await must('competitions/status', { competitionId: C2, action: 'publish' }, H);
      for (const k of ['amy', 'mei', 'tom', 'ken']) await must('competitions/entries/update', { competitionId: C2, userIds: [P[k].userId] }, H);
      await must('competitions/status', { competitionId: C2, action: 'start' }, H);
      let m2 = await must('competitions/matches/list', { competitionId: C2 }, H);
      for (const m of m2.filter((x) => x.stage === 'regular')) await must('competitions/matches/upsert', { competitionId: C2, matchId: m.id, scores: [{ t1: 11, t2: Math.min(9, 1 + m.round * 2 + m.number) }], finalize: true }, H);
      await must('competitions/draw', { competitionId: C2, stage: 'playoff' }, H);
      const final = () => sql(`select coalesce("entry1Id",'')||','||coalesce("entry2Id",'') from competition_match where "competitionId"='${C2}' and stage='playoff' order by round, number limit 1`);
      const cons = () => sql(`select count(*) from competition_match where "competitionId"='${C2}' and stage='consolation'`);
      const f0 = final(), c0n = cons();
      await visit(hp, 'tournament/index?id=' + C2 + '&tab=draw', 'i2-c2-draw');
      await mustClick(hp, 'Manage seeds'); const s = await txt(hp); await shot(hp, 'i2-manage-seeds');
      // move the second playoff seed up (▲ of row #2), then Update seeds
      await hp.evaluate(() => { const u = [...document.querySelectorAll('.t3-seeds-b')].filter((e) => e.getBoundingClientRect().width > 0 && e.innerText.trim() === '▲'); if (u[1]) u[1].setAttribute('data-mu', 'up2'); });
      await hp.click('[data-mu="up2"]'); await sleep(500);
      await mustClick(hp, 'Update seeds'); await sleep(3000);
      const f1 = final(); await shot(hp, 'i2-seeds-updated');
      ck('D-comp-manage-seeds.02', 'Manage seeds shows "#n in pool m" rows with the Playoffs / Consolation toggle; ▲ on seed #2 + Update seeds redraws the final in the new order (before/after read back), the consolation bracket kept', /#1 in pool \d/.test(s) && /Playoffs/.test(s) && /Consolation/.test(s) && f0.split(',').length === 2 && f1 === f0.split(',').reverse().join(',') && cons() === c0n, { before: f0, after: f1, consolation: cons() });
      // match-format.16: the wizard on the drawn pool competition — switch Consolation bracket off → warning → Reset and save
      const w = await visit(hp, 'tournament-create/index?id=' + C2 + '&step=2', 'i2-c2-wizard');
      const sw = await hp.evaluate(() => { const s = [...document.querySelectorAll('[role="switch"]')].find((e) => /Consolation bracket/.test(e.getAttribute('aria-label') || '') && e.getBoundingClientRect().width > 0); if (!s) return null; s.scrollIntoView({ block: 'center' }); s.setAttribute('data-mu', 'cons'); return s.getAttribute('aria-checked'); });
      if (sw == null) throw new Error('no Consolation bracket switch');
      await hp.click('[data-mu="cons"]'); await sleep(800);
      const sw2 = await hp.evaluate(() => { const s = document.querySelector('[data-mu="cons"]'); return s ? s.getAttribute('aria-checked') : null; });
      if (sw === sw2) throw new Error('the switch did not change: ' + sw);
      await mustClick(hp, 'Update'); await mustClick(hp, 'Confirm');
      const warn = await txt(hp); await shot(hp, 'i2-reset-warning');
      await dlg(hp, 'Reset and save'); await sleep(3000);
      const left = sql(`select stage||':'||count(*) from competition_match where "competitionId"='${C2}' group by stage order by stage`);
      const cb = sql(`select "consolationBracket" from competition where id='${C2}'`);
      ck('D-match-format.16', 'the wizard on a drawn competition: Consolation bracket off + Update + Confirm shows Reclub\'s stage warning ("…reset the playoff and consolation matches and scores."); Reset and save proceeds — playoff + consolation removed, the 2 pool matches kept, the setting stored', /a change to the format resets matches/.test(w) && /These changes will reset the playoff and consolation matches and scores\./.test(warn) && left === 'regular:2' && cb === 'f', { left, consolationBracket: cb });
    });

    await step('I2.reset-matches', async () => {
      // LAST on C1: the format pane's Reset matches pressed (Reclub confirm-reset) wipes the matches and reopens registration
      const n0 = sql(`select count(*) from competition_match where "competitionId"='${C1}'`);
      await visit(hp, 'tournament/index?id=' + C1 + '&tab=draw');
      await mustClick(hp, 'Reset matches'); const q = await txt(hp); await shot(hp, 'i2-reset-confirm');
      const rd = await dialogInfo(hp);
      ck('BUG.score-values.control', 'CONTROL: the same button detector reads the two-button Reset confirm as Cancel + Confirm (it is not blind)', !!rd && rd.buttons.includes('Cancel') && rd.buttons.includes('Confirm'), rd && rd.buttons);
      await dlg(hp, 'Confirm'); await sleep(3000);
      const n1 = sql(`select count(*) from competition_match where "competitionId"='${C1}'`), st = sql(`select status||'|'||"lockRegistration" from competition where id='${C1}'`);
      ck('D-comp-detail.45', 'the format pane\'s Reset matches pressed: the confirm lists the consequences; confirmed, the matches are removed (before n>0, after 0) and registration is open again as the confirm says (status open, lockRegistration false — Reclub confirm-reset "Registration open"; before the MOP-UP-COMP fix it read closed|true)', /Reset the competition\?/.test(q) && Number(n0) > 0 && n1 === '0' && st === 'open|false', { before: n0, after: n1, status: st });
    });
    ck('ui.errors', 'no page errors in the host session', hp.__errors.length === 0, hp.__errors.slice(0, 3));
  } catch (e) {
    R.errors.push(String(e && e.stack || e)); ck('probe', 'crashed', false, String(e && e.message || e));
  } finally {
    try { if (b) await b.close(); } catch (e) { /* */ }
    for (const cid of made) {
      try { await se('competitions/cancel', { competitionId: cid }, H); const d = await se('competitions/delete', { competitionId: cid }, H); R.cleanup[cid] = d.status; } catch (e) { R.cleanup[cid] = 'error ' + e.message; }
    }
    let left = '?';
    try { left = sql(`select count(*) from competition where name like '${PFX}%'`); } catch (e) { left = 'error'; }
    R.cleanupOk = left === '0';
    ck('G13.cleanup', 'every [probe] mop-up comp competition of this run deleted (rows left in se_sbx = 0)' + (left === '0' ? '' : ' — CLEANUP FAILED, rows are left'), left === '0', { left, cleanup: R.cleanup });
    const fails = R.checks.filter((c) => !c.pass);
    R.verdict = fails.length ? 'fail' : 'pass'; R.fails = fails.length; R.passes = R.checks.length - fails.length;
    R.evidence = R.checks.map((c) => (c.pass ? 'pass ' : 'FAIL ') + c.item + ': ' + c.what);
    // the lane's rows: each closes only when EVERY check it names ran and passed (a missing check = still-open)
    const ROWS = [
      ['item1 reserve one place on a competition team (engine + app)', /^I1./, 'captain + host in the browser at 390 px, engine refusals per role, start keeps a team completed by a place, EN/繁/简'],
      ['D-comp-detail.45', /^D-comp-detail.45(.pane)?$/, 'Reset matches pressed: matches 0, registration open (engine fix MOP-UP-COMP 8b4a62fa94)'],
      ['D-comp-manage-seeds.02', /^D-comp-manage-seeds.02$/, 'seed moved + Update seeds, final redrawn (read back)'],
      ['D-comp-match-detail.01', /^D-comp-match-detail.01$/, 'stage header + Swap sides before/after'],
      ['D-comp-match-detail.02', /^D-comp-match-detail.02$/, 'Edit match / Set availability / Clear all assignment pressed, rows read back'],
      ['D-comp-match-detail.06', /^D-comp-match-detail.06$/, 'Submitted by <name> before/after a PLANTED sandbox receipt (no DUPR submit pressed, rule 9)'],
      ['D-comp-score-sets.01', /^D-comp-score-sets.01$/, 'Remove game confirm: Cancel keeps 2, Remove + Save stores 1'],
      ['D-comp-score.04', /^D-comp-score.04$/, 'stopwatch up, 5-min timer down'],
      ['D-score-board.02', /^D-score-board.02$/, 'See stat definitions opens the definitions'],
      ['D-comp-sublocations.01', /^D-comp-sublocations.01$/, 'court renamed in the wizard, stored, team page follows'],
      ['D-match-format.13', /^D-match-format.13$/, 'fresh match sheet opens on Opener / Decider (Tiebreaker)'],
      ['D-match-format.16', /^D-match-format.16$/, 'wizard change on a drawn competition: stage warning, Reset and save, playoff+consolation removed, pools kept'],
      ['D-match-format.17', /^D-match-format.17./, 'both Learn more links pressed, help opens'],
      ['D-match-share-image.02', /^D-match-share-image.02$/, 'PNG generated: 1080x1080, file(1) reads it'],
      ['BUG Score values modal copy', /^BUG.score-values/, 'one OK, singular "1 point", word-break normal; detector control reads Cancel+Confirm'],
      ['BUG Draw tab hidden-matchups copy (started)', /^BUG.draw-hidden-copy$/, 'started competition copy'],
      ['BUG single elimination seeding copy', /^BUG.single-elim-copy$/, '"Automatic: by the seeds"'],
    ];
    R.rows = ROWS.map(([item, re, how]) => { const cs = R.checks.filter((c) => re.test(c.item)); const ok = cs.length > 0 && cs.every((c) => c.pass) && !R.checks.some((c) => /crashed/.test(c.what) && re.test(c.item)); return { item, status: ok ? 'closed' : 'still-open', level: ok ? 'L6' : (cs.some((c) => c.pass) ? 'partial' : 'none'), evidence: how + ' · checks: ' + cs.map((c) => (c.pass ? '' : '!') + c.item).join(', ') }; });
    if (R.verdict === 'pass' && R.rows.some((r) => r.status !== 'closed')) R.verdict = 'fail';
    fs.writeFileSync(OUT, JSON.stringify(R, null, 1));
    console.log('VERDICT', R.verdict, R.passes + '/' + R.checks.length);
    process.exit(0);
  }
})();

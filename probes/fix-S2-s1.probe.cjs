require('./_guard.cjs'); // G13.3 — run through probes/run.sh
// fix-S2 L6 probe, S1 scope (2026-09-25): the 19 S1 re-check rows judged WORSE than Reclub
// (gen/l6-scope/S1-competitions-a/recheck.json), measured at 390 px on UAT, EN + 繁 (+ 简 for language rows).
// Geometry / colour rows are self-tested IN PAGE: the fault is planted with an injected style (the pre-fix geometry) and the
// same check must FAIL on the plant before its PASS counts (G16.1). Fixtures '[probe] fix-S2 s1 <stamp> …', deleted in finally.
//   Run: bash /root/gen/browser-slot.sh bash /root/social-engine/probes/run.sh fix-S2-s1.probe.cjs
// @claims route pages/tournament/index :: fix-S2 :: standings-sticky · chat-fit · footer-panel · hide-roster · approve-btn · invited-one · award-desc · podium-zh · rounds-zh
// @claims route pages/tournament-create/index :: fix-S2 :: no-club
// @claims endpoint competitions/delete :: fix-S2 :: rooms-gone
'use strict';
const fs = require('fs');
const { execFileSync } = require('child_process');
const DIR = '/root/social-engine/probes';
const SHOTS = DIR + '/fix-S2-shots';
process.env.MU_SHOTS = SHOTS;
fs.mkdirSync(SHOTS, { recursive: true });
const MU = require('/root/gen/mop-up/mu-lib.cjs');
const HIT = require('./_fixs2-hit.cjs');   // FRONTEND_UAT_STANDARD 5B / 5C (AGENT_RULES rule 20)
const { sleep, se, who } = MU;
const stamp = Date.now().toString(36).slice(-5);
const PFX = '[probe] fix-S2 s1 ' + stamp;
const R = { id: 'fix-S2-s1', at: new Date().toISOString(), stamp, rows: [], plants: [], errors: [], cleanup: {}, fx: {} };
function ck(row, what, pass, ev, shot, extra) { const r = { row, what, pass: !!pass, ev: ev === undefined ? null : ev, shot: shot ? 'probes/fix-S2-shots/s1-' + shot + '.png' : null, ...(extra || {}) }; R.rows.push(r); console.log((pass ? 'PASS ' : 'FAIL ') + row + ' | ' + what + ' -> ' + JSON.stringify(r.ev).slice(0, 320)); }
function plant(name, what, caught, ev) { R.plants.push({ name, what, caught: !!caught, ev }); console.log((caught ? 'PLANT-CAUGHT ' : 'PLANT-MISSED ') + name + ' | ' + what + ' -> ' + JSON.stringify(ev).slice(0, 240)); }
async function step(name, fn) { try { await fn(); } catch (e) { R.errors.push(name + ': ' + (e && e.stack || e)); console.log('STEP CRASH ' + name + ': ' + (e && e.message)); } }
const sql = (q) => execFileSync('docker', ['exec', '-i', 'social-engine-db-1', 'psql', '-U', 'social', '-d', 'se_sbx', '-At', '-F', '|'], { input: q, encoding: 'utf8' }).trim();
async function must(ep, body, tok) { const r = await se(ep, body, tok); if (r.status >= 300) throw new Error(ep + ' -> ' + r.status + ' ' + JSON.stringify(r.json).slice(0, 240)); return r.json; }
const txt = (p) => MU.text(p).catch(() => '');
const lines = (t, re) => t.split('\n').filter((l) => re.test(l)).slice(0, 8).join(' | ');
async function snap(p, key) { await sleep(400); await p.screenshot({ path: SHOTS + '/s1-' + key + '.png' }).catch(() => undefined); return txt(p); }
async function visit(p, route, key, lang) { await MU.open(p, route, lang || 'en'); await sleep(1500); const t = await txt(p); if (/I agree/.test(t)) { await MU.clickText(p, 'I agree').catch(() => undefined); await sleep(800); } return key ? snap(p, key) : txt(p); }
async function tryClick(p, needle, opts) { try { await MU.clickText(p, needle, opts || {}); await sleep((opts && opts.after) || 1200); return true; } catch (e) { return false; } }
const PLANT_ID = 'fixs2-plant';
const setPlant = (p, css) => p.evaluate((css, id) => { let s = document.getElementById(id); if (!s) { s = document.createElement('style'); s.id = id; document.head.appendChild(s); } s.textContent = css; }, css, PLANT_ID);
const clearPlant = (p) => p.evaluate((id) => { const s = document.getElementById(id); if (s) s.remove(); }, PLANT_ID);
const rect = (p, sel, textRe) => p.evaluate((sel, src) => { const re = src ? new RegExp(src) : null; const e = [...document.querySelectorAll(sel)].filter((x) => { const r = x.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (!re || re.test(x.innerText || '')); }).pop(); if (!e) return null; const r = e.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width), h: Math.round(r.height) }; }, sel, textRe ? textRe.source : null);
const hit = (a, b) => !!(a && b && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom);

(async () => {
  const made = []; let b = null; const P = {};
  try {
    for (const [k, key] of [['host', 'admin'], ['amy', 'player-amy'], ['mei', 'clubowner-mei'], ['tom', 'clubadmin-tom'], ['ken', 'host-ken']]) P[k] = await who(key);
    for (const k of Object.keys(P)) { const me = await must('i', {}, P[k].token); P[k].name = me.name || me.username; P[k].username = me.username; }
    const H = P.host.token;
    R.fx.appBundle = ((await (await fetch('https://uat.gripbat.com/app/')).text()).match(/js\/app\.[a-z0-9]+\.js/) || [''])[0];
    R.fx.engineRev = execFileSync('docker', ['inspect', '-f', '{{index .Config.Labels "org.opencontainers.image.revision"}}', 'social-engine-web-uat-1'], { encoding: 'utf8' }).trim();
    const day = 86400e3, now = Date.now();
    const timeline = { startAt: new Date(now + 3 * day + 3600e3).toISOString(), registrationOpenAt: new Date(now - day).toISOString(), registrationCloseAt: new Date(now + 2 * day).toISOString() };
    const mk = async (tag, o, publish = true) => { const c = await must('competitions/create', { name: PFX + ' ' + tag, sport: 'pickleball', maxEntries: 8, visibility: 'private', autoApprove: true, ...timeline, ...o }, H); made.push(c.id); if (publish) await must('competitions/status', { competitionId: c.id, action: 'publish' }, H); const sh = await must('competitions/show', { competitionId: c.id }, H); return { id: c.id, at: sh.accessToken }; };
    const ents = async (cid) => (await must('competitions/entries', { competitionId: cid }, H)) || [];
    const hub = (C, extra) => 'tournament/index?id=' + C.id + '&at=' + encodeURIComponent(C.at || '') + (extra || '');
    b = await MU.browser();
    const ctx = {};
    const page = async (k) => { if (!ctx[k]) ctx[k] = await MU.newCtx(b, { host: 'admin', amy: 'player-amy', mei: 'clubowner-mei', tom: 'clubadmin-tom', ken: 'host-ken' }[k], 390); return ctx[k].page; };

    // ============================================================ S: singles RR amy/tom/mei, started, one match scored
    const S = await mk('S singles', { format: 'roundRobin', participantType: 'singles' });
    for (const k of ['amy', 'tom', 'mei']) await must('competitions/enter', { competitionId: S.id, accessToken: S.at }, P[k].token);
    // ---- D-comp-detail.41 (before the start): the entrant footer counts days in words
    await step('detail.41', async () => {
      const ap = await page('amy');
      const t = await visit(ap, hub(S), 'footer-days-amy-en');
      const ts = await visit(ap, hub(S), 'footer-days-amy-zhHans', 'zh_Hans');
      ck('D-comp-detail.41', 'entrant footer: "This competition is starting in 3 days" (a real plural, no "day(s)"); 简 本赛事将于 3 天后开始', /This competition is starting in [2-9] days/.test(t) && !/day\(s\)/.test(t) && /本赛事将于 [2-9] 天后开始/.test(ts), { en: lines(t, /starting|You are in/), zhHans: lines(ts, /本赛事/) }, 'footer-days-amy-en', { vsReclub: 'equal (was worse: "day(s)")' });
    });
    await must('competitions/status', { competitionId: S.id, action: 'start' }, H);
    const sm = await must('competitions/matches/list', { competitionId: S.id }, H);
    await must('competitions/matches/upsert', { competitionId: S.id, matchId: sm[0].id, scores: [{ t1: 11, t2: 7, type: 'standard' }], finalize: true }, H);

    // ---- D-comp-detail.55: standings names visible at 390 (sticky # + Name, the numbers scroll)
    await step('detail.55', async () => {
      const ap = await page('amy');
      await visit(ap, hub(S, '&tab=standings'), null);
      const measure = () => ap.evaluate(() => { const names = [...document.querySelectorAll('.tv-tdname')].map((e) => ({ t: (e.innerText || '').trim(), w: Math.round(e.getBoundingClientRect().width), l: Math.round(e.getBoundingClientRect().left), r: Math.round(e.getBoundingClientRect().right), clipped: e.scrollWidth > e.clientWidth + 1 })); const th = document.querySelector('.tv-thn'); return { names, head: th ? Math.round(th.getBoundingClientRect().width) : 0 }; });
      const good = (m) => m.names.length >= 3 && m.names.every((n) => n.w >= 20 && !n.clipped && n.t.length > 0 && n.l >= 0 && n.r <= 390) && m.head >= 30;   // the whole name on screen, not cut
      await setPlant(ap, '.tv-stick{flex:1 1 0 !important;min-width:0 !important;width:0 !important;overflow:hidden !important}.tv-tdname{width:0 !important}');
      await sleep(300); const pm = await measure(); plant('55', 'names squeezed to 0 px (the pre-fix layout) — the check must fail', !good(pm), pm.names.map((n) => n.w));
      await clearPlant(ap); await sleep(300);
      const m = await measure(); await snap(ap, 'standings-amy-en');
      // scroll the numbers sideways: the names stay put
      await ap.evaluate(() => { const s = [...document.querySelectorAll('.tv-tscroll, .tv-tscroll *')].find((e) => e.scrollWidth > e.clientWidth + 4); if (s) s.scrollLeft = 400; });
      await sleep(400); const m2 = await measure();
      const tz = await visit(ap, hub(S, '&tab=standings'), 'standings-amy-zhHant', 'zh_Hant'); const mz = await measure();
      ck('D-comp-detail.55', 'standings at 390: every NAME is whole on screen (not clipped, right edge ≤ 390), header "Name" its own cell; the stat columns scroll sideways under a pinned name column; 繁 the same', good(m) && good(m2) && good(mz) && [P.amy.name, P.tom.name, P.mei.name].every((n) => m.names.some((x) => x.t === n)), { en: m, afterScroll: m2.names, zh: mz.names.map((n) => n.w) }, 'standings-amy-en', { vsReclub: 'equal (was worse: names 0 px) — Reclub pins the name column the same way' });
    });

    // ---- D-comp-detail.61: every chat surface's composer is on screen above the tab bar + report button
    await step('detail.61', async () => {
      const surfaces = [];
      const ap = await page('amy');
      const meas = async (p, key) => { await sleep(1800); const inp = await rect(p, '.ct-input'); const bar = await rect(p, '.wv-tabbar'); const fab = await rect(p, '.sh-widgets-app .fb-fab'); await snap(p, 'chat-' + key); const h = await HIT.hit(p, '.ct-input, .ct-send'); return { key, inp, bar, fab, h, ok: !!(inp && bar && inp.bottom <= bar.top && inp.top >= 0 && !hit(inp, fab)) && h.ok }; };
      await visit(ap, hub(S, '&tab=chat'), null); surfaces.push(await meas(ap, 'competition-amy'));
      await setPlant(ap, '.ct-list{height:100vh !important}'); await sleep(300); const pinp = await rect(ap, '.ct-input'); const pbar = await rect(ap, '.wv-tabbar');
      plant('61', 'a thread taller than the room left (the pre-fix class of fault) — the composer must read as under the bar', !(pinp && pbar && pinp.bottom <= pbar.top), { pinp, pbar }); await clearPlant(ap);
      const meet = sql(`select id from meet where name like 'UAT Tuesday Doubles%' and status <> 'cancelled' order by "startAt" desc limit 1`);
      const kp = await page('ken'); if (meet) { await visit(kp, 'meet/index?id=' + meet + '&tab=chat', null); surfaces.push(await meas(kp, 'meet-ken')); }
      const mp = await page('mei'); await visit(mp, 'community/index?id=ari4he5s3hac000m&pane=chat', null); surfaces.push(await meas(mp, 'club-mei'));
      await visit(ap, 'chat/index?user=' + P.ken.userId, null); surfaces.push(await meas(ap, 'direct-amy'));
      await visit(ap, hub(S, '&tab=chat'), null, 'zh_Hant'); surfaces.push(await meas(ap, 'competition-amy-zhHant'));
      R.fx.chatSurfaces = surfaces;
      await visit(ap, hub(S, '&tab=chat'), null); const st = await HIT.selfTest(ap, '.ct-send'); plant('61-5B', 'a transparent layer over Send — the finger hit-test must fail', st.caught, st);
      // 5D: a real pointer tap in the box, real typing, a real tap on Send; reload -> it persisted; tom (another entrant) sees it
      const msg = '[probe] fix-S2 hello ' + stamp; await visit(ap, hub(S, '&tab=chat'), null); const ib = await rect(ap, '.ct-input'); await ap.mouse.click(ib.left + ib.w / 2, ib.top + ib.h / 2); await ap.keyboard.type(msg, { delay: 20 }); const sb = await rect(ap, '.ct-send'); await ap.mouse.click(sb.left + sb.w / 2, sb.top + sb.h / 2); await sleep(2500);
      const t1 = await visit(ap, hub(S, '&tab=chat'), 'chat-sent-amy-en'); const tp = await page('tom'); const t2 = await visit(tp, hub(S, '&tab=chat'), 'chat-seen-tom-en');
      ck('D-comp-detail.61 5D', 'journey: amy taps the box, types, taps Send (real pointer + keyboard, 390 px); after a reload the message is there, and tom (another entrant) sees it', t1.includes(msg) && t2.includes(msg), { persisted: t1.includes(msg), otherParty: t2.includes(msg) }, 'chat-seen-tom-en', { vsReclub: 'equal' });
      ck('D-comp-detail.61', 'the message box is on screen above the tab bar and clear of the report button WITHOUT scrolling on every chat surface: competition, meet, club, direct (found 2 under the bar on 2026-09-24: competition 802-844, meet 748-807; fixed at the one ChatThread)', surfaces.length >= 4 && surfaces.every((s) => s.ok), surfaces.map((s) => ({ k: s.key, input: s.inp && [s.inp.top, s.inp.bottom], bar: s.bar && s.bar.top, hit5B: s.h && { n: s.h.n, bad: s.h.bad }, ok: s.ok })), 'chat-competition-amy', { vsReclub: 'equal (was worse: no visible box to type)' });
    });

    // ============================================================ T: team comp min 2 / max 4, open: entries, spectators, footers
    const T = await mk('T teams', { format: 'roundRobin', participantType: 'team', teamMinSize: 2, teamMaxSize: 4 });
    await must('competitions/update', { competitionId: T.id, spectatorAutoApprove: false }, H);
    await must('competitions/enter', { competitionId: T.id, name: '[probe] fix-S2 s1 Team Tom', partnerIds: [P.ken.userId], accessToken: T.at }, P.tom.token);
    const TT = (await ents(T.id)).find((x) => x.captainId === P.tom.userId);
    await must('competitions/entries/partners', { competitionId: T.id, entryId: TT.id, cancel: [P.ken.userId] }, P.tom.token);
    await must('competitions/enter', { competitionId: T.id, name: '[probe] fix-S2 s1 Team Amy', partnerIds: [P.mei.userId], accessToken: T.at }, P.amy.token);
    const sp = await se('competitions/spectate', { competitionId: T.id, accessToken: T.at }, P.ken.token); R.fx.spectateKen = sp.status;

    await step('detail.33', async () => {
      const hp = await page('host');
      const t = await visit(hp, hub(T, '&tab=entries'), 'entries-host-en');
      ck('D-comp-detail.33', 'a 1-player team (min 2 / max 4) reads "Need 1 more" (to the minimum, not the maximum) and names its member "' + P.tom.name + '", never the handle @' + P.tom.username, /Need 1 more/.test(t) && !/Need 3 more/.test(t) && t.includes(P.tom.name) && !t.includes('@' + P.tom.username), { line: lines(t, /Team Tom|Need|Open for|@/) }, 'entries-host-en', { vsReclub: 'equal (was worse)' });
    });
    await step('detail.27-36', async () => {
      const hp = await page('host');
      const t = await visit(hp, hub(T, '&tab=entries&pane=confirmed'), 'confirmed-host-en');
      const chipHide = await hp.evaluate(() => [...document.querySelectorAll('.pg-chip')].some((e) => (e.innerText || '').trim() === 'Hide roster' && e.getBoundingClientRect().width > 0));
      const sw = await hp.evaluate(() => [...document.querySelectorAll('[role="switch"]')].some((e) => /Hide roster/.test(e.getAttribute('aria-label') || '')));
      const covered = await hp.evaluate(() => { const out = {}; for (const lab of ['Teams', 'Gender']) { const e = [...document.querySelectorAll('.pg-tab, .pg-chip')].find((x) => (x.innerText || '').trim() === lab && x.getBoundingClientRect().width > 0); if (!e) { out[lab] = 'absent'; continue; } const r = e.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); out[lab] = top && (e === top || e.contains(top)) ? 'clear' : 'covered'; } return out; });
      const h27 = await HIT.hit(hp, '.pg-tab, [role="switch"]');
      const tp = await visit(hp, hub(T, '&tab=entries&pane=pending'), 'pending-host-en');
      const swP = await hp.evaluate(() => [...document.querySelectorAll('[role="switch"]')].some((e) => /Hide roster/.test(e.getAttribute('aria-label') || '')));
      await visit(hp, hub(T, '&tab=entries&pane=confirmed'), 'confirmed-host-zhHant', 'zh_Hant');
      ck('D-comp-detail.27', 'sort strip Seeds / A–Z / Teams / Gender is uncovered (a tap on Teams and Gender lands on the chip); Hide roster is no longer a chip in that strip', !chipHide && covered.Teams === 'clear' && covered.Gender === 'clear' && h27.ok, { chipHide, covered, hit5B: h27 }, 'confirmed-host-en', { vsReclub: 'equal (was worse: bubble over the strip)' });
      ck('D-comp-detail.36', 'Hide roster is a labelled switch card on Confirmed AND on Pending (Reclub has it on Pending)', sw && swP, { confirmed: sw, pending: swP, pendingText: lines(tp, /Hide roster|Players see/) }, 'pending-host-en', { vsReclub: 'equal (was worse: Confirmed only, overlapping)' });
    });
    await step('detail.38', async () => {
      const hp = await page('host');
      await visit(hp, hub(T, '&tab=entries&pane=spectators'), null);
      const colours = () => hp.evaluate(() => [...document.querySelectorAll('taro-button-core, button, .pg-chip')].filter((e) => /^(Approve|Decline)$/.test((e.innerText || '').trim()) && e.getBoundingClientRect().width > 0).map((e) => { let x = e; let bg = 'rgba(0, 0, 0, 0)'; while (x && /rgba\(0, 0, 0, 0\)|transparent/.test(bg)) { bg = getComputedStyle(x).backgroundColor; x = x.parentElement; } const t = [...e.querySelectorAll('*')].concat([e]).find((y) => (y.innerText || '').trim() === (e.innerText || '').trim() && !y.children.length) || e; return { label: (e.innerText || '').trim(), fg: getComputedStyle(t).color, bg }; }));
      const ok = (cs) => cs.length >= 2 && cs.every((c) => c.fg !== c.bg);
      // the plant is written INLINE with !important on every element of the two buttons (a stylesheet loses to the kit's utilities)
      await hp.evaluate(() => { for (const e of document.querySelectorAll('taro-button-core, taro-button-core *, button, button *')) { e.setAttribute('data-fxplant', e.getAttribute('style') || ''); e.style.setProperty('color', 'rgb(255, 255, 255)', 'important'); e.style.setProperty('background-color', 'rgb(255, 255, 255)', 'important'); } });
      await sleep(300); const pc = await colours(); plant('38', 'white label on a white button (the measured fault) — the check must fail', !ok(pc), pc.slice(0, 2)); await hp.evaluate(() => { for (const e of document.querySelectorAll('[data-fxplant]')) { e.setAttribute('style', e.getAttribute('data-fxplant') || ''); e.removeAttribute('data-fxplant'); } }); await sleep(300);
      const cs = await colours(); const t = await snap(hp, 'spectators-host-en'); const h38 = await HIT.hit(hp, '.cfa-actrow taro-button-core, [role="switch"]');
      const nameLine = await hp.evaluate((n) => { const e = [...document.querySelectorAll('.pg-row-name')].find((x) => (x.innerText || '').includes(n)); return e ? Math.round(e.getBoundingClientRect().height) : null; }, P.ken.name);
      await visit(hp, hub(T, '&tab=entries&pane=spectators'), 'spectators-host-zhHant', 'zh_Hant');
      // press Approve → the engine has ken as a spectator
      await visit(hp, hub(T, '&tab=entries&pane=spectators'), null);
      const pressed = await tryClick(hp, 'Approve', { after: 2500 });
      const kenE = (await ents(T.id)).find((x) => (x.userIds || []).includes(P.ken.userId));
      ck('D-comp-detail.38', 'spectator request: Approve / Decline are readable kit buttons (label colour ≠ button colour), the requester\'s name keeps one line; Approve pressed → engine status spectator', ok(cs) && h38.ok && pressed && kenE && kenE.status === 'spectator' && nameLine != null && nameLine < 30, { hit5B: h38, colours: cs, nameLineHeight: nameLine, status: kenE && kenE.status, requested: lines(t, /Approve|Decline|REQUESTED/) }, 'spectators-host-en', { vsReclub: 'equal (was worse: blank button)' });
    });
    await step('detail.28-39', async () => {
      const hp = await page('host');
      await visit(hp, hub(T, '&tab=entries&pane=invited'), 'invited-host-en');
      const n = await hp.evaluate(() => [...document.querySelectorAll('taro-button-core, button')].filter((e) => (e.innerText || '').trim() === 'Invite a player' && e.getBoundingClientRect().width > 0).length);
      const h28 = await HIT.hit(hp, '.cfa-inv taro-button-core');
      ck('D-comp-detail.28', 'Invited pane shows ONE "Invite a player" button (the pane\'s own Invite players card); the hub\'s Invite-or-reserve card steps aside there', n === 1 && h28.ok, { inviteButtons: n, hit5B: h28 }, 'invited-host-en', { vsReclub: 'equal (was: two identical buttons)' });
      ck('D-comp-detail.39', 'same pane, same rule (duplicate of .28)', n === 1, { inviteButtons: n }, 'invited-host-en', { vsReclub: 'equal' });
    });
    await step('detail.65-66', async () => {
      // spectator ken (approved above): three-action footer; a stranger (non-member) footer vs the docked report button
      const kp = await page('ken');
      await visit(kp, hub(T), 'footer-spectator-ken-en');
      const geo = async (p) => { const cta = await rect(p, '.tv-cta'); const bar = await rect(p, '.wv-tabbar'); const fab = await rect(p, '.sh-widgets-app .fb-fab'); const btns = await p.evaluate(() => [...document.querySelectorAll('.tv-cta taro-button-core, .tv-cta button')].filter((e) => e.getBoundingClientRect().width > 0).map((e) => { const r = e.getBoundingClientRect(); return { t: (e.innerText || '').trim(), top: Math.round(r.top), bottom: Math.round(r.bottom) }; })); const bg = await p.evaluate(() => { const e = document.querySelector('.tv-cta'); return e ? getComputedStyle(e).backgroundColor : null; }); const h = await HIT.hit(p, '.tv-cta taro-button-core'); return { cta, bar, fab, btns, bg, h }; };
      const g = await geo(kp);
      const okG = (g) => !!(g.cta && g.bar && g.cta.bottom <= g.bar.top && g.btns.length >= 1 && g.btns.every((x) => x.bottom <= g.bar.top) && !hit(g.cta, g.fab) && g.bg && !/rgba\(0, 0, 0, 0\)/.test(g.bg) && (!g.h || g.h.ok));
      await setPlant(kp, '.tv-cta{bottom:74px !important;background:transparent !important;box-shadow:none !important;padding:0 !important}.tv-ctaalts{flex-direction:column !important}');
      await sleep(300); const pg = await geo(kp); plant('66', 'the pre-fix footer (transparent, 74px, stacked) — the check must fail', !okG(pg), { btns: pg.btns, bar: pg.bar && pg.bar.top }); await clearPlant(kp); await sleep(300);
      await visit(kp, hub(T), 'footer-spectator-ken-zhHant', 'zh_Hant'); const gz = await geo(kp);
      // spectator REQUEST footer (auto approve is off): Cancel request → the confirm reads Keep request / Cancel request; Keep changes nothing
      const tp = await page('tom');
      const C2 = await mk('T2 requests', { format: 'roundRobin', participantType: 'team', teamMinSize: 2, teamMaxSize: 4 });
      await must('competitions/update', { competitionId: C2.id, spectatorAutoApprove: false }, H);
      await must('competitions/spectate', { competitionId: C2.id, accessToken: C2.at }, P.tom.token);
      await visit(tp, hub(C2), 'footer-request-tom-en');
      const gr = await geo(tp);
      const dlgText = () => tp.evaluate(() => { const d = [...document.querySelectorAll('.nut-dialog')].find((e) => e.getBoundingClientRect().width > 0); return d ? d.innerText : null; });
      let dq = null;
      for (let i = 0; i < 3 && !dq; i++) { await tryClick(tp, 'Cancel request', { within: '.tv-cta', after: 1500 }); dq = await dlgText(); }
      await snap(tp, 'cancel-request-confirm-tom-en');
      await tryClick(tp, 'Keep request', { within: '.nut-dialog', after: 1500 });
      const still = (await must('competitions/show', { competitionId: C2.id, accessToken: C2.at }, P.tom.token)).mySpectatorRequest;
      // members-only stranger footer vs the report button (club competition, members only, amy not a member?) — the geometry rule is the footer's: never under the button
      const ap = await page('amy'); await visit(ap, hub(C2), 'footer-stranger-amy-en'); const gs = await geo(ap);
      const lineVsFab = await ap.evaluate(() => { const t = document.querySelector('.tv-ctat'); const f = document.querySelector('.sh-widgets-app .fb-fab'); if (!t || !f) return null; const a = t.getBoundingClientRect(), b = f.getBoundingClientRect(); return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom; });
      ck('D-comp-detail.66', 'three-action footer (spectator: Stop spectating · Join as a player · Go to forum) is one solid panel, every button above the tab bar, clear of the report button (EN + 繁); the cancel-request question answers "Keep request / Cancel request", Keep keeps it', okG(g) && okG(gz) && okG(gr) && /Keep request/.test(dq || '') && /Cancel request/.test(dq || '') && !!still, { en: g.btns, zh: gz.btns, hit5B: [g.h, gz.h, gr.h], bar: g.bar && g.bar.top, bg: g.bg, dialog: dq, keptRequest: !!still }, 'footer-spectator-ken-en', { vsReclub: 'better — Reclub stacks three buttons; ours keeps them above the bar in one panel, the confirm names both choices' });
      ck('D-comp-detail.65', 'the footer line is never under the docked report button (the first word is readable)', okG(gs) && lineVsFab === false, { lineVsFab, cta: gs.cta, fab: gs.fab, hit5B: gs.h }, 'footer-stranger-amy-en', { vsReclub: 'equal (was worse: "Only" hidden)' });
    });

    // ============================================================ D: draft competition — publish review sheet
    await step('confirm-publish.04', async () => {
      const D = await mk('D draft with a long name to wrap inside the review sheet at 390 px', { format: 'roundRobin', participantType: 'singles' }, false);
      const hp = await page('host');
      await visit(hp, hub(D), null);
      await tryClick(hp, 'Publish competition', { within: '.tv-cta', after: 1500 });
      const t = await snap(hp, 'publish-review-host-en');
      const right = await hp.evaluate(() => Math.max(0, ...[...document.querySelectorAll('.t3-pub-v, .t3-pub-k')].map((e) => Math.round(e.getBoundingClientRect().right))));
      const nameShown = t.includes('D draft with a long name');
      ck('D-comp-confirm-publish.04', 'REVIEW COMPETITION lines wrap inside the sheet at 390 px (right edge ≤ 390, was 528) and the whole name reads', right > 0 && right <= 390 && nameShown, { right, nameShown }, 'publish-review-host-en', { vsReclub: 'equal (was worse)' });
      await hp.keyboard.press('Escape').catch(() => undefined);
    });

    // ============================================================ E: ended singles RR — podium 繁 + custom award with description + rounds zh
    await step('awards', async () => {
      const E = await mk('E ended', { format: 'roundRobin', participantType: 'singles' });
      for (const k of ['amy', 'tom', 'mei']) await must('competitions/enter', { competitionId: E.id, accessToken: E.at }, P[k].token);
      await must('competitions/status', { competitionId: E.id, action: 'start' }, H);
      const ems = await must('competitions/matches/list', { competitionId: E.id }, H);
      for (const m of ems) await must('competitions/matches/upsert', { competitionId: E.id, matchId: m.id, scores: [{ t1: 11, t2: 5 + (m.round % 3), type: 'standard' }], finalize: true }, H);
      const hp = await page('host');
      // rounds in 简 / 繁 on the Matches tab (detail.45 / .46) while in progress
      const tm = await visit(hp, hub(E, '&tab=matches'), 'matches-host-zhHans', 'zh_Hans');
      const tmh = await visit(hp, hub(E, '&tab=draw'), 'draw-host-zhHant', 'zh_Hant');
      ck('D-comp-detail.46', 'Matches tab round headers in 简: 第 n 轮, no English "Round n"', /第 1 轮/.test(tm) && !/Round \d/.test(tm), { zhHans: lines(tm, /轮|Round/) }, 'matches-host-zhHans', { vsReclub: 'equal (was worse)' });
      ck('D-comp-detail.45', 'Draw tab round headers in 繁: 第 n 輪, no English "Round n"', /第 1 輪/.test(tmh) && !/Round \d/.test(tmh), { zhHant: lines(tmh, /輪|Round/) }, 'draw-host-zhHant', { vsReclub: 'equal (was worse)' });
      await must('competitions/status', { competitionId: E.id, action: 'finish' }, H);
      await visit(hp, hub(E, '&tab=awards'), null); await hp.keyboard.press('Escape').catch(() => undefined);
      const tz = await visit(hp, hub(E, '&tab=awards'), 'awards-host-zhHant', 'zh_Hant');
      const cards = await hp.evaluate(() => [...document.querySelectorAll('.tv-awardt')].map((e) => (e.innerText || '').trim()));
      ck('D-comp-award-podium.02', '繁 podium cards: 冠軍 / 亞軍 / 季軍 (the place, never 季軍戰 = the third-place match)', cards.includes('季軍') && !cards.includes('季軍戰') && cards.includes('冠軍'), { cards }, 'awards-host-zhHant', { vsReclub: 'equal (was worse)' });
      // custom award: name + description in ONE editor
      await visit(hp, hub(E, '&tab=awards'), null);
      await hp.keyboard.press('Escape').catch(() => undefined);
      const typed = await hp.evaluate(() => { const card = [...document.querySelectorAll('.tv-addaward')].find((e) => /Add an award/.test(e.innerText || '')); if (!card) return null; card.setAttribute('data-fx', 'aw'); return { input: !!card.querySelector('input'), textarea: !!card.querySelector('textarea') }; });
      if (typed && typed.input) { await hp.type('[data-fx="aw"] input', '[probe] fix-S2 MVP', { delay: 15 }); }
      if (typed && typed.textarea) { await hp.type('[data-fx="aw"] textarea', 'Voucher HK$200', { delay: 15 }); }
      await sleep(400); await snap(hp, 'award-add-filled-host-en'); const hAw = await HIT.hit(hp, '[data-fx="aw"] .tv-input, [data-fx="aw"] .tv-notesin, [data-fx="aw"] taro-button-core');
      await tryClick(hp, 'Add', { within: '[data-fx="aw"]', after: 2500 });
      const aw = ((await must('competitions/awards', { competitionId: E.id }, H)) || []).find((a) => a.name === '[probe] fix-S2 MVP');
      ck('D-comp-award-custom.02', 'Add an award takes the name AND the description in one card; pressed Add → the engine award carries both (no second trip through Edit award)', !!typed && typed.textarea && hAw.ok && aw && aw.description === 'Voucher HK$200', { hit5B: hAw, card: typed, award: aw && { name: aw.name, description: aw.description } }, 'award-add-filled-host-en', { vsReclub: 'equal (was worse: second trip)' });
    });

    // ============================================================ create.13 + add-match.01
    await step('create.13', async () => {
      const mp = await page('mei');
      await visit(mp, 'tournament-create/index', null);
      await tryClick(mp, 'Continue', { after: 1500 });
      const t = await snap(mp, 'wizard-club-mei-en');
      const tz = await visit(mp, 'tournament-create/index', null, 'zh_Hant'); await tryClick(mp, '繼續', { after: 1500 }); const tzz = await snap(mp, 'wizard-club-mei-zhHant');
      ck('D-comp-create.13', 'club block: the no-club option reads "No club" (a state beside "Not tied to a club"), never the action "Remove club"', /No club/.test(t) && !/Remove club/.test(t), { en: lines(t, /club/i), zh: lines(tzz, /球會/) }, 'wizard-club-mei-en', { vsReclub: 'equal' });
    });
    await step('add-match.01', async () => {
      const hp = await page('host');
      await visit(hp, hub(S, '&tab=matches'), null);
      await tryClick(hp, 'Add match', { after: 1500 });
      const box = await hp.evaluate(() => { const e = [...document.querySelectorAll('.cmt-input')].find((x) => x.getBoundingClientRect().width > 0); if (!e) return null; const cs = getComputedStyle(e); return { h: Math.round(e.getBoundingClientRect().height), border: cs.borderTopWidth, borderColor: cs.borderTopColor, bg: cs.backgroundColor }; });
      await snap(hp, 'create-match-sheet-host-en');
      ck('D-comp-add-match.01', 'Create match: the Name field is a visible box (border ≥ 1 px, height ≥ 36 px, paper fill)', !!box && parseFloat(box.border) >= 1 && box.h >= 36, box, 'create-match-sheet-host-en', { vsReclub: 'equal' });
      await hp.keyboard.press('Escape').catch(() => undefined);
    });

    // ============================================================ engine: deleting a competition deletes every room it owns
    await step('rooms-gone', async () => {
      const G = await mk('G rooms', { format: 'roundRobin', participantType: 'singles' }, false);
      const gen = await must('competitions/chat', { competitionId: G.id }, H);
      const forum = await must('competitions/chat', { competitionId: G.id, kind: 'forum' }, H);
      const staff = await must('competitions/chat', { competitionId: G.id, kind: 'staff' }, H);
      const ids = [gen.roomId, forum.roomId, staff.roomId].filter(Boolean);
      const before = Number(sql(`select count(*) from chat_room where id in (${ids.map((x) => `'${x}'`).join(',')})`));
      const del = await se('competitions/delete', { competitionId: G.id }, H);
      if (del.status < 300) made.splice(made.indexOf(G.id), 1);
      const after = Number(sql(`select count(*) from chat_room where id in (${ids.map((x) => `'${x}'`).join(',')})`));
      ck('ENGINE comp-rooms-gone', 'delete competition → its general, Forum and Staff rooms are gone (chat_room rows 3 → 0); was: the Forum room survived (arixiz58mpah00ul)', ids.length === 3 && before === 3 && del.status === 200 && after === 0, { ids, before, delete: del.status, after, engineRev: R.fx.engineRev }, null, { vsReclub: 'equal — no orphan rooms in anyone\'s inbox' });
    });
  } catch (e) {
    R.errors.push('main: ' + (e && e.stack || e)); console.log('CRASH ' + (e && e.message));
  } finally {
    try { if (b) await b.close(); } catch (e) { /* */ }
    const H = P.host && P.host.token;
    for (const cid of made) {
      try { const sh = (await se('competitions/show', { competitionId: cid }, H)).json || {}; if (sh.status === 'done') await se('competitions/status', { competitionId: cid, action: 'reopenEnded' }, H); await se('competitions/cancel', { competitionId: cid, message: 'fix-S2 fixture' }, H); const d = await se('competitions/delete', { competitionId: cid }, H); R.cleanup[cid] = d.status; } catch (e) { R.cleanup[cid] = 'error ' + e.message; }
    }
    try { R.cleanup.left = Number(sql(`select count(*) from competition where name like '${PFX.replace(/'/g, "''")}%'`)); } catch (e) { R.cleanup.left = 'error'; }
    const fails = R.rows.filter((r) => !r.pass).length, missed = R.plants.filter((p) => !p.caught).length;
    R.summary = { rows: R.rows.length, pass: R.rows.length - fails, fail: fails, plants: R.plants.length, plantsMissed: missed, errors: R.errors.length };
    fs.writeFileSync(DIR + '/fix-S2-s1.after.json', JSON.stringify(R, null, 1));
    console.log('WROTE fix-S2-s1.after.json', JSON.stringify(R.summary), 'cleanup', JSON.stringify(R.cleanup));
    process.exit(0);
  }
})();

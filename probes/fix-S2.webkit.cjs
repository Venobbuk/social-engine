// fix-S2 WebKit pass (AGENT_RULES 20: WebKit as well as Chromium on the priority paths) — Playwright WebKit, iPhone 13
// profile (390 px), against https://uat.gripbat.com. The SAME in-page 5B/5C rule as the Chromium probes
// (probes/_fixs2-hit.cjs inPage: elementFromPoint at the control centre, pinned at rest, every control at its scroller's
// end and centred, >= 24 px), then real taps (page.mouse at centres) and keyboard typing, read back from the engine and
// by the other party. Fixtures "[probe] fix-S2 W …" via the API, cancelled + deleted in finally.
// Output: fix-S2.webkit.json next to this file (copied to probes/ on kaka by the lane).
'use strict';
const fs = require('fs');
const { execFileSync } = require('child_process');
const { webkit, devices } = require('playwright');
const { inPage } = require('D:/tmp/fixs2/_fixs2-hit.cjs');
const HOST = 'https://uat.gripbat.com';
const RUN = Date.now().toString(36).slice(-5);
const PFX = '[probe] fix-S2 W ' + RUN;
const OUT = __dirname + '/fix-S2.webkit.json';
const SHOTS = __dirname + '/fix-S2-webkit-shots'; fs.mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = { id: 'fix-S2-webkit', engine: 'webkit', device: 'iPhone 13', at: new Date().toISOString(), run: RUN, rows: [], cleanup: {}, errors: [] };
const save = () => fs.writeFileSync(OUT, JSON.stringify(R, null, 1));
function ck(row, what, pass, ev) { R.rows.push({ row, what, pass: !!pass, ev }); console.log((pass ? 'PASS ' : 'FAIL ') + row + ' | ' + what + ' -> ' + JSON.stringify(ev).slice(0, 300)); save(); }
function token(key) { return JSON.parse(execFileSync('ssh', ['kaka', 'cat /root/gb-native-' + key + '-uat.token'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString()); }
async function api(ep, body, who) { for (let i = 0; i < 5; i++) { const r = await fetch(HOST + '/api/' + ep, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, i: who.token }) }); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) { /* */ } if (r.status !== 429) return { s: r.status, j, t }; await sleep(20000); } return { s: 429 }; }
async function must(ep, body, who) { const r = await api(ep, body, who); if (r.s >= 300) throw new Error(ep + ' ' + r.s + ' ' + String(r.t).slice(0, 200)); return r.j; }
let BR;
async function open(who, route, lang) {
  const ctx = await BR.newContext({ ...devices['iPhone 13'] });
  await ctx.addInitScript((t) => { if (location.hostname === 'uat.gripbat.com') { try { localStorage.setItem('boyau_social_token', JSON.stringify({ data: t })); localStorage.setItem('hkpl_lang_ok', JSON.stringify({ data: '1' })); localStorage.setItem('gb_loc_prompted', JSON.stringify({ data: '1' })); } catch (e) { /* */ } } }, who.token);
  if (process.env.NO_RO) await ctx.addInitScript(() => { try { delete window.ResizeObserver; window.ResizeObserver = undefined; } catch (e) { /* */ } });   // diagnosis only
  const page = await ctx.newPage();
  page.on('pageerror', (e) => R.errors.push('pageerror ' + route.slice(0, 40) + ': ' + String(e).slice(0, 200)));
  page.on('crash', () => R.errors.push('CRASH ' + route.slice(0, 40)));
  await page.goto(HOST + '/app/pages/' + route + (route.includes('?') ? '&' : '?') + 'lang=' + (lang || 'en'), { waitUntil: 'networkidle', timeout: 60000 }).catch(() => null);
  // wait for the page to finish (the competition name shows; the skeleton is gone) — WebKit on this box is slower than 4 s
  const end = Date.now() + 60000;
  while (Date.now() < end) { const ok = await page.evaluate(() => /\[probe\] fix-S2 W/.test(document.body.innerText) && !document.querySelector('.sk, .skeleton, [class*="skel"]')).catch(() => false); if (ok) break; await sleep(500); }
  await sleep(1500);
  const t = await page.evaluate(() => document.body.innerText).catch(() => '');
  if (/I agree/.test(t)) { const b = page.getByText('I agree', { exact: true }).first(); await b.click().catch(() => null); await sleep(800); }
  return { ctx, page };
}
const text = (p) => p.evaluate(() => document.body.innerText).catch(() => '');
async function waitSel(p, sel, ms = 30000) { const end = Date.now() + ms; while (Date.now() < end) { if (await p.evaluate((s) => [...document.querySelectorAll(s)].some((e) => e.getBoundingClientRect().width > 0), sel).catch(() => false)) { await sleep(1500); return true; } await sleep(500); } return false; }
async function hit(p, sel) { const out = []; for (const m of ['rest', 'end', 'centered']) { out.push(...await p.evaluate('(' + inPage.toString() + ')(' + JSON.stringify(sel) + ', ' + JSON.stringify(m) + ')')); await sleep(250); } const bad = out.filter((r) => !r.ok || r.w < 24 || r.h < 24); return { n: out.length, ok: out.length > 0 && !bad.length, bad: bad.slice(0, 5) }; }
const rect = (p, sel) => p.evaluate((sel) => { const e = [...document.querySelectorAll(sel)].filter((x) => x.getBoundingClientRect().width > 0).pop(); if (!e) return null; const r = e.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height) }; }, sel);
const tapCentre = async (p, sel) => { const r = await p.evaluate((sel) => { const e = [...document.querySelectorAll(sel)].filter((x) => x.getBoundingClientRect().width > 0).pop(); if (!e) return null; e.scrollIntoView({ block: 'center' }); const q = e.getBoundingClientRect(); return { x: q.left + q.width / 2, y: q.top + q.height / 2 }; }, sel); if (!r) return false; await p.mouse.click(r.x, r.y); return true; };
async function shot(p, name) { await p.screenshot({ path: SHOTS + '/' + name + '.png' }).catch(() => null); }

(async () => {
  const made = []; const P = {};
  for (const k of ['admin', 'player-amy', 'clubadmin-tom', 'host-ken', 'clubowner-mei']) P[k] = token(k);
  const H = P.admin;
  BR = await webkit.launch();
  try {
    const day = 86400e3, now = Date.now();
    const tl = { startAt: new Date(now + 3 * day).toISOString(), registrationOpenAt: new Date(now - day).toISOString(), registrationCloseAt: new Date(now + 2 * day).toISOString() };
    const mk = async (tag, o) => { const c = await must('competitions/create', { name: PFX + ' ' + tag, sport: 'pickleball', maxEntries: 8, visibility: 'private', autoApprove: true, ...tl, ...o }, H); made.push(c.id); await must('competitions/status', { competitionId: c.id, action: 'publish' }, H); const sh = await must('competitions/show', { competitionId: c.id }, H); return { id: c.id, at: sh.accessToken }; };
    const hub = (C, x) => 'tournament/index?id=' + C.id + '&at=' + encodeURIComponent(C.at) + (x || '');
    // ---- team competition: mei invited by amy (ONE invitation), ken a spectator (three-action footer)
    const T = await mk('T', { format: 'roundRobin', participantType: 'team', teamMinSize: 2, teamMaxSize: 3 });
    await must('competitions/enter', { competitionId: T.id, name: '[probe] fix-S2 W Team A', partnerIds: [P['clubowner-mei'].userId], accessToken: T.at }, P['player-amy']);
    await must('competitions/spectate', { competitionId: T.id, accessToken: T.at }, P['host-ken']);
    {
      const { ctx, page } = await open(P['clubowner-mei'], hub(T)); await waitSel(page, '.tv-cta taro-button-core');
      const n = await page.evaluate(() => [...document.querySelectorAll('taro-button-core')].filter((e) => (e.innerText || '').trim() === 'Accept invitation' && e.getBoundingClientRect().width > 0).length);
      const h = await hit(page, '.tv-cta taro-button-core'); await shot(page, 'invited-mei');
      const acc = await page.evaluate(() => { const e = [...document.querySelectorAll('.tv-cta taro-button-core')].find((x) => (x.innerText || '').trim() === 'Accept invitation'); if (!e) return null; const q = e.getBoundingClientRect(); return { x: q.left + q.width / 2, y: q.top + q.height / 2 }; });
      if (acc) await page.mouse.click(acc.x, acc.y); const tapped = !!acc; await sleep(3000);
      const e = ((await must('competitions/entries', { competitionId: T.id }, H)) || []).find((x) => x.captainId === P['player-amy'].userId);
      ck('D-comp-detail.67 (WebKit)', 'one Accept invitation; footer buttons pass the finger hit-test; a real tap on Accept puts mei in the team (engine)', n === 1 && h.ok && tapped && e && (e.userIds || []).includes(P['clubowner-mei'].userId), { acceptButtons: n, hit5B: h, meiIn: e && (e.userIds || []).includes(P['clubowner-mei'].userId) });
      await ctx.close();
    }
    {
      const { ctx, page } = await open(P['host-ken'], hub(T)); await waitSel(page, '.tv-cta taro-button-core');
      const btns = await page.evaluate(() => [...document.querySelectorAll('.tv-cta taro-button-core')].filter((e) => e.getBoundingClientRect().width > 0).map((e) => { const r = e.getBoundingClientRect(); return { t: (e.innerText || '').trim(), bottom: Math.round(r.bottom) }; }));
      const bar = await rect(page, '.wv-tabbar'); const h = await hit(page, '.tv-cta taro-button-core'); await shot(page, 'spectator-footer-ken');
      ck('D-comp-detail.66 (WebKit)', 'spectator footer: every button above the tab bar and passes the finger hit-test', btns.length >= 2 && bar && btns.every((b) => b.bottom <= bar.top) && h.ok, { btns, bar: bar && bar.top, hit5B: h });
      await ctx.close();
    }
    // ---- singles competition, started: standings names + chat send journey
    const S = await mk('S', { format: 'roundRobin', participantType: 'singles' });
    for (const k of ['player-amy', 'clubadmin-tom', 'clubowner-mei']) await must('competitions/enter', { competitionId: S.id, accessToken: S.at }, P[k]);
    await must('competitions/status', { competitionId: S.id, action: 'start' }, H);
    const ms = await must('competitions/matches/list', { competitionId: S.id }, H);
    await must('competitions/matches/upsert', { competitionId: S.id, matchId: ms[0].id, scores: [{ t1: 11, t2: 7, type: 'standard' }], finalize: true }, H);
    {
      const { ctx, page } = await open(P['player-amy'], hub(S, '&tab=standings')); await waitSel(page, '.tv-tdname');
      const names = await page.evaluate(() => [...document.querySelectorAll('.tv-tdname')].map((e) => { const r = e.getBoundingClientRect(); return { t: (e.innerText || '').trim(), r: Math.round(r.right), w: Math.round(r.width), clipped: e.scrollWidth > e.clientWidth + 1 }; }));
      await shot(page, 'standings-amy');
      ck('D-comp-detail.55 (WebKit)', 'standings names whole on screen at 390 px', names.length >= 3 && names.every((n) => n.w >= 20 && !n.clipped && n.r <= 390), names);
      await ctx.close();
    }
    {
      const { ctx, page } = await open(P['player-amy'], hub(S, '&tab=chat')); await waitSel(page, '.ct-input');
      await sleep(1500);
      const inp = await rect(page, '.ct-input'); const bar = await rect(page, '.wv-tabbar'); const h = await hit(page, '.ct-input, .ct-send');
      const msg = '[probe] fix-S2 W hello ' + RUN;
      await tapCentre(page, '.ct-input'); await page.keyboard.type(msg, { delay: 25 }); await tapCentre(page, '.ct-send'); await sleep(3000);
      await shot(page, 'chat-sent-amy');
      await page.reload({ waitUntil: 'networkidle' }).catch(() => null); await sleep(4000);
      const hasMsg = async (pg) => { const end = Date.now() + 40000; while (Date.now() < end) { if ((await text(pg)).includes(msg)) return true; await sleep(1000); } return false; };   // WebKit on this PC renders slowly
      const persisted = await hasMsg(page);
      await ctx.close();
      const o = await open(P['clubadmin-tom'], hub(S, '&tab=chat')); await sleep(1500); const seen = await hasMsg(o.page); await shot(o.page, 'chat-seen-tom'); await o.ctx.close();
      ck('D-comp-detail.61 (WebKit)', 'competition chat: the box is above the tab bar at rest, passes the finger hit-test; tap, type, tap Send → persists after reload, tom sees it', !!(inp && bar && inp.bottom <= bar.top) && h.ok && persisted && seen, { input: inp && [inp.top, inp.bottom], bar: bar && bar.top, hit5B: h, persisted, otherParty: seen });
    }
  } catch (e) { R.errors.push(String(e && e.stack || e)); console.log('CRASH', e && e.message); }
  finally {
    for (const id of made) { try { await api('competitions/cancel', { competitionId: id, message: 'fix-S2 W fixture' }, H); const d = await api('competitions/delete', { competitionId: id }, H); R.cleanup[id] = d.s; } catch (e) { R.cleanup[id] = 'error'; } }
    await BR.close().catch(() => null);
    R.summary = { rows: R.rows.length, pass: R.rows.filter((r) => r.pass).length, errors: R.errors.length };
    save(); console.log('WROTE', OUT, JSON.stringify(R.summary), JSON.stringify(R.cleanup));
  }
})();

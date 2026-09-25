// fix-S4 WebKit pass (AGENT_RULES 20: WebKit as well as Chromium on the priority paths) — Playwright WebKit, iPhone 13
// profile, against https://uat.gripbat.com. Real taps at element centres (touchscreen), typing, the engine read back, a
// 5B/5C hit-test before each tap. Fixtures "[probe] fix-S4 W …" via the API, removed in finally.
// Output: fix-S4.webkit.json next to this file (copied to probes/ on kaka by the lane).
'use strict';
const fs = require('fs');
const { execFileSync } = require('child_process');
const { webkit, devices } = require('playwright');
const HOST = 'https://uat.gripbat.com';
const RUN = Date.now().toString(36).slice(-5);
const P = '[probe] fix-S4 W ';
const OUT = __dirname + '/fix-S4.webkit.grade' + (process.env.GRADE || '1') + '.json';
const SHOTS = __dirname + '/fix-S4-webkit-shots'; fs.mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = { id: 'fix-S4-webkit', engine: 'webkit', at: new Date().toISOString(), run: RUN, rows: {}, checks: [], cleanup: [], errors: [] };
const save = () => fs.writeFileSync(OUT, JSON.stringify(R, null, 1));
function chk(row, name, pass, ev) { const e = typeof ev === 'string' ? ev : JSON.stringify(ev); R.checks.push({ row, name, pass: !!pass, ev: e.slice(0, 900) }); const r = R.rows[row] || (R.rows[row] = { checks: 0, passed: 0, status: 'still-open', evidence: [] }); r.checks++; if (pass) r.passed++; r.evidence.push((pass ? 'ok ' : 'NO ') + name); r.status = r.passed === r.checks ? 'closed' : 'still-open'; console.log((pass ? 'ok   ' : 'NO   ') + row + ' ' + name + ' :: ' + e.slice(0, 250)); save(); }
function token(key) { return JSON.parse(execFileSync('ssh', ['kaka', 'cat /root/gb-native-' + key + '-uat.token'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString()); }
async function api(ep, body, who) {
  for (let i = 0; i < 5; i++) {
    const r = await fetch(HOST + '/api/' + ep, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(who ? { ...body, i: who.token } : body) });
    const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) { /* */ }
    if (r.status !== 429) return { s: r.status, j, t };
    await sleep(20000);
  }
  return { s: 429 };
}
async function must(ep, body, who) { const r = await api(ep, body, who); if (r.s >= 300) throw new Error(ep + ' ' + r.s + ' ' + String(r.t).slice(0, 200)); return r.j; }

let BR;
async function open(who, route, lang = 'en', wait = 6000) {
  const br = await webkit.launch(); const ctx = await br.newContext({ ...devices['iPhone 13'] });   // a fresh WebKit per flow: one process degraded after a Home reload (0-byte screenshots)
  if (who) await ctx.addInitScript((t) => { if (location.hostname === 'uat.gripbat.com' && !sessionStorage.getItem('__fs4w')) { try { sessionStorage.setItem('__fs4w', '1'); localStorage.setItem('boyau_social_token', JSON.stringify({ data: t })); localStorage.setItem('hkpl_lang_ok', JSON.stringify({ data: '1' })); localStorage.setItem('boyau_onboarded', '1'); localStorage.setItem('boyau_push_dismissed', JSON.stringify({ data: '1' })); localStorage.setItem('gb_loc_prompted', JSON.stringify({ data: '1' })); localStorage.setItem('gb_loc_asked', JSON.stringify({ data: '1' })); localStorage.setItem('boyau_discover_loc', JSON.stringify({ data: JSON.stringify({ kind: 'everywhere', label: 'Everywhere' }) })); localStorage.setItem('boyau_discover_filter', JSON.stringify({ data: JSON.stringify({ level: '', gender: '', fee: '', club: '', hideFull: false, times: [], friendsOnly: false, hideEmpty: false, verifiedOnly: false, clubsOnly: false }) })); } catch (e) { /* */ } } }, who.token);
  const page = await ctx.newPage(); const net = []; page.on('pageerror', (e) => R.errors.push(route + ' pageerror ' + String(e.message).slice(0, 200))); page.on('crash', () => R.errors.push(route + ' CRASH'));
  page.on('response', (r) => { const m = r.url().match(/\/api\/([a-z0-9/_-]+)/i); if (m && r.request().method() === 'POST') net.push({ ep: m[1], s: r.status(), body: r.request().postData() || '' }); });
  await page.goto(HOST + '/app/pages/' + route + (route.includes('?') ? '&' : '?') + 'lang=' + lang, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => null);
  await sleep(wait);
  if (await page.evaluate(() => /We value your privacy/.test(document.body.innerText)).catch(() => false)) { await tapSel(page, null, /^(I agree|Accept all|Accept)$/); await sleep(1000); }
  return { ctx: { close: async () => { await ctx.close().catch(() => null); await br.close().catch(() => null); } }, page, net };
}
const text = (p) => p.evaluate(() => document.body.innerText).catch(() => '');
let n = 0; async function shot(p, name) { n++; const f = SHOTS + '/' + String(n).padStart(2, '0') + '-' + name + '.png'; await p.screenshot({ path: f }).catch(() => null); return f; }
// find a control by selector (+ optional text), hit-test it (5B at rest + its scroll container at the end, 5C size), return its centre
const FIND = (args) => { const [sel, src, fl, nth] = args; const re = src ? new RegExp(src, fl) : null;
  let els = Array.from(document.querySelectorAll(sel || '*')).filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (!re || re.test((e.textContent || '').trim())); });
  if (re && !sel) els = els.filter((e) => !Array.from(e.children).some((c) => re.test((c.textContent || '').trim())));
  const leaf = els[nth || 0]; if (!leaf) return { found: false };
  const ctl = sel ? leaf : (leaf.closest('[data-ctl], .hk-btn, button, .is-tap') || leaf);
  const inside = (x) => !!x && (x === ctl || ctl.contains(x));
  const test = () => { const q = ctl.getBoundingClientRect(); const cx = q.left + q.width / 2, cy = q.top + q.height / 2; if (cy < 0 || cy > innerHeight) return 'offscreen'; return inside(document.elementFromPoint(cx, cy)) ? 'ok' : 'covered'; };
  ctl.scrollIntoView({ block: 'center' }); const rest = test();
  let sc = ctl.parentElement; while (sc && !(sc.scrollHeight > sc.clientHeight + 2 && /(auto|scroll)/.test(getComputedStyle(sc).overflowY))) sc = sc.parentElement;
  const cont = sc || document.scrollingElement; const keep = cont.scrollTop; cont.scrollTop = cont.scrollHeight; const end = test(); cont.scrollTop = keep; ctl.scrollIntoView({ block: 'center' });
  const q = ctl.getBoundingClientRect(); return { found: true, rest, end, w: Math.round(q.width), h: Math.round(q.height), x: q.left + q.width / 2, y: q.top + q.height / 2 }; };
const hitOk = (t) => !!t && t.found && t.rest === 'ok' && (t.end === 'ok' || t.end === 'offscreen') && t.w >= 24 && t.h >= 24;
async function tapSel(p, sel, rx, row, label, nth) {
  const t = await p.evaluate(FIND, [sel, rx ? rx.source : null, rx ? rx.flags : '', nth || 0]).catch((e) => ({ found: false, err: String(e) }));
  if (row) chk(row, 'WebKit 5B/5C hit-test + >= 24 px: ' + label, hitOk(t), t);
  if (!t.found) return false; await p.touchscreen.tap(t.x, t.y); await sleep(1600); return true;
}

(async () => {
  const mei = token('clubowner-mei'), amy = token('player-amy'), tom = token('clubadmin-tom'), ken = token('host-ken');
  for (const w of [mei, amy, tom, ken]) { const me = await api('i', {}, w); if (me.s !== 200) throw new Error('persona token dead ' + me.s); }
  R.appBundle = ((await (await fetch(HOST + '/app/')).text()).match(/app\.[0-9a-f]+\.js/) || [''])[0];
  const FX = { meets: [], comps: [] }; R.fx = FX;
  const CLUB = 'ari4he5s3hac000m', KPSC = 'ar7iv198jhqz0008', day = 86400e3;
  try {
    BR = await webkit.launch();
    // W1 Clubs only (mei's own club, not followed)
    const M = await must('meets/create', { name: P + 'club meet ' + RUN, startAt: new Date(Date.now() + 3 * 3600e3).toISOString(), durationMinutes: 90, capacity: 8, channelId: CLUB, venueId: KPSC, venueName: 'Kowloon Park Sports Centre', sport: 'pickleball' }, tom); FX.meets.push(M.id);
    {
      const b = await open(mei, 'meets/index?view=list');
      await b.page.waitForSelector('.dv-filter', { timeout: 90000 }).catch(() => null); await sleep(1500); await tapSel(b.page, '.dv-filter', null); await sleep(1500);
      await b.page.waitForFunction(() => /Clubs only/.test(document.body.innerText), null, { timeout: 60000 }).catch(() => null); await tapSel(b.page, null, /^Clubs only$/, 'C-meet-filters.04', 'Clubs only chip');
      await tapSel(b.page, null, /^Show \d+ meets?$/); await sleep(2000);
      const items = await b.page.$$eval('.dv-item', (e) => e.map((x) => x.innerText.replace(/\s+/g, ' ').slice(0, 90))).catch(() => []);
      const sh = await shot(b.page, 'clubs-only');
      chk('C-meet-filters.04', 'WebKit: Clubs only keeps the meet of the club mei owns', items.some((x) => x.includes(P + 'club meet ' + RUN)), { items: items.slice(0, 3), sh });
      await b.ctx.close();
    }
    // W2 club code, letters only
    {
      const b = await open(amy, 'meets/index');
      const code = 'WAPSUW';
      await b.page.waitForFunction(() => { const e = document.querySelector('.dv-searchin input'); return !!e && e.getBoundingClientRect().height > 0; }, null, { timeout: 90000 }).catch(() => null); await sleep(1000); await tapSel(b.page, '.dv-searchin', null); await b.page.keyboard.type(code, { delay: 40 }); await sleep(2500);
      const ok = await tapSel(b.page, '.dv-code', null, 'C-discover.11', 'club-code row'); await sleep(2500);
      const url = b.page.url(); const sh = await shot(b.page, 'club-code');
      chk('C-discover.11', 'WebKit: typing WAPSUW → the club row → the club page', ok && /community\/index\?id=/.test(url), { url, sh });
      await b.ctx.close();
    }
    // W3 Home comp card: Maybe under my match (a [probe] comp with a draw), reload-persist
    const CD = await must('competitions/create', { name: P + 'D ' + RUN, sport: 'pickleball', format: 'roundRobin', participantType: 'singles', maxEntries: 8, visibility: 'private', autoApprove: true, startAt: new Date(Date.now() + 2 * day).toISOString(), registrationOpenAt: new Date(Date.now() - day).toISOString(), registrationCloseAt: new Date(Date.now() + day).toISOString() }, tom); FX.comps.push(CD.id);
    await must('competitions/status', { competitionId: CD.id, action: 'publish' }, tom);
    for (const w of [amy, mei, ken]) await must('competitions/enter', { competitionId: CD.id, accessToken: CD.accessToken }, w);
    await must('competitions/status', { competitionId: CD.id, action: 'start' }, tom);
    {
      const b = await open(amy, 'home/index', 'en', 8000);
      R.fx.amyComps = ((await api('competitions/list', { scope: 'mine' }, amy)).j || []).map((c) => c.name + ':' + c.status + ':' + c.hasDraw);
      await b.page.waitForSelector('.ma-cmrow .pg-chip', { timeout: 90000 }).catch(() => null); await sleep(1500);
      const tapped = await tapSel(b.page, '.ma-cmrow .pg-chip', /^Maybe$/, 'C-home.11', 'Maybe chip'); await sleep(1500);
      const ms = (await must('competitions/matches/list', { competitionId: CD.id, accessToken: CD.accessToken }, amy)).filter((m) => m.myAvailability === 'maybe');
      await b.page.reload({ waitUntil: 'networkidle' }).catch(() => null); await b.page.waitForSelector('.ma-cmrow .pg-chip', { timeout: 90000 }).catch(() => null); await sleep(2000);
      const on = await b.page.$$eval('.ma-cmrow .pg-tab-on', (e) => e.map((x) => x.innerText.trim())).catch(() => []);
      const sh = await shot(b.page, 'home-maybe');
      chk('C-home.11', 'WebKit: Maybe under the Home comp card → engine reads maybe → still chosen after a reload', tapped && ms.length === 1 && on.includes('Maybe'), { engine: ms.length, on, sh });
      await b.ctx.close();
    }
    // W4 range calendar
    {
      const b = await open(amy, 'meets/index?view=list');
      await b.page.waitForSelector('.dv-filter', { timeout: 90000 }).catch(() => null); await sleep(1500); await tapSel(b.page, '.dv-filter', null); await sleep(1500);
      await b.page.waitForSelector('.dv-datechip', { timeout: 60000 }).catch(() => null); await sleep(800); await tapSel(b.page, '.dv-datechip', null, 'C-filter-dates.01', 'Dates chip'); await b.page.waitForSelector('.rc-d.is-tap', { timeout: 15000 }).catch(() => null); await sleep(600);
      await tapSel(b.page, '.rc-d.is-tap', null, 'C-filter-dates.01', 'day cell', 1); await tapSel(b.page, '.rc-d.is-tap', null, null, null, 3);
      await tapSel(b.page, null, /^Confirm$/, 'C-filter-dates.01', 'Confirm'); await sleep(1500);
      const lr = b.net.filter((x) => x.ep === 'meets/list').pop();
      let span = null; try { const j = JSON.parse(lr.body); span = Math.round((new Date(j.to) - new Date(j.from)) / day); } catch (e) { /* */ }
      const sh = await shot(b.page, 'range');
      chk('C-filter-dates.01', 'WebKit: one range calendar → meets/list with a 3-day range', span === 3 && lr.s === 200, { span, s: lr && lr.s, sh });
      await b.ctx.close();
    }
    // W5 the club venues in the meet form's picker
    const S0 = await must('clubs/settings/show', { channelId: CLUB }, mei); FX.venueIds0 = S0.venueIds || [];
    await must('clubs/settings/update', { channelId: CLUB, venueIds: [KPSC] }, mei); FX.venuesSet = true;
    {
      const b = await open(mei, 'meet-create/index?club=' + CLUB);
      await b.page.waitForFunction(() => { const e = document.querySelector('input[placeholder="Search venues or type a place"]'); return !!e && e.getBoundingClientRect().height > 0; }, null, { timeout: 90000 }).catch(() => null); await sleep(1500);   /* Stencil hydrates taro-input-core late on a saturated PC */ await tapSel(b.page, 'input[placeholder="Search venues or type a place"]', null); await b.page.waitForSelector('.mc-venues', { timeout: 15000 }).catch(() => null); await b.page.waitForFunction(() => /Club venues/.test((document.querySelector('.mc-venues') || {}).innerText || ''), null, { timeout: 15000 }).catch(() => null);
      const t = await b.page.$eval('.mc-venues', (e) => e.innerText.replace(/\n+/g, ' | ')).catch(() => '');
      await tapSel(b.page, '.mc-venue', /Kowloon Park Sports Centre/, 'C-select-venue.03', 'club venue row');
      const v = await b.page.$eval('input[placeholder="Search venues or type a place"]', (e) => e.value).catch(() => '');
      const sh = await shot(b.page, 'club-venues');
      chk('C-select-venue.03', 'WebKit: "Club venues" first, a tap picks it', t.indexOf('Club venues') >= 0 && t.indexOf('Club venues') < t.indexOf('Kowloon Park') && v === 'Kowloon Park Sports Centre', { t: t.slice(0, 160), v, sh });
      await b.ctx.close();
    }
    // W7 the meet form's venue hint = the venue's real state (VENUE-STATE-HINT-V1)
    {
      const cv = await must('venues/create', { name: P + 'hint court ' + RUN, address: P + '1 Probe Road ' + RUN, lat: 22.3011, lng: 114.1712 }, amy); FX.venues = [cv.id];
      const b = await open(amy, 'meet-create/index');
      const SEL = 'input[placeholder="Search venues or type a place"]';
      await b.page.waitForFunction((q) => { const e = document.querySelector(q); return !!e && e.getBoundingClientRect().height > 0; }, SEL, { timeout: 90000 }).catch(() => null); await sleep(1500);
      await tapSel(b.page, SEL, null); await b.page.keyboard.type(RUN, { delay: 40 });
      await b.page.waitForFunction((n) => [...document.querySelectorAll('.mc-venue')].some((x) => (x.innerText || '').includes(n)), P + 'hint court ' + RUN, { timeout: 30000 }).catch(() => null);
      await tapSel(b.page, '.mc-venue', new RegExp('hint court ' + RUN), 'C-select-venue.04', 'venue search row'); await sleep(1500);
      const hint = await b.page.evaluate((q) => { let r = document.querySelector(q); for (let k = 0; k < 6 && r && !/Venue/.test(r.innerText || ''); k++) r = r.parentElement; return r ? (r.innerText || '').replace(/\s+/g, ' ').slice(0, 120) : ''; }, SEL).catch(() => '');
      const sh = await shot(b.page, 'venue-hint');
      chk('C-select-venue.04', 'WebKit: a just-added (Under review) venue picked in the meet form reads "Under review", never "Verified venue"', /Under review/.test(hint) && !/Verified venue/.test(hint), { hint, sh });
      await b.ctx.close();
    }
    // W6 one header on the three pages
    for (const route of ['community-center/index', 'venue-media/index?id=' + KPSC]) {
      const b = await open(amy, route);
      const backs = await b.page.$$eval('.ah-lead', (e) => e.filter((x) => x.getBoundingClientRect().height > 0).length).catch(() => -1);
      chk(route.startsWith('community') ? 'C-community-detail.01' : 'C-venue.13', 'WebKit: ' + route.split('/')[0] + ' one Back button', backs === 1, { backs });
      await b.ctx.close();
    }
  } catch (e) { R.errors.push(String(e && e.stack || e).slice(0, 600)); console.log('ERR', e && e.message); }
  finally {
    try { if (BR) await BR.close(); } catch (e) { /* */ }
    if (FX.venues) for (const id of FX.venues) R.cleanup.push({ venue: id, s: (await api('venues/delete', { venueId: id }, token('admin'))).s });
    if (FX.venuesSet) R.cleanup.push({ clubVenues: (await api('clubs/settings/update', { channelId: CLUB, venueIds: FX.venueIds0 }, mei)).s });
    for (const id of FX.comps) { let r = await api('competitions/cancel', { competitionId: id }, tom); r = await api('competitions/delete', { competitionId: id }, tom); R.cleanup.push({ comp: id, s: r.s }); }
    for (const id of FX.meets) R.cleanup.push({ meet: id, cancel: (await api('meets/cancel', { meetId: id }, tom)).s });
    R.cleanupFailed = R.cleanup.filter((c) => (c.s && c.s >= 300) || (c.cancel && c.cancel >= 300) || (c.clubVenues && c.clubVenues >= 300)).length;
    R.summary = { closed: Object.keys(R.rows).filter((k) => R.rows[k].status === 'closed'), open: Object.keys(R.rows).filter((k) => R.rows[k].status !== 'closed'), errors: R.errors.length, cleanupFailed: R.cleanupFailed };
    save(); console.log('SUMMARY ' + JSON.stringify(R.summary));
  }
})();

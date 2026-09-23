// UAT-DEMO-DATA-V1 probe (lane uat-demo-data, 2026-09-23) — does a stranger on https://uat.gripbat.com meet a real-looking
// demo world, and is the consent gate safe to tap near?  Seed under test: /root/uat-demo-seed.cjs (run by /root/uat-reset.sh).
//
// PHASES (env PHASES, comma list; default all):
//   doors    — the SAME engine doors the screens call, signed out / as each persona (works against any engine: SE_BASE may
//              point at a scratch engine on a COPY of se_sbx — that is how the fault is planted without touching UAT):
//                lesson slots (meets/list discover, anon) >= 3 · coaches (roles/users Coach role, anon) >= 2 · people alive
//                (users state:alive, anon) >= 10 · personas onboarded + today's terms (Amy: terms, NOT onboarded — A1)
//                · no duplicates (schedule names per coach, lesson dates per schedule, seeded notes per poster, bookings).
//   screens  — real browser, 390 px, https://uat.gripbat.com/app: signed-out Lessons hub lists "Lessons you can book" with
//              >= 3 rows; signed-out Coaches list non-empty; Ken / Mei / tester1 land on Home (not onboarding, no consent
//              gate) in a FRESH browser; Discover › People lists >= 10 players.
//   stranger — a fresh .test sign-in through the sign-in page (sandbox code read off the screen) books a seat in the group
//              clinic from the lesson page; the booking is read back from the engine, then cleaned up (finally).
//   consent  — P1 fix: an account without today's terms opens Discover; the gate appears; a stray tap on the gate's
//              "Sign out" does NOT sign out (confirm step + arming); the page behind is inert; "I agree" stores today's
//              version (read back from meets/level).
// Fixtures: '[probe] uat-demo …' names, .test emails; bookings removed in finally. Verdict: probes/uat-demo-data.verdict.json
// (LABEL=<x> writes probes/uat-demo-data.<x>.json instead, for before/after/plant runs).
'use strict';
const fs = require('fs');
const path = require('path');

const APP = process.env.APP_BASE || 'https://uat.gripbat.com';
const HK = process.env.UAT_BASE || 'https://uat.social.silkvo.com';
const SE = process.env.SE_BASE || HK;
const PHASES = (process.env.PHASES || 'doors,screens,stranger,consent').split(',').map((s) => s.trim()).filter(Boolean);
const LABEL = process.env.LABEL || '';
const OUT = path.join(__dirname, LABEL ? 'uat-demo-data.' + LABEL + '.json' : 'uat-demo-data.verdict.json');
const SHOTS = '/root/walk/uat-demo-data' + (LABEL ? '-' + LABEL : '');
fs.mkdirSync(SHOTS, { recursive: true });
const QA_P = (fs.readFileSync('/root/hkpl-server/.env', 'utf8').match(/^QA_BYPASS_PASSWORD=(.+)$/m) || [])[1];
const COACH_ROLE_ID = 'arc5w1aagbcoach1';
const LESSON_NAMES = ["Beginners' Group Clinic", 'Private Lesson with Mei', 'Intermediate Drills (3.0–3.5)', 'Dinking & Third-Shot Workshop'];
const COACH_NAMES = ['Mei Lam', 'Tom Ho', 'Rita 黃'];
const TS = Date.now().toString(36);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const persona = (slug) => 'uat+' + slug + '@hkpl-test.silkvo.com';

const checks = [];
const add = (phase, name, pass, evidence) => { checks.push({ phase, name, pass: !!pass, evidence: typeof evidence === 'string' ? evidence.slice(0, 600) : evidence }); console.log((pass ? 'PASS ' : 'FAIL ') + phase + ' · ' + name + ' · ' + (typeof evidence === 'string' ? evidence.slice(0, 300) : JSON.stringify(evidence).slice(0, 300))); return !!pass; };

function termsVersion() {
  const d = JSON.parse(fs.readFileSync('/root/hkpl-taro-branch/src/lib/legal.data.json', 'utf8'));
  const s = String(d.terms.updated || '') + '|' + String(d.privacy.updated || '');
  let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return 'gb-' + (h >>> 0).toString(36);
}
const V = termsVersion();

async function se(endpoint, body, token, base = SE) {
  for (let a = 0; a < 4; a++) {
    const r = await fetch(base + '/api/' + endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(token ? { ...body, i: token } : body) }).catch((e) => ({ status: 0, text: async () => String(e) }));
    const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch (e) { /* 204 */ }
    if (r.status === 0 || r.status >= 500 || r.status === 429) { await sleep(2000 * (a + 1)); continue; }
    return { status: r.status, json, text };
  }
  return { status: 599, json: null, text: 'retries exhausted' };
}
const ok = (r, what) => { if (!r || r.status >= 300) throw new Error(what + ' -> ' + (r && r.status) + ' ' + (r && r.text || '').slice(0, 200)); return r.json; };
const cookiesOf = (r) => (r.headers.getSetCookie ? r.headers.getSetCookie() : []).map((c) => c.split(';')[0]).join('; ');
async function qaCookie(email) {
  const s = await fetch(HK + '/api/v1/auth/qa/by-email/' + encodeURIComponent(email) + '?p=' + encodeURIComponent(QA_P), { redirect: 'manual' });
  if (s.status !== 302) throw new Error('qa/by-email ' + email + ' ' + s.status);
  return cookiesOf(s);
}
async function tokenFromCookie(cookie, host = HK) {
  const m = await (await fetch(host + '/api/v1/auth/sso/social', { headers: { cookie, accept: 'application/json' } })).json().catch(() => null);
  if (!m || !m.jwt) throw new Error('sso mint failed');
  const r = ok(await se('adapter/sso', { jwt: m.jwt }), 'adapter/sso');
  return { token: r.token, userId: r.userId };
}
const tokens = {};
async function login(email) { if (!tokens[email]) tokens[email] = await tokenFromCookie(await qaCookie(email)); return tokens[email]; }

// ================================================================================================== doors
async function doors() {
  const P = 'doors';
  const list = ok(await se('meets/list', { scope: 'discover', limit: 100 }), 'meets/list') || [];
  const slots = {};
  for (const m of list) if (m.coachScheduleId && m.status !== 'cancelled' && Date.parse(m.startAt) > Date.now()) (slots[m.coachScheduleId] = slots[m.coachScheduleId] || []).push(m);
  const slotNames = Object.values(slots).map((ms) => ms[0].name);
  add(P, 'signed-out lesson slots (meets/list discover, one row per slot) >= 3', Object.keys(slots).length >= 3, Object.keys(slots).length + ' slots: ' + slotNames.join(' | '));
  add(P, 'lesson names are demo names, not [probe]', slotNames.length > 0 && slotNames.every((n) => !/probe/i.test(n)), slotNames.join(' | '));
  const roles = ok(await se('roles/users', { roleId: COACH_ROLE_ID, limit: 50 }), 'roles/users') || [];
  const coachNames = roles.map((r) => r.user && r.user.name).filter(Boolean);
  const coachIds = roles.map((r) => r.user && r.user.id);
  add(P, 'signed-out Coaches (roles/users Coach role) >= 2', roles.length >= 2, roles.length + ': ' + coachNames.join(', '));
  add(P, 'no duplicate coach rows', new Set(coachIds).size === coachIds.length, coachIds.join(','));
  const withFields = roles.filter((r) => r.user && Array.isArray(r.user.fields) && r.user.fields.some((f) => /^Coaching (experience|rate)$/i.test(f.name)));
  add(P, 'every coach row carries experience/rate (what the Coaches list shows)', roles.length > 0 && withFields.length === roles.length, withFields.length + '/' + roles.length);
  const alive = ok(await se('users', { limit: 30, origin: 'local', sort: '+follower', state: 'alive' }), 'users') || [];
  add(P, 'Discover › People door (users state:alive) >= 10', alive.length >= 10, alive.length + ': ' + alive.slice(0, 14).map((u) => u.name || u.username).join(', '));
  if (alive.length) {
    const lv = ok(await se('meets/levels', { userIds: alive.map((u) => u.id), sport: 'pickleball' }), 'meets/levels') || [];
    const rated = lv.filter((l) => l.duprDoubles != null || l.selfLevel != null).length;
    add(P, 'People carry levels (>= 10 rated)', rated >= 10, rated + '/' + alive.length + ' rated');
  }
  // personas: onboarded + today's terms (Amy: terms only, by design)
  for (const [email, onb] of [[persona('host-ken'), true], [persona('clubowner-mei'), true], [persona('clubadmin-tom'), true], [persona('admin'), true], ['boyau.tester1@silkvo.com', true], ['boyau.tester2@silkvo.com', true], [persona('player-amy'), false]]) {
    try {
      const t = await login(email);
      const lv = ok(await se('meets/level', { sport: 'pickleball' }, t.token), 'meets/level');
      add(P, email.replace(/@.*/, '') + (onb ? ' onboarded + terms ' : ' terms (not onboarded: tester plan A1) ') + V, lv.termsVersion === V && !!lv.termsAcceptedAt && lv.onboarded === onb, 'onboarded=' + lv.onboarded + ' terms=' + lv.termsVersion + ' at ' + lv.termsAcceptedAt);
    } catch (e) { add(P, email + ' level readable', false, e.message); }
  }
  // duplicates + lived-in rosters, as the coaches
  // Rita 黃 by NAME from the directory (the demo handles do not follow the names: uat+demo_rita is Leo 梁)
  const dir = JSON.parse(fs.readFileSync(process.env.PEOPLE_JSON || '/var/www/boyau-uat-app/uat/people.json', 'utf8')).people || [];
  const rita = dir.find((p) => p.kind === 'demo' && p.name === 'Rita 黃');
  const coachEmails = { mei: persona('clubowner-mei'), tom: persona('clubadmin-tom'), rita: rita ? rita.email : 'missing-rita' };
  const allSched = {};
  for (const [k, em] of Object.entries(coachEmails)) {
    try {
      const t = await login(em);
      const mine = ok(await se('coaches/schedules/list', {}, t.token), 'coaches/schedules/list') || [];
      const names = mine.map((s) => s.name);
      add(P, k + ' schedules: no duplicate names', new Set(names).size === names.length && names.length > 0, names.join(' | ') || 'none');
      for (const s of mine) {
        const full = ok(await se('coaches/schedules/show', { scheduleId: s.id }, t.token), 'show');
        const live = (full.upcoming || []).filter((m) => m.status !== 'cancelled');
        const dates = live.map((m) => m.startAt);
        allSched[s.name] = { id: s.id, live, full };
        add(P, k + ' · ' + s.name + ': lessons materialised, one per date, HKD', live.length >= 3 && new Set(dates).size === dates.length && (full.priceTiers && full.priceTiers.tiers || []).every((b) => b.currency === 'HKD'), live.length + ' lessons ' + dates.map((d) => d.slice(0, 10)).join(',') + ' bands ' + JSON.stringify((full.priceTiers || {}).tiers || []));
      }
    } catch (e) { add(P, k + ' schedules readable', false, e.message); }
  }
  const clinic = allSched["Beginners' Group Clinic"];
  if (clinic) {
    const next = clinic.live[0];
    const t = await login(coachEmails.mei);
    const d = ok(await se('meets/show', { meetId: next.id }, t.token), 'meets/show');
    const ps = (d.participants || []).filter((p) => p.status === 'confirmed');
    const uids = ps.map((p) => p.userId);
    add(P, 'group clinic: lived-in (>= 2 booked), open seats (>= 1), no double booking', ps.length >= 2 && d.capacity - d.confirmedCount >= 1 && new Set(uids).size === uids.length, 'confirmed ' + d.confirmedCount + '/' + d.capacity + ' ' + ps.map((p) => (p.user && p.user.name) || p.userId).join(', '));
  } else add(P, 'group clinic exists', false, 'no "Beginners\' Group Clinic" schedule');
  // seeded notes: at most one per poster in 72 h (the seed looks before it posts)
  const NOTE_RX = /^(Great doubles session|Looking for a 3\.5 partner|今晚九龍公園|Finally landed the third-shot|Anyone selling a used paddle|Tuen Mun courts were packed|新手問題|Rain check on the outdoor|Played my first competitive|Who is up for an early game|Reminder: bring water|星期六朝早沙田|Working on my backhand dink|Good games with the Island Smash|Just joined Kowloon Dinkers|Tip for this humidity|打完波去飲糖水|Thanks for the patient rallies|Doubles question: stack|Court 3 at Kowloon Park)/;
  let dup = [];
  for (const u of alive) {
    const ns = ok(await se('users/notes', { userId: u.id, limit: 20 }), 'users/notes') || [];
    const seeded = ns.filter((n) => NOTE_RX.test(n.text || '') && Date.now() - Date.parse(n.createdAt) < 72 * 3600e3);
    if (seeded.length > 1) dup.push((u.name || u.username) + ' x' + seeded.length);
  }
  add(P, 'seeded notes: at most one per player in 72 h', dup.length === 0, dup.join(', ') || 'none duplicated');
}

// ================================================================================================== browser helpers
let browser;
async function ctxPage({ localOnboarded = false } = {}) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const net = [];
  page.on('response', async (r) => { const u = r.url(); if (!/\/api\//.test(u)) return; net.push({ url: u.replace(/^https:\/\/[^/]+/, ''), status: r.status(), method: r.request().method(), post: r.request().postData() || null, r }); });
  if (localOnboarded) await page.evaluateOnNewDocument(() => { try { localStorage.setItem('boyau_onboarded', '1'); } catch (e) { /* storage off */ } });
  return { ctx, page, net };
}
async function signInPage(page, email) {
  await page.goto(APP + '/api/v1/auth/qa/by-email/' + encodeURIComponent(email) + '?p=' + encodeURIComponent(QA_P), { waitUntil: 'networkidle2', timeout: 60000 }).catch(() => null);
}
const text = (page) => page.evaluate(() => document.body.innerText);
async function shot(page, name) { const p = path.join(SHOTS, name + '.png'); await page.screenshot({ path: p }).catch(() => null); return p; }
async function clickText(page, sel, rx) {
  const handles = await page.$$(sel);
  for (const h of handles) {
    const t = await h.evaluate((el) => (el.innerText || el.textContent || '').trim());
    const vis = await h.evaluate((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
    if (vis && rx.test(t)) { await h.click(); return t; }
  }
  return null;
}

// ================================================================================================== screens
async function screens() {
  const P = 'screens';
  { // signed-out Lessons hub
    const { ctx, page } = await ctxPage();
    try {
      await page.goto(APP + '/app/pages/lessons/index?lang=en', { waitUntil: 'networkidle2', timeout: 60000 });
      await sleep(2500);
      const t = await text(page);
      const sec = t.indexOf('Lessons you can book');
      const rows = await page.$$eval('.pg-row .pg-row-name', (els) => els.map((e) => e.innerText.trim()));
      const lessonRows = rows.filter((n) => LESSON_NAMES_IN_PAGE.includes(n));
      add(P, 'signed out /pages/lessons: "Lessons you can book" + >= 3 rows', sec >= 0 && lessonRows.length >= 3, 'section ' + (sec >= 0) + ' · rows: ' + lessonRows.join(' | ') + ' · ' + await shot(page, 'anon-lessons'));
    } finally { await ctx.close(); }
  }
  { // signed-out Coaches list
    const { ctx, page } = await ctxPage();
    try {
      await page.goto(APP + '/app/pages/coach/index?list=1&lang=en', { waitUntil: 'networkidle2', timeout: 60000 });
      await sleep(2500);
      const t = await text(page);
      const names = COACH_NAMES.filter((n) => t.includes(n));
      add(P, 'signed out Coaches list is not empty (>= 2 coaches)', !/There are no coaches matching those filters/.test(t) && names.length >= 2, 'coaches seen: ' + names.join(', ') + ' · ' + await shot(page, 'anon-coaches'));
    } finally { await ctx.close(); }
  }
  // personas land on Home in a FRESH browser (the onboarding bounce + consent gate both get their chance to fire)
  for (const [key, email] of [['ken', persona('host-ken')], ['mei', persona('clubowner-mei')], ['tester1', 'boyau.tester1@silkvo.com']]) {
    const { ctx, page, net } = await ctxPage();
    try {
      await signInPage(page, email);
      await page.goto(APP + '/app/pages/home/index?lang=en', { waitUntil: 'networkidle2', timeout: 60000 });
      await sleep(6000);
      const url = page.url();
      const gate = await page.$('.cg');
      const lvl = net.filter((n) => /\/api\/meets\/level$/.test(n.url)).map((n) => n.status).join(',');
      add(P, key + ' lands on Home (not onboarding), no consent gate', /\/pages\/home\//.test(url) && !/onboard/.test(url) && !gate, 'url ' + url.replace(APP, '') + ' · gate ' + !!gate + ' · meets/level ' + lvl + ' · ' + await shot(page, key + '-home'));
      if (key === 'ken') {
        await page.goto(APP + '/app/pages/meets/index?pane=people&lang=en', { waitUntil: 'networkidle2', timeout: 60000 });
        await sleep(3500);
        const people = await page.$$eval('.pg-row', (els) => els.filter((e) => e.querySelector('.dv-level')).map((e) => ((e.querySelector('.pg-row-name') || {}).innerText || '').trim() + ' ' + ((e.querySelector('.dv-level') || {}).innerText || '').trim()));
        add(P, 'Discover › People lists >= 10 players (with levels)', people.length >= 10, people.length + ': ' + people.slice(0, 14).join(' · ') + ' · ' + await shot(page, 'ken-people'));
      }
    } finally { await ctx.close(); }
  }
}
let LESSON_NAMES_IN_PAGE = LESSON_NAMES;

// ================================================================================================== stranger books a seat
async function stranger() {
  const P = 'stranger';
  const email = 'probe-uatdemo-' + TS + '@demo.test';
  let tok = null, bookedMeet = null;
  const coach = await login(persona('clubowner-mei'));
  const mineS = ok(await se('coaches/schedules/list', {}, coach.token), 'schedules/list') || [];
  const clinic = mineS.find((s) => s.name === "Beginners' Group Clinic");
  if (!add(P, 'group clinic schedule found', !!clinic, clinic ? clinic.id : 'missing')) return;
  const { ctx, page, net } = await ctxPage({ localOnboarded: true });
  try {
    await page.goto(APP + '/app/pages/signin/index?lang=en&next=' + encodeURIComponent('/pages/lesson/index?id=' + clinic.id), { waitUntil: 'networkidle2', timeout: 60000 });
    await sleep(1500);
    const em = await page.$('.si-input input') || await page.$('input[type=email]');
    await em.click(); await em.type(email, { delay: 20 });
    await page.click('.cg-check-tap');
    await page.click('.si-submit');
    await page.waitForSelector('.si-sbx-code', { timeout: 20000 });
    const code = (await page.$eval('.si-sbx-code', (e) => e.innerText)).trim();
    const ci = await page.$('.si-code input');
    await ci.click(); await ci.type(code, { delay: 30 });
    await page.waitForFunction(() => /\/pages\/lesson\//.test(location.pathname), { timeout: 30000 }).catch(() => null);
    await sleep(3500);
    const loadErr = /Could not load this lesson/.test(await text(page));
    const failed = net.filter((n) => n.status >= 400 || n.status === 0).map((n) => n.method + ' ' + n.url.replace(/\?.*/, '') + ' -> ' + n.status);
    add(P, 'fresh .test sign-in (code read off the screen) returns to the lesson page, and it loads', /\/pages\/lesson\//.test(page.url()) && !loadErr, email + ' code ' + code + ' -> ' + page.url().replace(APP, '') + ' · load error ' + loadErr + ' · failed requests ' + (failed.join(', ') || 'none') + ' · ' + await shot(page, 'stranger-lesson'));
    const cookie = (await page.cookies(APP)).map((c) => c.name + '=' + c.value).join('; ');
    tok = await tokenFromCookie(cookie, APP);
    await se('i/update', { name: '[probe] uat-demo stranger ' + TS }, tok.token);   // G13: the fixture reads as one
    const before = ok(await se('coaches/schedules/show', { scheduleId: clinic.id }, tok.token), 'show');
    const next = (before.upcoming || []).find((m) => m.status !== 'cancelled');
    const quote = (before.pricing && before.pricing.upcoming || []).find((q) => q.meetId === next.id);
    const bookRx = /^Book$/;
    const tapped = await clickText(page, '.pg-row .hk-btn, .pg-row taro-button-core', bookRx);
    await sleep(1200);
    const sheetT = await text(page);
    add(P, 'lesson page: Book opens the confirm sheet with the group price', !!tapped && /Confirm booking/.test(sheetT) && sheetT.includes('HKD ' + (quote ? quote.price : '')), 'tapped ' + tapped + ' · quote HKD ' + (quote && quote.price) + ' · ' + await shot(page, 'stranger-sheet'));
    await clickText(page, '.hk-btn, taro-button-core', /^Confirm$/);
    await page.waitForFunction(() => /\/pages\/lessons\//.test(location.pathname), { timeout: 20000 }).catch(() => null);
    await sleep(2500);
    const bookCall = net.find((n) => /\/api\/coaches\/lessons\/book$/.test(n.url));
    const mine = ok(await se('coaches/lessons/mine', {}, tok.token), 'lessons/mine');
    const l = (mine.lessons || []).find((x) => x.coachScheduleId === clinic.id);
    bookedMeet = l ? l.meetId : (next && next.id);
    const roster = ok(await se('meets/show', { meetId: next.id }, coach.token), 'meets/show');
    const onRoster = (roster.participants || []).find((p) => p.userId === tok.userId);
    add(P, 'booking read back from the engine (student + coach roster), price locked at the group rate', !!bookCall && bookCall.status === 200 && !!l && l.status === 'confirmed' && !!onRoster && onRoster.status === 'confirmed' && l.agreedPrice === (quote && quote.price) && l.agreedCurrency === 'HKD', 'POST coaches/lessons/book -> ' + (bookCall && bookCall.status) + ' · mine ' + JSON.stringify(l && { meetId: l.meetId, status: l.status, agreedPrice: l.agreedPrice, agreedCurrency: l.agreedCurrency }) + ' · roster ' + (onRoster && onRoster.status) + ' · ' + await shot(page, 'stranger-after'));
  } catch (e) { add(P, 'stranger flow ran', false, e.message + ' · ' + await shot(page, 'stranger-error')); }
  finally {
    if (tok && bookedMeet) {
      const lv = await se('meets/leave', { meetId: bookedMeet }, tok.token);
      const again = ok(await se('meets/show', { meetId: bookedMeet }, coach.token), 'meets/show');
      const still = (again.participants || []).find((p) => p.userId === tok.userId && ['confirmed', 'waitlisted', 'requested'].includes(p.status));
      add(P, 'cleanup: the stranger booking is gone', !still, 'meets/leave -> ' + lv.status + ' · on roster ' + (still ? still.status : 'no'));
    }
    await ctx.close();
  }
}

// ================================================================================================== consent gate (P1)
async function consent() {
  const P = 'consent';
  const email = 'probe-consent-' + TS + '@demo.test';
  // a signed-in account WITHOUT today's terms: made through the sandbox claim door (no sign-in page, so nothing recorded)
  let s = null, raw = '';
  for (let a = 0; a < 4 && !(s && s._dev_code); a++) {   // hkpl-app restarts now and then: an nginx HTML page is not an answer
    if (a) await sleep(15000);
    const r = await fetch(HK + '/api/v1/auth/claim/start', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ email }) });
    raw = r.status + ' ' + (await r.text()); try { s = JSON.parse(raw.slice(4)); } catch (e) { s = null; }
  }
  if (!s) { add(P, 'fixture account', false, 'claim/start ' + raw.slice(0, 160)); return; }
  if (!s || !s._dev_code) { add(P, 'fixture account', false, JSON.stringify(s).slice(0, 200)); return; }
  const c = await fetch(HK + '/api/v1/auth/claim/complete', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, code: s._dev_code, password: 'Probe-uat-' + TS + '!' }) });
  if (c.status !== 200) { add(P, 'fixture account', false, 'claim/complete ' + c.status); return; }
  const tok = await login(email);
  await se('i/update', { name: '[probe] uat-demo consent ' + TS }, tok.token);
  const lv0 = ok(await se('meets/level', { sport: 'pickleball' }, tok.token), 'meets/level');
  if (!add(P, 'fixture has NOT accepted today\'s terms (the gate must ask)', lv0.termsVersion !== V, 'termsVersion ' + lv0.termsVersion)) return;
  const { ctx, page } = await ctxPage({ localOnboarded: true });
  // hkpl answers /auth/me 200 either way ({user:null} signed out) — the fact is the user row, not the status (G16.3)
  const signedIn = () => page.evaluate(async () => { const r = await fetch('/api/v1/auth/me', { credentials: 'include', headers: { accept: 'application/json' } }); const j = await r.json().catch(() => null); return j && j.user && j.user.email ? 200 : 401; });
  try {
    await signInPage(page, email);
    await page.goto(APP + '/app/pages/meets/index?lang=en', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('.cg', { timeout: 20000 });
    // the stray tap: the instant the gate appears, a tap lands where its "Sign out" is (the S2 verifier's click did exactly this)
    const out = await page.evaluate(() => { const els = [...document.querySelectorAll('.cg *')].filter((e) => /^(Sign out|登出|退出登录)$/.test((e.innerText || '').trim())); const e = els[els.length - 1]; if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    if (out) await page.mouse.click(out.x, out.y);
    await sleep(2500);
    const s1 = await signedIn();
    const gateStill = !!(await page.$('.cg'));
    add(P, 'a stray tap on Sign out the moment the gate appears does NOT sign out', s1 === 200 && gateStill, 'tap at ' + JSON.stringify(out) + ' · /api/v1/auth/me ' + s1 + ' · gate still up ' + gateStill + ' · ' + await shot(page, 'consent-after-stray-tap'));
    if (s1 !== 200) return;
    // the page behind is inert: every point of the screen hits the gate (or the report button), and nothing behind can take focus
    const inert = await page.evaluate(() => {
      const cg = document.querySelector('.cg'); const hits = []; let off = 0;
      if (!cg) return { off: -1, hits: ['no gate on screen'], focusable: -1, sample: [] };
      for (let x = 20; x < innerWidth; x += 70) for (let y = 20; y < innerHeight; y += 80) {
        const e = document.elementFromPoint(x, y); if (!e) continue;
        const inGate = cg.contains(e); const isReport = !!e.closest('.fb-fab, .hkpl-bug-fab, [class*="bug-fab"], [id*="bug"]');
        if (!inGate && !isReport) { off++; hits.push(x + ',' + y + ':' + (e.className && e.className.toString ? e.className.toString().slice(0, 40) : e.tagName)); }
      }
      const focusables = [...document.querySelectorAll('button, a[href], input, textarea, select, [tabindex]:not([tabindex="-1"]), taro-button-core, [role="button"]')].filter((e) => !cg.contains(e) && !e.closest('[inert]') && !e.closest('.fb-fab, .hkpl-bug-fab, [class*="bug-fab"], [id*="bug"]') && e.getClientRects().length);
      return { off, hits: hits.slice(0, 8), focusable: focusables.length, sample: focusables.slice(0, 5).map((e) => (e.innerText || e.getAttribute('aria-label') || e.tagName).slice(0, 30)) };
    });
    add(P, 'the page behind the gate is inert (no tappable or focusable control outside it)', inert.off === 0 && inert.focusable === 0, JSON.stringify(inert));
    // a deliberate Sign out asks first (the decline stays possible: Reclub's accept-or-leave)
    await sleep(1500);
    const tappedOut = await clickText(page, '.cg .hk-btn, .cg taro-button-core, .cg [role="button"]', /^Sign out$/);
    await sleep(1200);
    const t2 = await text(page);
    const s2 = await signedIn();
    add(P, 'a deliberate Sign out asks to confirm (still signed in, leave is one more tap)', !!tappedOut && s2 === 200 && /Sign out without accepting\?/.test(t2), 'tapped ' + tappedOut + ' · me ' + s2 + ' · ' + await shot(page, 'consent-confirm-step'));
    await clickText(page, '.cg .hk-btn, .cg taro-button-core, .cg [role="button"]', /^Go back$/);
    await sleep(1500);
    const agreed = await clickText(page, '.cg .hk-btn, .cg taro-button-core, .cg [role="button"]', /^I agree$/);
    await sleep(3000);
    const gone = !(await page.$('.cg'));
    const lv = ok(await se('meets/level', { sport: 'pickleball' }, tok.token), 'meets/level');
    add(P, 'I agree stores today\'s terms version (read back from meets/level) and the gate closes', !!agreed && gone && lv.termsVersion === V && !!lv.termsAcceptedAt, 'tapped ' + agreed + ' · gate gone ' + gone + ' · stored ' + lv.termsVersion + ' at ' + lv.termsAcceptedAt + ' (want ' + V + ') · ' + await shot(page, 'consent-accepted'));
  } catch (e) { add(P, 'consent flow ran', false, e.message + ' · ' + await shot(page, 'consent-error')); }
  finally { await ctx.close(); }
}

// ================================================================================================== main
(async () => {
  const started = new Date().toISOString();
  try {
    if (PHASES.includes('doors')) await doors().catch((e) => add('doors', 'doors ran', false, e.message));
    const needBrowser = PHASES.some((p) => ['screens', 'stranger', 'consent'].includes(p));
    if (needBrowser) {
      const puppeteer = require('/root/hkpl-server/node_modules/puppeteer-core');
      browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
      try {
        if (PHASES.includes('screens')) await screens().catch((e) => add('screens', 'screens ran', false, e.message));
        if (PHASES.includes('stranger')) await stranger().catch((e) => add('stranger', 'stranger ran', false, e.message));
        if (PHASES.includes('consent')) await consent().catch((e) => add('consent', 'consent ran', false, e.message));
      } finally { await browser.close(); }
    }
  } finally {
    const fail = checks.filter((c) => !c.pass);
    const v = { id: 'uat-demo-data', at: started, label: LABEL || null, engine: SE, app: APP, phases: PHASES, termsVersion: V, condition_fired: checks.length > 0, verdict: checks.length && !fail.length ? 'pass' : 'fail', counts: { checks: checks.length, pass: checks.length - fail.length, fail: fail.length }, evidence: checks };
    fs.writeFileSync(OUT, JSON.stringify(v, null, 1));
    console.log('VERDICT ' + v.verdict + ' ' + JSON.stringify(v.counts) + ' -> ' + OUT);
    process.exitCode = v.verdict === 'pass' ? 0 : 1;
  }
})();

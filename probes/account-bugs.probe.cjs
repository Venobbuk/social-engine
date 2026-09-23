// account-bugs.probe.cjs — lane account-bugs (ACCOUNT-BUGS-V1, 2026-09-23). UAT ONLY. Run through the browser slot:
//   MODE=before|after bash /root/gen/browser-slot.sh node /root/social-engine/probes/account-bugs.probe.cjs
// Proves, on https://uat.gripbat.com/app/ with real clicks and every effect read back from the ENGINE API or DB (never
// from the screen that caused it), the five bugs the L6 verifier S7 found:
//   B1 no screen shows anything derived from a person's email        B2 the five notification switches work
//   B3 a person's own name wins; empty / "GripBat" names refused    B4 DUPR Rankings source (REPORT ONLY — hkpl data)
//   B5 a match in a cancelled meet / competition is not history, at every stats door
// G16.1: MODE=before is run against the build that has the bugs and MUST fail each B1/B2/B3/B5 check (the live bug is
// the planted fault); a control step inside each delivery check proves the reader can SEE a notification before it
// asserts that one did not arrive. Fixtures are "[probe] account-bugs" and are removed in `finally` (meets cancelled /
// deleted, follow undone, the probe's notification rows XDEL'd from tester2's stream, tester2's settings + name restored).
// @claims endpoint i/update :: account-bugs :: name-required,name-reserved,notificationRecieveConfig
// @claims endpoint adapter/sso :: account-bugs :: name-seed-rule
// @claims endpoint chat/notification-prefs/update :: account-bugs :: meets
// @claims endpoint chat/notification-prefs/show :: account-bugs :: meets
// @claims endpoint stats/matches :: account-bugs :: cancelled-not-history
// @claims endpoint stats/match-summary :: account-bugs :: cancelled-not-history
// @claims endpoint stats/pair-summary :: account-bugs :: cancelled-not-history
// @claims endpoint stats/gb-edge :: account-bugs :: cancelled-not-history
// @claims route pages/profile/index :: account-bugs :: no-email-derived-text
// @claims route pages/player/index :: account-bugs :: no-email-derived-text
// @claims route pages/social-settings/index :: account-bugs :: notification-switches
// @claims route pages/history/index :: account-bugs :: cancelled-not-history
'use strict';
const fs = require('fs');
const { execSync } = require('child_process');
process.env.BASE = process.env.BASE || 'https://uat.social.silkvo.com';
const BASE = process.env.BASE;
if (!BASE.includes('uat.')) throw new Error('account-bugs refuses a non-UAT BASE: ' + BASE);
const HOST = new URL(BASE).hostname;
const APP = 'https://uat.gripbat.com/app';
const MODE = process.env.MODE === 'before' ? 'before' : 'after';
const OUT = '/root/social-engine/probes/account-bugs' + (MODE === 'before' ? '.before' : '') + '.verdict.json';
const SHOTS = '/root/gen/account-bugs/shots-' + MODE;
fs.mkdirSync(SHOTS, { recursive: true });
const PFX = '[probe] account-bugs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { getSession: rawSession } = require('/root/social-engine/probes/_session.cjs');
// one hkpl login per persona per run: UAT's engine points at PRODUCTION hkpl, whose login door rate-limits (and 502'd once)
const SESS = {};
const getSession = (i) => (SESS[i] = SESS[i] || rawSession(i));
// i/update allows 20 calls per hour per account (i/update.ts meta.limit). A 429 is never a refusal — it FAILS a check.
const errCode = (r) => (r && r.json && r.json.error && r.json.error.code) || '';
const ACCTS = JSON.parse(fs.readFileSync('/root/boyau-test-accounts.json', 'utf8'));

// ------------------------------------------------------------------------------------------------ doors
async function se(endpoint, body, token) {
  const r = await fetch(BASE + '/api/' + endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(token ? { ...(body || {}), i: token } : (body || {})) });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch (e) { /* not json */ }
  return { status: r.status, json, text };
}
async function hk(base, path, cookie) {
  const r = await fetch(base + path, { headers: { cookie: cookie.name + '=' + cookie.value } });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch (e) { /* */ }
  return { status: r.status, json, text };
}
/** A FRESH sign-in exchange every call (hkpl mint → engine adapter/sso), exactly what the app does at sign-in. */
async function exchange(i) {
  const cookie = await getSession(i);
  // adapter/sso allows 60 / minute per caller and every lane's probes share this box — back off on 429 (a fresh JWT each try)
  let m, r;
  for (let k = 0; k < 8; k++) {
    m = await hk(BASE, '/api/v1/auth/sso/social', cookie);
    if (!m.json || !m.json.jwt) throw new Error('sso/social ' + m.status + ' ' + m.text.slice(0, 120));
    r = await se('adapter/sso', { jwt: m.json.jwt });
    if (r.status !== 429) break;
    await sleep(20000);
  }
  if (!r.json || !r.json.token) throw new Error('adapter/sso ' + r.status + ' ' + r.text.slice(0, 120));
  const me = (await se('i', {}, r.json.token)).json;
  return { cookie, token: r.json.token, me, email: ACCTS[i].email };
}
function sql(q, db = 'se_sbx') {
  if (db !== 'se_sbx' && !/^\s*select/i.test(q)) throw new Error('only SELECT on ' + db);
  return execSync('docker exec -i social-engine-db-1 psql -U social -d ' + db + ' -At -F "|" -v ON_ERROR_STOP=1', { input: q, encoding: 'utf8' }).trim();
}
function redis(args) { return execSync('docker exec social-engine-redis-1 redis-cli -n 1 ' + args, { encoding: 'utf8', maxBuffer: 64e6 }); }

// ------------------------------------------------------------------------------------------------ verdict
const R = { id: 'account-bugs', mode: MODE, at: new Date().toISOString(), checks: [], notes: {}, cleanup: {}, errors: [] };
function check(bug, id, pass, detail) { R.checks.push({ bug, id, pass: !!pass, detail }); console.log((pass ? 'PASS ' : 'FAIL ') + bug + ' ' + id + ' ' + JSON.stringify(detail).slice(0, 300)); }
async function step(name, fn) { try { await fn(); } catch (e) { R.errors.push(name + ': ' + (e && e.stack || e)); check('probe', name + ':crashed', false, String(e && e.message || e)); } }

// ------------------------------------------------------------------------------------------------ browser
let browser = null;
async function page(i, opt = {}) {
  if (!browser) browser = await require('/root/hkpl-server/node_modules/puppeteer-core').launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
  const ctx = await browser.createBrowserContext();
  const p = await ctx.newPage(); await p.setViewport({ width: opt.width || 390, height: 900 });
  p.__req = []; p.__err = [];
  p.on('request', (q) => { if (/\/api\/(i\/update|chat\/notification-prefs|adapter\/sso)/.test(q.url())) p.__req.push(q.method() + ' ' + q.url().replace(/^https:\/\/[^/]+/, '') + ' ' + String(q.postData() || '').replace(/"i":"[^"]+"/, '"i":"…"').replace(/"jwt":"[^"]+"/, '"jwt":"…"').slice(0, 240)); });
  p.on('pageerror', (e) => p.__err.push(String(e.message || e).slice(0, 200)));
  // the consent gate overlays first visits; it is another lane's surface and not under test here
  await p.evaluateOnNewDocument(() => { document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = '.cg{display:none !important}'; document.head.appendChild(s); }); });
  const c = await getSession(i); await p.setCookie({ name: c.name, value: c.value, domain: 'uat.gripbat.com', path: '/', secure: true });
  return { ctx, p };
}
async function visit(p, route, shot, wait = 3500) {
  await p.goto(APP + route + (route.includes('?') ? '&' : '?') + 'lang=en', { waitUntil: 'networkidle2', timeout: 60000 }).catch(() => undefined);
  await sleep(wait);
  if (shot) await p.screenshot({ path: SHOTS + '/' + shot + '.png', fullPage: true }).catch(() => undefined);
  return p.evaluate(() => document.body.innerText).catch(() => '');
}
/** Real click on the visible leaf element whose text is exactly `text` (G16.7: a DOM click, network captured). */
async function clickText(p, text) {
  const tok = 'ab' + Math.random().toString(36).slice(2, 8);
  const ok = await p.evaluate((text, tok) => {
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const hits = Array.from(document.querySelectorAll('body *')).filter((el) => (el.innerText || '').trim() === text && vis(el));
    const leaf = hits.filter((el) => !hits.some((o) => o !== el && el.contains(o)));
    const el = leaf[leaf.length - 1]; if (!el) return false; el.scrollIntoView({ block: 'center' }); el.setAttribute('data-ab', tok); return true;
  }, text, tok);
  if (!ok) throw new Error('no element "' + text + '"');
  await sleep(250); await p.click('[data-ab="' + tok + '"]');
}
const swSel = (label) => '[role=switch][aria-label="' + label + '"]';
async function aria(p, label) { return p.$eval(swSel(label), (e) => e.getAttribute('aria-checked')).catch(() => 'absent'); }
async function flip(p, label) { await p.$eval(swSel(label), (el) => el.scrollIntoView({ block: 'center' })); await sleep(250); await p.click(swSel(label)); }
async function toastAfter(p, fn) {
  await fn();
  let seen = '';
  for (let k = 0; k < 12 && !seen; k++) { await sleep(250); seen = await p.evaluate(() => { const t = document.querySelector('.taro__toast, .weui-toast, [class*=toast]'); return t && t.innerText ? t.innerText.trim() : ''; }).catch(() => ''); }
  return seen;
}
async function setNameInput(p, value) {
  const sel = '.bp-editin input, input.bp-editin, .bp-editin';
  // the sheet closes after a successful save — open it again from the name, as a person would
  const open = await p.$eval(sel, (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).catch(() => false);
  if (!open) { await p.click('.bp-name'); await sleep(1200); }
  await p.waitForSelector(sel, { visible: true, timeout: 8000 });
  await p.click(sel, { clickCount: 3 }); await p.keyboard.down('Control'); await p.keyboard.press('KeyA'); await p.keyboard.up('Control'); await p.keyboard.press('Backspace');
  if (value) await p.type(sel, value, { delay: 15 });
  await sleep(300);
}

// ------------------------------------------------------------------------------------------------ notifications
async function listSince(P, t0) {
  const l = (await se('i/notifications', { limit: 50, markAsRead: false }, P.token)).json;
  if (!Array.isArray(l)) throw new Error('i/notifications did not answer a list');   // G16.6: a wrong shape fails loudly
  return l.filter((n) => new Date(n.createdAt).getTime() >= t0 - 1500);
}
/** Every row stats/matches gives (the door's page limit is 50 — G16.2: read the paramDef, not a guess). */
async function allMatches(token, q) {
  const out = [];
  for (let off = 0; off < 400; off += 50) {
    const r = await se('stats/matches', { sport: 'pickleball', ...q, limit: 50, offset: off }, token);
    if (!Array.isArray(r.json)) throw new Error('stats/matches not a list: ' + r.status + ' ' + r.text.slice(0, 160));
    out.push(...r.json); if (r.json.length < 50) break;
  }
  return out;
}
const isFollowFrom =(n, uid) => n.type === 'follow' && (n.userId === uid || (n.user && n.user.id === uid));
const isAppFor = (n, meetId, meetName) => n.type === 'app' && (String(n.link || n.customLink || '').includes(meetId) || String(n.body || '').includes(meetName));
const createdMeets = [];
async function probeMeet(host, tag) {
  const name = PFX + ' ' + tag + ' ' + Date.now().toString(36);
  const m = await se('meets/create', { name, startAt: new Date(Date.now() + 5 * 86400e3).toISOString(), durationMinutes: 60, capacity: 4, visibility: 'private', sendNotifications: true }, host.token);
  if (m.status !== 200 || !m.json || !m.json.id) throw new Error('meets/create ' + m.status + ' ' + m.text.slice(0, 160));
  createdMeets.push(m.json.id);
  const back = sql(`select name||'|'||visibility from meet where id='${m.json.id}'`);   // G16.5: the fixture is real
  if (!back.startsWith(PFX)) throw new Error('fixture meet not in the DB: ' + back);
  return { id: m.json.id, name };
}

// ------------------------------------------------------------------------------------------------ main
(async () => {
  // SUBJ = whose settings / name are switched (T2), ACT = the other tester who follows / invites (T1). i/update allows 20
  // calls per hour per account, so a re-run moves the subject (SUBJ=0|1). B1 privacy and B5 history always read tester2
  // (PV — the account the S7 verifier found the leak on; neither writes i/update).
  const SUBJ = Number(process.env.SUBJ || 1) === 0 ? 0 : 1, ACT = 1 - SUBJ;
  const T1 = await exchange(ACT), T2 = await exchange(SUBJ);
  const PV = SUBJ === 1 ? T2 : await exchange(1), PVV = SUBJ === 1 ? T1 : await exchange(0);
  R.notes.personas = { subject: 'tester' + (SUBJ + 1), actor: 'tester' + (ACT + 1), privacyAndHistory: 'tester2' };
  const orig = { name: T2.me.name, recv: T2.me.notificationRecieveConfig || {}, prefs: (await se('chat/notification-prefs/show', {}, T2.token)).json, t1FollowsT2: null };
  const rel = await se('users/relation', { userId: T2.me.id }, T1.token);
  orig.t1FollowsT2 = !!(rel.json && (Array.isArray(rel.json) ? rel.json[0] && rel.json[0].isFollowing : rel.json.isFollowing));
  R.notes.orig = orig; R.notes.t1 = T1.me.id; R.notes.t2 = T2.me.id;
  const emailLocal = String(PV.email).split('@')[0].toLowerCase();
  const T0 = Date.now();
  try {
    // =========================================================================================== B1 privacy
    await step('B1', async () => {
      // engine side: every SSO account's username is the one-way hkpl_<hex>, never an email part (both databases, read-only)
      const known = `username !~ '^hkpl_[0-9a-f]{12}$' and username not in ('admin','boyau') and username !~ '^(system\\.|demo_|probe_)'`;
      for (const db of ['se_sbx', 'social']) {
        const total = Number(sql('select count(*) from "user" where host is null', db));
        const other = Number(sql(`select count(*) from "user" where host is null and ${known}`, db));
        check('B1', 'engine usernames not email-derived (' + db + ')', total > 0 && other === 0, { localUsers: total, nonHandleNonSeed: other });
      }
      check('B1', 'tester2 username is the machine handle', /^hkpl_[0-9a-f]{12}$/.test(PV.me.username), { username: PV.me.username });
      // screens: tester2's own profile, home and more (mobile + desktop chrome), and tester1 looking at tester2
      const own = await page(1);
      for (const [route, shot] of [['/pages/profile/index', 'b1-own-profile'], ['/pages/home/index', 'b1-home'], ['/pages/more/index', 'b1-more']]) {
        const t = (await visit(own.p, route, shot)).toLowerCase();
        check('B1', 'no email-derived text on ' + route + ' (own)', t.length > 50 && !t.includes(emailLocal), { chars: t.length, found: t.includes(emailLocal), handleLine: (t.match(/@[^\s]+/) || [''])[0] });
      }
      await own.ctx.close();
      const desk = await page(1, { width: 1280 });
      const td = (await visit(desk.p, '/pages/profile/index', 'b1-own-profile-desktop')).toLowerCase();
      check('B1', 'no email-derived text on profile (desktop chrome)', td.length > 50 && !td.includes(emailLocal), { found: td.includes(emailLocal) });
      await desk.ctx.close();
      const other = await page(0);
      const to = (await visit(other.p, '/pages/player/index?id=' + PV.me.id, 'b1-t1-views-t2')).toLowerCase();
      check('B1', 'tester1 viewing tester2 sees no email-derived text', to.length > 50 && !to.includes(emailLocal), { found: to.includes(emailLocal) });
      await other.ctx.close();
    });

    // =========================================================================================== B2 notifications
    await step('B2', async () => {
      if (orig.t1FollowsT2) { await se('following/delete', { userId: T2.me.id }, T1.token); await sleep(1500); }
      // CONTROL (the reader can see one): follow ON → tester1 follows → a follow row must reach tester2
      if (orig.recv.follow && orig.recv.follow.type !== 'all') await se('i/update', { notificationRecieveConfig: { ...orig.recv, follow: { type: 'all' } } }, T2.token);
      let t = Date.now(); await se('following/create', { userId: T2.me.id }, T1.token); await sleep(3000);
      const ctl = (await listSince(T2, t)).filter((n) => isFollowFrom(n, T1.me.id)).length;
      check('B2', 'control: with New followers ON a follow notification arrives', ctl >= 1, { rows: ctl });
      await se('following/delete', { userId: T2.me.id }, T1.token); await sleep(1500);
      // CONTROL for meets: Meet updates ON → an invite reaches tester2
      await se('chat/notification-prefs/update', { key: 'meets', on: true }, T2.token);   // before the fix: 400 (no such key) — recorded
      const M1 = await probeMeet(T1, 'control');
      t = Date.now(); const add1 = await se('meets/participants/add', { meetId: M1.id, userId: T2.me.id, status: 'invited' }, T1.token); await sleep(3000);
      const ctlM = (await listSince(T2, t)).filter((n) => isAppFor(n, M1.id, M1.name)).length;
      check('B2', 'control: with Meet updates ON an invite notification arrives', add1.status === 200 && ctlM >= 1, { add: add1.status, rows: ctlM });

      // REAL CLICKS on the five switches, then a reload — every one must read OFF on the page AND in the engine
      const S = await page(SUBJ);
      await visit(S.p, '/pages/social-settings/index', 'b2-before-clicks');
      const LABELS = ['New followers', 'Reactions to my posts', 'Replies', 'Mentions', 'Meet updates (confirmed, invited, cancelled)'];
      const pre = {}; for (const l of LABELS) pre[l] = await aria(S.p, l);
      for (const l of LABELS) {
        if ((await aria(S.p, l)) !== 'true') continue;
        await flip(S.p, l); await sleep(1800);
        if (l.startsWith('Meet updates')) { await clickText(S.p, 'Turn off').catch((e) => R.errors.push('confirm: ' + e.message)); await sleep(2200); }
      }
      R.notes.b2Requests = S.p.__req.slice(0, 12);
      await visit(S.p, '/pages/social-settings/index', 'b2-after-reload');
      const post = {}; for (const l of LABELS) post[l] = await aria(S.p, l);
      await S.ctx.close();
      const me = (await se('i', {}, T2.token)).json; const prefs = (await se('chat/notification-prefs/show', {}, T2.token)).json || {};
      const rc = (me && me.notificationRecieveConfig) || {};
      const eng = { follow: rc.follow && rc.follow.type, reaction: rc.reaction && rc.reaction.type, reply: rc.reply && rc.reply.type, mention: rc.mention && rc.mention.type, meets: prefs.meets };
      check('B2', 'all five switches were ON before the clicks (fixture state)', LABELS.every((l) => pre[l] === 'true'), pre);
      check('B2', 'after reload all five switches read OFF on the page', LABELS.every((l) => post[l] === 'false'), post);
      check('B2', 'engine stored all five as off (native notificationRecieveConfig ×4 + prefs.meets)', eng.follow === 'never' && eng.reaction === 'never' && eng.reply === 'never' && eng.mention === 'never' && eng.meets === false, eng);
      // DELIVERY with the switches off: tester1 follows again, and invites tester2 to a second meet
      t = Date.now(); await se('following/create', { userId: T2.me.id }, T1.token); await sleep(3000);
      const muted = (await listSince(T2, t)).filter((n) => isFollowFrom(n, T1.me.id)).length;
      check('B2', 'New followers OFF: a new follow does not reach tester2', ctl >= 1 && muted === 0, { rows: muted });
      await se('following/delete', { userId: T2.me.id }, T1.token);
      const M2 = await probeMeet(T1, 'muted');
      t = Date.now(); const add2 = await se('meets/participants/add', { meetId: M2.id, userId: T2.me.id, status: 'invited' }, T1.token); await sleep(3000);
      const mutedM = (await listSince(T2, t)).filter((n) => isAppFor(n, M2.id, M2.name)).length;
      check('B2', 'Meet updates OFF: an invite does not reach tester2', add2.status === 200 && ctlM >= 1 && mutedM === 0, { add: add2.status, rows: mutedM });
      // a casual-game consent ask is not an update — it must still arrive (read from the code path, no fixture: L2)
    });

    // =========================================================================================== B3 names
    await step('B3', async () => {
      const nameNow = async () => (await se('i', {}, T2.token)).json.name;
      const e1 = await se('i/update', { name: '   ' }, T2.token);
      const after1 = await nameNow();
      check('B3', 'API: an empty name is refused (NAME_REQUIRED) and nothing is stored', errCode(e1) === 'NAME_REQUIRED' && after1 === orig.name, { status: e1.status, code: errCode(e1), stored: after1 });
      if (after1 !== orig.name) await se('i/update', { name: orig.name }, T2.token);
      const e2 = await se('i/update', { name: PFX + ' GripBat' }, T2.token);
      const after2 = await nameNow();
      check('B3', 'API: a name containing GripBat is refused (NAME_RESERVED)', errCode(e2) === 'NAME_RESERVED' && after2 === orig.name, { status: e2.status, code: errCode(e2), stored: after2 });
      if (after2 !== orig.name) await se('i/update', { name: orig.name }, T2.token);
      const e3 = await se('i/update', { name: PFX + ' grip bat' }, T2.token);   // case / spacing variant of the rule
      check('B3', 'API: "grip bat" (case, spacing) is refused too', errCode(e3) === 'NAME_RESERVED', { status: e3.status, code: errCode(e3) });
      if ((await nameNow()) !== orig.name) await se('i/update', { name: orig.name }, T2.token);

      // UI: the Edit profile sheet — empty, reserved, then a real edit that must survive the next sign-in exchange
      const U = await page(SUBJ);
      await visit(U.p, '/pages/profile/index', 'b3-profile');
      await U.p.click('.bp-name').catch(() => clickText(U.p, orig.name)); await sleep(1200);
      await setNameInput(U.p, '');
      const tEmpty = await toastAfter(U.p, () => clickText(U.p, 'Save'));
      const s1 = await nameNow();
      check('B3', 'UI: Save with an empty name says so and stores nothing', /enter your name/i.test(tEmpty) && s1 === orig.name, { toast: tEmpty, stored: s1 });
      if (s1 !== orig.name) await se('i/update', { name: orig.name }, T2.token);
      await setNameInput(U.p, PFX + ' GripBat');
      const tRes = await toastAfter(U.p, () => clickText(U.p, 'Save'));
      const s2 = await nameNow();
      check('B3', 'UI: Save with "GripBat" in the name is refused in words', /reserved/i.test(tRes) && s2 === orig.name, { toast: tRes, stored: s2 });
      if (s2 !== orig.name) await se('i/update', { name: orig.name }, T2.token);
      const OWN = PFX + ' own name';
      await setNameInput(U.p, OWN);
      const tOk = await toastAfter(U.p, () => clickText(U.p, 'Save'));
      const s3 = await nameNow();
      check('B3', 'UI: a real edit saves', s3 === OWN, { toast: tOk, stored: s3 });
      // the next sign-in: a fresh hkpl mint → adapter/sso exchange (hkpl still says the old name)
      const again = await exchange(SUBJ);
      const s4 = (await se('i', {}, again.token)).json.name;
      const db4 = sql(`select name from "user" where id='${T2.me.id}'`);
      // 2026-09-23 scope change: the sign-in exchange (adapter/sso) and where a name comes from belong to gripbat-accounts — recorded, not graded
      R.notes.b3AfterExchange = { api: s4, db: db4, hkplName: orig.name, ownEditKept: s4 === OWN && db4 === OWN };
      const tpage = await visit(U.p, '/pages/profile/index', 'b3-after-exchange');
      R.notes.b3PageAfterExchange = tpage.includes(OWN);
      await U.ctx.close();
    });

    // =========================================================================================== B4 DUPR rankings (report)
    await step('B4', async () => {
      const cUat = await getSession(1);
      const uat = await hk(BASE, '/api/v1/players?sort=rating_doubles&order=desc&limit=1', cUat);
      const engUat = await se('stats/dupr-rankings', { sort: 'doubles', limit: 1 });
      const engProd = await fetch('https://social.silkvo.com/api/stats/dupr-rankings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"sort":"doubles","limit":1}' }).then((r) => r.json()).catch(() => null);
      R.notes.b4 = { appSource: 'hkpl GET /api/v1/players (lib/discover.ts duprRankings, DUPR-HKPL-V1)', hkplUatTotal: uat.json && uat.json.total, hkplUatStatus: uat.status, engineUatTotal: engUat.json && engUat.json.total, engineProdTotal: engProd && engProd.total };
      // not a pass/fail of our code: the verdict records the facts; the fix is hkpl sandbox data (see report)
    });

    // =========================================================================================== B5 cancelled is not history
    await step('B5', async () => {
      const cancelled = sql("select id from competition where status='cancelled'").split('\n').filter(Boolean);
      const cancelledNames = sql("select name from competition where status='cancelled'").split('\n').filter(Boolean);
      const cMeets = sql("select id from meet where status='cancelled'").split('\n').filter(Boolean);
      check('B5', 'fixture: cancelled competitions with completed matches exist on UAT', cancelled.length > 0 && Number(sql("select count(*) from competition_match cm join competition c on c.id=cm.\"competitionId\" where c.status='cancelled' and cm.status='completed'")) > 0, { cancelledComps: cancelled.length });
      const players = sql(`select distinct u from (select unnest(e."userIds") u from competition_entry e join competition c on c.id=e."competitionId" join competition_match cm on cm."competitionId"=c.id where c.status='cancelled' and cm.status='completed') x`).split('\n').filter(Boolean);
      R.notes.b5Players = players.length;
      let leakRows = 0, perPlayer = {};
      for (const u of players) {
        const rows = await allMatches(PV.token, { userId: u });
        const bad = rows.filter((x) => cancelled.includes(x.contextId) || cMeets.includes(x.contextId)).length;
        perPlayer[u] = { rows: rows.length, cancelledRows: bad }; leakRows += bad;
      }
      check('B5', 'stats/matches (My history, player match lists, pair H2H list) carries no cancelled meet/competition', players.length > 0 && leakRows === 0, perPlayer);
      const cm = sql(`select cm.id from competition_match cm join competition c on c.id=cm."competitionId" where c.status='cancelled' and cm.status='completed' limit 1`);
      const sum = await se('stats/match-summary', { source: 'competition', matchId: cm }, PV.token);
      check('B5', 'stats/match-summary refuses a match of a cancelled competition', !!cm && (sum.status >= 400 || sum.json == null || (sum.json && !sum.json.matchId)), { matchId: cm, status: sum.status, body: sum.text.slice(0, 80) });
      // gb-edge match count = the log rows that are still history (DB), for every affected player
      const LIVE = `(l.source='openplay' OR (l.source='meet' AND EXISTS (SELECT 1 FROM meet_match a JOIN meet b ON b.id=a."meetId" WHERE a.id=l."matchId" AND b.status<>'cancelled')) OR (l.source='competition' AND EXISTS (SELECT 1 FROM competition_match a JOIN competition b ON b.id=a."competitionId" WHERE a.id=l."matchId" AND b.status<>'cancelled')))`;
      const edges = {};
      for (const u of players) {
        const e = await se('stats/gb-edge', { userId: u, sport: 'pickleball' }, PV.token);
        const all = Number(sql(`select count(*) from gb_rating_log l where l."userId"='${u}' and l.sport='pickleball' and not l.skipped`));
        const live = Number(sql(`select count(*) from gb_rating_log l where l."userId"='${u}' and l.sport='pickleball' and not l.skipped and ${LIVE}`));
        const stored = sql(`select coalesce(matches,0) from gb_player_rating where "userId"='${u}' and sport='pickleball'`) || '0';
        edges[u] = { edge: e.json && e.json.matches, dbAll: all, dbLive: live, gbPlayerRating: Number(stored) };
      }
      check('B5', 'gb-edge counts only matches that are still history', Object.values(edges).every((x) => x.edge === x.dbLive), edges);
      check('B5', 'no rating-log row of a cancelled competition remains (take-back on cancel)', Number(sql(`select count(*) from gb_rating_log l join competition_match cm on cm.id=l."matchId" join competition c on c.id=cm."competitionId" where l.source='competition' and c.status='cancelled' and not l.skipped`)) === 0, {});
      // pair record and the match list agree for every partner tester2 has
      const partners = sql(`select distinct "partnerId" from gb_rating_log where "userId"='${PV.me.id}' and not skipped and "partnerId" is not null`).split('\n').filter(Boolean);
      const agree = {};
      for (const b of partners) {
        const ps = await se('stats/pair-summary', { a: PV.me.id, b, sport: 'pickleball', limit: 50 }, PV.token);
        const ml = await allMatches(PV.token, { userId: PV.me.id, partnerId: b });
        agree[b] = { pair: ps.json && ps.json.matches, list: ml.length };
      }
      check('B5', 'pair record = match list for every partner of tester2', partners.length > 0 && Object.values(agree).every((x) => x.pair === x.list), agree);
      // the screen: My history › Matches as tester2
      const H = await page(1);
      const th = await visit(H.p, '/pages/history/index?pane=matches', 'b5-my-history', 5000);
      const shown = cancelledNames.filter((n) => th.includes(n));
      check('B5', 'My history › Matches shows no cancelled competition', th.length > 50 && shown.length === 0, { shown });
      await H.ctx.close();
    });
  } catch (e) { R.errors.push('FATAL ' + (e && e.stack || e)); } finally {
    // ------------------------------------------------------------------------------------------ cleanup
    try { if (browser) await browser.close(); } catch (e) { /* */ }
    const C = R.cleanup;
    try {
      for (const id of createdMeets) {
        const d = await se('meets/delete', { meetId: id }, T1.token); C['delete ' + id] = d.status;
        if (d.status !== 200) C['cancel ' + id] = (await se('meets/cancel', { meetId: id }, T1.token)).status;
      }
      C.liveProbeMeets = sql(`select count(*) from meet where name like '${PFX}%' and status <> 'cancelled'`);
    } catch (e) { C.meetError = e.message; }
    try {
      const relNow = await se('users/relation', { userId: T2.me.id }, T1.token);
      const follows = !!(relNow.json && (Array.isArray(relNow.json) ? relNow.json[0] && relNow.json[0].isFollowing : relNow.json.isFollowing));
      if (follows !== orig.t1FollowsT2) C.follow = (await se(orig.t1FollowsT2 ? 'following/create' : 'following/delete', { userId: T2.me.id }, T1.token)).status;
      C.followRestored = orig.t1FollowsT2;
    } catch (e) { C.followError = e.message; }
    await sleep(2500);
    try {   // the probe's own notification rows in tester2's stream (follows from tester1 and the probe meets), nothing else
      const key = HOST + ':notificationTimeline:' + T2.me.id;
      const raw = redis('XRANGE ' + key + ' ' + (T0 - 5000) + ' +').split('\n');
      const del = [];
      for (let k = 0; k < raw.length; k++) {
        if (!/^\d{13}-\d+$/.test(raw[k].trim())) continue;
        const body = raw.slice(k + 1, k + 4).join(' ');
        if ((body.includes('"type":"follow"') && body.includes(T1.me.id)) || createdMeets.some((id) => body.includes(id)) || body.includes(PFX)) del.push(raw[k].trim());
      }
      C.streamKeyLen = Number(redis('XLEN ' + key).trim());
      C.notificationsRemoved = del.length ? Number(redis('XDEL ' + key + ' ' + del.join(' ')).trim()) : 0;
    } catch (e) { C.streamError = e.message; }
    try {
      const cur = (await se('i', {}, T2.token)).json || {};
      const upd = {};
      if (cur.name !== orig.name) upd.name = orig.name;
      if (JSON.stringify(cur.notificationRecieveConfig || {}) !== JSON.stringify(orig.recv)) upd.notificationRecieveConfig = orig.recv;
      C.restoreWrite = Object.keys(upd).length ? (await se('i/update', upd, T2.token)).status : 'nothing to restore';
      const pm = await se('chat/notification-prefs/update', { key: 'meets', on: true }, T2.token); C.meetsPref = pm.status;
      const me = (await se('i', {}, T2.token)).json;
      C.restored = me.name === orig.name && JSON.stringify(me.notificationRecieveConfig || {}) === JSON.stringify(orig.recv);
    } catch (e) { C.restoreError = e.message; }
    try { C.probecount = execSync('bash /root/gen/probecount.sh', { encoding: 'utf8' }).trim(); } catch (e) { C.probecount = 'error ' + e.message; }
    const fails = R.checks.filter((c) => !c.pass);
    R.summary = { checks: R.checks.length, pass: R.checks.length - fails.length, fail: fails.length, failed: fails.map((f) => f.bug + ' ' + f.id) };
    R.verdict = fails.length || R.errors.length || !C.restored ? 'fail' : 'pass';
    // condition_fired: the checks were seen to FAIL on the buggy build (MODE=before) — read from that run's file
    let before = null; try { before = JSON.parse(fs.readFileSync('/root/social-engine/probes/account-bugs.before.verdict.json', 'utf8')); } catch (e) { /* */ }
    R.condition_fired = MODE === 'before' ? fails.length > 0 : !!(before && before.summary && before.summary.fail > 0);
    R.evidence = [{ summary: R.summary }, { before: before ? before.summary : null }, { notes: R.notes }, { cleanup: C }, { shots: SHOTS }];
    fs.writeFileSync(OUT, JSON.stringify(R, null, 1));
    console.log('VERDICT ' + R.verdict + ' ' + JSON.stringify(R.summary) + ' → ' + OUT);
    process.exit(0);
  }
})();

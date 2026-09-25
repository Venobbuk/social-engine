require('./_guard.cjs');   // G13.3: run through probes/run.sh (it sweeps afterwards)
// probes/fix-S7.probe.cjs — lane fix-S7 (2026-09-24). Closes the S7 re-check (gen/l6-scope/S7-account-stats/recheck.json) at
// L6 on https://uat.gripbat.com/app/ at 390 px, EN + 繁, against the UAT engine (state read back from the engine / se_sbx).
//
//   PHASE=before  the fault: the LIVE bundle + the running engine BEFORE this lane's change. Every row marked mustFail must
//                 FAIL here (a check that cannot fail is not evidence, G16.1). Writes fix-S7.before.json.
//   PHASE=after   the fix. APP=preview serves the lane's built dist (PREVIEW_DIR) into the browser for /app/* only (the
//                 engine, hkpl and data are the real UAT ones); APP=live reads the deployed bundle. Writes fix-S7.after.json
//                 and the verdict fix-S7.verdict.json (pass only when every own row passes after AND every mustFail row
//                 failed before).
// Fixtures: five NATIVE throwaway accounts '[probe] fix-S7 A..E <run>' (fs7-<run>-x@example.invalid — a reserved test
// address, so the caged UAT engine links a SANDBOX DUPR id locally: gb/dupr/connect, source dupr-sandbox, nothing calls
// DUPR), meets / a club / a competition by host-ken, all '[probe] fix-S7 …', removed in finally. One SQL write: A's
// meet_player_level.duprDoubles = 3.5 (a rating to prove Disconnect clears it; column type read first). The maintenance
// switch is the REAL staff door (admin persona, gb/maintenance) — on for < 60 s, then off and read back.
// Never: a real DUPR id, a DUPR submit outside the UAT cage, production.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const puppeteer = require('/root/hkpl-server/node_modules/puppeteer-core');
process.env.BASE = process.env.BASE || 'https://uat.gripbat.com';
const { getNativeToken } = require('./_native-session.cjs');
const BASE = process.env.BASE;
if (!/uat\./.test(BASE)) { console.error('UAT only'); process.exit(2); }
const APPURL = BASE + '/app';
const PHASE = process.env.PHASE === 'before' ? 'before' : 'after';
const MODE = process.env.APP === 'preview' ? 'preview' : 'live';
const PREVIEW_DIR = process.env.PREVIEW_DIR || '/root/gen/fix-s7/preview-dist';
const ONLY = (process.env.ONLY || '').split(',').filter(Boolean);
const SHOTS = '/root/social-engine/probes/fix-S7-shots/' + PHASE + '-' + MODE;
fs.mkdirSync(SHOTS, { recursive: true });
const RUN = crypto.randomBytes(3).toString('hex');
const PFX = '[probe] fix-S7';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIME = { js: 'application/javascript', css: 'text/css', html: 'text/html; charset=utf-8', png: 'image/png', svg: 'image/svg+xml', jpg: 'image/jpeg', json: 'application/json', woff2: 'font/woff2', webp: 'image/webp', mp4: 'video/mp4' };
const R = { id: 'fix-S7', phase: PHASE, app: MODE, run: RUN, at: new Date().toISOString(), rows: {}, fixtures: {}, cleanup: {}, errors: [] };

// ---------------------------------------------------------------------------------------------------------- engine
async function se(endpoint, body, token) {
  const r = await fetch(BASE + '/api/' + endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(token ? { ...(body || {}), i: token } : (body || {})) });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch (e) { /* 204 */ }
  return { status: r.status, json, text, code: (json && json.error && json.error.code) || '' };
}
function psql(q) { return execFileSync('docker', ['exec', '-i', 'social-engine-db-1', 'psql', '-U', 'social', '-d', 'se_sbx', '-qtA', '-F', '|'], { input: q }).toString().trim(); }
function sql(q) { if (!/^\s*(select|with)\b/i.test(q)) throw new Error('read-only sql: ' + q.slice(0, 60)); return psql(q); }
const idOk = (x) => /^[a-z0-9]{10,24}$/.test(String(x || ''));
function row(id, items, pass, evidence, opt = {}) {
  R.rows[id] = { id, items, pass: !!pass, mustFail: !!opt.mustFail, level: opt.level || 'L6', vsReclub: opt.vsReclub || null, evidence };
  console.log((pass ? 'PASS ' : 'FAIL ') + id + ' ' + JSON.stringify(evidence).slice(0, 400));
}
function want(id) { return !ONLY.length || ONLY.some((o) => id.startsWith(o)); }

// ---------------------------------------------------------------------------------------------------------- browser
let browser;
async function newPage(token, opt = {}) {
  const ctx = browser.createBrowserContext ? await browser.createBrowserContext() : await browser.createIncognitoBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  page.__api = [];
  page.__dictFail = opt.dictFail || 0;
  page.on('response', (res) => { const u = res.url(); if (!/\/api\//.test(u)) return; page.__api.push({ m: res.request().method(), p: u.replace(/^https:\/\/[^/]+/, '').split('?')[0], s: res.status(), body: res.request().postData() || '' }); });
  page.on('dialog', async (d) => { R.errors.push('native dialog: ' + d.message()); await d.dismiss().catch(() => undefined); });
  if (MODE === 'preview' || opt.dictFail) {
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const u = req.url();
      try {
        if (page.__dictFail > 0 && /\/api\/v1\/i18n\/zh_/.test(u)) { page.__dictFail--; page.__api.push({ m: 'GET', p: 'PLANTED 503 ' + u.split('/api/')[1], s: 503, body: '' }); return req.respond({ status: 503, contentType: 'application/json', body: '{"error":"planted"}' }); }
        if (MODE === 'preview' && u.startsWith(APPURL + '/')) {
          const rel = u.slice(APPURL.length + 1).split('?')[0].split('#')[0];
          const f = path.join(PREVIEW_DIR, rel);
          if (rel && !rel.startsWith('uat') && fs.existsSync(f) && fs.statSync(f).isFile()) return req.respond({ status: 200, contentType: MIME[path.extname(f).slice(1)] || 'application/octet-stream', body: fs.readFileSync(f) });
          if (req.resourceType() === 'document') return req.respond({ status: 200, contentType: MIME.html, body: fs.readFileSync(path.join(PREVIEW_DIR, 'index.html')) });
        }
      } catch (e) { R.errors.push('intercept ' + e.message); }
      return req.continue();
    });
  }
  if (token) await page.evaluateOnNewDocument((t) => { try { if (!sessionStorage.getItem('__fs7')) { localStorage.setItem('boyau_social_token', JSON.stringify({ data: t })); sessionStorage.setItem('__fs7', '1'); } } catch (e) { /* */ } }, token);
  return { page, ctx };
}
async function visit(page, route, lang, wait = 3000) {
  page.__api = [];
  await page.goto(APPURL + route + (route.includes('?') ? '&' : '?') + 'lang=' + (lang || 'en'), { waitUntil: 'networkidle2', timeout: 60000 }).catch((e) => R.errors.push('goto ' + route + ': ' + e.message));
  await sleep(wait);
  await dismiss(page);
  return text(page);
}
async function text(page) { return (await page.evaluate(() => document.body.innerText).catch(() => '')).replace(/[ \t]+\n/g, '\n'); }
async function shot(page, name) { await page.screenshot({ path: SHOTS + '/' + name + '.png' }).catch(() => undefined); return SHOTS + '/' + name + '.png'; }
async function dismiss(page) { for (let k = 0; k < 3; k++) { const t = await text(page); const b = /Not now/.test(t) ? 'Not now' : /Got it, continue/.test(t) ? 'Got it, continue' : ''; if (!b) return; await clickText(page, b, { wait: 900 }).catch(() => undefined); } }
/** A real cursor click on the deepest visible element whose own text is `text`. */
async function clickText(page, txt, opt = {}) {
  const tok = 'f7' + Math.random().toString(36).slice(2, 8);
  const ok = await page.evaluate((txt, tok, exact, sel, last) => {
    const els = Array.from(document.querySelectorAll(sel || 'body *'));
    const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
    const T = txt.toLowerCase(); const hits = els.filter((el) => { const t = (el.innerText || '').trim().toLowerCase(); return (exact ? t === T : t.includes(T)) && vis(el); });
    const leaf = hits.filter((el) => !hits.some((o) => o !== el && el.contains(o)));
    const el = last ? leaf[leaf.length - 1] : leaf[0]; if (!el) return false;
    el.scrollIntoView({ block: 'center' }); el.setAttribute('data-f7', tok); return true;
  }, txt, tok, opt.exact !== false, opt.sel || null, !!opt.last);
  if (!ok) throw new Error('no visible element with text "' + txt + '"');
  await sleep(250);
  await page.click('[data-f7="' + tok + '"]');
  await sleep(opt.wait == null ? 1800 : opt.wait);
}
async function typeIn(page, how, value, opt = {}) {
  const tok = 'f7i' + Math.random().toString(36).slice(2, 8);
  const ok = await page.evaluate((how, tok) => {
    const ins = Array.from(document.querySelectorAll('input')).filter((i) => { const r = i.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
    const el = ins.find((i) => (how.name && i.name === how.name) || (how.ph && (i.placeholder || '') === how.ph) || (how.type && i.type === how.type && !i.value));
    if (!el) return false; el.scrollIntoView({ block: 'center' }); el.setAttribute('data-f7i', tok); return true;
  }, how, tok);
  if (!ok) throw new Error('no input ' + JSON.stringify(how));
  const sel = '[data-f7i="' + tok + '"]';
  await page.click(sel, { clickCount: 3 }); await page.keyboard.press('Backspace');
  if (value) await page.type(sel, value, { delay: opt.delay || 25 });
  await sleep(opt.wait == null ? 500 : opt.wait);
  return page.$eval(sel, (i) => i.value);
}
/** Bounding rect of the first visible element whose own text is exactly `txt` (null when absent). */
async function rectOf(page, txt) {
  return page.evaluate((txt) => {
    const els = Array.from(document.querySelectorAll('body *')).filter((el) => (el.innerText || '').trim() === txt);
    const leaf = els.filter((el) => !els.some((o) => o !== el && el.contains(o)));
    for (const el of leaf) { const r = el.getBoundingClientRect(); if (r.width > 0 && r.height > 0) return { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), width: Math.round(r.width) }; }
    return null;
  }, txt);
}

// ---------------------------------------------------------------------------------------------------------- fixtures
const acct = {};
async function throwaway(tag, opt = {}) {
  const email = `fs7-${RUN}-${tag.toLowerCase()}@example.invalid`, password = 'Fs7-' + crypto.randomBytes(6).toString('hex');
  const s = await se('signup', { emailAddress: email, password, lang: 'en' });
  if (!(s.json && s.json._dev_code)) throw new Error('signup ' + tag + ' ' + s.status + ' ' + s.text.slice(0, 160));
  const d = await se('signup-pending', { code: s.json._dev_code });
  if (!(d.json && d.json.i)) throw new Error('signup-pending ' + tag + ' ' + d.status);
  const a = { tag, email, password, token: d.json.i, userId: d.json.id };
  acct[tag] = a;
  await se('i/update', { name: PFX + ' ' + tag + ' ' + RUN }, a.token);
  if (opt.username !== false) { const u = await se('gb/account/username', { username: 'fs7' + RUN + tag.toLowerCase() }, a.token); a.username = u.json && u.json.username; }
  if (opt.terms) await se('meets/level', { sport: 'pickleball', acceptTerms: opt.terms, ...(opt.onboarded === false ? {} : { onboarded: true }) }, a.token);
  R.fixtures['acct_' + tag] = { userId: a.userId, email, username: a.username || null };
  return a;
}
const F = { meets: [], comps: [], clubs: [] };
async function mkMeet(host, name, startMs, extra = {}) {
  const r = await se('meets/create', { name: PFX + ' ' + name + ' ' + RUN, type: 'managed', startAt: new Date(Date.now() + startMs).toISOString(), durationMinutes: 60, capacity: 8, visibility: 'public', sendNotifications: false, autoApprove: true, ...extra }, host.token);
  if (!(r.json && r.json.id)) throw new Error('meets/create ' + name + ' ' + r.status + ' ' + r.text.slice(0, 200));
  F.meets.push({ id: r.json.id, host }); return r.json.id;
}
const pidOf = (meetId, userId) => sql(`select id from meet_participant where "meetId"='${meetId}' and "userId"='${userId}' limit 1`);

(async () => {
  const ken = await getNativeToken(process.env.PROBE_HOST || 'host-ken');   // the fixtures' host (PROBE_HOST=clubowner-mei when host-ken hit meets/create's rate limit)
  const admin = await getNativeToken('admin');
  const kh = await getNativeToken(process.env.CLUB_HOST || 'host-ken');   // the club's owner (channels/create is rate-limited per account)
  const amy = await getNativeToken('player-amy');
  const terms = ((await se('meets/level', { sport: 'pickleball' }, amy.token)).json || {}).termsVersion;
  R.build = { engine: execFileSync('docker', ['inspect', '-f', '{{index .Config.Labels "org.opencontainers.image.revision"}}', 'social-engine-web-uat-1']).toString().trim(), live: ((await (await fetch(APPURL + '/')).text()).match(/app\.[0-9a-f]{8}\.js/) || [''])[0], preview: MODE === 'preview' ? (fs.readdirSync(path.join(PREVIEW_DIR, 'js')).find((f) => /^app\.[0-9a-f]{8}\.js$/.test(f)) || '') : null };
  const maint0 = (await se('gb/status', {})).json;
  R.fixtures.maintenanceBefore = maint0 && maint0.maintenance;
  try {
    // ---- accounts (A, B sandbox-linked DUPR; C unconnected; D deletes itself; E fresh for onboarding)
    const A = await throwaway('A', { terms }), B = await throwaway('B', { terms }), C = await throwaway('C', { terms }), D = await throwaway('D', { terms });
    const E = await throwaway('E', { terms, username: false, onboarded: false });
    for (const [x, id] of [[A, 'FS7A' + RUN.slice(0, 4).toUpperCase()], [B, 'FS7B' + RUN.slice(0, 4).toUpperCase()]]) {
      const c = await se('gb/dupr/connect', { duprId: id.replace(/[^A-Z0-9]/g, 'X').slice(0, 10) }, x.token);
      R.fixtures['dupr_' + x.tag] = { status: c.status, body: c.json };
      if (!(c.json && c.json.sandbox === true)) throw new Error('sandbox DUPR link for ' + x.tag + ' was not a sandbox link: ' + c.text.slice(0, 200));
    }
    const NEED_MEETS = ['U-dmgr','U-dupr-basis','U-notice','U-activity','R-played','R-recap','U-history'].some(want);   // an ONLY= re-run makes no meet it does not read
    let M = null, N = null, Fu = null;
    if (NEED_MEETS) {
    // ---- M: ken's DUPR meet (starts in 75 s): A vs B singles (eligible) + ken vs guest (ineligible); submitMatches after scoring
    M = await mkMeet(ken, 'dupr', 75e3);
    for (const x of [A, B]) R.fixtures['joinM_' + x.tag] = (await se('meets/join', { meetId: M }, x.token)).status;
    const g = await se('meets/participants/add', { meetId: M, displayName: PFX + ' guest ' + RUN }, ken.token); R.fixtures.guest = g.status;
    const guestPid = sql(`select id from meet_participant where "meetId"='${M}' and "userId" is null limit 1`);
    const m1 = await se('meets/matches/upsert', { meetId: M, team1Ids: [pidOf(M, A.userId)], team2Ids: [pidOf(M, B.userId)], scores: [[11, 6], [11, 8]], round: 1, courtIndex: 0 }, ken.token);
    const m2 = await se('meets/matches/upsert', { meetId: M, team1Ids: [pidOf(M, ken.userId)], team2Ids: [guestPid], scores: [[11, 4]], round: 1, courtIndex: 1 }, ken.token);
    F.m1 = m1.json && m1.json.id; F.m2 = m2.json && m2.json.id;
    R.fixtures.matches = { m1: m1.status + ' ' + F.m1, m2: m2.status + ' ' + F.m2, submitOn: (await se('meets/update', { meetId: M, submitMatches: true }, ken.token)).status };
    if (!idOk(F.m1) || !idOk(F.m2)) throw new Error('match fixtures failed ' + JSON.stringify(R.fixtures.matches));
    // ---- N: a DUPR meet (in 2 days) for the join notice
    N = await mkMeet(ken, 'notice', 2 * 86400e3, { submitMatches: true });
    // ---- Fu: A's FUTURE meet with a scored doubles match (A,B vs C,D) — History vs the pair record
    Fu = await mkMeet(A, 'future', 3 * 86400e3);
    for (const x of [B, C, D]) await se('meets/join', { meetId: Fu }, x.token);
    const fm = await se('meets/matches/upsert', { meetId: Fu, team1Ids: [pidOf(Fu, A.userId), pidOf(Fu, B.userId)], team2Ids: [pidOf(Fu, C.userId), pidOf(Fu, D.userId)], scores: [[11, 5]], round: 1, courtIndex: 0 }, A.token);
    F.fm = fm.json && fm.json.id; R.fixtures.future = fm.status + ' ' + F.fm;
    }
    // ---- K: ken's club (its code for onboarding); Q: ken's competition (C enters, cancelled with a note later)
    const k = await se('channels/create', { name: PFX + ' club ' + RUN, description: PFX }, kh.token); F.K = k.json && k.json.id; F.clubs.push(F.K); if (!F.K) throw new Error('channels/create ' + k.status + ' ' + k.text.slice(0, 160));
    const ks = await se('clubs/settings/show', { channelId: F.K }, kh.token); F.Kcode = ks.json && (ks.json.refCode || ks.json.code); R.fixtures.club = { id: F.K, code: F.Kcode };
    const q = await se('competitions/create', { name: PFX + ' comp ' + RUN, startAt: new Date(Date.now() + 5 * 86400e3).toISOString(), format: 'roundRobin', participantType: 'singles', maxEntries: 4, sport: 'pickleball', visibility: 'public', publish: true }, ken.token);
    F.Q = q.json && q.json.id; if (F.Q) F.comps.push(F.Q); R.fixtures.comp = q.status + ' ' + F.Q;
    R.fixtures.compEnterE = F.Q ? (await se('competitions/enter', { competitionId: F.Q }, E.token)).status : null;

    browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });

    // ======================================================================== 1. Settings › Username (A)
    if (want('U-username')) {
      const { page, ctx } = await newPage(A.token);
      await visit(page, '/pages/social-settings/index');
      await clickText(page, 'Change', { wait: 1200 });
      const typed = await typeIn(page, { ph: 'New username' }, 'sam_smash', { wait: 1400 });
      const t1 = await text(page);
      await typeIn(page, { ph: 'New username' }, 'ken_host', { wait: 1800 }); const taken = /That username is taken\./.test(await text(page));
      await typeIn(page, { ph: 'New username' }, 'gb_zzz', { wait: 1200 }); const reserved = /That username is reserved\./.test(await text(page));
      const fresh = 'fs7' + RUN + 'new';
      await typeIn(page, { ph: 'New username' }, fresh, { wait: 1800 }); const free = /That username is free\./.test(await text(page));
      await shot(page, 'u1-username');
      let saved = null;
      if (free) { await clickText(page, 'Save', { wait: 2200 });   /* the FIRST Save = the username card (the password card's Save comes later) */ saved = ((await se('i', {}, A.token)).json || {}).username; }
      row('U-username', ['E-update-profile.02'], typed === 'sam_smash' && taken && reserved && free && saved === fresh, { typed, taken, reserved, free, saved, fresh, uppercaseShown: /SAM_SMASH/.test(t1) }, { mustFail: true, vsReclub: 'better' });
      await ctx.close();
    }
    // ======================================================================== 2. Change email (B) — the engine's own flow
    if (want('U-email')) {
      const { page, ctx } = await newPage(B.token);
      const t0 = await visit(page, '/pages/social-settings/index');
      const hasRow = /Sign-in email/.test(t0);
      const ev = { hasRow };
      if (hasRow) {
        await clickText(page, 'Change email', { wait: 1500 });
        const newEmail = `fs7-${RUN}-bnew@example.invalid`;
        await typeIn(page, { name: 'email' }, newEmail); await typeIn(page, { name: 'password' }, B.password);
        page.__api = [];
        await clickText(page, 'Send code', { wait: 2500 });
        const t1 = await text(page); const code = (t1.match(/Test code: (\S+)/) || [])[1] || '';
        ev.sent = page.__api.filter((a) => /update-email/.test(a.p)).map((a) => a.s);
        ev.devCodeShown = !!code;
        ev.oldBeforeConfirm = (await se('signin-flow', { username: B.email, password: B.password })).status;
        ev.newBeforeConfirm = (await se('signin-flow', { username: newEmail, password: B.password })).status;
        await shot(page, 'u2-email-code');
        if (code) { await typeIn(page, { name: 'code' }, code); await clickText(page, 'Confirm', { last: true, wait: 2500 }); }
        ev.toast = /Sign-in email changed/.test(await text(page));
        ev.oldAfter = (await se('signin-flow', { username: B.email, password: B.password })).status;
        const nw = await se('signin-flow', { username: newEmail, password: B.password }); ev.newAfter = nw.status;
        if (nw.json && nw.json.i) B.token = nw.json.i;   // the account's token for cleanup
        ev.stored = sql(`select email||'|'||"emailVerified" from user_profile where "userId"='${B.userId}'`);
        B.email = newEmail;
      }
      row('U-email', ['E-settings-hub.01', 'E-update-account.03'], ev.hasRow && ev.devCodeShown && ev.oldBeforeConfirm === 200 && ev.newBeforeConfirm !== 200 && ev.newAfter === 200 && ev.oldAfter !== 200, ev, { mustFail: true, vsReclub: 'better' });
      await ctx.close();
    }
    // ======================================================================== 3. DUPR Manager (ken): counts, chooser, sheet close, cage
    if (want('U-dupr')) {
      const { page, ctx } = await newPage(ken.token);
      await visit(page, '/pages/meet/index?id=' + M);
      await clickText(page, 'Participants', { wait: 1500 }).catch(() => undefined);
      await clickText(page, 'Manager', { exact: false, wait: 1800 });
      await clickText(page, 'Matches', { sel: '[class*=sheet] *', wait: 2500 });
      const t = await text(page);
      const submitLabel = (t.match(/Submit all(?: \(\d+\))?/) || [''])[0];
      const box = await rectOf(page, 'Pending');
      const rawCodes = /no_account|not_connected/.test(t);
      await shot(page, 'u3-dmgr-matches');
      row('U-dmgr-counts', ['D-dupr-activity-manager.02'], submitLabel === 'Submit all (1)' && !rawCodes && box && box.left >= 12 && box.right <= 378, { submitLabel, rawCodes, pendingLabelRect: box }, { mustFail: true, vsReclub: 'equal' });
      // Submit all → (after) Submission basis → Scoring type → consent → Confirm; (before) no chooser: Cancel, nothing sent
      page.__api = [];
      await clickText(page, submitLabel || 'Submit all', { wait: 1500 });
      let t2 = await text(page);
      const chooser = /Submission basis/.test(t2);
      const ev = { chooser };
      if (chooser) {
        await clickText(page, 'Sets — one DUPR result per set', { wait: 1500 });
        t2 = await text(page); ev.scoring = /Scoring type/.test(t2);
        await clickText(page, 'Rally — a point on every rally', { wait: 1500 });
        t2 = await text(page); ev.consentWords = /Submitted per set · Rally scoring/.test(t2);
        await shot(page, 'u3-consent');
        await clickText(page, 'Confirm', { last: true, wait: 3500 });
        const call = page.__api.find((a) => /submit-dupr-all/.test(a.p));
        ev.request = call ? { status: call.s, basis: /"basis":"sets"/.test(call.body), scoring: /"scoringType":"rally"/.test(call.body) } : null;
        ev.row = sql(`select "duprStatus"||'|'||coalesce("duprRef",'')||'|'||coalesce("duprBasis",'')||'|'||coalesce("duprScoring",'')||'|'||coalesce("duprSubmittedById",'') from meet_match where id='${F.m1}'`);
      } else {
        await clickText(page, 'Cancel', { last: true, wait: 1200 }).catch(() => undefined);
        ev.sentWithoutChooser = page.__api.some((a) => /submit-dupr/.test(a.p));
      }
      const parts = String(ev.row || '').split('|');
      row('U-dupr-basis', ['D-dupr-confirm-submit.01', 'D-dupr-confirm-submit.02'], chooser && ev.scoring && ev.consentWords && ev.request && ev.request.status === 200 && ev.request.basis && ev.request.scoring && parts[0] === 'submitted' && /^sandbox:/.test(parts[1]) && parts[2] === 'sets' && parts[3] === 'rally' && parts[4] === ken.userId, ev, { mustFail: true, vsReclub: 'equal' });
      // the row opens the recap and the sheet goes away
      if (chooser) {
        await sleep(1500);
        await clickText(page, 'Round 1', { exact: false, sel: '[class*=sheet] *', wait: 3000 }).catch((e) => R.errors.push('dmgr row: ' + e.message));
        const t3 = await text(page);
        const sheetOpen = await page.evaluate(() => Array.from(document.querySelectorAll('body *')).some((el) => (el.innerText || '').trim() === 'DUPR Manager' && el.getBoundingClientRect().height > 0));
        await shot(page, 'u3-recap-after-row');
        row('U-dmgr-close', ['D-dupr-activity-manager.03'], /pages\/match\/index/.test(page.url()) && !sheetOpen && /Submitted by/.test(t3) && /Test environment — not sent to DUPR/.test(t3), { url: page.url(), sheetOpen, submittedBy: (t3.match(/Submitted by[^\n]*/) || [''])[0], cageLine: /Test environment — not sent to DUPR/.test(t3) }, { mustFail: true, vsReclub: 'equal' });
      } else row('U-dmgr-close', ['D-dupr-activity-manager.03'], false, { reason: 'no chooser → nothing submitted in this phase; the sheet-close check needs the submitted row' }, { mustFail: true, vsReclub: 'equal' });
      await ctx.close();
    }
    // ======================================================================== 4. DUPR join notice (C, unconnected) — plain back-out
    if (want('U-notice')) {
      const { page, ctx } = await newPage(C.token);
      await visit(page, '/pages/meet/index?id=' + N);
      await clickText(page, 'Join', { wait: 2000 }).catch((e) => R.errors.push('notice join: ' + e.message));
      const t = await text(page);
      await shot(page, 'u4-notice');
      const opts = { joinLater: /Join now — connect DUPR later/.test(t), connectFirst: /Connect DUPR first/.test(t), cancel: /\bCancel\b/.test(t), gotItJoins: /Got it/.test(t) };
      const titleClip = await page.evaluate(() => { const el = Array.from(document.querySelectorAll('body *')).find((e) => (e.innerText || '').trim().startsWith('This activity will be submitted') && e.children.length === 0); if (!el) return null; return { clipped: el.scrollWidth > el.clientWidth + 1, text: el.innerText.trim() }; });
      if (opts.cancel) await clickText(page, 'Cancel', { last: true, wait: 1500 }).catch(() => undefined);
      const joined = sql(`select count(*) from meet_participant where "meetId"='${N}' and "userId"='${C.userId}'`);
      row('U-notice', ['D-dupr-submit-notice.01'], opts.joinLater && opts.connectFirst && opts.cancel && joined === '0' && /pages\/meet\/index/.test(page.url()), { opts, joined, url: page.url(), titleClip }, { mustFail: true, vsReclub: 'better' });
      await ctx.close();
    }
    // wait until M has started (History / activities read started meets only)
    if (M) while (Date.now() < Date.parse(sql(`select to_char("startAt" at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') from meet where id='${M}'`)) + 5e3) await sleep(2000);
    // ======================================================================== 5. Activity sheet (B views A) + empty next step (C)
    if (want('U-activity')) {
      const { page, ctx } = await newPage(B.token);
      await visit(page, '/pages/player/index?id=' + A.userId);
      await clickText(page, 'Activities', { wait: 2500 });
      await clickText(page, PFX + ' dupr ' + RUN, { wait: 2500 });
      const t = await text(page);
      const open = await rectOf(page, 'Open meet');
      await shot(page, 'u5-activity-sheet');
      const statLine = (t.match(/\d+ match(?:es)? · \d+W \d+L · \d+%/) || [''])[0];
      const dateLine = (t.match(/[^\n]*(Mon|Tue|Wed|Thu|Fri|Sat|Sun)[^\n]*player[^\n]*/) || [''])[0];
      const { page: p2, ctx: c2 } = await newPage(B.token);
      await visit(p2, '/pages/player/index?id=' + C.userId);
      await clickText(p2, 'Activities', { wait: 2500 });
      const t2 = await text(p2);
      await shot(p2, 'u5-activity-empty');
      row('U-activity', ['D-player-activity.01', 'E-player-sport.06'], !!statLine && !!dateLine && open && open.left >= 12 && /Find a meet to play together/.test(t2), { statLine, dateLine, openMeetRect: open, emptyNext: /Find a meet to play together/.test(t2) }, { mustFail: true, vsReclub: 'equal' });
      await ctx.close(); await c2.close();
    }
    // ======================================================================== 6. History chips (A) + the one "played" rule (A,B vs C,D on a FUTURE meet)
    if (want('U-history')) {
      const { page, ctx } = await newPage(A.token);
      await visit(page, '/pages/history/index?pane=matches');
      const r1 = await rectOf(page, 'Your matches'), r2 = await rectOf(page, 'Community matches');
      await shot(page, 'u6-history');
      row('U-history-chips', ['D-statistics.06'], r1 && r2 && r1.top === r2.top && r1.left >= 12 && r2.right <= 378, { your: r1, community: r2 }, { mustFail: true, vsReclub: 'equal' });
      await ctx.close();
    }
    if (want('R-played')) {
      const hist = (await se('stats/matches', { userId: A.userId, limit: 50 }, A.token)).json || [];
      const inHistory = Array.isArray(hist) && hist.some((h) => h.matchId === F.fm);
      const pair = (await se('stats/pair-summary', { a: A.userId, b: B.userId }, A.token)).json || {};
      const pairCountsFuture = sql(`select count(*) from gb_rating_log where "matchId"='${F.fm}'`);
      row('R-played-one-rule', ['D-stats-team-summary.02'], Array.isArray(hist) && !inHistory && pairCountsFuture === '0', { inHistory, historyRows: Array.isArray(hist) ? hist.length : hist, pairMatches: pair.matches, ratingLogRowsForFutureMatch: pairCountsFuture, rule: 'a meet match counts once its meet has started — History and the pair record agree' }, { mustFail: true, level: 'L5', vsReclub: 'equal' });
    }
    // ======================================================================== 7. Onboarding (E): field boxes + club code on the first screen
    if (want('U-onboard')) {
      const { page, ctx } = await newPage(E.token);
      await visit(page, '/pages/onboard/index', 'en', 3500);
      // the field's OWN box: the NutUI root around the input (not the card it sits in) must draw a border
      const boxes = await page.evaluate(() => Array.from(document.querySelectorAll('input')).filter((i) => i.getBoundingClientRect().height > 0).map((i) => { const root = i.closest('.nut-input') || i; const s = getComputedStyle(root); const has = parseFloat(s.borderTopWidth) >= 1 && s.borderTopStyle !== 'none' && s.borderTopColor !== 'rgba(0, 0, 0, 0)'; return { name: i.name, ph: i.placeholder, cls: String(root.className).slice(0, 60), box: has ? s.borderTopWidth + ' ' + s.borderTopColor : null }; }));
      const t = await text(page);
      const codeField = /I have a club code/i.test(t);   // .ob-l draws in capitals (innerText follows text-transform)
      let joined = null, msg = '';
      if (codeField && F.Kcode) {
        await typeIn(page, { name: 'obcode' }, String(F.Kcode), { wait: 600 });
        await clickText(page, 'Join club', { wait: 2500 });
        msg = ((await text(page)).match(/You joined[^\n]*|Request sent[^\n]*|No club has[^\n]*/) || [''])[0];
        joined = sql(`select count(*) from club_member where "channelId"='${F.K}' and "userId"='${E.userId}'`);
      }
      await shot(page, 'u7-onboard');
      const named = boxes.filter((b) => b.name === 'obname' || b.name === 'obusername');
      row('U-onboard', ['E-onb-basic.01', 'E-onb-welcome.02'], named.length === 2 && named.every((b) => !!b.box) && codeField && joined === '1', { boxes: named, codeField, clubCode: F.Kcode, msg, joined }, { mustFail: true, vsReclub: 'better' });
      await ctx.close();
    }
    // ======================================================================== 8. zh_Hant notifications (E): a club's new meet + a cancel with a note
    if (want('U-notif')) {
      if (F.K) await mkMeet(kh, 'club meet', 4 * 86400e3, { channelId: F.K, sendNotifications: true, visibility: 'private' });
      if (F.Q) R.fixtures.compCancel = (await se('competitions/cancel', { competitionId: F.Q, message: PFX + ' note ' + RUN }, ken.token)).status;
      await sleep(2500);
      const { page, ctx } = await newPage(E.token);
      const t = await visit(page, '/pages/notifications/index', 'zh_Hant', 3500);
      await shot(page, 'u8-notif-zh');
      const ev = { newMeetZh: /新約戰 · /.test(t), cancelZh: /已被主辦人取消。/.test(t), englishLeft: (t.match(/New meet ·|has been cancelled by the host/g) || []), notesInDb: sql(`select count(*) from notification where "notifieeId"='${E.userId}'`) };
      row('U-notif-zh', ['E-notifications.01'], ev.newMeetZh && ev.cancelZh && !ev.englishLeft.length, ev, { mustFail: true, vsReclub: 'equal' });
      await ctx.close();
    }
    // ======================================================================== 9. Help centre (EN + 繁), one feedback path, version line
    if (want('U-help')) {
      const { page, ctx } = await newPage(A.token);
      const t = await visit(page, '/pages/help/index');
      const cats = ['Getting started', 'Playing', 'Hosting meets', 'Clubs', 'Competitions', 'Coaching & lessons', 'DUPR', 'Payments', 'Safety & reports', 'Account & settings', 'Troubleshooting'].filter((c) => t.includes(c)).length;
      let found = 0, para = '';
      if (/Help centre/.test(t)) {
        await typeIn(page, { ph: 'Search help — e.g. waitlist, DUPR, refund' }, 'waitlist', { wait: 1200 });
        const t1 = await text(page); found = (t1.match(/waitlist/gi) || []).length;
        await clickText(page, 'waitlist', { exact: false, sel: '.hk-row *, [class*=row] *', wait: 1800 }).catch((e) => R.errors.push('help open: ' + e.message));
        para = ((await text(page)).match(/[^\n]{80,}/) || [''])[0];
      }
      await shot(page, 'u9-help-en');
      const version = (t.match(/GripBat · Version[^\n]*/) || [''])[0];
      const { page: pz, ctx: cz } = await newPage(A.token);
      const tz = await visit(pz, '/pages/help/index', 'zh_Hant');
      let zhFound = 0, zhPara = '';
      if (/幫助中心|Help centre/.test(tz)) {
        await typeIn(pz, { ph: '搜尋幫助 — 例如：候補、DUPR、退款' }, '候補', { wait: 1200 }).catch((e) => R.errors.push('zh search: ' + e.message));
        const tz1 = await text(pz); zhFound = (tz1.match(/候補/g) || []).length;
        await clickText(pz, '候補', { exact: false, sel: '.hk-row *, [class*=row] *', wait: 1800 }).catch(() => undefined);
        zhPara = ((await text(pz)).match(/[^\n]*[㐀-鿿][^\n]{40,}/) || [''])[0];
      }
      const zhVersion = (tz.match(/GripBat · 版本[^\n]*/) || [''])[0];
      await shot(pz, 'u9-help-zh');
      row('U-help-centre', ['E-help.03', 'E-faq.01'], cats === 11 && found >= 2 && para.length >= 80 && zhFound >= 2 && /[㐀-鿿]/.test(zhPara) && !/[A-Za-z]{4,} [A-Za-z]{4,} [A-Za-z]{4,}/.test(zhPara.replace(/GripBat|DUPR|HKPL/g, '')), { cats, found, para: para.slice(0, 100), zhFound, zhPara: zhPara.slice(0, 80) }, { mustFail: true, vsReclub: 'better' });
      row('U-version', ['E-auth-welcome.06', 'E-settings-hub.12'], /^GripBat · Version 1\.0 \(build \d+\)$/.test(version.trim()) && /^GripBat · 版本 1\.0（建置 \d+）$/.test(zhVersion.trim()), { version, zhVersion }, { mustFail: true, vsReclub: 'equal' });
      // one feedback path: DUPR help's rows
      const td = await visit(page, '/pages/dupr-connect/index');
      const faqs = /DUPR FAQs/.test(td);
      if (faqs) { await clickText(page, 'DUPR FAQs', { wait: 2500 }); }
      const faqUrl = page.url();
      await visit(page, '/pages/dupr-connect/index');
      await clickText(page, 'Send feedback', { wait: 2000 }).catch(() => undefined);
      const panelDupr = await page.evaluate(() => { const p = document.querySelector('.fb-panel'); return !!(p && p.getBoundingClientRect().height > 0); });
      const duprUrl = page.url();
      await visit(page, '/pages/help/index');
      await clickText(page, 'Send feedback', { wait: 2000 }).catch(() => undefined);
      const panelHelp = await page.evaluate(() => { const p = document.querySelector('.fb-panel'); return !!(p && p.getBoundingClientRect().height > 0); });
      await shot(page, 'u9-feedback');
      row('U-feedback-one', ['E-help.06', 'D-dupr-support.04'], faqs && /cat=dupr/.test(faqUrl) && panelDupr && panelHelp && /dupr-connect/.test(duprUrl), { faqs, faqUrl, panelDupr, duprUrl, panelHelp }, { mustFail: true, vsReclub: 'equal' });
      await ctx.close(); await cz.close();
    }
    // ======================================================================== 10. zh_Hant Help while the dictionary read fails twice (DICT-RETRY)
    if (want('U-zh-dict')) {
      const { page, ctx } = await newPage(A.token, { dictFail: 2 });
      await visit(page, '/pages/help/index', 'zh_Hant', 14000);
      const t = await text(page);
      const planted = page.__api.filter((a) => /PLANTED/.test(a.p)).length;
      await shot(page, 'u10-zh-dict-retry');
      row('U-zh-dict-retry', ['A-manage-meet-tutorial.01', 'E-help.06 (zh)'], planted >= 1 && /私隱政策/.test(t) && /發送反饋/.test(t) && !/Privacy Policy|Send feedback/.test(t), { planted503: planted, privacyZh: /私隱政策/.test(t), sendZh: /發送反饋/.test(t), english: (t.match(/Privacy Policy|Send feedback/g) || []) }, { mustFail: true, vsReclub: 'equal' });
      await ctx.close();
      const { page: p2, ctx: c2 } = await newPage(A.token);
      const t2 = await visit(p2, '/pages/help/index', 'zh_Hant', 4000);
      row('U-zh-help-plain', ['A-manage-meet-tutorial.01'], /私隱政策/.test(t2) && /發送反饋/.test(t2), { privacyZh: /私隱政策/.test(t2), sendZh: /發送反饋/.test(t2), dictReads: p2.__api.filter((a) => /i18n/.test(a.p)).map((a) => a.s) }, { vsReclub: 'equal' });
      await c2.close();
    }
    // ======================================================================== 11. DUPR Resync + Disconnect (A, sandbox link; A's rating planted 3.5)
    if (want('U-dupr-self')) {
      const coltype = sql(`select data_type from information_schema.columns where table_name='meet_player_level' and column_name='duprDoubles'`);
      psql(`update meet_player_level set "duprDoubles" = 3.5 where "userId"='${A.userId}' and sport='pickleball' and source='dupr-sandbox'`);
      const before = sql(`select coalesce("duprId",'-')||'|'||coalesce("duprDoubles"::text,'-')||'|'||coalesce(source,'-') from meet_player_level where "userId"='${A.userId}' and sport='pickleball'`);
      const { page, ctx } = await newPage(A.token);
      const t = await visit(page, '/pages/dupr-connect/index');
      page.__api = [];
      await clickText(page, 'Resync ratings', { wait: 2500 }).catch((e) => R.errors.push('resync1: ' + e.message));
      const r1 = page.__api.filter((a) => /gb\/dupr\/resync/.test(a.p)).map((a) => a.s);
      await clickText(page, 'Resync ratings', { wait: 2000 }).catch((e) => R.errors.push('resync2: ' + e.message));
      const t2 = await text(page);
      const r2 = page.__api.filter((a) => /gb\/dupr\/resync/.test(a.p)).map((a) => a.s);
      const cooldown = /You can resync once an hour/.test(t2);
      await clickText(page, 'Disconnect DUPR', { wait: 1500 });
      await clickText(page, 'Disconnect', { last: true, wait: 2500 });
      for (let k = 0; k < 20 && /Disconnecting…/.test(await text(page)); k++) await sleep(1000);   // the door may be slow: read the result, not the spinner
      const conn = (await se('gb/dupr/connection', {}, A.token)).json || {};
      const after = sql(`select coalesce("duprId",'-')||'|'||coalesce("duprDoubles"::text,'-')||'|'||coalesce(source,'-') from meet_player_level where "userId"='${A.userId}' and sport='pickleball'`);
      const shown = (await text(page));
      await shot(page, 'u11-dupr-disconnected');
      row('U-dupr-self', ['D-dupr-support.02', 'D-dupr-support.03'], /Connected/.test(t) && r1[0] === 200 && r2.includes(400) && cooldown && conn.connected === false && after.startsWith('-|-|'), { coltype, before, resync: r1, resyncAgain: r2, cooldown, connection: conn, after, notConnected: /Not connected/.test(shown) }, { mustFail: true, vsReclub: 'equal' });
      await ctx.close();
    }
    // ======================================================================== 12. Recap of a DUPR-sent match after its meet is cancelled (B, player)
    if (want('R-recap')) {
      const sent = sql(`select "duprStatus" from meet_match where id='${F.m1}'`);
      R.fixtures.cancelM = (await se('meets/cancel', { meetId: M }, ken.token)).status;
      const api = (await se('stats/match-summary', { source: 'meet', matchId: F.m1 }, B.token)).json;
      const { page, ctx } = await newPage(B.token);
      const t = await visit(page, '/pages/match/index?source=meet&id=' + F.m1);
      await shot(page, 'u12-recap-cancelled');
      row('R-recap-cancelled', ['D-match-summary.02'], sent === 'submitted' && !!api && api.dupr && api.dupr.status === 'submitted' && /Submitted by/.test(t) && /was cancelled after this match was sent to DUPR/.test(t), { duprStatus: sent, api: api ? { cancelled: api.context && api.context.cancelled, dupr: api.dupr && api.dupr.status, by: api.dupr && api.dupr.submittedBy && api.dupr.submittedBy.username } : null, screen: (t.match(/Submitted by[^\n]*|This match is not available\.|[^\n]*was cancelled after[^\n]*/g) || []) }, { mustFail: true, vsReclub: 'better' });
      await ctx.close();
    }
    // ======================================================================== 13. Delete account (D): the 7-day receipt stays until OK
    if (want('U-delete')) {
      const { page, ctx } = await newPage(D.token);
      await visit(page, '/pages/social-settings/index');
      await clickText(page, 'Delete account', { wait: 1200 });
      await typeIn(page, { ph: 'Enter your password to confirm' }, D.password);
      await typeIn(page, { ph: 'DELETE' }, 'DELETE');
      await clickText(page, 'Yes, delete', { wait: 1500 });
      const at1 = /7 days/.test(await text(page));
      await sleep(1500);
      const at3 = /7 days/.test(await text(page));
      await shot(page, 'u13-delete-receipt');
      let home = false;
      if (at3) { await clickText(page, 'OK', { last: true, wait: 3000 }).catch(() => undefined); home = /pages\/home\/index/.test(page.url()); }
      const grace = sql(`select count(*) from gb_account_deletion where "userId"='${D.userId}'`);
      row('U-delete-receipt', ['E-delete-account.03'], at1 && at3 && home && grace === '1', { receiptAt1_5s: at1, receiptAt3s: at3, homeAfterOk: home, graceRow: grace }, { mustFail: true, vsReclub: 'better' });
      D.deleted = grace === '1';
      await ctx.close();
    }
    // ======================================================================== 14. Maintenance: the REAL staff switch (admin), on < 60 s
    if (want('U-maint')) {
      const on = await se('gb/maintenance', { on: true, until: new Date(Date.now() + 2 * 3600e3).toISOString(), message: null }, admin.token);
      const ev = { on: on.status, notStaff: (await se('gb/maintenance', { on: true }, amy.token)).status };
      try {
        const { page, ctx } = await newPage(null);
        const t = await visit(page, '/pages/home/index', 'en', 3000);
        ev.gate = /maintenance/i.test(t); ev.backIn = (t.match(/Back in[^\n]*/) || [''])[0];
        await shot(page, 'u14-maintenance-on');
        const tz = await visit(page, '/pages/home/index', 'zh_Hant', 3000); ev.gateZh = /維護/.test(tz);
        ev.off = (await se('gb/maintenance', { on: false }, admin.token)).status;
        await clickText(page, '再試一次', { wait: 3000 }).catch(() => clickText(page, 'Try again', { wait: 3000 }).catch((e) => R.errors.push('maint retry: ' + e.message)));
        ev.gateGone = !/maintenance|維護/i.test(await text(page));
        await ctx.close();
      } finally { ev.offFinal = (await se('gb/maintenance', { on: false }, admin.token)).status; ev.readBack = ((await se('gb/status', {})).json || {}).maintenance; }
      row('U-maintenance', ['E-maintenance.01'], ev.on === 200 && ev.notStaff === 403 && ev.gate && ev.gateZh && ev.gateGone && ev.readBack && ev.readBack.on === false, ev, { vsReclub: 'equal' });
    }
  } catch (e) {
    R.errors.push('FATAL ' + (e && e.stack || e));
  } finally {
    // ---- cleanup: every fixture of this run, then read back
    const C = R.cleanup;
    try { C.maintenance = ((await se('gb/status', {})).json || {}).maintenance; if (C.maintenance && C.maintenance.on) C.maintenanceOff = (await se('gb/maintenance', { on: false }, admin.token)).status; } catch (e) { C.maintErr = e.message; }
    for (const m of F.meets) {
      try {
        for (const mm of sql(`select id from meet_match where "meetId"='${m.id}' and coalesce("duprStatus",'') <> 'submitted'`).split('\n').filter(Boolean)) await se('meets/matches/delete', { meetId: m.id, matchId: mm }, m.host.token);
        const d = await se('meets/delete', { meetId: m.id }, m.host.token);
        C['meet ' + m.id] = d.status === 200 ? 'deleted' : 'cancel ' + (await se('meets/cancel', { meetId: m.id }, m.host.token)).status;
      } catch (e) { C['meet ' + m.id] = 'ERR ' + e.message; }
    }
    for (const q of F.comps) { try { C['comp ' + q] = (await se('competitions/cancel', { competitionId: q }, ken.token)).status + '/' + (await se('competitions/delete', { competitionId: q }, ken.token)).status; } catch (e) { C['comp ' + q] = 'ERR ' + e.message; } }
    for (const k of F.clubs) { if (!k) continue; try { if (acct.E) await se('clubs/leave', { channelId: k }, acct.E.token); C['club ' + k] = (await se('channels/update', { channelId: k, isArchived: true, name: '[probe] archived' }, kh.token)).status; } catch (e) { C['club ' + k] = 'ERR ' + e.message; } }
    for (const a of Object.values(acct)) {
      if (a.deleted) { C['acct ' + a.tag] = 'in deletion grace (deleted by U-delete)'; continue; }
      try { const d = await se('adapter/account/delete', { password: a.password }, a.token); C['acct ' + a.tag] = d.status + ' ' + (d.text || '').slice(0, 40); } catch (e) { C['acct ' + a.tag] = 'ERR ' + e.message; }
    }
    try { C.remainingMeets = sql(`select count(*) from meet where name like '${PFX}%${RUN}%' and status <> 'cancelled'`); C.remainingClubs = sql(`select count(*) from channel where name like '${PFX}%${RUN}%' and "isArchived" = false`); } catch (e) { C.countErr = e.message; }
    try { const a = (await se('meets/level', { sport: 'pickleball' }, amy.token)).json || {}; C.amyTermsUnchanged = a.termsVersion === terms; } catch (e) { /* */ }
    if (browser) await browser.close().catch(() => undefined);
    const out = path.join(__dirname, 'fix-S7.' + PHASE + (MODE === 'preview' ? '.preview' : '') + (ONLY.length ? '.only-' + ONLY.join('+') : '') + '.json');
    fs.writeFileSync(out, JSON.stringify(R, null, 1));
    console.log('wrote ' + out + ' · rows ' + Object.keys(R.rows).length + ' · pass ' + Object.values(R.rows).filter((r) => r.pass).length + ' · errors ' + R.errors.length);
  }
})();

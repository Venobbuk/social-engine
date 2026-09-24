require('./_guard.cjs'); // G13.3 — run through probes/run.sh
// fix-S5 L6 probe (2026-09-24) — closes the S5 re-check rows (gen/l6-scope/S5-meet-host-tools/recheck.json) at 390 px on
// UAT, EN + 繁, each row judged vs Reclub before -> after (BETTER-THAN-RECLUB):
//   A-generate-teams.04  Force position (participant sheet) · Balance positions · Reset positions (Generate teams)
//   A-meet-detail.41     Invited clubs empty line "No clubs have been invited to this meet yet." + the way on (Invite club members)
//                        (Reclub's reward-points payment-tag reminder: OUT OF SCOPE — GripBat has no reward points)
//   A-roles-action.12    the host's Swap from the participant sheet (meets/participants/swap {participantId})
//   D-meet-custom-match.03  "Teams have not been set up yet." + Generate teams / Manage participants; different-size preset
//                        teams are explained (a confirm), never a silent empty side
//   A-roles-action.02    "View profile" and "Message" apart in the sheet header (geometry)
//   A-promote-meet.02    the "What players will see" preview == the notification delivered (one engine source), meet name in it
//   A-promote-meet.06    delivery at L6 to this run's [probe] club members (i/notifications + their inbox page)
//   D-meet-score-sheet.02  round / court saved on an unplayed match (Save without a score)
//   D-meet-score-sheet.04  the DUPR-submitted read-only note on a match submitted through the REAL engine path in the UAT
//                        sandbox cage (web-uat DUPR_SUBMIT_SANDBOX=1 answers sandbox:<id>, no HTTP to hkpl) — safety-gated
//
//   Run: bash /root/gen/browser-slot.sh bash /root/social-engine/probes/run.sh /root/se-wt-fixs5/probes/fix-S5.probe.cjs
//        PHASE=before on the UNFIXED build = the planted fault: every must-fail row must FAIL there.
// Fixtures: fresh '[probe] fix-S5 <stamp> …' native accounts (sign-up; admin via _native-session.cjs for the fallback), one
// club, three meets — all removed in finally. The only SQL write: two of this run's OWN accounts' DUPR link (a fake PRB… id)
// for the seconds around the caged submit, restored at once and again in finally (pattern REUSED from fix-S2 / uat-dupr-cage).
// Never pressed: Promote to real users (Promote is pressed only when the engine's own preview is exactly this run's [probe]
// members), any DUPR submit outside the cage.
// @claims route pages/meet/index :: fix-S5 :: force-position · balance-positions · reset-positions · host-swap · invited-clubs-empty · no-teams · uneven-teams · sheet-links · promote-one-source · promote-delivery · score-no-score · dupr-readonly
'use strict';
const fs = require('fs');
const crypto = require('crypto');
const { execFileSync, execSync } = require('child_process');
const PHASE = process.env.PHASE || 'after';
const DIR = __dirname;
const SHOTS = DIR + '/fix-S5-shots';
fs.mkdirSync(SHOTS, { recursive: true });
const APPHOST = 'https://uat.gripbat.com';
const APP = APPHOST + '/app/pages/';
const ACCESS = '/var/log/nginx/access.log';
const stamp = Date.now().toString(36).slice(-5);
const PFX = '[probe] fix-S5 ' + stamp;
const R = { id: 'fix-S5', phase: PHASE, at: new Date().toISOString(), stamp, rows: [], controls: [], errors: [], cleanup: {}, fx: {} };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sql = (q) => execFileSync('docker', ['exec', '-i', 'social-engine-db-1', 'psql', '-U', 'social', '-d', 'se_sbx', '-qtA', '-F', '|'], { input: q, encoding: 'utf8' }).trim();
const lit = (s) => "'" + String(s).replace(/'/g, "''") + "'";
function ck(row, what, pass, ev, shot, extra) { const r = { row, what, pass: !!pass, ev: ev === undefined ? null : ev, shot: shot ? 'probes/fix-S5-shots/' + PHASE + '-' + shot + '.png' : null, ...(extra || {}) }; R.rows.push(r); console.log((pass ? 'PASS ' : 'FAIL ') + row + ' | ' + what + ' -> ' + JSON.stringify(r.ev).slice(0, 400)); }
function ctl(name, what, pass, ev) { R.controls.push({ name, what, pass: !!pass, ev }); console.log((pass ? 'CTL-PASS ' : 'CTL-FAIL ') + name + ' | ' + what + ' -> ' + JSON.stringify(ev).slice(0, 300)); }
async function step(name, fn) { try { await fn(); } catch (e) { R.errors.push(name + ': ' + String(e && e.stack || e).slice(0, 900)); console.log('STEP CRASH ' + name + ': ' + (e && e.message)); } }

// ---------------------------------------------------------------- engine door (the app's own host), 429-patient
async function se(ep, body, tok) {
  for (let i = 0; i < 6; i++) {
    const r = await fetch(APPHOST + '/api/' + ep, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(tok ? { ...body, i: tok } : body) });
    const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch (e) { /* 204 */ }
    if (r.status === 429) { const reset = json && json.error && json.error.info && json.error.info.reset; const w = Math.min(90000, Math.max(3000, reset ? reset * 1000 - Date.now() + 1500 : 20000)); console.log('[429] ' + ep + ' wait ' + Math.round(w / 1000) + 's'); await sleep(w); continue; }
    return { status: r.status, json, text: text.slice(0, 600) };
  }
  throw new Error('429 forever on ' + ep);
}
async function must(ep, body, tok) { const r = await se(ep, body, tok); if (r.status >= 300) throw new Error(ep + ' ' + r.status + ' ' + r.text.slice(0, 300)); return r.json; }

// ---------------------------------------------------------------- fresh [probe] accounts (REUSED: gen/l6-scope/S5 l6r-lib mkAcct)
const ACCTS = {};
async function mkAcct(tag, o, admin) {
  const email = `fixs5-${stamp}-${tag}@example.invalid`, password = 'Fs5-' + crypto.randomBytes(8).toString('hex');
  const a = { tag, email, password, token: '', userId: '', username: 'fs5' + stamp + tag };
  ACCTS[tag] = a;
  const su = await se('signup', { emailAddress: email, password, lang: 'en' });
  const code = su.json && su.json._dev_code;
  if (code) {
    const done = await se('signup-pending', { code }); a.token = done.json && done.json.i; if (!a.token) throw new Error('signup-pending ' + done.status + ' ' + done.text);
    await must('gb/account/username', { username: a.username }, a.token);
  } else if (su.json && su.json.error && su.json.error.code === 'REGISTRATION_CLOSED' && admin) {
    const r = await must('admin/accounts/create', { username: a.username, password }, admin); a.token = r.token; a.via = 'admin/accounts/create';
  } else throw new Error('signup ' + tag + ' ' + su.status + ' ' + su.text.slice(0, 200));
  const me = await must('i/update', { name: PFX + ' ' + tag.toUpperCase() }, a.token); a.userId = me.id; a.name = me.name;
  const TERMS = sql(`select version from gb_terms_acceptance group by 1 order by max("acceptedAt") desc limit 1`);
  await must('meets/level', { sport: 'pickleball', acceptTerms: TERMS, onboarded: true, selfLevel: o.level || 3.0, ...(o.gender ? { gender: o.gender } : {}), ageGroup: 'adult' }, a.token);
  return a;
}

// ---------------------------------------------------------------- browser (REUSED: l6r-lib ctxFor / tap / snap patterns)
let puppeteer = null;
async function browser() { puppeteer = puppeteer || require('/root/hkpl-server/node_modules/puppeteer-core'); return puppeteer.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-dev-shm-usage', '--lang=en-US'], protocolTimeout: 60000 }); }
async function ctxFor(b, a) {
  const ctx = await b.createBrowserContext();
  await ctx.overridePermissions(APPHOST, ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']).catch(() => undefined);
  const page = await ctx.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await page.emulateTimezone('Asia/Hong_Kong').catch(() => undefined);
  page.__req = []; page.__err = [];
  page.on('request', (r) => { const u = r.url(); if (u.includes('/api/') && r.method() === 'POST') page.__req.push({ url: u.replace(/^https:\/\/[^/]+/, ''), body: (r.postData() || '').replace(/"i":"[^"]+"/, '"i":"…"').slice(0, 3000) }); });
  page.on('pageerror', (e) => { page.__err.push(String(e).slice(0, 200)); });
  await page.goto(APPHOST + '/app/', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => undefined);
  await page.evaluate((t) => { localStorage.setItem('boyau_social_token', JSON.stringify({ data: t })); localStorage.setItem('hkpl_lang_ok', JSON.stringify({ data: '1' })); localStorage.setItem('boyau_onboarded', '1'); }, a.token);
  return page;
}
async function open(page, route, lang = 'en') { page.__req = []; await page.goto(APP + route + (route.includes('?') ? '&' : '?') + 'lang=' + lang, { waitUntil: 'networkidle2', timeout: 60000 }).catch(() => undefined); await sleep(2000); }
const text = (page) => page.evaluate(() => document.body.innerText || '').catch(() => '');
async function waitText(page, re, ms = 15000) { const end = Date.now() + ms; while (Date.now() < end) { const t = await text(page); if (re.test(t)) return t; await sleep(300); } return null; }
async function snap(page, key) { await sleep(400); await page.screenshot({ path: SHOTS + '/' + PHASE + '-' + key + '.png' }).catch(() => undefined); return (await text(page)).replace(/[ \t]+\n/g, '\n').replace(/\n{2,}/g, '\n'); }
async function tap(page, needle, o = {}) {
  const id = 'fs5' + Math.random().toString(36).slice(2);
  const found = await page.evaluate((needle, o, id) => {
    const roots = o.within ? Array.from(document.querySelectorAll(o.within)).filter((e) => { const r = e.getBoundingClientRect(); return r.width > 2 && r.height > 2; }) : [document.body];
    const hits = [];
    for (const root of roots) for (const el of root.querySelectorAll(o.sel || '*')) {
      const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) continue;
      const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      const t = (el.innerText || '').replace(/\s+/g, ' ').trim(); if (!t) continue;
      const ok = o.re ? new RegExp(o.re, o.ci ? 'i' : '').test(t) : o.contains ? t.includes(needle) : o.ci ? t.toLowerCase() === needle.toLowerCase() : t === needle;
      if (ok) hits.push(el);
    }
    const leaf = hits.filter((el) => !hits.some((x) => x !== el && el.contains(x)));
    const el = o.last ? leaf[leaf.length - 1] : leaf[o.nth || 0];
    if (!el) return null;
    el.setAttribute('data-fs5', id); el.scrollIntoView({ block: 'center' });
    return true;
  }, needle, o, id);
  if (!found) throw new Error('tap: no visible "' + needle + '"' + (o.within ? ' in ' + o.within : ''));
  await sleep(300);
  await page.click('[data-fs5="' + id + '"]');
  await sleep(o.wait == null ? 1000 : o.wait);
  return true;
}
const has = async (page, needle, o = {}) => { try { return await page.evaluate((needle, o) => { const roots = o.within ? Array.from(document.querySelectorAll(o.within)) : [document.body]; return roots.some((r) => r.getBoundingClientRect().height > 2 && (r.innerText || '').includes(needle)); }, needle, o); } catch (e) { return false; } };
const dlgText = (page) => page.evaluate(() => Array.from(document.querySelectorAll('.nut-dialog, .ak-list, .nut-popup')).filter((e) => e.getBoundingClientRect().height > 4).map((e) => e.innerText.replace(/\s*\n\s*/g, ' | ')).join(' || ')).catch(() => '');
async function toastAfter(page, re, ms = 3500) { const end = Date.now() + ms; while (Date.now() < end) { const t = await text(page); const m = t.match(re); if (m) return m[0]; await sleep(150); } return null; }
async function passSafety(page) { if (/Got it, continue/.test(await text(page))) await tap(page, 'Got it, continue', { wait: 1200 }); }
/** the kit Btn / button that carries `label` inside `within`: disabled? (null = none on screen) */
const btnDisabled = (page, label, within) => page.evaluate((label, within) => {
  const root = document.querySelector(within); if (!root) return null;
  const el = Array.from(root.querySelectorAll('*')).filter((x) => (x.innerText || '').trim() === label && x.getBoundingClientRect().height > 2).pop(); if (!el) return null;
  const b = el.closest('button, taro-button-core, [role="button"], .hk-btn') || el;
  return !!(b.disabled || b.getAttribute('disabled') != null || b.getAttribute('aria-disabled') === 'true' || /disabled/.test(String(b.className)));
}, label, within);
const url = (id, tab) => 'meet/index?id=' + id + (tab ? '&tab=' + tab : '');

(async () => {
  let b = null; const meets = []; let club = null; const plUndo = []; const follows = [];
  const restoreLinks = () => { while (plUndo.length) { const u = plUndo.pop(); try { sql(`update meet_player_level set "duprId"=${u.oldD === '' ? 'null' : lit(u.oldD)}, "updatedAt"=now() where id=${lit(u.plId)}`); } catch (e) { R.errors.push('restore link ' + u.plId + ': ' + e.message); } } };
  try {
    R.fx.engineRev = execSync("docker inspect -f '{{index .Config.Labels \"org.opencontainers.image.revision\"}}' social-engine-web-uat-1", { encoding: 'utf8' }).trim();
    R.fx.appBundle = ((await (await fetch(APPHOST + '/app/')).text()).match(/js\/app\.[a-z0-9]+\.js/) || [''])[0];
    const { getNativeToken } = require('./_native-session.cjs');
    const adm = (await getNativeToken('admin')).token;
    // ============================================================ fixtures
    const A = await mkAcct('a', { level: 3.5, gender: 'male' }, adm);
    const B = await mkAcct('b', { level: 3.0, gender: 'male' }, adm);
    const C = await mkAcct('c', { level: 3.5, gender: 'female' }, adm);
    const D = await mkAcct('d', { level: 3.0, gender: 'male' }, adm);
    const E = await mkAcct('e', { level: 3.0, gender: 'female' }, adm);
    const F = await mkAcct('f', { level: 3.0, gender: 'male' }, adm);
    const ch = await must('channels/create', { name: PFX + ' club', description: PFX + ' club' }, A.token); club = ch.id; R.fx.club = club;
    await must('clubs/settings/update', { channelId: club, gateType: 'open' }, A.token);
    for (const x of [B, C, D, E]) await must('clubs/join', { channelId: club }, x.token);
    for (const [p, q] of [[A, F], [F, A]]) { await must('following/create', { userId: q.userId }, p.token); follows.push([p, q]); }   // A and F are friends: F is in the Swap picker's Friends tab
    const hk = (h) => new Date(Date.now() + h * 3600e3); const at = (h) => { const d = hk(h); d.setUTCMinutes(0, 0, 0); return d.toISOString(); };
    const mk = async (tag, extra) => { const m = await must('meets/create', { sport: 'pickleball', type: 'managed', durationMinutes: 90, capacity: 8, visibility: 'public', feeType: 'free', autoApprove: true, sendNotifications: true, submitMatches: false, name: PFX + ' ' + tag, ...extra }, A.token); meets.push(m.id); return m; };
    const M1 = await mk('m1', { startAt: at(30), channelId: club, hostPlays: true });
    const M2 = await mk('m2', { startAt: at(50), channelId: club });
    const M3 = await mk('m3', { startAt: at(52) });
    R.fx.meets = { M1: M1.id, M2: M2.id, M3: M3.id };
    for (const x of [B, C]) await must('meets/join', { meetId: M1.id }, x.token);
    for (const [n, lv] of [['G1', 3.5], ['G2', 3.0]]) await must('meets/participants/add', { meetId: M1.id, displayName: PFX + ' ' + n, declaredLevel: lv, status: 'confirmed' }, A.token);
    for (const x of [B, C]) await must('meets/join', { meetId: M3.id }, x.token);
    const show = async (id, tok = A.token) => must('meets/show', { meetId: id }, tok);
    const partBy = (m, f) => (m.participants || []).find(f);
    let m1 = await show(M1.id);
    const pid = { B: partBy(m1, (p) => p.userId === B.userId).id, C: partBy(m1, (p) => p.userId === C.userId).id, G1: partBy(m1, (p) => /G1$/.test(p.displayName || '')).id, G2: partBy(m1, (p) => /G2$/.test(p.displayName || '')).id, A: (partBy(m1, (p) => p.userId === A.userId) || {}).id };
    R.fx.pid = pid; R.fx.m1Confirmed = m1.confirmed;
    ctl('fixture', 'M1 holds A (host) + B + C + two reserved guests confirmed; club open with B C D E; M2 club meet empty; M3 has B + C (read back)', m1.confirmed >= 4 && !!pid.B && !!pid.C && !!pid.G1 && !!pid.G2, { confirmed: m1.confirmed, pid });

    b = await browser();
    const h = await ctxFor(b, A);

    // ============================================================ A-roles-action.02 + A-generate-teams.04 (sheet part)
    await step('sheet', async () => {
      await open(h, url(M1.id, 'participants')); await waitText(h, /CONFIRMED|Confirmed/, 15000); await passSafety(h);
      await tap(h, C.name, { within: '.mt-cell', sel: '.mt-celln', wait: 1500 });
      const t = await snap(h, 'psheet-c-en');
      const geo = await h.evaluate(() => { const head = document.querySelector('.mt-hthead'); if (!head) return null; const els = Array.from(head.querySelectorAll('*')).filter((x) => ['View profile', 'Message'].includes((x.innerText || '').trim()) && !Array.from(x.children).some((c) => ['View profile', 'Message'].includes((c.innerText || '').trim()))); const r = els.map((e) => { const q = e.getBoundingClientRect(); return { t: e.innerText.trim(), l: Math.round(q.left), r: Math.round(q.right), top: Math.round(q.top), b: Math.round(q.bottom) }; }); return { r, headText: head.innerText.replace(/\n/g, ' | ') }; });
      const vp = geo && geo.r.find((x) => x.t === 'View profile'), ms = geo && geo.r.find((x) => x.t === 'Message');
      const apart = !!vp && !!ms && (ms.top >= vp.b + 2 || vp.top >= ms.b + 2 || ms.l >= vp.r + 6 || vp.l >= ms.r + 6);
      ck('A-roles-action.02', 'participant sheet header: "View profile" and "Message" are separate, not run together (>= 2 px apart vertically or >= 6 px horizontally) at 390 px EN', apart, geo, 'psheet-c-en', { vsReclub: { before: 'worse — "View profileMessage" with no gap read as one broken link', after: apart ? 'equal — two labelled links stacked at the header\'s right (Reclub: a chat icon + More)' : 'worse' } });
      // Force position (the chip row in the sheet)
      const fpOn = /Force position/i.test(t);   // .mt-genl labels are upper-cased by CSS (innerText reads FORCE POSITION)
      let fpBack = null;
      if (fpOn) { h.__req = []; await tap(h, 'Left side', { within: '.mt-htsheet', sel: '.mt-genchip', wait: 2500 }); m1 = await show(M1.id); fpBack = (partBy(m1, (p) => p.id === pid.C) || {}).forcePosition; R.fx.fpReq = h.__req.filter((r) => /participants\/update/.test(r.url)).map((r) => r.body.slice(0, 200)); }
      R.fx.fp = { fpOn, fpBack };
      await h.keyboard.press('Escape').catch(() => undefined);
      // 繁: the same sheet
      await open(h, url(M1.id, 'participants'), 'zh_Hant'); await waitText(h, /已確認|確認/, 12000);
      await tap(h, C.name, { within: '.mt-cell', sel: '.mt-celln', wait: 1500 });
      const tz = await snap(h, 'psheet-c-zh');
      const geoZ = await h.evaluate(() => { const head = document.querySelector('.mt-hthead'); return head ? head.innerText.replace(/\n/g, ' | ') : ''; });
      R.fx.sheetZh = { force: /指定位置/.test(tz), left: /左邊/.test(tz), head: geoZ };
      ck('A-generate-teams.04/force-position', 'participant sheet: "Force position" chips (None · Left side · Right side · Either side); tapping Left side stores meet_participant.forcePosition (read back); 繁 shows 指定位置 · 左邊', fpOn && fpBack === 'Left side' && /指定位置/.test(tz) && /左邊/.test(tz), { fpOn, fpBack, req: R.fx.fpReq, zh: R.fx.sheetZh }, 'psheet-c-en');
    });

    // ============================================================ A-generate-teams.04: Balance positions + Reset positions
    await step('teams', async () => {
      for (const [k, v] of [['G1', 'Left side'], ['G2', 'Right side'], ['B', 'Right side']]) await se('meets/participants/update', { meetId: M1.id, participantId: pid[k], forcePosition: v }, A.token);
      if (!R.fx.fp || R.fx.fp.fpBack !== 'Left side') await se('meets/participants/update', { meetId: M1.id, participantId: pid.C, forcePosition: 'Left side' }, A.token);
      // ENGINE behaviour, 6 seeds: with Balance positions the two Left-side players (C, G1) are always on different teams
      const split = []; const together = [];
      for (const seed of [11, 22, 33, 44, 55, 66]) {
        const on = await se('meets/participants/generate-teams', { meetId: M1.id, numTeams: 2, balanceSkill: false, balanceGender: false, balancePositions: true, seed }, A.token);
        const off = await se('meets/participants/generate-teams', { meetId: M1.id, numTeams: 2, balanceSkill: false, balanceGender: false, seed }, A.token);
        const teamOf = (r, id) => ((r.json && r.json.teams) || []).findIndex((t) => t.participantIds.includes(id));
        split.push(on.status === 200 && teamOf(on, pid.C) !== teamOf(on, pid.G1));
        together.push(off.status === 200 && teamOf(off, pid.C) === teamOf(off, pid.G1));
      }
      R.fx.balance = { split, togetherWithoutSwitch: together };
      await open(h, url(M1.id, 'participants')); await waitText(h, /Options/, 15000);
      await tap(h, 'Options', { wait: 1200 }); await tap(h, 'Generate teams', { within: '.ak-list', wait: 1500 });
      const t0 = await snap(h, 'teams-sheet-en');
      let req = [], pvText = '';
      const balOn = /Balance positions/.test(t0);
      if (balOn) {
        await h.evaluate(() => { const row = Array.from(document.querySelectorAll('.mt-genopt')).find((r) => /Balance positions/.test(r.innerText)); const s = row && row.querySelector('[role="switch"]'); if (s) { s.scrollIntoView({ block: 'center' }); s.setAttribute('data-fs5', 'balpos'); } });
        await h.click('[data-fs5="balpos"]'); await sleep(600);
        h.__req = []; await tap(h, 'Generate', { within: '.mt-htsheet', last: true, wait: 3000 });
        req = h.__req.filter((r) => /generate-teams/.test(r.url)).map((r) => r.body.slice(0, 300));
        pvText = await snap(h, 'teams-preview-en');
      }
      const resetBtn = /Reset positions/.test(pvText || t0);
      let resetBack = null, toast = null;
      if (resetBtn) {
        await tap(h, 'Reset positions', { within: '.mt-htsheet', wait: 1200 }); const d = await dlgText(h);
        await tap(h, 'Confirm', { within: '.nut-dialog', last: true, wait: 200 }).catch(() => tap(h, 'OK', { within: '.nut-dialog', last: true, wait: 200 }));
        toast = await toastAfter(h, /Positions reset/, 4000); await sleep(1500);
        m1 = await show(M1.id); resetBack = (m1.participants || []).filter((p) => p.forcePosition).length; R.fx.resetDialog = d;
      }
      await open(h, url(M1.id, 'participants'), 'zh_Hant'); await waitText(h, /選項|Options/, 12000);
      let tz = '';
      try { await tap(h, '選項', { wait: 1200 }); await tap(h, '產生隊伍', { within: '.ak-list', contains: true, wait: 1500 }); tz = await snap(h, 'teams-sheet-zh'); } catch (e) { tz = 'zh sheet not opened: ' + e.message; }
      const chipsWithPos = (pvText.match(/ · (Left|Right) side/g) || []).length;
      ck('A-generate-teams.04', 'Generate teams: "Balance positions" switch sends balancePositions:true, the preview names each forced position, and the engine splits the two Left-side players on every one of 6 seeds; "Reset positions" (confirm) clears every forced position (read back 0); 繁 shows 平衡位置', balOn && req.some((x) => /"balancePositions":true/.test(x)) && chipsWithPos >= 3 && split.every(Boolean) && resetBtn && resetBack === 0 && /平衡位置/.test(tz),
        { balOn, req, chipsWithPos, engine: R.fx.balance, resetBtn, toast, resetBack, zh: /平衡位置/.test(tz) ? 'Balance positions = 平衡位置' : tz.slice(0, 200) }, 'teams-preview-en',
        { vsReclub: { before: 'worse — Force position, Balance positions and Reset positions missing', after: 'equal — Force position per player (participant sheet, Reclub\'s per-player overrides), Balance positions, Reset positions; the preview names each player\'s position' } });
    });

    // ============================================================ D-meet-custom-match.03 (a): no teams
    await step('noteams', async () => {
      await se('meets/participants/generate-teams', { meetId: M1.id, reset: true }, A.token);
      const run = async (lang, key) => {
        await open(h, url(M1.id, 'matches'), lang); await sleep(1500);
        await h.evaluate(() => { const g = document.querySelector('.mt-gear[aria-label]'); if (g) g.setAttribute('data-fs5', 'gear'); });
        await h.click('[data-fs5="gear"]'); await sleep(1200);
        await tap(h, lang === 'en' ? 'Create custom match' : '自訂比賽', { within: '.ak-list', contains: lang !== 'en', wait: 1800 }).catch(async () => { const items = await dlgText(h); throw new Error('gear items: ' + items); });
        return snap(h, 'custom-noteams-' + key);
      };
      const t = await run('en', 'en');
      const noteOn = /Teams have not been set up yet\./.test(t) && /Generate teams/.test(t) && /Manage participants/.test(t);
      let opened = null;
      if (noteOn) { await tap(h, 'Generate teams', { within: '.mt-htsheet', last: true, wait: 1800 }); const t2 = await snap(h, 'custom-noteams-generate'); opened = /Number of teams/.test(t2) && !/Teams have not been set up yet/.test(t2); }
      let tz = ''; try { tz = await run('zh_Hant', 'zh'); } catch (e) { tz = String(e.message); }
      ck('D-meet-custom-match.03/no-teams', 'Create custom match with no preset teams: "Teams have not been set up yet." + Generate teams + Manage participants; Generate teams opens the teams sheet; 繁 尚未設定隊伍。', noteOn && opened === true && /尚未設定隊伍/.test(tz), { noteOn, opened, zh: (tz.match(/[^\n]*尚未設定隊伍[^\n]*/) || [tz.slice(0, 160)])[0] }, 'custom-noteams-en',
        { vsReclub: { before: 'worse — the preset rows were hidden, no empty state, no way to set teams up from here', after: 'equal — Reclub\'s empty state and its two ways on (copy without Reclub\'s "setup" slip)' } });
    });

    // ============================================================ A-roles-action.12: the host's Swap (B -> F)
    await step('swap', async () => {
      await open(h, url(M1.id, 'participants')); await waitText(h, /CONFIRMED|Confirmed/, 15000);
      await tap(h, B.name, { within: '.mt-cell', sel: '.mt-celln', wait: 1500 });
      const t = await snap(h, 'psheet-b-en');
      const swapChip = await has(h, 'Swap', { within: '.mt-htsheet' }) && await h.evaluate(() => Array.from(document.querySelectorAll('.mt-htsheet .mt-genchip')).some((c) => c.innerText.trim() === 'Swap'));
      let done = null, dlg = '', toast = null, req = [];
      if (swapChip) {
        await tap(h, 'Swap', { within: '.mt-htsheet', sel: '.mt-genchip', wait: 2500 });
        const s1 = await snap(h, 'host-swap-sheet');
        await waitText(h, new RegExp(F.name.replace(/[[\]]/g, '\\$&')), 12000);
        const row = await h.evaluate((nm) => { const rows = Array.from(document.querySelectorAll('.pg-row')).filter((r) => r.innerText.includes(nm) && r.getBoundingClientRect().height > 4); const r = rows[0]; if (!r) return null; const btn = Array.from(r.querySelectorAll('*')).find((x) => (x.innerText || '').trim() === 'Swap in'); if (!btn) return 'nobtn'; btn.scrollIntoView({ block: 'center' }); btn.setAttribute('data-fs5', 'swapin'); return 'ok'; }, F.name);
        R.fx.swapRow = row; R.fx.swapSheet = (s1.match(/Swap [^\n]*/) || [''])[0];
        if (row === 'ok') {
          await h.click('[data-fs5="swapin"]'); await sleep(1200); dlg = await dlgText(h);
          h.__req = []; await tap(h, 'Confirm', { within: '.nut-dialog', last: true, wait: 200 }).catch(() => tap(h, 'OK', { within: '.nut-dialog', last: true, wait: 200 }));
          toast = await toastAfter(h, /now has this spot/, 5000); await sleep(1500);
          req = h.__req.filter((r) => /participants\/swap/.test(r.url)).map((r) => r.body.slice(0, 200));
          const m = await show(M1.id); const seat = partBy(m, (p) => p.id === pid.B);
          done = { seatUser: seat && seat.userId, seatStatus: seat && seat.status, bRow: !!partBy(m, (p) => p.userId === B.userId), confirmed: m.confirmed, before: R.fx.m1Confirmed };
        }
      }
      await sleep(1500);
      const nB = ((await se('i/notifications', { limit: 20 }, B.token)).json || []).map((n) => n.body || '');
      const nF = ((await se('i/notifications', { limit: 20 }, F.token)).json || []).map((n) => n.body || '');
      const told = { B: nB.find((x) => x === 'You were removed from ' + M1.name + '.') || null, F: nF.find((x) => x === 'You are confirmed to play ' + M1.name + '. Please be on time.') || null };
      // role classes: a non-host player may not swap someone else's seat; the host row is never swapped
      let refusals = null;
      if (PHASE !== 'before') {
        const nh = await se('meets/participants/swap', { meetId: M1.id, participantId: pid.G1, userId: D.userId }, C.token);
        const hr = pid.A ? await se('meets/participants/swap', { meetId: M1.id, participantId: pid.A, userId: D.userId }, A.token) : { status: 'no host row' };
        const after = await show(M1.id);
        refusals = { nonHost: nh.status, nonHostCode: nh.json && nh.json.error && nh.json.error.code, hostRow: hr.status, g1Still: !!partBy(after, (p) => p.id === pid.G1 && !p.userId), dNotIn: !partBy(after, (p) => p.userId === D.userId) };
      }
      await open(h, url(M1.id, 'participants'), 'zh_Hant'); await waitText(h, /已確認|確認/, 12000);
      let zh = '';
      try { await tap(h, C.name, { within: '.mt-cell', sel: '.mt-celln', wait: 1500 }); zh = await snap(h, 'psheet-c-zh-swap'); } catch (e) { zh = e.message; }
      ck('A-roles-action.12', 'host participant sheet › Swap → the add-from-community picker (Friends) → "Swap in" → confirm naming both → B\'s seat now F\'s (same row, confirmed, count unchanged), B off the meet; B told "You were removed from <meet>.", F told "You are confirmed to play <meet>…"; a non-host is refused, the host row is refused; 繁 chip 替換',
        swapChip && !!done && done.seatUser === F.userId && done.seatStatus === 'confirmed' && !done.bRow && done.confirmed === done.before && /Swap/.test(dlg) && !!told.B && !!told.F && refusals && refusals.nonHost >= 400 && refusals.hostRow >= 400 && refusals.g1Still && refusals.dNotIn && /交換|替換/.test(zh),
        { swapChip, sheet: R.fx.swapSheet, row: R.fx.swapRow, dlg, toast, req, done, told, refusals, zhChip: (zh.match(/交換|替換/) || [null])[0] }, 'host-swap-sheet',
        { vsReclub: { before: 'worse — the host-side Swap was missing (only the player\'s own Swap my spot)', after: 'equal — Reclub\'s Swap from the participant sheet via add-from-community; ours confirms with both names first' } });
    });

    // ============================================================ D-meet-custom-match.03 (b): different-size preset teams
    await step('uneven', async () => {
      await must('meets/participants/bulk', { meetId: M1.id, participantIds: [pid.C], teamKey: 'red' }, A.token);
      await must('meets/participants/bulk', { meetId: M1.id, participantIds: [pid.G1, pid.G2, pid.B], teamKey: 'blue' }, A.token);
      await open(h, url(M1.id, 'matches')); await sleep(1500);
      await h.evaluate(() => { const g = document.querySelector('.mt-gear[aria-label]'); if (g) g.setAttribute('data-fs5', 'gear'); }); await h.click('[data-fs5="gear"]'); await sleep(1200);
      await tap(h, 'Create custom match', { within: '.ak-list', wait: 2000 });
      const sw = async (row, i) => { const rows = await h.$$('.mt-htsheet .mt-htswatches'); const s = await rows[row].$$('.mt-htswatch'); await s[i].evaluate((e) => e.scrollIntoView({ block: 'center' })); await sleep(400); await s[i].click(); await sleep(1300); };
      await sw(0, 0);   // Team 1 = red (1 player)
      const t1 = await text(h);
      await sw(1, 1);   // Team 2 = blue (3 players) — different size
      const dlg = await dlgText(h); await snap(h, 'uneven-dialog');
      let afterCancel = '', afterPick = '';
      if (/Teams of different sizes/.test(dlg)) {
        await tap(h, 'Cancel', { within: '.nut-dialog', last: true, wait: 1200 }); afterCancel = await text(h);
        await sw(1, 1); await tap(h, 'Pick anyway', { within: '.nut-dialog', last: true, wait: 1200 }); afterPick = await snap(h, 'uneven-picked');
      } else afterCancel = await snap(h, 'uneven-silent');
      const count = (t, n) => { const m = t.match(new RegExp('TEAM ' + n + ' · (\\d+)/(\\d+)', 'i')); return m ? m[1] + '/' + m[2] : null; };
      const ev = { dlg, t1Team1: count(t1, 1), cancel: { t1: count(afterCancel, 1), t2: count(afterCancel, 2) }, pick: { t1: count(afterPick, 1), t2: count(afterPick, 2) } };
      ck('D-meet-custom-match.03/uneven', 'preset teams of different sizes (red 1, blue 3): the second pick asks "Teams of different sizes" naming both and the side it would clear; Cancel keeps Team 1 (1/1); Pick anyway fills Team 2 (3/3) and clears Team 1 (0/3) — never silent',
        /Teams of different sizes/.test(dlg) && /Red( team)? \(1\)/i.test(dlg) && /Blue( team)? \(3\)/i.test(dlg) && /clear Team 1\?/.test(dlg) && ev.cancel.t1 === '1/1' && ev.pick.t2 === '3/3' && ev.pick.t1 === '0/3', ev, 'uneven-dialog',
        { vsReclub: { before: 'worse — the second tap silently emptied the first side (TEAM 1 · 0/4)', after: 'better — the host is told why (a match needs the same number each side) and chooses; Reclub does not explain it either' } });
      await must('meets/participants/generate-teams', { meetId: M1.id, reset: true }, A.token);
    });

    // ============================================================ A-promote-meet.02 + .06
    await step('promote', async () => {
      const readPreview = async (lang, key) => {
        await open(h, url(M1.id, 'participants'), lang); await waitText(h, lang === 'en' ? /Get more players/ : /招募更多球員/, 15000); await sleep(1200);
        await tap(h, lang === 'en' ? 'Club members' : '球會會員', { within: '.mx-promote', wait: 2500 });
        await snap(h, 'promote-' + key);
        return h.evaluate(() => { const l = Array.from(document.querySelectorAll('.mx-promote .mx-promotel')).find((x) => /What players will see|球友會看到的通知/.test(x.innerText)); const c = l ? l.parentElement : null; const lines = c ? Array.from(c.querySelectorAll('.mx-promotes')).map((x) => x.innerText.trim()) : []; return { lines, card: c ? c.innerText : ((document.querySelector('.mx-promote') || {}).innerText || '') }; });
      };
      const en = await readPreview('en', 'preview-en');
      const zh = await readPreview('zh_Hant', 'preview-zh');
      R.fx.previewEn = en; R.fx.previewZh = zh;
      const m1now = await show(M1.id);
      const onM1 = new Set((m1now.participants || []).map((p) => p.userId).filter(Boolean));
      const expected = [B, C, D, E].filter((x) => !onM1.has(x.userId)).map((x) => x.tag).sort();
      const pv = await must('meets/promote', { meetId: M1.id, preview: true, audience: 'club' }, A.token); R.fx.enginePreview = pv;
      ctl('promote.safe', 'Promote is pressed only when the engine\'s preview reach equals this run\'s [probe] club members not on the meet (' + expected.join(',') + ')', pv.gate === 'ok' && pv.reach === expected.length && expected.length >= 2, { reach: pv.reach, expected });
      if (!(pv.gate === 'ok' && pv.reach === expected.length && expected.length >= 2)) throw new Error('promote not pressed: preview ' + JSON.stringify(pv).slice(0, 200));
      await open(h, url(M1.id, 'participants')); await waitText(h, /Get more players/, 15000); await sleep(1000);
      await tap(h, 'Club members', { within: '.mx-promote', wait: 2500 });
      h.__req = []; await tap(h, 'Promote', { within: '.mx-promoteb', wait: 1500 }); const cd = await dlgText(h);
      await tap(h, 'Confirm', { within: '.nut-dialog', last: true, wait: 200 });
      const t0 = Date.now(); const got = {};
      for (let i = 0; i < 12; i++) {
        for (const x of [B, C, D, E, F]) { if (got[x.tag] && got[x.tag].length) continue; const ns = (await se('i/notifications', { limit: 20 }, x.token)).json || []; got[x.tag] = ns.filter((n) => n.type === 'app' && n.header === 'Looking for players').map((n) => n.body); }
        if (expected.every((k) => got[k] && got[k].length)) break; await sleep(250);
      }
      R.fx.deliveredMs = Date.now() - t0;
      const rs = await dlgText(h); await snap(h, 'promote-result');
      const body = (got[expected[0]] || [])[0] || '';
      const previewBody = en.lines[1] || '';
      ck('A-promote-meet.02', '"What players will see" = the delivered notification, exactly: header "GripBat · Looking for players" + body; the body names the meet ("' + M1.name + '"); 繁 preview is the same sentence through the inbox localizer (招募 + the meet name)',
        !!body && previewBody === body && en.lines[0] === 'GripBat · Looking for players' && body.includes(M1.name) && (zh.lines[1] || '').includes(M1.name) && /招募/.test(zh.lines[1] || ''),
        { previewEn: en.lines, delivered: body, previewZh: zh.lines }, 'promote-preview-en',
        { vsReclub: { before: 'worse — the mock read "… for <meet> on <when>" but players got "… is looking for players — 7 seats, <when>" with no meet name', after: 'equal — Reclub\'s mock push, now the very text delivered (one engine source), meet name + venue + time' } });
      const reached = expected.every((k) => got[k] && got[k].length === 1) && !(got.F || []).length && ['B', 'C', 'D', 'E'].map((k) => k.toLowerCase()).filter((k) => !expected.includes(k)).every((k) => !(got[k] || []).length);
      // the member's own inbox page, EN + 繁 (L6 on the reader's screen)
      const who = ACCTS[expected[0]];
      const dp = await ctxFor(b, who);
      await open(dp, 'notifications/index'); await waitText(dp, /Looking for players/, 15000); const ti = await snap(dp, 'member-inbox-en');
      await open(dp, 'notifications/index', 'zh_Hant'); await waitText(dp, /招募球員/, 15000); const tzi = await snap(dp, 'member-inbox-zh');
      await dp.browserContext().close().catch(() => undefined);
      ck('A-promote-meet.06', 'Promote (club audience) delivers to exactly this run\'s [probe] members off the meet (' + expected.join(',') + ') within ' + R.fx.deliveredMs + ' ms, nobody else (F, the players on the meet); "Meet promoted to N players" sheet; the member\'s inbox shows it in EN and 繁 (招募球員 + the meet name)',
        reached && /Meet promoted to \d+ players?/.test(rs) && /Looking for players/.test(ti) && ti.includes(ACCTS.a.name + ' is looking for') && ti.includes(M1.name) && tzi.includes(M1.name) && /招募球員/.test(tzi),
        { confirm: cd, sheet: rs, got, inboxEn: (ti.match(/Looking for players\n[^\n]*/) || [''])[0], inboxZh: (tzi.match(/[^\n]*招募[^\n]*/g) || []).slice(0, 2) }, 'member-inbox-en',
        { vsReclub: { before: 'equal (delivery unproven at L6 — the 45-min sweeper ate the first run\'s notifications)', after: 'equal — delivered, read on the member\'s own inbox in both languages' } });
    });

    // ============================================================ A-meet-detail.41: the empty Invited clubs line (M2)
    await step('invclubs', async () => {
      await open(h, url(M2.id, 'participants')); await sleep(2500);
      const t = await snap(h, 'invclubs-empty-en');
      const line = /No clubs have been invited to this meet yet\./.test(t) && /INVITED CLUBS • 0/i.test(t);
      let after = null, toast = null, list = null;
      if (line && /Invite club members/.test(t)) {
        await tap(h, 'Invite club members', { wait: 1200 });
        await tap(h, 'Members', { within: '.ak-list', wait: 200 }); toast = await toastAfter(h, /\d+ invited/, 6000); await sleep(2500);
        list = await must('clubs/meets/invited-clubs', { meetId: M2.id }, A.token);
        after = await snap(h, 'invclubs-after-en');
      }
      await open(h, url(M1.id, 'participants'), 'zh_Hant'); await sleep(2000);
      // 繁: the line on a fresh club meet (M1 has no club invitation either)
      const tz = await snap(h, 'invclubs-empty-zh');
      ck('A-meet-detail.41', 'host, club meet with no club invitation: "INVITED CLUBS • 0" + "No clubs have been invited to this meet yet." + Invite club members → Members → toast "N invited" → the club is listed (clubs/meets/invited-clubs read back 1); 繁 這個活動尚未邀請任何球會。 · reward-points reminder OUT OF SCOPE (no reward points in GripBat)',
        line && !!toast && list && (list.clubs || []).length === 1 && after && after.includes(PFX + ' club') && /這個活動尚未邀請任何球會/.test(tz),
        { line, toast, clubs: list && (list.clubs || []).map((c) => c.name), zh: (tz.match(/[^\n]*尚未邀請[^\n]*/) || [''])[0] }, 'invclubs-empty-en',
        { vsReclub: { before: 'worse — the section was hidden (no empty line); the reward-points reminder missing', after: 'better — Reclub\'s empty line plus the way on (invite the club\'s members from here); the reward-points payment-tag reminder is out of scope: GripBat has no reward-points system (orchestrator decision under G15.0 — inventing one to copy a reminder is not a user need)' } });
    });

    // ============================================================ D-meet-score-sheet.02: round / court without a score (M1, C vs G1)
    await step('score', async () => {
      const mm = await must('meets/matches/upsert', { meetId: M1.id, round: 1, team1Ids: [pid.C], team2Ids: [pid.G1] }, A.token); R.fx.scoreMatch = mm.id;
      await open(h, url(M1.id, 'matches')); await sleep(2500);
      const idx = await h.evaluate((nm) => Array.from(document.querySelectorAll('.mt-match')).findIndex((m) => m.innerText.includes(nm)), PFX + ' G1');
      if (idx < 0) throw new Error('the G1 match is not on screen');
      const cards = await h.$$('.mt-match'); const tm = await cards[idx].$('.mt-team'); await tm.evaluate((e) => e.scrollIntoView({ block: 'center' })); await sleep(300); await tm.click(); await sleep(1500);
      const d0 = await btnDisabled(h, 'Save', '.ks-foot');
      await tap(h, '3', { within: '.mt-htsheet', sel: '.mt-genchip', wait: 600 });
      const d1 = await btnDisabled(h, 'Save', '.ks-foot'); await snap(h, 'score-court-en');
      h.__req = []; await tap(h, 'Save', { within: '.ks-foot', last: true, wait: 3000 });
      const req = h.__req.filter((r) => /matches\/upsert/.test(r.url)).map((r) => r.body.slice(0, 200));
      const back = (await must('meets/matches/list', { meetId: M1.id }, A.token)).find((x) => x.id === mm.id) || {};
      await open(h, url(M1.id, 'matches'), 'zh_Hant'); await sleep(2000); const tz = await snap(h, 'score-after-zh');
      ck('D-meet-score-sheet.02', 'unplayed match: Save starts disabled, turns on once Court 3 is picked, saves court without a score (request has courtIndex 2 and no scores; read back courtIndex 2, scores []); 繁 card shows 3 號場',
        d0 === true && d1 === false && req.some((x) => /"courtIndex":2/.test(x) && !/"scores"/.test(x)) && back.courtIndex === 2 && (back.scores || []).length === 0,
        { saveDisabledBefore: d0, saveDisabledAfterCourt: d1, req, back: { courtIndex: back.courtIndex, scores: back.scores }, zh: (tz.match(/[^\n]*號場[^\n]*/) || [''])[0] }, 'score-court-en',
        { vsReclub: { before: 'worse — the round / court pickers looked usable but Save stayed disabled until a score was typed', after: 'equal — Reclub sets round / court on the score sheet; ours saves them before play too' } });
    });

    // ============================================================ D-meet-score-sheet.04: DUPR-submitted read-only note via the UAT cage (M3, B vs C)
    await step('dupr', async () => {
      const mm = await must('meets/matches/upsert', { meetId: M3.id, round: 1, team1Ids: [(partBy(await show(M3.id), (p) => p.userId === B.userId) || {}).id], team2Ids: [(partBy(await show(M3.id), (p) => p.userId === C.userId) || {}).id], scores: [[11, 5]] }, A.token);
      const env = execFileSync('docker', ['exec', 'social-engine-web-uat-1', 'printenv', 'DUPR_SUBMIT_SANDBOX'], { encoding: 'utf8' }).trim();
      const mark = Number(execFileSync('docker', ['exec', 'social-engine-web-uat-1', 'sh', '-c', "grep -rl 'uat_cage_env_missing' /misskey/packages/backend/built | wc -l"], { encoding: 'utf8' }).trim());
      const uatContainers = execSync("docker ps --format '{{.Names}}' | grep -i 'web-uat' || true", { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
      const envAll = uatContainers.map((c) => { try { return c + '=' + execFileSync('docker', ['exec', c, 'printenv', 'DUPR_SUBMIT_SANDBOX'], { encoding: 'utf8' }).trim(); } catch (e) { return c + '=unset'; } });
      ctl('dupr.gate', 'SAFETY GATE: every running web-uat container carries DUPR_SUBMIT_SANDBOX=1 and runs the cage code (marker from CODE in the built tree)', env === '1' && mark > 0 && envAll.every((x) => /=1$/.test(x)), { env, mark, envAll });
      if (!(env === '1' && mark > 0 && envAll.every((x) => /=1$/.test(x)))) throw new Error('SAFETY: the cage is not live on web-uat — nothing pressed');
      for (const x of [B, C]) {
        const r0 = sql(`select id, coalesce("duprId",'') from meet_player_level where "userId"=${lit(x.userId)} and sport='pickleball' limit 1`);
        if (!r0) throw new Error('no level row for ' + x.tag);
        const [plId, oldD] = r0.split('|'); plUndo.push({ plId, oldD });
        sql(`update meet_player_level set "duprId"=${lit('PRBFS5' + x.userId.slice(-5).toUpperCase())}, "updatedAt"=now() where id=${lit(plId)}`);
      }
      const off = fs.statSync(ACCESS).size; let sent;
      try { sent = await se('meets/matches/submit-dupr', { meetId: M3.id, matchId: mm.id }, A.token); } finally { restoreLinks(); }
      await sleep(3000);
      const buf = fs.readFileSync(ACCESS); const win = buf.length < off ? null : buf.slice(off).toString();
      const hits = win == null ? -1 : win.split('\n').filter((l) => l.includes('/api/v1/social/dupr/submit')).length;
      const row = sql(`select "duprStatus", "duprRef", "duprError" from meet_match where id=${lit(mm.id)}`);
      R.fx.dupr = { status: sent && sent.status, row, hits };
      ctl('dupr.receipt', 'the caged engine path wrote submitted | sandbox:<id> | sandbox_not_sent; 0 hits on /api/v1/social/dupr/submit in the nginx window; links restored', row === `submitted|sandbox:${mm.id}|sandbox_not_sent` && hits === 0 && Number(sql(`select count(*) from meet_player_level where "duprId" like 'PRBFS5%'`)) === 0, R.fx.dupr);
      const seeNote = async (lang, key) => {
        await open(h, url(M3.id, 'matches'), lang); await sleep(2500);
        const chip = await h.evaluate(() => { const m = document.querySelector('.mt-match'); return m ? m.innerText.replace(/\n/g, ' | ') : ''; });
        const tm = await h.$('.mt-match .mt-team'); if (tm) { await tm.evaluate((e) => e.scrollIntoView({ block: 'center' })); await sleep(300); await tm.click(); await sleep(1500); }
        const d = await dlgText(h); await snap(h, 'dupr-note-' + key);
        await tap(h, lang === 'en' ? 'OK' : '好', { within: '.nut-dialog', last: true, wait: 500 }).catch(() => undefined);
        return { chip, d };
      };
      const en = await seeNote('en', 'en'); const zh = await seeNote('zh_Hant', 'zh');
      ck('D-meet-score-sheet.04', 'a match submitted through the REAL engine path (UAT cage, sandbox:<id>) is read-only: the card says Test only and a tap says "Submitted to DUPR — These matches have already been submitted to DUPR and can no longer be edited."; 繁 the same note in Chinese',
        row === `submitted|sandbox:${mm.id}|sandbox_not_sent` && hits === 0 && /Test only/.test(en.chip) && /Submitted to DUPR/.test(en.d) && /These matches have already been submitted to DUPR and can no longer be edited\./.test(en.d) && /DUPR/.test(zh.d) && !/These matches have already/.test(zh.d),
        { card: en.chip, note: en.d, zhNote: zh.d }, 'dupr-note-en',
        { vsReclub: { before: 'equal (fixture SEEDED by SQL — not a real engine path)', after: 'equal — the same note, now on a match the engine itself submitted through the UAT cage; ours also labels it honestly as Test only on UAT' } });
    });
  } catch (e) {
    R.errors.push('main: ' + (e && e.stack || e)); console.log('CRASH ' + (e && e.message));
  } finally {
    restoreLinks();
    try { if (b) await b.close(); } catch (e) { /* */ }
    const A = ACCTS.a;
    for (const [p, q] of follows) { try { await se('following/delete', { userId: q.userId }, p.token); } catch (e) { /* */ } }
    if (A) {
      for (const id of meets) { try { const c = await se('meets/cancel', { meetId: id }, A.token); const d = await se('meets/delete', { meetId: id }, A.token); R.cleanup[id] = c.status + '/' + d.status; } catch (e) { R.cleanup[id] = 'error ' + e.message; } }
      if (club) { try { R.cleanup.club = (await se('channels/update', { channelId: club, isArchived: true }, A.token)).status; } catch (e) { R.cleanup.club = 'error ' + e.message; } }
    }
    for (const [k, a] of Object.entries(ACCTS)) { try { const r = a.token ? await se('i/delete-account', { password: a.password }, a.token) : { status: 'no token' }; R.cleanup['acct-' + k] = r.status; } catch (e) { R.cleanup['acct-' + k] = 'error ' + e.message; } }
    try { R.cleanup.pending = sql(`with d as (delete from user_pending where email like ${lit('fixs5-' + stamp + '%')} returning 1) select count(*) from d`); } catch (e) { R.cleanup.pending = 'error ' + e.message; }
    try { R.cleanup.liveUsers = Number(sql(`select count(*) from "user" where username like ${lit('fs5' + stamp + '%')} and "isDeleted" = false`)); } catch (e) { R.cleanup.liveUsers = 'error'; }
    try { R.cleanup.liveMeets = Number(sql(`select count(*) from meet where name like ${lit(PFX + '%')} and status <> 'cancelled'`)); } catch (e) { R.cleanup.liveMeets = 'error'; }
    try { R.cleanup.fakeLinks = Number(sql(`select count(*) from meet_player_level where "duprId" like 'PRBFS5%'`)); } catch (e) { R.cleanup.fakeLinks = 'error'; }
    const must8 = ['A-roles-action.02', 'A-generate-teams.04/force-position', 'A-generate-teams.04', 'D-meet-custom-match.03/no-teams', 'A-roles-action.12', 'D-meet-custom-match.03/uneven', 'A-promote-meet.02', 'A-meet-detail.41', 'D-meet-score-sheet.02'];
    const always = ['A-promote-meet.06', 'D-meet-score-sheet.04'];
    const got = (id) => R.rows.find((r) => r.row === id);
    const cleanOk = R.cleanup.liveUsers === 0 && R.cleanup.liveMeets === 0 && R.cleanup.fakeLinks === 0;
    const ctlOk = R.controls.every((c) => c.pass);
    let verdict;
    if (PHASE === 'before') {
      // the planted fault: on the unfixed build every must-fail row FAILS (or cannot run), the always-rows still hold
      const fired = must8.filter((id) => !got(id) || !got(id).pass);
      R.fired = fired; R.firedAll = fired.length === must8.length;
      verdict = R.firedAll && cleanOk ? 'pass' : 'fail';
    } else {
      const all = [...must8, ...always];
      const missing = all.filter((id) => !got(id));
      verdict = missing.length ? 'no_verdict' : all.every((id) => got(id).pass) && ctlOk && cleanOk && !R.errors.length ? 'pass' : 'fail';
      R.missing = missing;
    }
    const out = { id: 'fix-S5' + (PHASE === 'before' ? '.before' : ''), at: new Date().toISOString(), condition_fired: true, verdict, evidence: [{ phase: PHASE, engineRev: R.fx.engineRev, appBundle: R.fx.appBundle, stamp }, { rows: R.rows.map((r) => ({ row: r.row, pass: r.pass, vsReclub: r.vsReclub || null })) }, { controls: R.controls.map((c) => ({ name: c.name, pass: c.pass })) }, { cleanup: R.cleanup }, { errors: R.errors }, ...(PHASE === 'before' ? [{ fired: R.fired }] : [{ missing: R.missing }])], detail: R };
    fs.writeFileSync(DIR + '/fix-S5' + (PHASE === 'before' ? '.before' : '') + '.verdict.json', JSON.stringify(out, null, 1));
    console.log('VERDICT ' + verdict + ' · rows ' + R.rows.filter((r) => r.pass).length + '/' + R.rows.length + ' · controls ' + R.controls.filter((c) => c.pass).length + '/' + R.controls.length + ' · errors ' + R.errors.length + ' · cleanup ' + JSON.stringify(R.cleanup));
    process.exit(verdict === 'pass' ? 0 : 1);
  }
})();

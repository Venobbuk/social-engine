require('./_guard.cjs');   // G13.3: run through probes/run.sh (it sweeps afterwards)
// probes/account-rest.probe.cjs — lane account-rest (2026-09-24). The S7 account/stats rows this lane closed, checked on
// https://uat.gripbat.com/app/ at 390 px (the app) and against the UAT engine (state read back from the engine / se_sbx).
//
//   APP=live     the app as deployed on UAT (default).
//   APP=preview  the lane's committed build, served INTO the browser for /app/* only (request interception from
//                PREVIEW_DIR) — the engine, hkpl and data are the real UAT ones. Used to prove flag-gated UI before a
//                switch is flipped (AGENT_RULES 5) and before the app is published.
//   PLANT=1      run the app rows against the LIVE bundle and EXPECT them to fail (the fault: the build without this
//                lane's change) — a check that cannot fail there is not evidence (G16.1).
// Engine rows (deletion grace, maintenance gate, Social / promoted-club switches, community matches, competition recap
// DUPR, rating chips) need engine ACCOUNT-REST (adapter/account/deletion, gb/status …). When the running engine does not
// have those doors the rows are NOT RUN and the verdict is no_verdict — never a pass by absence.
// Personas: 0 = tester1, 1 = tester2 (probes/_session.cjs). A throwaway engine account ([probe] account-rest, sub
// ar-<stamp>) is minted with hkpl's SSO key (sec-lib mintJwt) for everything that suspends, deletes or gates an
// account — never a real one; in the browser its hkpl identity (whoami / SSO mint / sign-out) is answered by the probe.
// Never presses a DUPR submit. Every fixture is '[probe] account-rest …' and is removed in finally.
'use strict';
process.env.BASE = process.env.BASE || 'https://uat.social.silkvo.com';
const BASE = process.env.BASE;
if (!BASE.includes('uat.')) throw new Error('account-rest runs on UAT only');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');
const puppeteer = require('/root/hkpl-server/node_modules/puppeteer-core');
const { getSession } = require('./_session.cjs');
const L = require('./sec-lib.cjs');

const APPURL = 'https://uat.gripbat.com/app';
const MODE = process.env.APP || 'live';
const PLANT = process.env.PLANT === '1';
const PREVIEW_DIR = process.env.PREVIEW_DIR || '/root/gen/account-rest/preview-dist';
const OUT = path.join(__dirname, 'account-rest' + (PLANT ? '.plant' : MODE === 'preview' ? '.preview' : '') + '.verdict.json');
const SHOTS = '/root/gen/account-rest/shots-' + (PLANT ? 'plant' : MODE);
fs.mkdirSync(SHOTS, { recursive: true });
const PFX = '[probe] account-rest';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const V = { id: 'account-rest', at: new Date().toISOString(), mode: MODE, plant: PLANT, condition_fired: false, verdict: 'no_verdict', rows: [], fixtures: {}, restores: {}, cleanup: {}, errors: [], evidence: [] };

// ---------------------------------------------------------------------------------------------------------- doors
async function se(endpoint, body, token) {
  for (let k = 0; k < 12; k++) { const x = await se1(endpoint, body, token).catch((e) => ({ status: 599, json: null, text: String(e) })); if (![502, 503, 504, 599].includes(x.status)) return x; V.errors.push('engine ' + x.status + ' on ' + endpoint + ' — retry'); await sleep(10000); }
  return se1(endpoint, body, token);
}
async function se1(endpoint, body, token) {
  const r = await fetch(BASE + '/api/' + endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(token ? { ...(body || {}), i: token } : (body || {})) });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch (e) { /* */ }
  return { status: r.status, json, text };
}
async function hk(p, cookie, opt = {}) {
  const r = await fetch(BASE + p, { method: opt.method || 'GET', headers: { cookie: cookie.name + '=' + cookie.value, ...(opt.body ? { 'content-type': 'application/json' } : {}) }, body: opt.body ? JSON.stringify(opt.body) : undefined });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch (e) { /* */ }
  return { status: r.status, json, text };
}
const who = {};
async function persona(i) {
  if (who[i]) return who[i];
  const cookie = await getSession(i);
  const m = await hk('/api/v1/auth/sso/social', cookie);
  if (!m.json || !m.json.jwt) throw new Error('sso/social ' + m.status);
  const r = await se('adapter/sso', { jwt: m.json.jwt });
  if (!r.json || !r.json.token) throw new Error('adapter/sso ' + r.status);
  const me = await se('i', {}, r.json.token);
  who[i] = { cookie, token: r.json.token, me: me.json, id: me.json.id };
  return who[i];
}
function sql(q) { return execSync('docker exec -i social-engine-db-1 psql -U social -d se_sbx -At -F "|"', { input: q, encoding: 'utf8' }).trim(); }
async function create(body, token) { for (let k = 0; k < 6; k++) { const r = await se('meets/create', body, token); if (r.status !== 429) return r; await sleep(15000); } return se('meets/create', body, token); }
async function hasDoor(name) { const r = await se('endpoint', { endpoint: name }); return r.status === 200; }

// ---------------------------------------------------------------------------------------------------------- rows
const row = (id, level) => { const r = { id, level, verdict: 'not_run', checks: [], note: '' }; V.rows.push(r); return r; };
function chk(r, pass, text, detail) { r.checks.push({ pass: !!pass, text, detail }); if (r.verdict !== 'fail') r.verdict = pass ? 'pass' : 'fail'; if (!pass) r.verdict = 'fail'; return !!pass; }
function notRun(r, why) { r.verdict = 'not_run'; r.note = why; }

// ---------------------------------------------------------------------------------------------------------- browser
let browser;
const MIME = { js: 'application/javascript', css: 'text/css', html: 'text/html; charset=utf-8', png: 'image/png', svg: 'image/svg+xml', jpg: 'image/jpeg', json: 'application/json', woff2: 'font/woff2' };
async function newPage(opt = {}) {
  const ctx = browser.createBrowserContext ? await browser.createBrowserContext() : await browser.createIncognitoBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  page.__api = [];
  page.on('response', (res) => { const u = res.url(); if (!/\/api\//.test(u)) return; page.__api.push(res.request().method() + ' ' + u.replace(/^https:\/\/[^/]+/, '').split('?')[0] + ' -> ' + res.status() + (res.request().postData() ? ' ' + String(res.request().postData()).replace(/"i":"[^"]+"/, '"i":"…"').slice(0, 160) : '')); });
  page.on('dialog', async (d) => { V.errors.push('native dialog: ' + d.message()); await d.dismiss().catch(() => undefined); });
  const fake = opt.fake || null;   // { user, mint() } — the throwaway account's hkpl identity, answered by the probe
  if (MODE === 'preview' || fake) {
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const u = req.url();
      try {
        if (fake && u.startsWith('https://uat.gripbat.com/api/v1/')) {
          const p = u.replace('https://uat.gripbat.com', '').split('?')[0];
          if (p === '/api/v1/auth/me') return req.respond(fake.signedIn ? { status: 200, contentType: 'application/json', body: JSON.stringify({ user: fake.user }) } : { status: 401, contentType: 'application/json', body: '{"error":"unauthorized"}' });
          if (p === '/api/v1/auth/sso/social') return req.respond(fake.signedIn ? { status: 200, contentType: 'application/json', body: JSON.stringify({ jwt: fake.mint(), endpoint: BASE }) } : { status: 401, contentType: 'application/json', body: '{}' });
          if (p === '/api/v1/auth/signout') { fake.signedIn = false; fake.signouts = (fake.signouts || 0) + 1; return req.respond({ status: 200, contentType: 'application/json', body: '{"ok":true}' }); }
          if (p === '/api/v1/auth/sso/social/delete-proof') return req.respond({ status: 404, contentType: 'application/json', body: '{"error":"not_found"}' });
        }
        if (MODE === 'preview' && u.startsWith(APPURL + '/')) {
          const rel = u.slice(APPURL.length + 1).split('?')[0].split('#')[0];
          const f = path.join(PREVIEW_DIR, rel);
          if (rel && !rel.startsWith('uat') && fs.existsSync(f) && fs.statSync(f).isFile()) return req.respond({ status: 200, contentType: MIME[path.extname(f).slice(1)] || 'application/octet-stream', body: fs.readFileSync(f) });
          if (req.resourceType() === 'document') return req.respond({ status: 200, contentType: MIME.html, body: fs.readFileSync(path.join(PREVIEW_DIR, 'index.html')) });
        }
      } catch (e) { V.errors.push('intercept ' + u + ': ' + e.message); }
      return req.continue();
    });
  }
  if (opt.persona != null) { const c = (await persona(opt.persona)).cookie; await page.setCookie({ name: c.name, value: c.value, domain: 'uat.gripbat.com', path: '/', secure: true }); }
  if (opt.hideConsent) await page.evaluateOnNewDocument(() => { document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = '.cg{display:none !important}'; document.head.appendChild(s); }); });
  return { page, ctx };
}
async function visit(page, route, wait = 2800) {
  page.__api = [];
  await page.goto(APPURL + route + (route.includes('?') ? '&' : '?') + 'lang=en', { waitUntil: 'networkidle2', timeout: 60000 }).catch((e) => V.errors.push('goto ' + route + ': ' + e.message));
  await sleep(wait);
  return text(page);
}
async function text(page) { return (await page.evaluate(() => document.body.innerText).catch(() => '')).replace(/[ \t]+\n/g, '\n'); }
async function shot(page, name) { const f = SHOTS + '/' + name + '.png'; await page.screenshot({ path: f, fullPage: false }).catch(() => undefined); return f; }
/** A real click on the deepest visible element whose own text is exactly `t` (or includes it with exact:false). */
async function click(page, t, opt = {}) {
  const tok = 'ar' + Math.random().toString(36).slice(2, 8);
  const ok = await page.evaluate((t, tok, exact, sel) => {
    const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
    const hits = Array.from(document.querySelectorAll(sel || 'body *')).filter((el) => { const x = (el.innerText || '').trim(); return (exact ? x === t : x.includes(t)) && vis(el); });
    const leaf = hits.filter((el) => !hits.some((o) => o !== el && el.contains(o)));
    const el = leaf[0]; if (!el) return false;
    el.scrollIntoView({ block: 'center' }); el.setAttribute('data-arc', tok); return true;
  }, t, tok, opt.exact !== false, opt.sel || null);
  if (!ok) throw new Error('no visible element "' + t + '"');
  await sleep(250);
  await page.click('[data-arc="' + tok + '"]');
  await sleep(opt.wait || 2000);
}
const has = (t, s) => String(t || '').toLowerCase().includes(String(s).toLowerCase());
/** Home's location prompt ("No more boundaries…" · Not now) can open over any page — close it when present. */
async function dismissPrompts(page) { for (let k = 0; k < 3; k++) { const t = await text(page); const b = has(t, 'Not now') ? 'Not now' : has(t, 'Got it, continue') ? 'Got it, continue' : ''; if (!b) return; await click(page, b, { wait: 1200 }).catch(() => undefined); } }
async function step(r, fn) { try { await fn(); } catch (e) { chk(r, false, 'step threw', String(e && e.message || e).slice(0, 300)); } }

// ---------------------------------------------------------------------------------------------------------- run
const clean = [];   // async cleanups, run in finally (newest first)
(async () => {
  try {
    const t1 = await persona(0), t2 = await persona(1);
    V.personas = { t1: t1.id, t2: t2.id };
    const rev = execSync("docker inspect -f '{{index .Config.Labels \"org.opencontainers.image.revision\"}}' social-engine-web-uat-1").toString().trim();
    const ENGINE_AR = await hasDoor('adapter/account/deletion') && await hasDoor('gb/status');
    V.engine = { rev, accountRest: ENGINE_AR };
    browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });

    // ================================================================= E-sport-levels.01 — one list, 13 steps
    const rLv = row('E-sport-levels.01', 'L6');
    await step(rLv, async () => {
      const lv0 = (await se('meets/level', {}, t2.token)).json;   // read: no selfLevel key = no write
      V.restores.level0 = lv0 && lv0.selfLevel;
      clean.push(async () => { if (V.restores.level0 == null) return; const cur = (await se('meets/level', {}, t2.token)).json; if (cur && Number(cur.selfLevel) !== Number(V.restores.level0)) await se('meets/level', { selfLevel: Number(V.restores.level0) }, t2.token); V.restores.levelFinal = ((await se('meets/level', {}, t2.token)).json || {}).selfLevel; });
      const P = await newPage({ persona: 1, hideConsent: true });
      await visit(P.page, '/pages/onboard/index');
      // the level step is the second view: tap Next / Get started until the chips are drawn
      let chipsOb = [];
      for (let k = 0; k < 3 && !chipsOb.length; k++) {
        chipsOb = await P.page.evaluate(() => { const box = document.querySelector('.ob-chips'); return box ? Array.from(box.querySelectorAll('.ob-chip')).map((x) => x.innerText.trim()) : []; });   // the FIRST chip row is the level (gender / age follow)
        if (!chipsOb.length) { try { await click(P.page, 'Get started', { wait: 1500 }); } catch (e) { try { await click(P.page, 'Next', { wait: 1500 }); } catch (e2) { /* */ } } }
      }
      await shot(P.page, 'levels-onboarding');
      await visit(P.page, '/pages/profile/index');
      await click(P.page, 'Pickleball', { sel: '.bp-cardrow *' });
      const chipsPr = await P.page.evaluate(() => Array.from(document.querySelectorAll('.bp-levelchips .pg-chip')).map((x) => x.innerText.trim()));
      await shot(P.page, 'levels-profile');
      chk(rLv, chipsOb.length === 13, 'onboarding shows 13 level steps', chipsOb);
      chk(rLv, chipsPr.length === 13, 'profile level picker shows 13 level steps', chipsPr);
      chk(rLv, chipsOb.length === 13 && JSON.stringify(chipsOb) === JSON.stringify(chipsPr), 'the two screens show the SAME list (value · word)', { onboarding: chipsOb.slice(0, 4), profile: chipsPr.slice(0, 4) });
      if (chipsPr.length === 13 && !PLANT) {   // one real write through the chip, read back, then restore
        const target = chipsPr.find((c) => c.startsWith('3.25')) || chipsPr[5];
        P.page.__api = [];
        await click(P.page, target, { sel: '.bp-levelchips .pg-chip' });
        const after = (await se('meets/level', {}, t2.token)).json;
        chk(rLv, after && Math.abs(Number(after.selfLevel) - 3.25) < 1e-6, 'tapping "' + target + '" stores selfLevel 3.25 (engine read-back)', { selfLevel: after && after.selfLevel, api: P.page.__api.filter((a) => a.includes('meets/level')).slice(0, 2) });
        if (V.restores.level0 != null) { const back = await se('meets/level', { selfLevel: Number(V.restores.level0) }, t2.token); V.restores.levelBack = back.status + ' ' + (back.json && back.json.selfLevel); }
      }
      await P.ctx.close();
    });

    // ================================================================= A-manage-meet-tutorial.03 — convert a listing
    const rCv = row('A-manage-meet-tutorial.03', 'L6');
    await step(rCv, async () => {
      const inAt = new Date(Date.now() + 3 * 86400e3).toISOString();
      const l = await create({ name: PFX + ' listing', type: 'listing', startAt: inAt, durationMinutes: 60, capacity: 4, visibility: 'private', sendNotifications: false }, t2.token);
      const id = l.json && l.json.id; V.fixtures.listing = id; if (!id) throw new Error('listing fixture ' + l.status + ' ' + l.text.slice(0, 120));
      clean.push(async () => { V.cleanup['listing ' + id] = (await se('meets/delete', { meetId: id }, t2.token)).status; if (V.cleanup['listing ' + id] >= 300) V.cleanup['listing cancel'] = (await se('meets/cancel', { meetId: id }, t2.token)).status; });
      chk(rCv, sql(`select type from meet where id='${id}'`) === 'listing', 'fixture is a real listing (se_sbx read-back)', sql(`select type, visibility from meet where id='${id}'`));
      const P = await newPage({ persona: 1, hideConsent: true });
      const t = await visit(P.page, '/pages/meet/index?id=' + id);
      await shot(P.page, 'convert-listing');
      chk(rCv, has(t, 'Convert to a full meet'), 'the host of a live listing sees "Convert to a full meet"', t.slice(0, 200));
      if (has(t, 'Convert to a full meet') && !PLANT) {
        P.page.__api = [];
        await click(P.page, 'Convert to a full meet');
        await click(P.page, 'Convert', { sel: '[class*=dlg] *, [class*=dialog] *, [role=dialog] *' });
        const after = sql(`select type from meet where id='${id}'`);
        chk(rCv, after === 'managed', 'Convert → the meet row is now managed (se_sbx read-back)', { type: after, api: P.page.__api.filter((a) => a.includes('meets/update')).slice(0, 2) });
      }
      await P.ctx.close();
    });

    // ================================================================= DUPR Manager (W2_S_DUPR_MANAGER) + notice (W2_S_DUPR_NOTICE)
    const rDm2 = row('D-dupr-activity-manager.02', 'L6'), rDm3 = row('D-dupr-activity-manager.03', 'L6'), rDm4 = row('D-dupr-activity-manager.04', 'L6');
    const rNo = row('D-dupr-submit-notice.01', 'L6');
    await step(rDm2, async () => {
      const inAt = new Date(Date.now() + 3 * 86400e3).toISOString();
      // host tester2 (tester1's meets/create hour is spent by other lanes' probes), matches NOT submitted while the score is written (no auto-submit), switched on afterwards
      const m = await create({ name: PFX + ' DUPR manager', type: 'managed', startAt: inAt, durationMinutes: 90, capacity: 8, visibility: 'private', submitMatches: false, sendNotifications: false, autoApprove: true }, t2.token);
      const id = m.json && m.json.id; V.fixtures.duprMeet = id; if (!id) throw new Error('dupr meet ' + m.status + ' ' + m.text.slice(0, 160));
      clean.push(async () => { V.cleanup['duprMeet ' + id] = (await se('meets/delete', { meetId: id }, t2.token)).status; if (V.cleanup['duprMeet ' + id] >= 300) V.cleanup['duprMeet cancel'] = (await se('meets/cancel', { meetId: id }, t2.token)).status; });
      const g = await se('meets/participants/add', { meetId: id, displayName: PFX + ' guest' }, t2.token);
      V.fixtures.guestAdd = g.status + ' ' + g.text.slice(0, 120);
      const parts = sql(`select id||':'||coalesce("userId",'-')||':'||"isHost" from meet_participant where "meetId"='${id}'`).split('\n').filter(Boolean).map((x) => x.split(':'));
      const host = parts.find((p) => p[2] === 't' || p[2] === 'true'), guest = parts.find((p) => p[1] === '-');
      if (!host || !guest) throw new Error('participants ' + JSON.stringify(parts));
      const up = await se('meets/matches/upsert', { meetId: id, team1Ids: [host[0]], team2Ids: [guest[0]], scores: [[11, 7], [11, 9]], round: 1, courtIndex: 0 }, t2.token);
      V.fixtures.match = up.status + ' ' + (up.json && up.json.id);
      const sw = await se('meets/update', { meetId: id, submitMatches: true }, t2.token);
      V.fixtures.submitOn = sw.status + ' ' + sw.text.slice(0, 80);
      chk(rDm2, sql(`select "submitMatches" from meet where id='${id}'`) === 't' && sql(`select count(*) from meet_match where "meetId"='${id}' and jsonb_array_length(scores)>0 and "duprStatus" is null`) === '1', 'fixture: submitMatches on, one scored match never sent (duprStatus null)', {});
      const P = await newPage({ persona: 1, hideConsent: true });
      await visit(P.page, '/pages/meet/index?id=' + id);
      await click(P.page, 'Participants', { exact: true }).catch(() => undefined);
      await click(P.page, 'Manager');
      await click(P.page, 'Matches', { sel: '.mt-htsheet *, [class*=sheet] *' });
      const t = await text(P.page); await shot(P.page, 'dupr-manager-matches');
      chk(rDm2, has(t, 'Pending') && has(t, 'Ineligible'), 'DUPR Manager shows the Pending / Submitted / Ineligible boxes', t.slice(0, 300));
      if (has(t, 'Recalculate eligibility')) {
        P.page.__api = [];
        await click(P.page, 'Recalculate eligibility');
        chk(rDm4, P.page.__api.some((a) => a.includes('meets/dupr-manager')), 'Recalculate eligibility re-reads meets/dupr-manager', P.page.__api.slice(0, 4));
      } else chk(rDm4, false, '"Recalculate eligibility" button present', t.slice(0, 200));
      // row → recap
      try {
        await click(P.page, 'Round 1', { exact: false, sel: '.mt-htsheet *, [class*=sheet] *' });
        await sleep(1500);
        chk(rDm3, /pages\/match\/index/.test(P.page.url()), 'tapping a scored row opens the match recap', P.page.url());
      } catch (e) { chk(rDm3, false, 'a tappable scored row', e.message); }
      chk(rDm2, !P.page.__api.some((a) => /submit-dupr/.test(a)), 'no DUPR submit door was called', null);
      await P.ctx.close();
    });
    await step(rNo, async () => {
      const inAt = new Date(Date.now() + 3 * 86400e3).toISOString();
      const m = await create({ name: PFX + ' DUPR notice', type: 'managed', startAt: inAt, durationMinutes: 90, capacity: 8, visibility: 'public', submitMatches: true, sendNotifications: false, autoApprove: true }, t2.token);
      const id = m.json && m.json.id; V.fixtures.noticeMeet = id; if (!id) throw new Error('notice meet ' + m.status);
      clean.push(async () => { V.cleanup['notice leave'] = (await se('meets/leave', { meetId: id }, t1.token)).status; V.cleanup['noticeMeet ' + id] = (await se('meets/delete', { meetId: id }, t2.token)).status; if (V.cleanup['noticeMeet ' + id] >= 300) V.cleanup['noticeMeet cancel'] = (await se('meets/cancel', { meetId: id }, t2.token)).status; });
      const P = await newPage({ persona: 0, hideConsent: true });
      const tn = await visit(P.page, '/pages/meet/index?id=' + id); await shot(P.page, 'dupr-notice-before');
      await dismissPrompts(P.page);
      const cta = await P.page.evaluate(() => { const els = Array.from(document.querySelectorAll('body *')).filter((x) => { const r = x.getBoundingClientRect(); const t = (x.innerText || '').trim(); return r.width > 0 && r.height > 0 && /^(Join|Request to join|Join waitlist)/.test(t) && x.children.length === 0; }); return els.length ? els[0].innerText.trim() : ''; });
      V.fixtures.noticeCta = cta || tn.slice(-300);
      P.page.__api = [];
      await click(P.page, cta || 'Join');
      if (has(await text(P.page), 'Got it, continue')) { V.fixtures.noticeSafetyFirst = true; await click(P.page, 'Got it, continue', { wait: 2000 }); }
      const t = await text(P.page); await shot(P.page, 'dupr-notice');
      const joined = P.page.__api.some((a) => a.includes('meets/join'));
      chk(rNo, has(t, 'This activity will be submitted to DUPR'), 'Join first shows "This activity will be submitted to DUPR"', t.slice(0, 200));
      chk(rNo, !joined, 'nothing is joined before the player answers the notice', P.page.__api.slice(0, 4));
      try { await click(P.page, 'Cancel', { sel: '[class*=dlg] *, [class*=dialog] *, [role=dialog] *' }); } catch (e) { try { await click(P.page, 'Connect DUPR'); } catch (e2) { /* */ } }
      await P.ctx.close();
    });

    // ================================================================= D-dupr-support.03 — Resync ratings (W2_S_DUPR_RESYNC)
    const rRs = row('D-dupr-support.03', 'L6');
    await step(rRs, async () => {
      const conn = await hk('/api/v1/dupr/connection', t2.cookie);
      const id = String((conn.json && conn.json.dupr_id) || '');
      V.fixtures.t2Dupr = { connected: conn.json && conn.json.connected, id, hasResyncField: !!(conn.json && Object.prototype.hasOwnProperty.call(conn.json, 'resync_available_at')) };
      chk(rRs, !!V.fixtures.t2Dupr.hasResyncField, 'prod hkpl answers resync_available_at (the /dupr/resync route is live on hkpl)', V.fixtures.t2Dupr);
      const P = await newPage({ persona: 1, hideConsent: true });
      const t = await visit(P.page, '/pages/dupr-connect/index'); await shot(P.page, 'dupr-resync');
      chk(rRs, has(t, 'Resync ratings') && has(t, 'not syncing'), 'Connect DUPR shows "Is your DUPR rating not syncing correctly?" + Resync ratings', t.slice(0, 300));
      // SAFE PRESS ONLY: a short DUPR id would make hkpl READ the partner API — then the press is skipped (reported)
      if (has(t, 'Resync ratings') && !/^[A-Z0-9]{4,7}$/.test(id.toUpperCase()) && !PLANT) {
        P.page.__api = [];
        await click(P.page, 'Resync ratings', { wait: 2500 });
        const r = P.page.__api.find((a) => a.includes('/api/v1/dupr/resync'));
        chk(rRs, !!r && / -> (409|429|400) /.test(r + ' '), 'the press reaches hkpl POST /api/v1/dupr/resync and is answered without a DUPR call (409 no_short_id / 429 cooldown)', r);
      } else rRs.note = 'press skipped (short DUPR id → would read the partner API, or PLANT)';
      await P.ctx.close();
    });

    // ================================================================= live-app rows closed by T3 (295c910): re-check at L6
    if (!PLANT) {
      const rPh = row('E-own-profile.03', 'L6'), rVer = row('E-settings-hub.12', 'L6'), rDel2 = row('E-delete-account.02', 'L6'), rN9 = row('E-notif-settings.09', 'L6'), rGen = row('D-stats-filter-gender.01', 'L6');
      const P = await newPage({ persona: 1, hideConsent: true });
      await step(rVer, async () => {
        const t = await visit(P.page, '/pages/social-settings/index');
        const line = (t.match(/GripBat · Version [^\n]+/) || [''])[0];
        const js = await P.page.evaluate(() => { const s = Array.from(document.querySelectorAll('script[src]')).map((x) => x.src).find((u) => /\/js\/app\.[0-9a-f]+\.js/.test(u)); return s ? /\/js\/app\.([0-9a-f]+)\.js/.exec(s)[1].slice(0, 8) : ''; });
        chk(rVer, !!line && !!js && line.includes('build ' + js), 'Settings foot reads the build of the bundle this browser loaded', { line, bundle: js });
      });
      await step(rDel2, async () => {
        await click(P.page, 'Delete account');
        const box = await P.page.$('.ss-danger input');
        const disabledBefore = await P.page.evaluate(() => { const b = Array.from(document.querySelectorAll('.ss-danger *')).find((x) => (x.innerText || '').trim() === 'Yes, delete'); const btn = b && (b.closest('button,[class*=btn]') || b); return btn ? (btn.getAttribute('aria-disabled') === 'true' || btn.hasAttribute('disabled') || /disabled/.test(btn.className)) : null; });
        chk(rDel2, !!box, 'Delete account reveals the typed-confirmation field', null);
        if (box) { await box.type('DELETE'); await sleep(500); }
        const disabledAfter = await P.page.evaluate(() => { const b = Array.from(document.querySelectorAll('.ss-danger *')).find((x) => (x.innerText || '').trim() === 'Yes, delete'); const btn = b && (b.closest('button,[class*=btn]') || b); return btn ? (btn.getAttribute('aria-disabled') === 'true' || btn.hasAttribute('disabled') || /disabled/.test(btn.className)) : null; });
        await shot(P.page, 'delete-typed');
        chk(rDel2, disabledBefore === true && disabledAfter === false, '"Yes, delete" is disabled until DELETE is typed (NOT pressed)', { disabledBefore, disabledAfter });
        await click(P.page, 'Cancel', { sel: '.ss-danger *' });
      });
      await step(rN9, async () => {
        const before = (await se('chat/notification-prefs/show', {}, t2.token)).json;
        await visit(P.page, '/pages/social-settings/index');
        P.page.__api = [];
        await P.page.evaluate(() => { const lab = Array.from(document.querySelectorAll('.ss-opt')).find((x) => (x.innerText || '').includes('Meet updates')); const sw = lab && lab.querySelector('[role=switch], [class*=switch]'); if (sw) sw.setAttribute('data-arc', 'mu'); });
        await P.page.click('[data-arc="mu"]'); await sleep(1500);
        const t = await text(P.page); await shot(P.page, 'meet-updates-confirm');
        chk(rN9, has(t, 'Turn off all essential notifications?'), 'switching Meet updates off asks first', t.slice(-300));
        await click(P.page, 'Keep them on', { sel: '[class*=dlg] *, [class*=dialog] *, [role=dialog] *' }).catch((e) => V.errors.push('keep: ' + e.message));
        const after = (await se('chat/notification-prefs/show', {}, t2.token)).json;
        chk(rN9, before && after && before.meets === after.meets && !P.page.__api.some((a) => a.includes('notification-prefs/update')), '"Keep them on" writes nothing (engine read-back unchanged)', { before: before && before.meets, after: after && after.meets });
      });
      await step(rPh, async () => {
        const me0 = (await se('i', {}, t2.token)).json; V.restores.avatar0 = me0.avatarId || null;
        clean.push(async () => { const back = await se('i/update', { avatarId: V.restores.avatar0 }, t2.token); const me2 = (await se('i', {}, t2.token)).json; V.restores.avatarBack = { status: back.status, avatarId: me2.avatarId, want: V.restores.avatar0 }; });
        let fid = me0.avatarId;
        if (!fid) { const fl = (await se('drive/files', { limit: 10 }, t2.token)).json || []; const img = fl.find((f) => /^image\//.test(f.type)); fid = img && img.id; if (fid) V.fixtures.avatarSet = (await se('i/update', { avatarId: fid }, t2.token)).status; }
        if (!fid) { notRun(rPh, 'tester2 has no image in their drive to make an avatar of (fixture impossible without an upload)'); return; }
        await visit(P.page, '/pages/profile/index');
        await dismissPrompts(P.page);
        await P.page.click('.bp-av'); await sleep(1500);
        const t = await text(P.page); await shot(P.page, 'photo-sheet'); V.fixtures.photoSheet = { avatarBefore: fid, text: t.slice(-240) };
        chk(rPh, has(t, 'Remove profile picture'), 'the photo sheet offers "Remove profile picture"', null);
        P.page.__api = [];
        await click(P.page, 'Remove profile picture', { sel: '.ak-list *' });
        const t2x = await text(P.page); if (has(t2x, 'Remove')) await click(P.page, 'Remove', { sel: '[class*=dlg] *, [class*=dialog] *, [role=dialog] *' }).catch(() => undefined);
        await sleep(1200);
        const me1 = (await se('i', {}, t2.token)).json;
        chk(rPh, me1.avatarId == null, 'the engine avatar is cleared (i/update {avatarId:null}, read back)', { avatarId: me1.avatarId, api: P.page.__api.filter((a) => a.includes('i/update')).slice(0, 2) });
      });
      await step(rGen, async () => {
        const t = await visit(P.page, '/pages/my-stats/index');
        await dismissPrompts(P.page);
        await click(P.page, 'Rankings', { exact: true }).catch((e) => V.errors.push('rankings tab: ' + e.message));
        await shot(P.page, 'stats-rankings'); V.fixtures.statsText = (await text(P.page)).slice(0, 300);
        P.page.__api = [];
        await click(P.page, 'Non-binary', { exact: true });
        chk(rGen, P.page.__api.some((a) => a.includes('stats/gb-rankings') && a.includes('nonbinary')), 'Rankings (GripBat): the Non-binary chip filters (gender:nonbinary sent)', P.page.__api.slice(0, 3));
        await click(P.page, 'DUPR Rankings', { exact: true });
        const td = await text(P.page); await shot(P.page, 'stats-dupr-rankings');
        chk(rGen, has(td, 'Non-binary'), 'DUPR Rankings shows the same Coed / Male / Female / Non-binary chips', td.slice(0, 200));
      });
      await P.ctx.close();
    }

    if (!PLANT) {   // the plant pass measures the app rows only
    // ================================================================= throwaway account: terms gate sign-out, suspended sign-in
    const rT2 = row('E-onb-terms.02', 'L6'), rL5 = row('E-auth-login.05', 'L5');
    const tmpl = L.decodeJwt(await L.hkplJwt(await L.hkplCookies(L.persona('player-amy').email)));
    const stamp = Date.now().toString(36).slice(-6);
    const mkFake = (sub) => ({ signedIn: true, user: { id: 'probe-' + sub, fullname: PFX + ' ' + stamp, email: sub + '@probe.invalid', role: 'PLAYER' }, mint: () => L.mintJwt({ iss: tmpl.iss, aud: tmpl.aud, sub, tenant: tmpl.tenant, name: PFX + ' ' + stamp, lang: 'en', iat: L.now(), exp: L.now() + 120, jti: crypto.randomUUID() }) });
    const throwaways = [];
    const makeAcct = async (sub) => { const r = await se('adapter/sso', { jwt: mkFake(sub).mint() }); if (!r.json || !r.json.token) throw new Error('throwaway ' + r.status + ' ' + r.text.slice(0, 120)); throwaways.push({ sub, ...r.json }); return r.json; };
    clean.push(async () => {
      for (const a of throwaways) {
        const u = sql(`select "isDeleted" from "user" where id='${a.userId}'`);
        if (u === 't') { V.cleanup['throwaway ' + a.userId] = 'already deleted'; continue; }
        const tok = (await se('adapter/sso', { jwt: mkFake(a.sub).mint() })).json;   // a fresh credential (the old one may be revoked)
        const d = await se('adapter/account/delete', {}, tok && tok.token);
        let st = d.status + ' ' + d.text.slice(0, 80);
        if (d.status === 403 && V.engine && V.engine.accountRest) sql(`insert into gb_account_deletion ("userId", "purgeAt", how) values ('${a.userId}', now() - interval '1 second', 'probe cleanup') on conflict ("userId") do update set "purgeAt" = excluded."purgeAt"`);
        if ((d.json && d.json.scheduled) || (d.status === 403 && V.engine && V.engine.accountRest)) {   // ACCOUNT-GRACE-V1: fast-forward OUR fixture and let the sweep purge it
          sql(`update gb_account_deletion set "purgeAt" = now() - interval '1 second' where "userId"='${a.userId}'`);
          for (let k = 0; k < 24 && sql(`select "isDeleted" from "user" where id='${a.userId}'`) !== 't'; k++) await sleep(5000);
          st += ' → purged ' + sql(`select "isDeleted" from "user" where id='${a.userId}'`);
        }
        V.cleanup['throwaway ' + a.userId] = st;
      }
    });
    await step(rT2, async () => {
      const sub = 'ar-' + stamp + '-t';
      const a = await makeAcct(sub);
      chk(rT2, sql(`select count(*) from gb_terms_acceptance where "userId"='${a.userId}'`) === '0', 'fixture: a brand-new account with no accepted terms (se_sbx)', null);
      const fake = mkFake(sub);
      const P = await newPage({ fake });
      await visit(P.page, '/pages/home/index', 4000);
      let t = await text(P.page); await shot(P.page, 'terms-gate');
      chk(rT2, has(t, 'We value your privacy'), 'a signed-in account without accepted terms gets the consent gate', t.slice(0, 200));
      V.fixtures.promptOverGate = has(t, 'No more boundaries');   // FINDING: Home's location prompt opens ON TOP of the consent gate
      await dismissPrompts(P.page);
      await sleep(900);
      await click(P.page, 'Sign out', { sel: '#cg-gate *' });
      t = await text(P.page);
      if (has(t, 'Sign out without accepting')) { await sleep(900); await click(P.page, 'Sign out', { sel: '#cg-gate *' }); }
      await sleep(2000);
      const gone = !(await P.page.$('#cg-gate'));
      chk(rT2, fake.signouts >= 1 && gone, 'Sign out from the gate signs out (hkpl sign-out called) and the gate closes', { signouts: fake.signouts, gateGone: gone, url: P.page.url() });
      const tok = await P.page.evaluate(() => { try { return Object.keys(localStorage).filter((k) => /social/i.test(k)).map((k) => k + '=' + (localStorage.getItem(k) || '').length); } catch (e) { return []; } });
      V.fixtures.termsAfterSignout = tok;
      await P.ctx.close();
    });
    await step(rL5, async () => {
      // A suspension made in SQL stays in the engine's user cache after it is lifted, so the account could not be deleted
      // through the door (2026-09-24 run 2: one throwaway left). With ACCOUNT-GRACE-V1 running, the cleanup purges it through
      // the grace table + the minute sweep (DeleteAccountService does not ask about suspension). Without it: not run.
      if (!ENGINE_AR) { notRun(rL5, 'needs the ACCOUNT-GRACE-V1 sweep to clean a suspended throwaway; measured once on 2026-09-24 (preview-run2.verdict.json): adapter/sso 200 + every call 403 YOUR_ACCOUNT_SUSPENDED, the app shows Home signed in with no message'); return; }
      const sub = 'ar-' + stamp + '-s';
      const a = await makeAcct(sub);
      sql(`update "user" set "isSuspended" = true where id='${a.userId}'`);
      chk(rL5, sql(`select "isSuspended" from "user" where id='${a.userId}'`) === 't', 'fixture: the throwaway engine account is suspended (se_sbx read-back)', null);
      const again = await se('adapter/sso', { jwt: mkFake(sub).mint() });
      const call = again.json && again.json.token ? await se('i', {}, again.json.token) : null;
      V.fixtures.suspendedSignIn = { sso: again.status + ' ' + again.text.slice(0, 160), i: call && (call.status + ' ' + call.text.slice(0, 160)) };
      const P = await newPage({ fake: mkFake(sub) });
      const t = await visit(P.page, '/pages/home/index', 4000); await shot(P.page, 'suspended-home');
      const said = /blocked|suspended/i.test(t);
      V.fixtures.suspendedScreen = t.slice(0, 400);
      chk(rL5, said, 'a suspended account signing in is TOLD it is blocked / suspended', { sso: V.fixtures.suspendedSignIn, sawWords: said });
      rL5.note = 'Sign-in itself belongs to gripbat-accounts; finding handed over in /root/gen/l6-scope/lane-notes/account-rest.md';
      sql(`update "user" set "isSuspended" = false where id='${a.userId}'`);   // so the finally can delete it through the door
      await P.ctx.close();
    });

    // ================================================================= ENGINE ACCOUNT-REST rows
    const eng = ['E-delete-account.03', 'E-marked-deletion.01', 'E-maintenance.01', 'E-notif-settings.04', 'E-notif-settings.06', 'D-statistics.06', 'D-match-summary.02', 'RATINGS-LIVE-V1 (ratingsOf vs liveLog)', 'D-dupr-confirm-submit.01', 'D-dupr-confirm-submit.02'].map((id) => row(id, 'L6'));
    if (!ENGINE_AR) { for (const r of eng) notRun(r, 'engine ACCOUNT-REST not running on UAT (rev ' + rev + '): its doors adapter/account/deletion + gb/status are absent'); }
    else {
      const [rG, rMk, rMt, rS4, rS6, rCm, rMs, rRt, rB1, rB2] = eng;
      // --- deletion grace: request (typed DELETE, real click) → closed + pending → sign in → gate → Restore
      await step(rG, async () => {
        const sub = 'ar-' + stamp + '-d';
        const a = await makeAcct(sub);
        const fake = mkFake(sub);
        const P = await newPage({ fake, hideConsent: true });
        await visit(P.page, '/pages/social-settings/index', 4000);
        await click(P.page, 'Delete account');
        const box = await P.page.$('.ss-danger input'); await box.type('DELETE'); await sleep(400);
        P.page.__api = [];
        await click(P.page, 'Yes, delete', { sel: '.ss-danger *', wait: 3500 });
        const t = await text(P.page);
        const row0 = sql(`select to_char("purgeAt" - "requestedAt", 'DD HH24') ||'|'|| (select "isExplorable"::text from "user" where id='${a.userId}') ||'|'|| (select count(*) from access_token where "userId"='${a.userId}') from gb_account_deletion where "userId"='${a.userId}'`);
        chk(rG, !!row0 && row0.startsWith('07 00|false|0'), 'the request schedules the deletion 7 days out, hides the account and revokes its credentials (se_sbx)', { row: row0, api: P.page.__api.filter((x) => x.includes('account/delete')) });
        chk(rG, (await se('i', {}, a.token)).status === 401, 'the old credential no longer works (signed out everywhere)', null);
        chk(rG, sql(`select "isDeleted" from "user" where id='${a.userId}'`) === 'f', 'nothing is purged yet (grace)', null);
        await P.ctx.close();
        // sign in again inside the grace → the gate → Restore
        fake.signedIn = true;
        const Q = await newPage({ fake, hideConsent: true });
        const g = await visit(Q.page, '/pages/home/index', 4500); await shot(Q.page, 'marked-for-deletion');
        chk(rMk, has(g, 'This account is marked for deletion') && has(g, 'Restore my account'), 'signing in within the grace opens "This account is marked for deletion" + Restore', g.slice(0, 240));
        Q.page.__api = [];
        await sleep(800);
        await click(Q.page, 'Restore my account', { wait: 2500 });
        chk(rMk, sql(`select count(*) from gb_account_deletion where "userId"='${a.userId}'`) === '0' && sql(`select "isExplorable" from "user" where id='${a.userId}'`) === 't', 'Restore removes the pending deletion and brings the account back to search (se_sbx)', Q.page.__api.filter((x) => x.includes('account/')));
        await Q.ctx.close();
        // purge by the sweep: schedule again, fast-forward, wait for the minute job
        const tok = (await se('adapter/sso', { jwt: fake.mint() })).json.token;
        await se('adapter/account/delete', {}, tok);
        sql(`update gb_account_deletion set "purgeAt" = now() - interval '1 second' where "userId"='${a.userId}'`);
        let del = 'f'; for (let k = 0; k < 30 && del !== 't'; k++) { await sleep(5000); del = sql(`select "isDeleted" from "user" where id='${a.userId}'`); }
        chk(rG, del === 't' && sql(`select count(*) from gb_account_deletion where "userId"='${a.userId}'`) === '0', 'when the grace has run out the minute sweep purges the account (DeleteAccountService, isDeleted true)', { isDeleted: del });
      });
      // --- maintenance gate: staff switch on → every page gated → off → Try again lets the app back
      await step(rMt, async () => {
        const adm = await L.signIn('admin');
        const refused = await se('gb/maintenance', { on: true }, t2.token);
        chk(rMt, refused.status === 403, 'a non-staff account is refused (403 NOT_GRIPBAT_STAFF)', refused.status + ' ' + refused.text.slice(0, 80));
        const until = new Date(Date.now() + 2 * 3600e3).toISOString();
        const on = await se('gb/maintenance', { on: true, until, message: null }, adm.token);
        clean.push(async () => { V.cleanup.maintenanceOff = (await se('gb/maintenance', { on: false }, adm.token)).status; V.cleanup.maintenanceRead = (await se('gb/status', {})).text; });
        chk(rMt, on.status === 200 && (await se('gb/status', {})).json.maintenance.on === true, 'staff switch it on (gb/status reads on)', on.status);
        const P = await newPage({ hideConsent: true });
        const t = await visit(P.page, '/pages/home/index', 3500); await shot(P.page, 'maintenance-gate');
        chk(rMt, has(t, 'GripBat is under maintenance') && has(t, 'Back in about 2 hours'), 'the app shows the maintenance gate with "back in about 2 hours"', t.slice(0, 200));
        await se('gb/maintenance', { on: false }, adm.token);
        await click(P.page, 'Try again', { wait: 3000 });
        chk(rMt, !(await P.page.$('#ag-maint')), 'switched off → Try again lets the app back in', null);
        await P.ctx.close();
      });
      // --- Social + promoted switches: drawn, written, read back, restored
      await step(rS4, async () => {
        const before = (await se('chat/notification-prefs/show', {}, t2.token)).json; V.restores.prefs0 = before;
        const P = await newPage({ persona: 1, hideConsent: true });
        const t = await visit(P.page, '/pages/social-settings/index');
        chk(rS4, has(t, 'Social (kudos, feedback, awards)'), 'Settings › Notifications has the Social switch', null);
        chk(rS6, has(t, 'Promoted community meets') && has(t, 'Promoted club meets'), 'two promoted switches: community / club', null);
        for (const [label, key, r] of [['Social (kudos, feedback, awards)', 'social', rS4], ['Promoted club meets', 'promotedClub', rS6]]) {
          await P.page.evaluate((label) => { const lab = Array.from(document.querySelectorAll('.np-opt')).find((x) => (x.innerText || '').trim().startsWith(label)); const sw = lab && lab.querySelector('[role=switch], [class*=switch]'); if (sw) sw.setAttribute('data-arc', 'np'); }, label);
          await P.page.click('[data-arc="np"]'); await sleep(1500);
          const mid = (await se('chat/notification-prefs/show', {}, t2.token)).json;
          chk(r, mid[key] === !before[key], label + ' switch writes the engine (read back ' + key + '=' + mid[key] + ')', null);
          await P.page.evaluate(() => document.querySelectorAll('[data-arc="np"]').forEach((x) => x.removeAttribute('data-arc')));
          const back = await se('chat/notification-prefs/update', { key, on: !!before[key] }, t2.token);
          V.restores['pref ' + key] = back.status + ' → ' + (await se('chat/notification-prefs/show', {}, t2.token)).json[key];
        }
        await P.ctx.close();
      });
      // --- community matches
      await step(rCm, async () => {
        const api = await se('stats/matches', { scope: 'community', limit: 5 }, t2.token);
        chk(rCm, api.status === 200 && Array.isArray(api.json) && api.json.every((m) => m.community === true), 'stats/matches {scope:community} answers community rows', (api.json || []).slice(0, 2).map((m) => m.contextName));
        const P = await newPage({ persona: 1, hideConsent: true });
        await visit(P.page, '/pages/history/index?pane=matches');
        await click(P.page, 'Community matches', { exact: true });
        const t = await text(P.page); await shot(P.page, 'community-matches');
        chk(rCm, (api.json || []).length ? has(t, String(api.json[0].contextName || '')) : has(t, 'No community matches yet'), 'My history › Matches › Community matches lists them', t.slice(0, 200));
        await P.ctx.close();
      });
      // --- competition recap carries its DUPR receipt (read door; a fixture row is only READ)
      await step(rMs, async () => {
        const cm = sql(`select cm.id from competition_match cm join competition c on c.id=cm."competitionId" where cm."duprStatus" is not null and c.status<>'cancelled' and c.visibility='public' limit 1`);
        if (!cm) { notRun(rMs, 'no competition match with a DUPR status on UAT to read'); return; }
        const s = await se('stats/match-summary', { source: 'competition', matchId: cm }, t2.token);
        chk(rMs, s.json && s.json.dupr && s.json.dupr.status, 'stats/match-summary of a competition match returns its DUPR status', s.json && s.json.dupr);
      });
      // --- rating chips follow the live log: a deleted match stops counting at once
      await step(rRt, async () => {
        // SEC-RATING-VIEW-V1 (sec-chemistry, stacked under this branch): a chip is the VIEWER's view (logVisible), so the count is
        // compared for the player's OWN chip, where the visible rows are exactly the live rows
        const before = (await se('stats/gb-ratings', { userIds: [t2.id] }, t2.token)).json || [];
        const live = sql(`select "userId"||':'||count(*) from gb_rating_log l where "userId" in ('${t2.id}') and not skipped and (l.source='openplay' or (l.source='meet' and exists (select 1 from meet_match x join meet m on m.id=x."meetId" where x.id=l."matchId" and m.status<>'cancelled')) or (l.source='competition' and exists (select 1 from competition_match x join competition c on c.id=x."competitionId" where x.id=l."matchId" and c.status<>'cancelled'))) group by 1`);
        V.fixtures.ratingLive = live; V.fixtures.ratingChip = before;
        const want = Object.fromEntries(live.split('\n').filter(Boolean).map((x) => { const [u, n] = x.split(':'); return [u, Number(n)]; }));
        chk(rRt, before.length === 1 && before.every((b) => want[b.userId] === b.matches), 'each chip\'s match count equals the live log count', { chip: before.map((b) => [b.userId, b.matches]), live: want });
        // plant an orphan: a rating row whose match does not exist — the chip must not count it
        sql(`insert into gb_rating_log (source, "matchId", "userId", sport, side, pre, post, "teamRating", "oppRating", expected, won, games, "playedAt") values ('meet', 'arprobe${stamp}', '${t2.id}', 'pickleball', 1, 3, 9, 3, 3, 0.5, true, '[]', now())`);
        clean.push(async () => { V.cleanup.orphanPlant = sql(`delete from gb_rating_log where "matchId"='arprobe${stamp}' returning 1`) || 'none'; });
        const after = ((await se('stats/gb-ratings', { userIds: [t2.id] }, t2.token)).json || [])[0];
        const b2 = before.find((b) => b.userId === t2.id);
        chk(rRt, after && b2 && after.matches === b2.matches && after.rating === b2.rating, 'a planted orphan row (match gone, post 9.0) moves neither the count nor the rating', { before: b2, after });
      });
      for (const r of [rB1, rB2]) notRun(r, 'flag W2_S_DUPR_BASIS stays OFF until the hkpl submit door is shipped (staged /root/hkpl-wt-account-rest); UI proven separately with the flag on in the preview');
    }
    }   // !PLANT
  } catch (e) {
    V.errors.push('FATAL ' + (e && e.stack || e));
  } finally {
    for (const f of clean.slice().reverse()) { try { await f(); } catch (e) { V.errors.push('cleanup: ' + e.message); } }
    try { if (browser) await browser.close(); } catch (e) { /* */ }
  }
  // ---------------------------------------------------------------- verdict
  try { V.probecount = execSync('bash /root/gen/probecount.sh se_sbx').toString(); } catch (e) { V.probecount = 'probecount failed: ' + e.message; }
  const leftover = sql(`select count(*) from meet where name like '${PFX}%' and status <> 'cancelled'`);
  V.cleanup.liveProbeMeets = leftover;
  const counted = V.rows.filter((r) => r.verdict !== 'not_run');
  V.condition_fired = counted.length > 0 && counted.every((r) => r.checks.length > 0);
  const fails = V.rows.filter((r) => r.verdict === 'fail').map((r) => r.id);
  const notRunIds = V.rows.filter((r) => r.verdict === 'not_run').map((r) => r.id);
  if (PLANT) V.verdict = V.condition_fired ? (fails.length ? 'pass' : 'fail') : 'no_verdict';   // the plant must be CAUGHT
  else V.verdict = !V.condition_fired ? 'no_verdict' : fails.length ? 'fail' : notRunIds.length ? 'no_verdict' : 'pass';
  if (leftover !== '0') { V.verdict = 'fail'; V.errors.push('cleanup left ' + leftover + ' live [probe] meets'); }
  V.summary = { rows: V.rows.length, pass: V.rows.filter((r) => r.verdict === 'pass').length, fail: fails, not_run: notRunIds };
  V.evidence = V.rows.map((r) => r.verdict.toUpperCase() + ' ' + r.id + ' [' + r.level + '] ' + r.checks.map((c) => (c.pass ? 'OK ' : 'NO ') + c.text).join(' | ') + (r.note ? ' — ' + r.note : ''));
  fs.writeFileSync(OUT, JSON.stringify(V, null, 1));
  console.log(V.evidence.join('\n')); console.log('errors:', V.errors.length, JSON.stringify(V.errors.slice(0, 8))); console.log('VERDICT', V.verdict, OUT);
  process.exit(V.verdict === 'pass' ? 0 : V.verdict === 'fail' ? 1 : 3);
})();

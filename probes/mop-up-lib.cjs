// mop-up probe helpers (lane mop-up, 2026-09-24). REUSED: /root/gen/meets-fixes/mf-lib.cjs (clickText, waitText, shot,
// engine call with 429 wait) + probes/_native-session.cjs (GRIPBAT-ACCOUNTS-V1: personas sign in NATIVELY; the browser
// gets the engine token in localStorage.boyau_social_token, the key lib/config.ts:32 SOCIAL_TOKEN_KEY reads).
'use strict';
const fs = require('fs');
const MF = require('/root/gen/meets-fixes/mf-lib.cjs');
const { getNativeToken } = require('/root/social-engine/probes/_native-session.cjs');
const APPHOST = 'https://uat.gripbat.com';
const APP = APPHOST + '/app/pages/';
const SHOTS = process.env.MU_SHOTS || '/root/social-engine/probes/mop-up-shots';
fs.mkdirSync(SHOTS, { recursive: true });
const sleep = MF.sleep;
const se = MF.se;   // (endpoint, body, token) -> { status, json, text }; waits out 429s

const pcache = {};
/** persona key ('player-amy' | 'host-ken' | 'clubowner-mei' | 'clubadmin-tom' | 'admin' | 'tester1' | 'tester2') -> { token, userId, username } */
async function who(k) { if (!pcache[k]) pcache[k] = await getNativeToken(k); return pcache[k]; }

async function browser() { return MF.browser(); }
/** A fresh browser context signed in as persona k (or anonymous when k is null), at `width` px. */
async function newCtx(b, k, width = 390, height = 844) {
  const s = k ? await who(k) : null;
  const ctx = await b.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  page.__req = []; page.__resp = []; page.__errors = []; page.__failed = [];
  page.on('request', (r) => { const u = r.url(); if (u.includes('/api/') && r.method() === 'POST') page.__req.push({ at: Date.now(), url: u.replace(/^https:\/\/[^/]+/, ''), body: (r.postData() || '').replace(/"i":"[^"]+"/, '"i":"…"').slice(0, 6000) }); });
  page.on('response', (r) => { const u = r.url(); if (u.includes('/api/')) { page.__resp.push({ at: Date.now(), url: u.replace(/^https:\/\/[^/]+/, ''), status: r.status() }); if (r.status() >= 400) page.__failed.push(u.replace(/^https:\/\/[^/]+/, '') + ' ' + r.status()); } });
  page.on('requestfailed', (r) => { const f = r.failure(); if (!/ERR_ABORTED/.test((f && f.errorText) || '')) page.__failed.push(r.url().replace(/^https:\/\/[^/]+/, '') + ' ' + ((f && f.errorText) || 'failed')); });
  page.on('pageerror', (e) => page.__errors.push(String(e).slice(0, 300)));
  if (s) {
    // plant the session the way the app keeps it (Taro H5 storage wraps the value as {"data": …})
    await page.goto(APPHOST + '/app/', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => undefined);
    await page.evaluate((t) => { localStorage.setItem('boyau_social_token', JSON.stringify({ data: t })); localStorage.setItem('hkpl_lang_ok', JSON.stringify({ data: '1' })); }, s.token);
  }
  return { ctx, page, s };
}
async function open(page, route, lang = 'en') { page.__req = []; page.__resp = []; page.__failed = []; await page.goto(APP + route + (route.includes('?') ? '&' : '?') + 'lang=' + lang, { waitUntil: 'networkidle2', timeout: 60000 }).catch(() => undefined); await sleep(1500); }
async function shot(page, key) { await sleep(400); await page.screenshot({ path: SHOTS + '/' + key + '.png' }); return 'probes/' + SHOTS.split('/probes/')[1] + '/' + key + '.png'; }
/** Touch-drag from (x, y0) down by dy px (CDP touch events, as a thumb does). */
async function pullDown(page, dy = 160, x = 195, y0 = 200) {
  const c = await page.target().createCDPSession();
  await c.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0 }] });
  for (let i = 1; i <= 8; i++) { await c.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y0 + (dy * i) / 8 }] }); await sleep(25); }
  await c.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await c.detach().catch(() => undefined);
}
/** Elements whose right edge passes the viewport (G5) — [{ text, right }]. */
async function overflowRight(page, sel = '*') {
  return page.evaluate((sel) => { const W = window.innerWidth; return Array.from(document.querySelectorAll(sel)).filter((e) => { const r = e.getBoundingClientRect(); const t = (e.innerText || '').trim(); return r.width > 0 && r.height > 0 && r.right > W + 1 && t && e.children.length === 0; }).map((e) => ({ text: e.innerText.trim().slice(0, 40), right: Math.round(e.getBoundingClientRect().right) })).slice(0, 20); }, sel);
}
/** WCAG contrast ratio of an element's text against its (first opaque ancestor's) background. */
async function contrastOf(page, handleSel) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel); if (!el) return null;
    const rgb = (s) => (s.match(/[\d.]+/g) || []).map(Number);
    const lum = (c) => { const a = c.slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2]; };
    const fg = rgb(getComputedStyle(el).color); let n = el, bg = null;
    while (n && n.nodeType === 1) { const c = rgb(getComputedStyle(n).backgroundColor); if (c.length >= 3 && (c.length < 4 || c[3] > 0.5)) { bg = c; break; } n = n.parentElement; }
    bg = bg || [255, 255, 255];
    const L1 = lum(fg), L2 = lum(bg); const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    return { fg: getComputedStyle(el).color, bg: 'rgb(' + bg.slice(0, 3).join(',') + ')', ratio: Math.round(ratio * 100) / 100, text: (el.innerText || '').trim().slice(0, 40) };
  }, handleSel);
}
module.exports = { APPHOST, APP, SHOTS, sleep, se, who, browser, newCtx, open, shot, pullDown, overflowRight, contrastOf, text: MF.text, waitText: MF.waitText, clickText: MF.clickText, chipsOn: MF.chipsOn };

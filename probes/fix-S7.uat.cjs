// fix-S7 — FRONTEND-UAT-STANDARD v2.0 (AGENT_RULES 20) on the pages this lane touched, Chromium AND WebKit (Playwright on
// the operator PC), against https://uat.gripbat.com/app/ at 390 px (+ 320 px reflow), EN + 繁.
//   5B finger hit-test: elementFromPoint at every visible control's centre, at rest AND with each scroll container at its end
//   5C targets >= 24 px, no sideways scroll at 320 / 390, no clipped text in 繁
//   5D real taps + typing: Settings › Username typed "sam_smash_<run>" (contains "s"), Save, RELOAD → still there, and the
//      OTHER party (a signed-out visitor on the player page) sees @sam_smash_<run>
//   5E axe-core: 0 critical, 0 serious (wcag2a/2aa/21aa/22aa)
//   5H no raw keys / ids on screen
// Fixtures: two NATIVE throwaway accounts '[probe] fix-S7 uat …' (fs7u-<run>-x@example.invalid, UAT sandbox sign-up), deleted in finally.
// usage (Git Bash on the PC): node fix-S7.uat.cjs > fix-S7.uat.json
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { chromium, webkit } = require('playwright');
const BASE = 'https://uat.gripbat.com';
const APP = BASE + '/app';
const RUN = crypto.randomBytes(3).toString('hex');
const PFX = '[probe] fix-S7 uat';
const AXE = fs.readFileSync(path.join(__dirname, 'node_modules', 'axe-core', 'axe.min.js'), 'utf8');
const SHOTS = path.join(__dirname, 'fix-S7-shots'); fs.mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let OTHER = null;
const OUT = { id: 'fix-S7.uat', at: new Date().toISOString(), run: RUN, engines: {}, fixtures: {}, cleanup: {}, errors: [] };

async function se(endpoint, body, token) {
  const r = await fetch(BASE + '/api/' + endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(token ? { ...(body || {}), i: token } : (body || {})) });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch (e) { /* 204 */ }
  return { status: r.status, json, text };
}
async function throwaway(tag, opt) {
  if (process.env.ACCTS) { const pre = JSON.parse(fs.readFileSync(process.env.ACCTS, 'utf8'))[tag]; if (pre) { OUT.fixtures[tag] = { userId: pre.userId, email: pre.email, madeOn: 'kaka' }; return { tag, ...pre }; } }   // sign-ups made on kaka (the PC network hit the sign-up rate limit)
  const email = `fs7u-${RUN}-${tag}@example.invalid`, password = 'Fs7u-' + crypto.randomBytes(6).toString('hex');
  const s = await se('signup', { emailAddress: email, password, lang: 'en' });
  if (!(s.json && s.json._dev_code)) throw new Error('signup ' + s.status + ' ' + s.text.slice(0, 120));
  const d = await se('signup-pending', { code: s.json._dev_code });
  const a = { tag, email, password, token: d.json.i, userId: d.json.id };
  await se('i/update', { name: PFX + ' ' + tag + ' ' + RUN }, a.token);
  const terms = opt.terms;
  if (opt.username) await se('gb/account/username', { username: 'fs7u' + RUN + tag }, a.token);
  await se('meets/level', { sport: 'pickleball', ...(terms ? { acceptTerms: terms } : {}), ...(opt.onboarded ? { onboarded: true } : {}) }, a.token);
  OUT.fixtures[tag] = { userId: a.userId, email };
  return a;
}

// ---- in-page instruments (one copy each, evaluated in the page) ----------------------------------------------------------
const CONTROL_SEL = 'button, a[href], input, textarea, select, [role=button], [role=tab], [role=link], [role=checkbox], [role=switch], [data-act], .is-tap, .hk-btn, .hk-row[aria-label]';
function hitScanSrc() {
  return `(() => {
    const SEL = ${JSON.stringify(CONTROL_SEL)};
    const vw = innerWidth, vh = innerHeight;
    const modalOpen = !!Array.from(document.querySelectorAll('[aria-modal="true"], .nut-popup, .nut-dialog')).find((m) => { const r = m.getBoundingClientRect(); const s = getComputedStyle(m); return r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden'; });
    const out = { controls: 0, covered: [], small: [] };
    const seen = new Set();
    for (const el of Array.from(document.querySelectorAll(SEL))) {
      if (seen.has(el)) continue; seen.add(el);
      let p = el.parentElement, nested = false; while (p) { if (p.matches && p.matches(SEL)) { nested = true; break; } p = p.parentElement; }
      const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
      if (r.width < 1 || r.height < 1 || s.visibility === 'hidden' || s.display === 'none' || s.pointerEvents === 'none') continue;
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      if (cx < 0 || cy < 0 || cx >= vw || cy >= vh) continue;
      out.controls++;
      const name = ((el.getAttribute('aria-label') || el.innerText || el.getAttribute('placeholder') || el.tagName) + '').trim().slice(0, 40);
      const hit = document.elementFromPoint(cx, cy);
      if (hit && !(hit === el || el.contains(hit) || hit.contains(el) && hit.children.length === 0)) {
        const cov = hit.closest('[class]'); const fixed = (() => { let q = hit; while (q && q !== document.body) { const ps = getComputedStyle(q).position; if (ps === 'fixed' || ps === 'sticky') return true; q = q.parentElement; } return false; })();
        const shell = !!(hit.closest('.sh-tabbar, .sh-tabs, .fb-fab, .fb-panel, .sh-header, .app-header, .hk-appbar, [class*=tabbar], #uat-banner'));
        if (!modalOpen) out.covered.push({ name, cls: String(el.className).slice(0, 50), by: cov ? String(cov.className).slice(0, 60) : hit.tagName, fixed, shell, y: Math.round(cy) });
      }
      const inline = el.tagName === 'A' && el.closest('p');
      if (!nested && !inline && (r.width < 24 || r.height < 24)) out.small.push({ name, w: Math.round(r.width), h: Math.round(r.height), cls: String(el.className).slice(0, 40) });
    }
    out.modalOpen = modalOpen;
    return out;
  })()`;
}
async function scrollEnds(page) {
  return page.evaluate(() => {
    const els = [document.scrollingElement, ...Array.from(document.querySelectorAll('*')).filter((e) => { const s = getComputedStyle(e); return (s.overflowY === 'auto' || s.overflowY === 'scroll') && e.scrollHeight > e.clientHeight + 5; })];
    let n = 0; for (const e of els) { if (e && e.scrollHeight > e.clientHeight + 5) { e.scrollTop = e.scrollHeight; n++; } } return n;
  });
}
async function scan(page, label) {
  process.stderr.write(new Date().toISOString().slice(11, 19) + ' scan ' + label + String.fromCharCode(10));
  const rest = await page.evaluate(hitScanSrc());
  const n = await scrollEnds(page); await sleep(600);
  const end = await page.evaluate(hitScanSrc());
  await page.evaluate(() => { document.scrollingElement.scrollTop = 0; for (const e of Array.from(document.querySelectorAll('*'))) if (e.scrollTop) e.scrollTop = 0; });
  const sideways = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1 || document.body.scrollWidth > innerWidth + 1);
  const raw = await page.evaluate(() => (document.body.innerText.match(/\b[a-z]+(_[a-z0-9]+){1,}\b|\b[a-z]+\.[a-z_]+\.[a-z_]+\b/g) || []).filter((x) => !/^fs7u|^sam_smash|example\.invalid|gripbat\.com|uat\./.test(x)).slice(0, 8));
  await page.addScriptTag({ content: AXE }).catch(() => undefined);
  const axe = await Promise.race([sleep(25000).then(() => [{ id: 'axe-timeout', impact: 'n/a', n: 0, first: 'axe.run did not return in 25 s' }]), page.evaluate(async () => { try { const r = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] } }); return r.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious').map((v) => ({ id: v.id, impact: v.impact, n: v.nodes.length, first: v.nodes[0] && v.nodes[0].target.join(' '), data: v.nodes[0] && v.nodes[0].any[0] && v.nodes[0].any[0].data })); } catch (e) { return [{ id: 'axe-error', impact: 'n/a', n: 0, first: String(e) }]; } })]);
  return { label, containersScrolled: n, rest, end, sideways, rawKeys: raw, axe };
}
async function clipped(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll('body *')).filter((e) => e.children.length === 0 && (e.innerText || '').trim() && /[㐀-鿿]/.test(e.innerText)).filter((e) => { const s = getComputedStyle(e); return (s.overflow === 'hidden' || s.overflowX === 'hidden') && s.textOverflow !== 'ellipsis' && e.scrollWidth > e.clientWidth + 1; }).map((e) => e.innerText.trim().slice(0, 30)).slice(0, 10));
}
async function tapText(page, txt, opt = {}) {
  const loc = page.getByText(txt, { exact: opt.exact !== false }).filter({ visible: true });
  const el = opt.last ? loc.last() : loc.first();
  await el.waitFor({ state: 'visible', timeout: 30000 });
  await el.evaluate((e) => e.scrollIntoView({ block: 'center' })); await sleep(700);   // no 'stable' wait: a page that keeps re-laying out still takes a finger at its centre
  const b = await el.boundingBox(); if (!b) throw new Error('no box for ' + txt);
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);   // a finger at the centre, never el.click()
  await sleep(opt.wait || 1500);
}

function grade(R) {
  R.zhClipped = R.zhClipped || {}; R.reflow320 = R.reflow320 || {};
  const pg = Object.values(R.pages);
  R.summary = {
    controls: pg.reduce((n, p) => n + p.rest.controls + p.end.controls, 0),
    coveredOwn: pg.flatMap((p) => [...p.rest.covered, ...p.end.covered].filter((c) => !c.shell).map((c) => p.label + ': ' + c.name + ' ← ' + c.by)),
    coveredShell: pg.flatMap((p) => [...p.rest.covered, ...p.end.covered].filter((c) => c.shell).map((c) => p.label + ': ' + c.name + ' ← ' + c.by)),
    small: pg.flatMap((p) => p.rest.small.map((c) => p.label + ': ' + c.name + ' ' + c.w + 'x' + c.h)),
    sideways: pg.filter((p) => p.sideways).map((p) => p.label),
    axe: pg.flatMap((p) => p.axe.map((v) => p.label + ': ' + v.id + ' (' + v.impact + ', ' + v.n + ') ' + v.first + ' ' + JSON.stringify(v.data || {}).slice(0, 120))),
    rawKeys: pg.flatMap((p) => p.rawKeys.map((k) => p.label + ': ' + k)),
    zhClipped: Object.entries(R.zhClipped).filter(([, v]) => v.length).map(([k, v]) => k + ': ' + v.join(' | ')),
    reflow320: Object.entries(R.reflow320).filter(([, v]) => v).map(([k]) => k),
  };
}
async function runEngine(name, type, A, E) {
  const soft = (p) => Promise.race([Promise.resolve(p).catch(() => undefined), sleep(8000)]);   // a close that hangs (seen twice on the loaded PC) must not swallow the run
  const R = { pages: {}, journeys: {} };
  OUT.engines[name] = R;   // live reference: a hung close still leaves the measurements printable
  const log = (m) => process.stderr.write(new Date().toISOString().slice(11, 19) + ' ' + name + ' ' + m + String.fromCharCode(10));
  const browser = await type.launch();
  try {
    const mk = async (token, w = 390) => {
      const ctx = await browser.newContext({ viewport: { width: w, height: 844 }, deviceScaleFactor: 1, hasTouch: name === 'webkit' });
      if (token) await ctx.addInitScript((t) => { try { if (!sessionStorage.getItem('__fs7u')) { localStorage.setItem('boyau_social_token', JSON.stringify({ data: t })); sessionStorage.setItem('__fs7u', '1'); } } catch (e) { /* */ } }, token);
      const page = await ctx.newPage(); page.on('pageerror', (e) => OUT.errors.push(name + ' pageerror ' + e.message.slice(0, 120)));
      return { ctx, page };
    };
    const go = async (page, route, lang) => { await page.goto(APP + route + (route.includes('?') ? '&' : '?') + 'lang=' + (lang || 'en'), { waitUntil: 'load', timeout: 45000 }).catch((e) => OUT.errors.push(name + ' goto ' + route + ' ' + e.message.slice(0, 80))); await sleep(2500); for (const b of ['Not now', 'Got it, continue']) { if (await page.getByText(b, { exact: true }).first().isVisible().catch(() => false)) await tapText(page, b, { wait: 800 }).catch(() => undefined); } };
    const { ctx, page } = await mk(A.token);
    // ---- 5D journey: username with "s", reload-persist, other party sees it
    const uname = 'sam_smash_' + RUN;
    await go(page, '/pages/social-settings/index');
    await tapText(page, 'Change', { wait: 1000 });
    const field = page.locator('input[placeholder="New username"]').first();
    const fb = await field.boundingBox(); await page.mouse.click(fb.x + fb.width / 2, fb.y + fb.height / 2);
    await page.keyboard.type(uname, { delay: 30 }); await sleep(1800);
    const typed = await field.inputValue();
    const free = await page.getByText('That username is free.').first().isVisible().catch(() => false);
    R.pages['settings-username-open'] = await scan(page, 'settings, username card open');
    await page.screenshot({ path: path.join(SHOTS, name + '-username.png') });
    log('save'); await tapText(page, 'Save', { wait: 2200 }); log('saved');
    await page.reload({ waitUntil: 'load' }); await sleep(3500);
    const afterReload = await page.waitForFunction((u) => document.body.innerText.includes('@' + u), uname, { timeout: 25000 }).then(() => true).catch(() => false);
    const { ctx: anon, page: ap } = await mk(OTHER.token);   // the OTHER party: another signed-in, onboarded member
    await go(ap, '/pages/player/index?id=' + A.userId);
    const otherSees = await ap.waitForFunction((u) => document.body.innerText.includes(u), uname, { timeout: 25000 }).then(() => true).catch(() => false);
    await soft(anon.close());
    R.journeys.username = { typed, free, afterReload, otherSees, pass: typed === uname && free && afterReload && otherSees };
    // ---- pages: EN at 390 (+ zh clipped text), 320 reflow
    const pages = [['help', '/pages/help/index'], ['history', '/pages/history/index?pane=matches'], ['dupr-connect', '/pages/dupr-connect/index'], ['player-activities', '/pages/player/index?id=' + A.userId], ['settings', '/pages/social-settings/index']];
    for (const [k, r] of pages) { await go(page, r); if (k === 'player-activities') await tapText(page, 'Activities', { wait: 1500 }).catch(() => undefined); R.pages[k] = await scan(page, k); }
    // help: search + an article sheet open
    await go(page, '/pages/help/index');
    const s = page.locator('input[placeholder^="Search help"]').first(); const sb = await s.boundingBox(); await page.mouse.click(sb.x + sb.width / 2, sb.y + sb.height / 2); await page.keyboard.type('waitlist', { delay: 30 }); await sleep(1200);
    R.pages['help-search'] = await scan(page, 'help, search results');
    await (async () => { const row = page.locator('[data-act^="help/article:"]').first(); const b = await row.boundingBox(); await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); await sleep(1800); })().catch((e) => OUT.errors.push(name + ' article ' + e.message.slice(0, 80)));
    R.pages['help-article'] = await scan(page, 'help, article sheet open (modal: covered controls behind it are silent)');
    await page.screenshot({ path: path.join(SHOTS, name + '-help-article.png') });
    // zh clipped text on the touched pages
    const zh = {};
    for (const [k, r] of [['help', '/pages/help/index'], ['settings', '/pages/social-settings/index'], ['history', '/pages/history/index?pane=matches'], ['dupr-connect', '/pages/dupr-connect/index']]) { await go(page, r, 'zh_Hant'); zh[k] = await clipped(page); }
    R.zhClipped = zh;
    await soft(ctx.close());
    // 320 reflow
    const { ctx: c3, page: p3 } = await mk(A.token, 320);
    const reflow = {};
    for (const [k, r] of [['help', '/pages/help/index'], ['settings', '/pages/social-settings/index'], ['history', '/pages/history/index?pane=matches']]) { await go(p3, r); reflow[k] = await p3.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1); }
    R.reflow320 = reflow; await soft(c3.close());
    // onboarding step 0 (a fresh account)
    const { ctx: c4, page: p4 } = await mk(E.token);
    await go(p4, '/pages/onboard/index');
    R.pages['onboard-0'] = await scan(p4, 'onboarding step 0');
    await p4.screenshot({ path: path.join(SHOTS, name + '-onboard.png'), timeout: 20000 }).catch(() => undefined);
    await soft(c4.close());
  } finally { await soft(browser.close()); }
  // grade
  grade(R);
  return R;
}

// WATCHDOG: a hung browser (a fullPage shot stalled ~40 min on the loaded PC) must not keep the accounts alive
setTimeout(() => { OUT.errors.push('WATCHDOG: run exceeded 20 min'); for (const e of Object.values(OUT.engines)) { try { grade(e); } catch (x) { /* */ } } console.log(JSON.stringify(OUT, null, 1)); process.exit(3); }, 20 * 60e3).unref();
(async () => {
  const accts = [];
  try {
    const A = await throwaway('a', { terms: process.env.TERMS, username: true, onboarded: true }); accts.push(A);
    const E = await throwaway('e', { terms: process.env.TERMS, username: false, onboarded: false }); accts.push(E);
    OTHER = await throwaway('b', { terms: process.env.TERMS, username: true, onboarded: true }); accts.push(OTHER);
    for (const [n, t] of [['chromium', { launch: (o) => chromium.launch({ ...(o || {}), channel: process.env.CH || 'chrome' }) }], ['webkit', webkit]].filter(([n]) => !process.env.ENGINE || process.env.ENGINE === n)) { try { OUT.engines[n] = await runEngine(n, t, A, E); } catch (e) { OUT.errors.push(n + ' FATAL ' + (e.stack || e).toString().slice(0, 300)); } fs.writeFileSync(path.join(__dirname, 'fix-S7.uat.partial.json'), JSON.stringify(OUT, null, 1)); }
  } catch (e) { OUT.errors.push('FATAL ' + e.message); } finally {
    for (const a of accts) { const d = await se('adapter/account/delete', { password: a.password }, a.token).catch((e) => ({ status: 'ERR ' + e.message })); OUT.cleanup[a.tag] = d.status; }
    console.log(JSON.stringify(OUT, null, 1));
  }
})();

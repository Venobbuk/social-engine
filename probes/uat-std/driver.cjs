// UAT-STD engine adapter: the SAME matrix code drives Chromium (puppeteer-core on kaka, a local slot, scrollbars NOT hidden)
// and WebKit (Playwright on the operator PC). Only what differs between the two APIs lives here.
'use strict';

async function launch(engine) {
  if (engine === 'webkit') {
    const pw = require(process.env.PW_PATH || 'D:/tmp/gb-uat-tools/node_modules/playwright');
    const b = await pw.webkit.launch({ headless: true });
    return { engine, b, kind: 'pw' };
  }
  const pp = require(process.env.PPTR_PATH || '/root/hkpl-server/node_modules/puppeteer-core');
  // --hide-scrollbars is a puppeteer DEFAULT in headless mode; it would make every "visible inner scrollbar" read 0 px.
  const b = await pp.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', ignoreDefaultArgs: ['--hide-scrollbars'], args: ['--no-sandbox', '--disable-dev-shm-usage', '--lang=en-US'] });
  return { engine, b, kind: 'pp' };
}

/** A context whose every document starts with `init(arg)` run first (the Taro storage for the persona + language). */
async function context(E, init, arg) {
  if (E.kind === 'pw') {
    const ctx = await E.b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, locale: 'en-US', timezoneId: 'Asia/Hong_Kong' });
    await ctx.addInitScript(init, arg);
    return { ctx, E };
  }
  const ctx = await E.b.createBrowserContext();
  return { ctx, E, init, arg };
}

async function newPage(C) {
  const page = await C.ctx.newPage();
  if (C.E.kind === 'pp') {
    await page.evaluateOnNewDocument(C.init, C.arg);
    await page.emulateTimezone('Asia/Hong_Kong').catch(() => undefined);
  }
  const P = { page, E: C.E, net: [], errors: [], failed: [] };
  page.on('response', (r) => { try { const u = r.url(); if (/\/api\//.test(u)) P.net.push({ u: u.replace(/^https?:\/\/[^/]+/, '').slice(0, 120), s: r.status(), m: r.request().method() }); if (r.status() >= 400 && /^https:\/\/(uat\.gripbat\.com|uat\.social\.silkvo\.com)/.test(u)) P.failed.push(r.status() + ' ' + u.replace(/^https?:\/\/[^/]+/, '').slice(0, 100)); } catch (e) { /* */ } });
  page.on('pageerror', (e) => P.errors.push(String(e && e.message || e).slice(0, 200)));
  return P;
}

async function viewport(P, w, h) {
  const mobile = w < 1024;
  if (P.E.kind === 'pw') return P.page.setViewportSize({ width: w, height: h });
  return P.page.setViewport({ width: w, height: h, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
}
async function goto(P, url) {
  P.net = []; P.errors = []; P.failed = [];
  let status = 0;
  try { const r = await P.page.goto(url, { waitUntil: 'load', timeout: 45000 }); status = r ? r.status() : 0; } catch (e) { return { status: 0, error: String(e.message || e).slice(0, 120) }; }
  return { status };
}
async function content(P, html) { P.net = []; P.errors = []; P.failed = []; await P.page.setContent(html, { waitUntil: 'load' }); }
const ev = (P, fn, arg) => P.page.evaluate(fn, arg);
const evs = (P, src) => P.page.evaluate(src);
async function shot(P, file) { try { await P.page.screenshot({ path: file, type: 'jpeg', quality: 55 }); return file; } catch (e) { return null; } }
async function key(P, k) { return P.page.keyboard.press(k); }
async function tap(P, x, y) { try { if (P.page.touchscreen) { await P.page.touchscreen.tap(x, y); return true; } } catch (e) { /* no touch in this context */ } await P.page.mouse.click(x, y); return true; }
async function close(P) { try { await P.page.close(); } catch (e) { /* */ } }
async function closeCtx(C) { try { await C.ctx.close(); } catch (e) { /* */ } }
function alive(E) { try { return typeof E.b.isConnected === 'function' ? E.b.isConnected() : E.b.connected !== false; } catch (e) { return false; } }
async function end(E) { try { await E.b.close(); } catch (e) { /* */ } }
module.exports = { launch, alive, context, newPage, viewport, goto, content, ev, evs, shot, key, tap, close, closeCtx, end };

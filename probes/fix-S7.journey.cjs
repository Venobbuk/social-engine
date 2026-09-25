// fix-S7 — FRONTEND-UAT-STANDARD 5D journey only: Settings › Username › Change, a real pointer tap on the field (Playwright
// click = a mouse at the element's centre), keyboard typing of a name with "s", Save by a tap, RELOAD → @name on screen,
// and the OTHER party (another signed-in member) sees @name on the player page. Accounts from kaka (ACCTS), deleted after.
// usage: ENGINE=webkit|chromium ACCTS=accts-x.json node fix-S7.journey.cjs
'use strict';
const fs = require('fs');
const { chromium, webkit } = require('playwright');
const APP = 'https://uat.gripbat.com/app';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const acc = JSON.parse(fs.readFileSync(process.env.ACCTS, 'utf8'));
const E = process.env.ENGINE || 'webkit';
const out = { engine: E, at: new Date().toISOString(), steps: {}, errors: [] };
setTimeout(() => { out.errors.push('WATCHDOG 12 min'); console.log(JSON.stringify(out)); process.exit(3); }, 12 * 60e3).unref();
(async () => {
  const b = E === 'webkit' ? await webkit.launch() : await chromium.launch({ channel: 'chrome' });
  const mk = async (tok) => { const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: E === 'webkit' }); await ctx.addInitScript((t) => { try { if (!sessionStorage.getItem('__j')) { localStorage.setItem('boyau_social_token', JSON.stringify({ data: t })); sessionStorage.setItem('__j', '1'); } } catch (e) { /* */ } }, tok); return ctx.newPage(); };
  const uname = 'sam_smash_' + Math.random().toString(36).slice(2, 7);
  try {
    const p = await mk(acc.a.token);
    await p.goto(APP + '/pages/social-settings/index?lang=en', { waitUntil: 'load', timeout: 90000 });
    await p.getByText('Change', { exact: true }).first().waitFor({ state: 'visible', timeout: 60000 });
    await sleep(2500);
    await p.getByText('Change', { exact: true }).first().click({ timeout: 30000, force: true });
    const f = p.locator('input[placeholder="New username"]').first();
    await f.waitFor({ state: 'visible', timeout: 30000 }); await sleep(800);
    await f.click({ timeout: 30000, force: true });   // pointer at the element centre
    await p.keyboard.type(uname, { delay: 40 });
    await p.getByText('That username is free.').first().waitFor({ timeout: 20000 }).catch(() => undefined);
    out.steps.typed = await f.inputValue();
    out.steps.free = await p.getByText('That username is free.').first().isVisible().catch(() => false);
    await p.getByText('Save', { exact: true }).first().click({ timeout: 30000, force: true });
    await p.getByText('@' + uname).first().waitFor({ timeout: 30000 }).catch(() => undefined);
    await p.reload({ waitUntil: 'load', timeout: 90000 });
    out.steps.afterReload = await p.waitForFunction((u) => document.body.innerText.includes('@' + u), uname, { timeout: 60000 }).then(() => true).catch(() => false);
    const q = await mk(acc.b.token);
    await q.goto(APP + '/pages/player/index?id=' + acc.a.userId + '&lang=en', { waitUntil: 'load', timeout: 90000 });
    out.steps.otherSees = await q.waitForFunction((u) => document.body.innerText.includes(u), uname, { timeout: 60000 }).then(() => true).catch(() => false);
    out.steps.uname = uname;
    out.pass = out.steps.typed === uname && out.steps.free && out.steps.afterReload && out.steps.otherSees;
  } catch (e) { out.errors.push(String(e.message || e).slice(0, 200)); out.pass = false; }
  await Promise.race([b.close(), sleep(8000)]);
  const del = async (a) => { const r = await fetch('https://uat.gripbat.com/api/adapter/account/delete', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ i: a.token, password: a.password }) }); return r.status; };
  out.cleanup = { a: await del(acc.a).catch((e) => 'ERR'), b: await del(acc.b).catch(() => 'ERR'), e: await del(acc.e).catch(() => 'ERR') };
  console.log(JSON.stringify(out));
  process.exit(0);
})();

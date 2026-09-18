// feedback-app.probe.cjs — the bug-report round trip FROM AN APP PAGE (FEEDBACK-IN-APP): signed in on UAT, open
// /app/pages/home/index, tap the bug launcher (.fb-fab), type a message, Send → POST /api/v1/feedback 200, the
// widget's done line names GripBat (not the league office), and the admin list (tester1, TENANT_ADMIN) shows the
// row with page_context.route = the home page + tester name. Verdict → probes/feedback-app.verdict.json.
'use strict';
const fs = require('fs');
const puppeteer = require('/root/hkpl-server/node_modules/puppeteer-core');
const BASE = process.env.BASE || 'https://uat.social.silkvo.com';
const { getSession } = require('./_session.cjs');
const evidence = []; let ok = true;
const ev = (pass, s) => { evidence.push((pass ? 'PASS ' : 'FAIL ') + s); if (!pass) ok = false; console.log((pass ? 'PASS ' : 'FAIL ') + s); };
const stamp = 'probe: in-app launcher round trip ' + new Date().toISOString();
(async () => {
  const sess = await getSession(1);
  const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 412, height: 915, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await page.setCookie({ name: sess.name, value: sess.value, domain: new URL(BASE).hostname, path: '/' });
  await page.evaluateOnNewDocument(() => { try { localStorage.setItem('uat:tester', 'Probe Launcher'); localStorage.setItem('hkpl_lang', 'en'); } catch (e) {} });
  const posts = [];
  page.on('response', (r) => { if (/\/api\/v1\/feedback(\?|$)/.test(r.url()) && r.request().method() === 'POST') posts.push(r.status()); });
  await page.goto(BASE + '/app/pages/home/index?lang=en', { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise((r) => setTimeout(r, 1500));
  const fab = await page.$('.sh-widgets-app .fb-fab');
  ev(!!fab, 'bug launcher (.sh-widgets-app .fb-fab) is on the Home page');
  if (fab) {
    const box = await fab.boundingBox();
    ev(box && box.x < 100 && box.y > 700 && box.y < 860, `launcher sits bottom-left, clear of the search FAB — x ${box && box.x.toFixed(0)} y ${box && box.y.toFixed(0)}`);
    await fab.tap();
    await page.waitForSelector('.fb-panel', { timeout: 8000 }).catch(() => null);
    ev(!!(await page.$('.fb-panel')), 'panel opens (Report a problem)');
    await new Promise((r) => setTimeout(r, 2500)); // auto page capture
    const ta = await page.$('.fb-msg textarea, textarea.fb-msg, .fb-msg');
    ev(!!ta, 'message field present');
    if (ta) { await ta.tap(); await page.keyboard.type(stamp, { delay: 5 }); }
    const send = await page.$('.fb-send, .fb-send-t');
    ev(!!send, 'Send report button present');
    if (send) await send.tap();
    await new Promise((r) => setTimeout(r, 1500));
    ev(posts.length > 0 && posts[posts.length - 1] === 200, `POST /api/v1/feedback → ${posts.join(',') || 'none'}`);
    const done = await page.$eval('.fb-done', (e) => e.textContent).catch(() => '');
    ev(/GripBat team/.test(done || ''), `done line names GripBat, not the league office — "${done}"`);
    await new Promise((r) => setTimeout(r, 3000));
    ev(!(await page.$('.fb-panel')), 'panel closes itself after the thanks line (grader r8 #100)');
    await page.screenshot({ path: '/root/walk/_feedback-app-sent.png' });
  }
  await browser.close();
  // admin side: tester1 (TENANT_ADMIN) through the QA door
  const door = await fetch(BASE + '/api/v1/auth/qa/by-email/boyau.tester1@silkvo.com?p=hkpl-uat-2026', { redirect: 'manual' });
  const sid = (door.headers.get('set-cookie') || '').split(';')[0];
  const list = await (await fetch(BASE + '/api/v1/admin/feedback?limit=20', { headers: { cookie: sid } })).json();
  const row = (list.data || []).find((r) => r.message === stamp);
  ev(!!row, `admin list has the row (${(list.data || []).length} rows)`);
  if (row) {
    ev(row.tenant_id === 'boyau-uat', `row is in the GripBat UAT tenant — ${row.tenant_id}`);
    ev(/home/.test(JSON.stringify(row.page_context || {})), `page_context carries the Home route — ${JSON.stringify(row.page_context || {}).slice(0, 160)}`);
    ev((row.page_context || {}).tester_name === 'Probe Launcher', `tester name attached — ${(row.page_context || {}).tester_name}`);
    ev(Array.isArray(row.image_urls) && row.image_urls.length >= 1, `auto page capture attached — ${(row.image_urls || []).length} image(s)`);
  }
  const verdict = { id: 'feedback-app', at: new Date().toISOString(), condition_fired: true, verdict: ok ? 'pass' : 'fail', evidence };
  fs.writeFileSync('/root/social-engine/probes/feedback-app.verdict.json', JSON.stringify(verdict, null, 1));
  console.log(verdict.verdict, evidence.filter((e) => e.startsWith('PASS')).length + '/' + evidence.length);
})().catch((e) => { console.error(e); process.exit(1); });

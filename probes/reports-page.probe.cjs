// REPORTS-PAGE probe (ON kaka, headless Chrome against https://uat.social.silkvo.com): the GripBat Bug reports console
// (src/pages/reports) as tester1 (TENANT_ADMIN on the UAT tenant, signed in through the sandbox QA door):
//   1. the API facts first — whoami is TENANT_ADMIN, GET /api/v1/admin/feedback has >= 1 row (the UAT tenant has rows)
//   2. /app/pages/reports/index renders the list (>= 1 .rp-itemwrap) — until the build is deployed this is the
//      expected failure ("page not found" / no rows)
//   3. tap the first row -> #rp-detail; tap a status chip that differs from the row's current status; tap Save
//   4. GET /api/v1/admin/feedback/:id reflects the new status (then the original status is put back by API)
// Verdict: /root/social-engine/probes/reports-page.verdict.json { id, at, condition_fired, verdict, evidence }.
'use strict';
const fs = require('fs');
const puppeteer = require('/root/hkpl-server/node_modules/puppeteer-core');
const BASE = process.env.BASE || 'https://uat.social.silkvo.com';
const HOST = BASE.replace(/^https?:\/\//, '');
const EMAIL = process.env.EMAIL || 'boyau.tester1@silkvo.com';
const QA_P = process.env.QA_P || 'hkpl-uat-2026';
const OUT = '/root/social-engine/probes/reports-page.verdict.json';
const ev = []; let ok = true;
const check = (label, pass, detail) => { ev.push((pass ? 'PASS ' : 'FAIL ') + label + (detail ? ' — ' + detail : '')); ok = ok && !!pass; console.log(ev[ev.length - 1]); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
async function clickText(page, re, sel = '*') {
  const h = await page.evaluateHandle((reS, sel) => { const r = new RegExp(reS); const els = [...document.querySelectorAll(sel)].filter((e) => r.test((e.textContent || '').trim()) && e.getBoundingClientRect().width > 0); return els.sort((a, b) => a.textContent.length - b.textContent.length)[0] || null; }, re.source, sel);
  const el = h.asElement(); if (!el) return false;
  await el.evaluate((e) => e.scrollIntoView({ block: 'center' })); await sleep(250);
  const b = await el.boundingBox(); if (!b) return false;
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); return true;
}
async function clickSel(page, sel) {
  const el = await page.$(sel); if (!el) return false;
  await el.evaluate((e) => e.scrollIntoView({ block: 'center' })); await sleep(250);
  const b = await el.boundingBox(); if (!b) return false;
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); return true;
}
function finish() {
  const verdict = ok ? 'pass' : 'fail';
  fs.writeFileSync(OUT, JSON.stringify({ id: 'reports-page', at: new Date().toISOString(), base: BASE, condition_fired: true, verdict, evidence: ev }, null, 1));
  console.log(verdict.toUpperCase() + ' ' + ev.filter((e) => e.startsWith('PASS')).length + '/' + ev.length + ' -> ' + OUT);
  process.exit(ok ? 0 : 1);
}

(async () => {
  // 0. a session through the sandbox QA door (302 + Set-Cookie hkpl_sid)
  const door = await fetch(BASE + '/api/v1/auth/qa/by-email/' + encodeURIComponent(EMAIL) + '?p=' + encodeURIComponent(QA_P), { redirect: 'manual' });
  const raw = (door.headers.get('set-cookie') || '').split(/,(?=[^ ;]+=)/).map((s) => s.split(';')[0]).find((s) => s.startsWith('hkpl_sid=')) || '';
  const sid = raw.slice('hkpl_sid='.length);
  check('0 QA door signs tester1 in (302 + hkpl_sid)', door.status === 302 && !!sid, 'status ' + door.status + ' sid ' + (sid ? sid.slice(0, 6) + '…' : '(none)'));
  if (!sid) return finish();
  const H = { cookie: 'hkpl_sid=' + sid };
  const api = async (path, init) => { const r = await fetch(BASE + path, { ...(init || {}), headers: { 'content-type': 'application/json', ...H, ...((init && init.headers) || {}) } }); let j = null; try { j = await r.json(); } catch (e) { j = null; } return { status: r.status, json: j }; };

  // 1. API facts
  const me = await api('/api/v1/auth/me');
  const role = me.json && me.json.user && me.json.user.role;
  check('1a whoami is an admin role', me.status === 200 && /TENANT_ADMIN|SUPER_ADMIN|EDITORIAL/.test(String(role)), me.status + ' ' + role + ' ' + (me.json && me.json.user && me.json.user.email));
  const list = await api('/api/v1/admin/feedback?limit=200');
  const rows = (list.json && Array.isArray(list.json.data)) ? list.json.data : [];
  check('1b GET /api/v1/admin/feedback has >= 1 row', list.status === 200 && rows.length >= 1, list.status + ' rows ' + rows.length);
  const stats = await api('/api/v1/admin/feedback/stats');
  check('1c GET /api/v1/admin/feedback/stats answers { feedback_new, feedback_total } (route-order fix, server side)', stats.status === 200 && stats.json && typeof stats.json.feedback_total === 'number', stats.status + ' ' + JSON.stringify(stats.json).slice(0, 160));
  if (!rows.length) return finish();
  const first = rows[0];
  const target = first.status === 'triaged' ? 'in_progress' : 'triaged';

  // 2. the page
  const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  try {
    const page = await browser.newPage(); await page.setViewport({ width: 412, height: 915 });
    await page.setCookie({ name: 'hkpl_sid', value: sid, domain: HOST, path: '/', secure: true, httpOnly: true });
    const errs = []; page.on('pageerror', (e) => errs.push(String(e && e.message || e).slice(0, 200)));
    await page.goto(BASE + '/app/pages/reports/index', { waitUntil: 'networkidle2', timeout: 60000 }).catch((e) => errs.push('goto: ' + e.message));
    await page.waitForSelector('.rp-itemwrap', { timeout: 15000 }).catch(() => undefined);
    await sleep(800);
    const body = clean(await page.evaluate(() => document.body.innerText).catch(() => ''));
    const n = await page.$$eval('.rp-itemwrap', (a) => a.length).catch(() => 0);
    await page.screenshot({ path: '/root/walk/_reports-01-list.png' }).catch(() => undefined);
    check('2a /app/pages/reports/index renders the Bug reports list with >= 1 row', n >= 1 && /Bug reports|錯誤報告|错误报告/.test(body), 'rows ' + n + ' · url ' + page.url().replace(BASE, '') + ' · text "' + body.slice(0, 140) + '"' + (errs.length ? ' · pageerror ' + errs.slice(0, 2).join(' | ') : ''));
    if (n < 1) return finish();
    const firstId = await page.$eval('.rp-itemwrap', (e) => String(e.id || '').replace(/^rp-/, ''));
    check('2b the first row is the API\'s first row', firstId === first.id, 'ui ' + firstId + ' api ' + first.id);
    const id = firstId || first.id;

    // 3. open it, pick a status, save
    await clickSel(page, '.rp-itemwrap .pg-row');
    await page.waitForSelector('#rp-detail', { timeout: 8000 }).catch(() => undefined);
    const detail = clean(await page.evaluate(() => { const d = document.querySelector('#rp-detail'); return d ? d.innerText : ''; }).catch(() => ''));
    await page.screenshot({ path: '/root/walk/_reports-02-detail.png' }).catch(() => undefined);
    check('3a tapping the row opens the detail with the message', !!detail && detail.indexOf(clean(String(first.message || '').split(/\r?\n/)[0]).slice(0, 30)) >= 0, '"' + detail.slice(0, 160) + '"');
    const hitChip = await clickSel(page, '#rp-st-' + target);
    await sleep(300);
    const chipOn = await page.$eval('#rp-st-' + target, (e) => e.className.indexOf('pg-tab-on') >= 0).catch(() => false);
    check('3b the ' + target + ' chip is selectable', hitChip && chipOn, 'hit ' + hitChip + ' on ' + chipOn);
    const hitSave = await clickText(page, /^(Save|儲存|保存)$/, 'button, taro-button-core, .hk-btn, .hk-btn *');
    await sleep(2000);
    await page.screenshot({ path: '/root/walk/_reports-03-saved.png' }).catch(() => undefined);
    check('3c Save tapped', hitSave, String(hitSave));

    // 4. the server reflects it
    const after = await api('/api/v1/admin/feedback/' + encodeURIComponent(id));
    const st = after.json && after.json.data && after.json.data.status;
    check('4 GET /api/v1/admin/feedback/:id reflects the status picked in the UI', after.status === 200 && st === target, id + ' ' + first.status + ' -> ' + st + ' (wanted ' + target + ')');
    // put the original status back so the UAT data is as it was (the notes were saved as they were shown)
    const restore = await api('/api/v1/admin/feedback/' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify({ status: first.status }) });
    ev.push('INFO restored ' + id + ' to ' + first.status + ' -> ' + restore.status);
    if (errs.length) ev.push('INFO pageerrors: ' + errs.slice(0, 5).join(' | '));
  } finally { await browser.close().catch(() => undefined); }
  finish();
})().catch((e) => { check('probe crashed', false, String(e && e.stack || e).slice(0, 400)); finish(); });

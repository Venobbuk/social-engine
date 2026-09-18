// gb-admin-v1.probe.cjs — GB-ADMIN-V1: GripBat's in-app console (/app/pages/admin/index) on UAT as tester1 (TENANT_ADMIN,
// through the QA door). Every tab renders rows from the API; Amy's role goes to CAPTAIN through the console and back
// (hkpl has no CLUB_ORGANISER role — routes/admin.js NON_ADMIN_ROLES); a translation override (btn_back, the 返回
// override) is edited in the console and read back through tx() in the app (the AppHeader's Back label); the bug_widget
// flag is set to admin through the console and restored; the Venues tab lists >= 1 league-curated venue; More has the
// Console row; qa.html's admin card CTA lands on the console; reports/index?id= is a route and a table on a desktop.
// Verdict -> probes/gb-admin-v1.verdict.json. FAILS until the orchestrator deploys the app bundle.
'use strict';
const fs = require('fs');
const puppeteer = require('/root/hkpl-server/node_modules/puppeteer-core');
const BASE = process.env.BASE || 'https://uat.social.silkvo.com';
const HOST = new URL(BASE).hostname;
// DOOR: where the QA door is fetched from (a private build served on 127.0.0.1 proxies the API but the cookie must be minted by the origin)
const DOOR = process.env.DOOR_BASE || BASE;
const CONSOLE = '/app/pages/admin/index';
const AMY = 'uat+player-amy@hkpl-test.silkvo.com';
const evidence = []; let ok = true;
const ev = (pass, s) => { evidence.push((pass ? 'PASS ' : 'FAIL ') + s); if (!pass) ok = false; console.log((pass ? 'PASS ' : 'FAIL ') + s); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let SID = '';
const api = async (method, path, body) => {
  const r = await fetch(BASE + path, { method, headers: { cookie: SID, origin: BASE, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch (e) { /* not json */ }
  return { status: r.status, json: j };
};
const text = (page, sel) => page.$eval(sel, (e) => (e.textContent || '').trim()).catch(() => '');
const count = (page, sel) => page.$$eval(sel, (xs) => xs.length).catch(() => 0);
async function tab(page, key) { await page.$$eval('.gba-tabs .pg-tab', (xs, k) => { const el = xs.find((x) => (x.textContent || '').trim() === k); if (el) el.click(); }, key); await sleep(1500); }
/** Drive the NutUI picker ONE notch (a quick 40px flick — headless Chrome never fires the transitionend the slow path
 *  commits on, the inertia path commits at once) and confirm; repeat until the trigger reads the wanted label. */
async function pickTo(page, triggerSel, labelSel, want, maxNotches = 4) {
  for (let n = 0; n < maxNotches; n++) {
    await page.$eval(triggerSel, (e) => e.click());
    await page.waitForSelector('.nut-pickerview-list', { timeout: 6000 });
    await sleep(1000); // the popup slides in (300 ms) and the roller measures its line height — touch it only once it is still
    const list = await page.$('.nut-pickerview-list');
    const box = await list.boundingBox();
    const x = box.x + box.width / 2, y0 = box.y + box.height / 2;
    await page.touchscreen.touchStart(x, y0);
    for (let i = 1; i <= 4; i++) { await page.touchscreen.touchMove(x, y0 - 40 * i / 4); await sleep(30); }
    await sleep(120);
    await page.touchscreen.touchEnd();
    await sleep(800);
    const active = await page.$eval('.nut-pickerview-roller-item-active', (e) => (e.textContent || '').trim()).catch(() => '?');
    await sleep(300);
    await page.$eval('.nut-picker-confirm-btn', (e) => e.click());
    await sleep(900);
    const now = await text(page, labelSel);
    console.log(`   picker notch ${n + 1}: roller active "${active}" -> trigger reads "${now}"`);
    if (now === want) return now;
  }
  return await text(page, labelSel);
}
async function newPage(browser, opts = {}) {
  const page = await browser.newPage();
  await page.setViewport(opts.desktop ? { width: 1280, height: 900 } : { width: 412, height: 915, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  if (SID) { const [name, value] = SID.split('='); await page.setCookie({ name, value, domain: HOST, path: '/' }); }
  await page.evaluateOnNewDocument((lang) => { try { localStorage.setItem('hkpl_lang', lang); } catch (e) {} }, opts.lang || 'en');
  page.calls = [];
  page.on('response', (r) => { const u = r.url(); if (/\/api\//.test(u)) page.calls.push({ m: r.request().method(), u: u.replace(BASE, ''), s: r.status() }); });
  return page;
}
const saw = (page, rx, method) => page.calls.filter((c) => rx.test(c.u) && (!method || c.m === method));

(async () => {
  // ---- sign in as tester1 through the QA door
  const door = await fetch(DOOR + '/api/v1/auth/qa/by-email/boyau.tester1@silkvo.com?p=hkpl-uat-2026', { redirect: 'manual' });
  SID = (door.headers.get('set-cookie') || '').split(';')[0];
  const who = await api('GET', '/api/v1/auth/me');
  ev(who.status === 200 && who.json && who.json.user && who.json.user.role === 'TENANT_ADMIN', `tester1 is TENANT_ADMIN on ${HOST} — ${who.json && who.json.user && who.json.user.role}`);
  const amyRow = await api('GET', '/api/v1/admin/users-list?q=' + encodeURIComponent(AMY));
  const amy = amyRow.json && (amyRow.json.data || []).find((u) => u.email === AMY);
  ev(!!amy, `Amy found through the API — ${amy && amy.id} role ${amy && amy.role}`);
  const btnBack = await api('GET', '/api/v1/admin/translations?lang=zh_Hant&search=btn_back');
  const bb = btnBack.json && (btnBack.json.data || []).find((r) => r.key === 'btn_back');
  ev(!!bb, `btn_back row in the translations API — override "${bb && bb.override_value}" default "${bb && bb.default_value}"`);
  const bbBefore = bb ? bb.override_value : null;
  const flagsBefore = await api('GET', '/api/v1/admin/tenant/flags');
  const bugBefore = (flagsBefore.json && flagsBefore.json.data && flagsBefore.json.data.feature_flags && flagsBefore.json.data.feature_flags.bug_widget) || 'public';

  // no --disable-gpu: it suppresses CSS transitions in headless Chrome, and NutUI's picker commits its value on transitionend
  const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
  try {
    // ---- 1. the console renders, gated, with its tabs
    let page = await newPage(browser);
    await page.goto(BASE + CONSOLE + '?lang=en', { waitUntil: 'networkidle2', timeout: 60000 });
    await sleep(1500);
    ev(!!(await page.$('#gba')), 'console renders for tester1 (#gba)');
    const tabs = await page.$$eval('.gba-tabs .pg-tab', (xs) => xs.map((x) => (x.textContent || '').trim()));
    ev(['Users', 'Venues', 'Settings', 'Translations', 'Announcements', 'Bug reports'].every((t) => tabs.includes(t)), `tabs: ${tabs.join(' · ')}`);
    const chrome = (await text(page, '.ah-title')) + ' · ' + (await text(page, '.ah-sub'));
    ev(/GripBat/.test(chrome) && !/hkpl/i.test(chrome + ' ' + tabs.join(' ')), `GripBat-branded — header "${chrome}", no hkpl name in the chrome or the tabs`);
    // ---- 2. Users: rows from the API, search Amy, role -> CAPTAIN through the console
    ev((await count(page, '.gba-user')) > 0 && saw(page, /admin\/users-list/).some((c) => c.s === 200), `Users tab lists ${await count(page, '.gba-user')} rows from GET /admin/users-list`);
    await page.type('.gba-search input', 'player-amy', { delay: 10 });
    await sleep(1200);
    const amyRows = await page.$$eval('.gba-user', (xs) => xs.map((x) => (x.textContent || '').trim()));
    ev(amyRows.some((t) => /Amy/.test(t)), `search "player-amy" -> ${amyRows.length} row(s): ${amyRows[0] || ''}`);
    await page.$$eval('.gba-user', (xs) => { const el = xs.find((x) => /player-amy/.test(x.textContent || '')); if (el) el.click(); });
    await sleep(800);
    ev(!!(await page.$('#gba-role-save')), 'Amy\'s sheet opens with the Role field and Save role');
    let roleUi = false;
    try {
      const chosen = await pickTo(page, '.gba-sheet .gba-select', '.gba-sheet .gba-selectt', 'Captain', 1); // PLAYER -> CAPTAIN, one notch
      roleUi = chosen === 'Captain';
      ev(roleUi, `picker chose "${chosen}" (expected Captain)`);
      if (roleUi) { await page.$eval('#gba-role-save', (e) => e.click()); await sleep(1500); }
    } catch (e) { ev(false, 'picker drive failed: ' + e.message); }
    const rolePatch = saw(page, /admin\/users\/[^/]+\/role/, 'PATCH');
    ev(rolePatch.length > 0 && rolePatch[rolePatch.length - 1].s === 200, `PATCH /admin/users/:id/role -> ${rolePatch.map((c) => c.s).join(',') || 'none'}`);
    const amyNow = (await api('GET', '/api/v1/admin/users-list?q=' + encodeURIComponent(AMY))).json;
    const amyRole = amyNow && (amyNow.data || []).find((u) => u.email === AMY);
    ev(!!amyRole && amyRole.role === 'CAPTAIN', `Amy's role on the server is now ${amyRole && amyRole.role} (expected CAPTAIN)`);
    // and back
    const restore = await api('PATCH', '/api/v1/admin/users/' + (amy ? amy.id : '') + '/role', { role: 'PLAYER' });
    ev(restore.status === 200, `restored Amy to PLAYER (PATCH ${restore.status})`);
    await page.reload({ waitUntil: 'networkidle2' }); await sleep(1500);
    await page.type('.gba-search input', 'player-amy', { delay: 10 }); await sleep(1200);
    const amyBack = await page.$$eval('.gba-user', (xs) => xs.map((x) => (x.textContent || '').trim()).find((t) => /player-amy/.test(t)) || '');
    ev(/Player/.test(amyBack) && !/Captain/.test(amyBack), `console shows Amy as Player again — "${amyBack}"`);
    // ---- 3. Venues: >= 1 league-curated venue from the engine
    await tab(page, 'Venues');
    const nVen = await count(page, '.gba-venue');
    const venTxt = await page.$$eval('.gba-venue', (xs) => xs.map((x) => (x.textContent || '').trim()));
    ev(nVen >= 1 && venTxt.some((t) => /League-curated/.test(t)), `Venues tab lists ${nVen} venue(s), league-curated present — "${venTxt[0] || ''}"`);
    ev(saw(page, /\/api\/venues\/search/).some((c) => c.s === 200), 'venues/search answered 200');
    // ---- 4. Settings: bug_widget -> admin through the console, then restored
    await tab(page, 'Settings');
    ev(!!(await page.$('#gba-bug')) && saw(page, /admin\/tenant\/flags/).some((c) => c.s === 200), `Settings tab shows the bug-widget setting "${await text(page, '#gba-bug')}" from GET /admin/tenant/flags`);
    let bugUi = false;
    try {
      const chosen = await pickTo(page, '#gba-bug', '#gba-bug', 'Admins only', 2); // public -> staff -> admin (each pick saves)
      bugUi = chosen === 'Admins only';
      ev(bugUi, `picker chose "${chosen}" (expected Admins only)`);
      await sleep(1200);
    } catch (e) { ev(false, 'bug-widget picker drive failed: ' + e.message); }
    const tenantPatch = saw(page, /\/api\/v1\/admin\/tenant$/, 'PATCH');
    ev(tenantPatch.length > 0 && tenantPatch[tenantPatch.length - 1].s === 200, `PATCH /admin/tenant -> ${tenantPatch.map((c) => c.s).join(',') || 'none'}`);
    const pubFlag = await api('GET', '/api/v1/public/feature/bug-widget');
    ev(pubFlag.json && pubFlag.json.visibility === 'admin', `/public/feature/bug-widget now ${pubFlag.json && pubFlag.json.visibility} (expected admin)`);
    const bugRestore = await api('PATCH', '/api/v1/admin/tenant', { bug_widget: bugBefore });
    const pubAfter = await api('GET', '/api/v1/public/feature/bug-widget');
    ev(bugRestore.status === 200 && pubAfter.json && pubAfter.json.visibility === bugBefore, `bug_widget restored to ${bugBefore} (PATCH ${bugRestore.status}, public reads ${pubAfter.json && pubAfter.json.visibility})`);
    // ---- 5. Translations: edit the btn_back override in the console, see it through tx() in the app
    await tab(page, 'Translations');
    ev(saw(page, /admin\/translations\?lang=zh_Hant/).some((c) => c.s === 200) && (await count(page, '.gba-trow')) > 0, `Translations tab lists ${await count(page, '.gba-trow')} override row(s) from GET /admin/translations?lang=zh_Hant`);
    await page.type('.gba-search input', 'btn_back', { delay: 10 }); await sleep(600);
    const trRows = await page.$$eval('.gba-trow', (xs) => xs.map((x) => (x.textContent || '').trim()));
    ev(trRows.some((t) => /btn_back/.test(t)), `search btn_back -> "${trRows[0] || ''}"`);
    await page.$$eval('.gba-trow', (xs) => { const el = xs.find((x) => /btn_back/.test(x.textContent || '')); if (el) el.click(); });
    await sleep(800);
    const stamp = '返回·' + Date.now().toString(36).slice(-4);
    const ta = await page.$('.gba-sheet .gba-ta textarea, .gba-sheet textarea');
    ev(!!ta, 'override sheet opens with the value field');
    if (ta) {
      await ta.click({ clickCount: 3 }); await page.keyboard.press('Backspace');
      await page.evaluate((v) => { const t = document.querySelector('.gba-sheet textarea'); const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(t, v); t.dispatchEvent(new Event('input', { bubbles: true })); }, stamp);
      await sleep(300);
      await page.$eval('#gba-tr-save', (e) => e.click()); await sleep(1500);
    }
    const trPatch = saw(page, /admin\/translations\/zh_Hant\/btn_back/, 'PATCH');
    ev(trPatch.length > 0 && trPatch[trPatch.length - 1].s === 200, `PATCH /admin/translations/zh_Hant/btn_back -> ${trPatch.map((c) => c.s).join(',') || 'none'}`);
    // the dictionary answer is cached for 60 s on the server: poll it, then read the app
    let dictVal = null;
    for (let i = 0; i < 16; i++) { const d = await (await fetch(BASE + '/api/v1/i18n/zh_Hant', { headers: { 'cache-control': 'no-cache' } })).json(); dictVal = d.btn_back; if (dictVal === stamp) break; await sleep(5000); }
    ev(dictVal === stamp, `GET /api/v1/i18n/zh_Hant btn_back = "${dictVal}" (expected "${stamp}")`);
    const zh = await newPage(browser, { lang: 'zh_Hant' });
    await zh.goto(BASE + CONSOLE + '?lang=zh_Hant', { waitUntil: 'networkidle2', timeout: 60000 }); await sleep(2500);
    const backLabel = await text(zh, '.ah-lead .sr-only');
    ev(backLabel === stamp, `the app renders tx('Back') as "${backLabel}" after reload (the console header's Back label)`);
    await zh.close();
    const trRestore = bbBefore == null ? await api('DELETE', '/api/v1/admin/translations/zh_Hant/btn_back') : await api('PATCH', '/api/v1/admin/translations/zh_Hant/btn_back', { value: bbBefore });
    ev(trRestore.status === 200, `btn_back override restored to ${JSON.stringify(bbBefore)} (${trRestore.status})`);
    // ---- 6. Announcements: create through the console, row appears, cleaned up
    await tab(page, 'Announcements');
    ev(saw(page, /editorial\/posts/).some((c) => c.s === 200), 'Announcements tab reads GET /editorial/posts (200)');
    await page.$eval('#gba-ann-new', (e) => e.click()); await sleep(800);
    const annTitle = 'probe announcement ' + Date.now().toString(36);
    await page.type('.gba-sheet .gba-in input', annTitle, { delay: 5 });
    await page.$eval('#gba-ann-save', (e) => e.click()); await sleep(1500);
    const annPost = saw(page, /editorial\/posts$/, 'POST');
    ev(annPost.length > 0 && annPost[annPost.length - 1].s === 200, `POST /editorial/posts -> ${annPost.map((c) => c.s).join(',') || 'none'}`);
    const annRows = await page.$$eval('.gba-ann', (xs) => xs.map((x) => (x.textContent || '').trim()));
    ev(annRows.some((t) => t.indexOf(annTitle) >= 0), `announcement row rendered — ${annRows.length} row(s)`);
    const posts = await api('GET', '/api/v1/editorial/posts');
    const mine = posts.json && (posts.json.data || []).filter((p) => p.title_en === annTitle);
    for (const p of mine || []) await api('DELETE', '/api/v1/editorial/posts/' + p.id);
    ev((mine || []).length === 1, `announcement on the server once and deleted again (${(mine || []).length})`);
    // ---- 7. Bug reports tab -> the reports page; reports/index?id= is a route
    await tab(page, 'Bug reports'); await sleep(1500);
    ev(/\/pages\/reports\/index/.test(page.url()), `Bug reports tab opens the reports page — ${page.url().replace(BASE, '')}`);
    const firstRow = await page.$('.rp-itemwrap .pg-row');
    if (firstRow) { await firstRow.tap().catch(() => null); }
    await page.waitForSelector('#rp-detail', { timeout: 15000 }).catch(() => null); await sleep(500);
    ev(!!firstRow && /reports\/index\?.*id=/.test(page.url()) && !!(await page.$('#rp-detail')), `a report is a route — ${page.url().replace(BASE, '')}${firstRow ? '' : ' (no report rows to open)'}`);
    await page.close();
    // ---- 8. More has the Console row (admin) and it lands on the console
    page = await newPage(browser);
    await page.goto(BASE + '/app/pages/more/index?lang=en', { waitUntil: 'networkidle2', timeout: 60000 }); await sleep(1500);
    const moreRows = await page.$$eval('.mo-admin', (xs) => xs.map((x) => (x.textContent || '').trim()));
    ev(moreRows.some((t) => /^Console/.test(t)) && moreRows.some((t) => /^Bug reports/.test(t)), `More › ${moreRows.map((t) => t.split(/\s{2,}|Users|Reports/)[0].trim()).join(' · ')}`);
    await page.$$eval('.mo-admin', (xs) => { const el = xs.find((x) => /^Console/.test(x.textContent || '')); if (el) el.click(); }); await sleep(1500);
    ev(page.url().indexOf(CONSOLE) >= 0 && !!(await page.$('#gba')), 'the Console row lands on /pages/admin/index');
    await page.close();
    // ---- 9. desktop: the reports list is a table
    page = await newPage(browser, { desktop: true });
    await page.goto(BASE + '/app/pages/reports/index?lang=en', { waitUntil: 'networkidle2', timeout: 60000 }); await sleep(1500);
    const tableShown = await page.$eval('.rp-table', (e) => getComputedStyle(e).display !== 'none').catch(() => false);
    const rowsHidden = await page.$$eval('.rp-itemwrap', (xs) => xs.every((x) => getComputedStyle(x).display === 'none')).catch(() => false);
    ev(tableShown && rowsHidden, `desktop 1280: reports list is a table (.rp-table shown, phone rows hidden) — ${tableShown}/${rowsHidden}`);
    await page.close();
    // ---- 10. non-admin sees "Admins only"
    const tom = await fetch(DOOR + '/api/v1/auth/qa/by-email/uat%2Bclubadmin-tom%40hkpl-test.silkvo.com?p=hkpl-uat-2026', { redirect: 'manual' });
    const tomSid = (tom.headers.get('set-cookie') || '').split(';')[0];
    page = await browser.newPage(); await page.setViewport({ width: 412, height: 915, isMobile: true, hasTouch: true });
    if (tomSid) { const [n, v] = tomSid.split('='); await page.setCookie({ name: n, value: v, domain: HOST, path: '/' }); }
    const tomCalls = []; page.on('response', (r) => { if (/\/api\/v1\/admin\//.test(r.url())) tomCalls.push(r.url()); });
    await page.goto(BASE + CONSOLE + '?lang=en', { waitUntil: 'networkidle2', timeout: 60000 }); await sleep(1500);
    const tip = await page.$eval('.be', (e) => (e.textContent || '').trim()).catch(() => '');
    ev(/Admins only/.test(tip) && !(await page.$('#gba')) && tomCalls.length === 0, `Tom (club admin, PLAYER) sees "Admins only", no admin API call — "${tip.slice(0, 40)}"`);
    await page.close();
    // ---- 11. qa.html: the admin card's CTA lands on the console
    page = await browser.newPage(); await page.setViewport({ width: 412, height: 915, isMobile: true, hasTouch: true });
    await page.goto(BASE + '/uat/qa.html', { waitUntil: 'networkidle2', timeout: 60000 }); await sleep(1000);
    const cta = await page.$eval('#role-admin a.cta', (a) => ({ href: a.getAttribute('href'), land: a.getAttribute('data-land'), label: (a.textContent || '').trim() })).catch(() => null);
    ev(!!cta && cta.land === CONSOLE && /Open the console as/.test(cta.label), `qa.html admin card: "${cta && cta.label}" door=${cta && cta.href} land=${cta && cta.land}`);
    const accLink = await page.$eval('[data-i="acc_admin_link"]', (a) => a.getAttribute('href')).catch(() => '');
    ev(accLink === CONSOLE, `qa.html "Management console" row -> ${accLink}`);
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 }).catch(() => null), page.$eval('#role-admin a.cta', (a) => a.click())]);
    await sleep(2000);
    ev(page.url().indexOf(CONSOLE) >= 0 && !!(await page.$('#gba')), `admin card CTA lands on the console signed in — ${page.url().replace(BASE, '')}`);
    await page.close();
  } finally { await browser.close(); }
  // paranoia: leave the tenant as found
  const amyFinal = (await api('GET', '/api/v1/admin/users-list?q=' + encodeURIComponent(AMY))).json;
  const af = amyFinal && (amyFinal.data || []).find((u) => u.email === AMY);
  if (af && af.role !== 'PLAYER' && amy) await api('PATCH', '/api/v1/admin/users/' + amy.id + '/role', { role: 'PLAYER' });
  const verdict = { id: 'gb-admin-v1', at: new Date().toISOString(), condition_fired: true, verdict: ok ? 'pass' : 'fail', evidence };
  fs.writeFileSync('/root/social-engine/probes/gb-admin-v1.verdict.json', JSON.stringify(verdict, null, 1));
  console.log(verdict.verdict, evidence.filter((e) => e.startsWith('PASS')).length + '/' + evidence.length);
})().catch((e) => { console.error(e); const verdict = { id: 'gb-admin-v1', at: new Date().toISOString(), condition_fired: true, verdict: 'fail', evidence: evidence.concat(['FAIL crashed: ' + e.message]) }; fs.writeFileSync('/root/social-engine/probes/gb-admin-v1.verdict.json', JSON.stringify(verdict, null, 1)); process.exit(1); });

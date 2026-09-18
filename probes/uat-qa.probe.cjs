// UAT-QA-V2 probe (ON kaka, headless Chrome, real cursor) — https://uat.social.silkvo.com/qa.html and its pack.
//   1 /qa.html renders: title, ≥ 7 role cards, search / clubs / officials sections
//   2 tester name: typed + saved → localStorage uat:tester; Send feedback → POST /api/v1/feedback payload carries tester_name
//   3 search "Jason" → row "Jason 張" → click Sign in → /api/v1/auth/me = uat+demo_jason@hkpl-test.silkvo.com
//   4 browse by club → Tuen Mun Paddle Club → ≥ 1 member row with a Sign in button
//   5 Seed a busy Saturday (as the signed-in Jason) → three meet links on the page
//   6 /test-plan.html → ≥ 40 cards; typing "block" filters the cards
//   7 /fixed.html → 95 rows, the FIXED count > 0
//   8 aliases: /, /uat.html (302 → /qa.html), /qa.html, /test-plan.html, /fixed.html, /uat/people.json, /uat/test-plan.json = 200;
//     /demo.html /features.html /tutorial.html are another agent's files — recorded, not part of the verdict
// Verdict → /root/social-engine/probes/uat-qa.verdict.json; screenshots → /root/walk/_qa-*.png
'use strict';
const fs = require('fs');
const puppeteer = require('/root/hkpl-server/node_modules/puppeteer-core');
const BASE = 'https://uat.social.silkvo.com';
const checks = []; const ok = (n, p, d) => { checks.push({ name: n, pass: !!p, detail: d }); console.log((p ? 'PASS ' : 'FAIL ') + n + ' — ' + JSON.stringify(d).slice(0, 300)); };
const info = []; const note = (n, d) => { info.push({ name: n, detail: d }); console.log('INFO ' + n + ' — ' + JSON.stringify(d).slice(0, 300)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync('/root/walk', { recursive: true });
(async () => {
  const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  const ctx = await browser.createBrowserContext(); const page = await ctx.newPage(); await page.setViewport({ width: 412, height: 915, deviceScaleFactor: 2 });
  const feedbackPosts = [];
  page.on('request', (r) => { if (r.url().endsWith('/api/v1/feedback') && r.method() === 'POST') { try { feedbackPosts.push(JSON.parse(r.postData() || '{}')); } catch (e) { feedbackPosts.push({ raw: r.postData() }); } } });
  let feedbackStatus = null;
  page.on('response', (r) => { if (r.url().endsWith('/api/v1/feedback') && r.request().method() === 'POST') feedbackStatus = r.status(); });

  // 1 render
  await page.goto(BASE + '/qa.html', { waitUntil: 'networkidle2', timeout: 45000 }); await sleep(1200);
  const r1 = await page.evaluate(() => ({ title: document.title, h1: (document.querySelector('h1') || {}).textContent, roles: document.querySelectorAll('#role-list .role').length, search: !!document.getElementById('q'), clubs: document.querySelectorAll('#club-select option').length, staff: document.querySelectorAll('#staff .person').length, chips: document.querySelectorAll('#role-chips .chip').length, pairs: document.querySelectorAll('#pair-list .pair').length }));
  ok('1 /qa.html renders (title, ≥7 role cards, search, clubs, GripBat operations only, pairs)', /GripBat/.test(r1.title) && r1.roles >= 7 && r1.search && r1.clubs >= 3 && r1.staff >= 1 && r1.chips === 0 /* GripBat only: no league officials, no /qa/<role> chips (operator, 2026-09-18) */ && r1.pairs >= 3, r1);
  await page.screenshot({ path: '/root/walk/_qa-home.png', fullPage: false });

  // 2 name → localStorage + feedback payload
  await page.click('#who-input'); await page.keyboard.type('Probe Tester', { delay: 30 }); await page.click('#who-save'); await sleep(300);
  const stored = await page.evaluate(() => localStorage.getItem('uat:tester'));
  await page.click('#fb-open'); await sleep(300); await page.click('#fb-text'); await page.keyboard.type('probe: qa.html feedback widget check (sandbox)', { delay: 10 }); await page.click('#fb-send'); await sleep(2500);
  const fbMsg = await page.evaluate(() => (document.getElementById('fb-msg') || {}).textContent);
  const payload = feedbackPosts[0] || {};
  ok('2 name saved under uat:tester and sent as tester_name in POST /api/v1/feedback', stored === 'Probe Tester' && payload.tester_name === 'Probe Tester' && feedbackStatus && feedbackStatus < 300, { stored, tester_name: payload.tester_name, page_context: payload.page_context && payload.page_context.page, feedbackStatus, fbMsg });
  await page.screenshot({ path: '/root/walk/_qa-feedback.png', fullPage: false });
  await page.click('#fb-cancel').catch(() => {});

  // 4 (before 3, since 3 navigates away) browse by club
  await page.evaluate(() => document.getElementById('clubs').scrollIntoView());
  const tuenMun = await page.evaluate(() => { const o = [...document.querySelectorAll('#club-select option')].find((x) => /Tuen Mun/.test(x.textContent)); return o ? o.value : null; });
  await page.select('#club-select', tuenMun); await sleep(300);
  const r4 = await page.evaluate(() => ({ rows: document.querySelectorAll('#club-people .person').length, withBtn: document.querySelectorAll('#club-people .person a.go').length, owner: (document.querySelector('#club-people .pill.owner') || {}).textContent, first: (document.querySelector('#club-people .person .nm') || {}).textContent }));
  ok('4 browse by club → Tuen Mun Paddle Club lists members with ≥1 Sign in button', !!tuenMun && r4.rows >= 1 && r4.withBtn >= 1, Object.assign({ clubId: tuenMun }, r4));
  await page.screenshot({ path: '/root/walk/_qa-club.png', fullPage: false });

  // 3 search Jason → sign in
  await page.evaluate(() => { document.getElementById('search').scrollIntoView(); document.getElementById('q').value = ''; });
  await page.click('#q'); await page.keyboard.type('Jason', { delay: 40 }); await sleep(400);
  const r3a = await page.evaluate(() => [...document.querySelectorAll('#hits .person')].map((p) => ({ name: p.querySelector('.nm').textContent.trim(), meta: p.querySelector('.meta').textContent.trim(), btn: !!p.querySelector('a.go') })));
  await page.screenshot({ path: '/root/walk/_qa-search.png', fullPage: false });
  const jasonRow = await page.evaluateHandle(() => [...document.querySelectorAll('#hits .person')].find((p) => /Jason 張/.test(p.textContent)));
  let me = null;
  if (jasonRow && jasonRow.asElement()) {
    const btn = await jasonRow.asElement().$('a.go');
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 45000 }).catch(() => {}), btn.click()]);
    await sleep(1500);
    me = await page.evaluate(() => fetch('/api/v1/auth/me', { credentials: 'include' }).then((r) => r.json()).then((j) => j.user && { email: j.user.email, fullname: j.user.fullname, role: j.user.role }));
  }
  ok('3 search "Jason" → Sign in as Jason 張 (by-email) → /api/v1/auth/me is uat+demo_jason', r3a.some((h) => /Jason 張/.test(h.name)) && me && me.email === 'uat+demo_jason@hkpl-test.silkvo.com', { hits: r3a.slice(0, 3), landed: page.url(), me });
  await page.screenshot({ path: '/root/walk/_qa-jason-home.png', fullPage: false });

  // 5 seed a busy Saturday as Jason
  await page.goto(BASE + '/qa.html', { waitUntil: 'networkidle2', timeout: 45000 }); await sleep(800);
  await page.click('#seed-btn'); await page.waitForFunction(() => /✓|Could not|Sign in first|already/.test((document.getElementById('seed-msg') || {}).textContent || ''), { timeout: 30000 }).catch(() => {});
  const r5 = await page.evaluate(() => ({ text: (document.getElementById('seed-msg') || {}).textContent, links: [...document.querySelectorAll('#seed-msg a')].map((a) => a.getAttribute('href')) }));
  ok('5 Seed a busy Saturday → three meet links (as the signed-in person)', r5.links.length === 3 && /✓|already/.test(r5.text), r5);
  await page.screenshot({ path: '/root/walk/_qa-seed.png', fullPage: false });

  // 6 test plan
  await page.goto(BASE + '/test-plan.html', { waitUntil: 'networkidle2', timeout: 45000 }); await sleep(800);
  const before = await page.evaluate(() => document.querySelectorAll('.tc').length);
  await page.click('#q'); await page.keyboard.type('block', { delay: 30 }); await sleep(500);
  const r6 = await page.evaluate(() => ({ after: document.querySelectorAll('.tc').length, allMatch: [...document.querySelectorAll('.tc')].every((c) => /block/i.test(c.textContent)), tabs: document.querySelectorAll('.tab').length, n: (document.getElementById('n-sc') || {}).textContent }));
  ok('6 /test-plan.html lists ≥40 scenarios and the search filters', before >= 40 && r6.after > 0 && r6.after < before && r6.allMatch, Object.assign({ before }, r6));
  await page.screenshot({ path: '/root/walk/_qa-testplan.png', fullPage: false });

  // 7 fixed
  await page.goto(BASE + '/fixed.html', { waitUntil: 'networkidle2', timeout: 45000 }); await sleep(500);
  const r7 = await page.evaluate(() => ({ rows: document.querySelectorAll('.row').length, counts: [...document.querySelectorAll('#counts .cnt')].map((b) => b.textContent.trim()) }));
  ok('7 /fixed.html lists 95 items with FIXED / PARTLY / OPEN counts', r7.rows === 95 && r7.counts.some((c) => /Fixed\s*[1-9]/.test(c)), r7);
  await page.screenshot({ path: '/root/walk/_qa-fixed.png', fullPage: false });

  // desktop shot of qa.html
  const d = await ctx.newPage(); await d.setViewport({ width: 1280, height: 900 }); await d.goto(BASE + '/qa.html', { waitUntil: 'networkidle2', timeout: 45000 }); await sleep(800); await d.screenshot({ path: '/root/walk/_qa-desktop.png' }); await d.close();

  // 8 aliases
  const head = async (p) => { const r = await fetch(BASE + p, { redirect: 'manual' }); return { path: p, status: r.status, location: r.headers.get('location'), type: (r.headers.get('content-type') || '').split(';')[0] }; };
  const mine = await Promise.all(['/', '/uat.html', '/qa.html', '/test-plan.html', '/fixed.html', '/uat/people.json', '/uat/test-plan.json', '/referee.html', '/registrar.html'].map(head));
  const expect = { '/': 302, '/uat.html': 302, '/referee.html': 302, '/registrar.html': 302 };
  ok('8 aliases: mine answer 200 (redirects 302 → /qa.html, app pages)', mine.every((r) => r.status === (expect[r.path] || 200)), mine);
  const theirs = await Promise.all(['/demo.html', '/features.html', '/tutorial.html'].map(head));
  note('other agent\'s pages (demo / features / tutorial) — served by the same aliases once their files land', theirs);

  await browser.close();
  const pass = checks.filter((c) => c.pass).length;
  const v = { id: 'uat-qa', at: new Date().toISOString(), condition_fired: true, verdict: pass === checks.length ? 'pass' : 'fail', pass, total: checks.length, evidence: checks.map((c) => c.name + '=' + (c.pass ? 'ok' : 'FAIL') + ' ' + JSON.stringify(c.detail).slice(0, 400)), info, detail: 'headless Chrome (real clicks) on https://uat.social.silkvo.com: qa.html render, tester name → feedback payload, search Jason → by-email → auth/me, browse by club, seed Saturday, test-plan search, fixed.html, aliases', checks, screenshots: fs.readdirSync('/root/walk').filter((f) => f.startsWith('_qa-')).map((f) => '/root/walk/' + f) };
  fs.writeFileSync('/root/social-engine/probes/uat-qa.verdict.json', JSON.stringify(v, null, 2));
  console.log(v.verdict + ' ' + pass + '/' + checks.length); process.exit(v.verdict === 'pass' ? 0 : 1);
})().catch((e) => { console.error('PROBE CRASH', e); process.exit(2); });

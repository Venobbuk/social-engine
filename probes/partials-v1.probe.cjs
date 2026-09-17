// PARTIALS-V1 probe (ON kaka, headless Chrome as tester2): join by code, duplicate meet prefill, save a player →
// Saved pane, post detail, DUPR connect status, edit-profile sheet, Comps tiles, share sheet QR.
'use strict';
const fs = require('fs');
const puppeteer = require('/root/hkpl-server/node_modules/puppeteer-core');
const BASE = 'https://social.silkvo.com'; const E = 'http://127.0.0.1:3960/api';
const MEET = process.env.MEET || 'ar7qrfpjs64a00mi'; const PLAYER = process.env.PLAYER || 'aqxxu4xssfmc000f'; const CLUB = process.env.CLUB || 'ar7o90b5s64a0010';
const checks = []; const ok = (n, p, d) => { checks.push({ name: n, pass: !!p, detail: d }); console.log((p ? 'PASS ' : 'FAIL ') + n + (d ? ' — ' + JSON.stringify(d).slice(0, 240) : '')); };
(async () => {
  const { name: cname, value: cval } = await require('./_session.cjs').getSession(1);
  const meet = await (await fetch(E + '/meets/show', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ meetId: MEET }) })).json();
  const code = meet.referenceCode;
  const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  const page = await browser.newPage(); await page.setViewport({ width: 412, height: 915 });
  await page.setCookie({ name: cname, value: cval, domain: 'social.silkvo.com', path: '/', secure: true });
  const wait = (ms) => new Promise((res) => setTimeout(res, ms));
  const errs = []; page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 120)));
  const open = async (r) => { await page.goto(BASE + r + (r.includes('?') ? '&' : '?') + 'lang=en', { waitUntil: 'networkidle2', timeout: 45000 }); await wait(2000); };
  // 1 join by code
  await open('/app/pages/meets/index');
  await page.click('.dv-searchin'); await page.keyboard.type(code || 'ZZZZZZ', { delay: 30 }); await wait(800);
  const codeRow = await page.$('.dv-code'); if (codeRow) { await codeRow.click(); await wait(2500); }
  ok('1 Discover: typing the join code opens the meet', !!code && page.url().indexOf('/pages/meet/index?id=' + MEET) >= 0, { code, url: page.url().slice(-60) });
  // 2 duplicate
  await open('/app/pages/meet-create/index?dup=' + MEET);
  const dup = await page.evaluate(() => ({ name: (document.querySelector('.mc-input') || {}).value, date: (document.querySelector('.mc-pick') || {}).textContent }));
  ok('2 Duplicate: meet-create prefilled with the name, date left empty', dup.name === meet.name && /Pick a date/i.test(dup.date || ''), dup);
  // 3 save a player → Saved pane
  await open('/app/pages/player/index?id=' + PLAYER);
  const acts = await page.$$('.ah-act'); await acts[acts.length - 1].click(); await wait(800);
  const items = await page.$$('.ak-item'); const labels = await Promise.all(items.map((i) => i.evaluate((e) => e.textContent)));
  const saveIdx = labels.findIndex((l) => /^(Save|Unsave)$/.test(l || ''));
  const wasSaved = /Unsave/.test(labels[saveIdx] || '');
  if (saveIdx >= 0) { await items[saveIdx].click(); await wait(2000); }
  if (wasSaved) { await acts[acts.length - 1].click(); await wait(800); const it2 = await page.$$('.ak-item'); const l2 = await Promise.all(it2.map((i) => i.evaluate((e) => e.textContent))); const i2 = l2.findIndex((l) => /^Save$/.test(l || '')); if (i2 >= 0) { await it2[i2].click(); await wait(2000); } }
  await open('/app/pages/network/index');
  const tabs = await page.$$('.pg-tab'); const tl = await Promise.all(tabs.map((t) => t.evaluate((e) => e.textContent)));
  const si = tl.findIndex((l) => /Saved/.test(l || '')); if (si >= 0) { await tabs[si].click(); await wait(1500); }
  const savedRows = await page.evaluate(() => [...document.querySelectorAll('.nw-item')].map((e) => e.textContent || ''));
  ok('3 Player ⋯ › Save → My network › Saved lists Jason', saveIdx >= 0 && savedRows.some((t) => /Jason/.test(t)), { labels: labels.slice(0, 3), savedRows: savedRows.map((t) => t.slice(0, 30)) });
  // 4 post detail
  const notes = await (await fetch(E + '/channels/timeline', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ channelId: CLUB, limit: 3 }) })).json();
  const nid = Array.isArray(notes) && notes[0] ? notes[0].id : '';
  await open('/app/pages/feed/index?note=' + nid);
  const detail = await page.evaluate(() => ({ posts: document.querySelectorAll('.fd-post').length, replies: !!document.querySelector('.fd-replies'), title: (document.querySelector('.ah-title') || {}).textContent }));
  ok('4 feed?note= shows the one post with its replies open', detail.posts === 1 && detail.replies, detail);
  // 5 settings DUPR + display
  await open('/app/pages/social-settings/index');
  const st = await page.evaluate(() => ({ dupr: /Connected:/.test(document.body.innerText), display: !!document.querySelector('.ss-display') && document.querySelectorAll('.ss-l').length >= 3, seg: document.querySelectorAll('.ss-l').length }));
  ok('5 Settings: DUPR shows Connected; Display has Appearance + Text size', st.dupr && st.display, st);
  // 6 edit profile sheet
  await open('/app/pages/profile/index');
  const nameEl = await page.$('.bp-name'); if (nameEl) { await nameEl.click(); await wait(1000); }
  const edit = await page.evaluate(() => ({ sheet: !!document.querySelector('.bp-edit'), input: !!document.querySelector('.bp-editin'), value: (document.querySelector('.bp-editin') || {}).value }));
  ok('6 Profile: tapping the name opens Edit profile with the name filled', edit.sheet && edit.input && !!edit.value, edit);
  // 7 comps tiles + 8 share sheet QR
  await open('/app/pages/meets/index?pane=comps');
  const comps = await page.evaluate(() => [...document.querySelectorAll('.dv-leaguet')].map((e) => e.textContent));
  ok('7 Discover › Comps: Standings · Schedule · Playoffs · Results tiles', comps.length === 4, { comps });
  await open('/app/pages/meet/index?id=' + MEET);
  const sh = await page.$$('.ah-act'); if (sh.length) { await sh[0].click(); await wait(1200); }
  const share = await page.evaluate(() => ({ sheet: !!document.querySelector('.sh2'), qr: !!document.querySelector('.sh2-qr svg'), url: (document.querySelector('.sh2-url') || {}).textContent }));
  ok('8 Meet share → sheet with a QR and the link', share.sheet && share.qr && /pages\/meet/.test(share.url || ''), share);
  ok('9 no page errors', errs.length === 0, { errs: errs.slice(0, 3) });
  await browser.close();
  const pass = checks.filter((c) => c.pass).length;
  const v = { id: 'partials-v1', at: new Date().toISOString(), condition_fired: true, verdict: pass === checks.length ? 'pass' : 'fail', pass, total: checks.length, evidence: JSON.stringify(checks.map((c) => c.name + '=' + (c.pass ? 'ok' : 'FAIL') + ' ' + JSON.stringify(c.detail))), detail: 'join by code, duplicate, saved players, post detail, DUPR connect, edit profile, comps, share QR — live app as tester2', checks };
  fs.writeFileSync('/root/social-engine/probes/partials-v1.verdict.json', JSON.stringify(v, null, 2));
  console.log(v.verdict + ' ' + pass + '/' + checks.length); process.exit(v.verdict === 'pass' ? 0 : 1);
})();

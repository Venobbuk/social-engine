// UAT SHELL PROBE — https://uat.social.silkvo.com/uat.html driven with the real cursor (page.mouse.click on bounding
// boxes): a tester opens the role page, taps "Sign in as …", and lands in the app AS that persona. Facts checked:
// GET /api/v1/auth/me (who the hkpl session is) and POST /api/i (who the engine token is) from inside the page, plus what
// the screen shows (Home's NEXT UP / THIS WEEK, Community's My clubs, the /admin console). Verdict:
// /root/social-engine/probes/uat-shell.verdict.json · shots /root/walk/_uat-shell-*.png
'use strict';
const fs = require('fs');
const puppeteer = require('/root/hkpl-server/node_modules/puppeteer-core');
const BASE = 'https://uat.social.silkvo.com';
const ev = []; let ok = true;
const check = (label, pass, detail) => { ev.push((pass ? 'PASS ' : 'FAIL ') + label + (detail ? ' — ' + detail : '')); ok = ok && pass; console.log(ev[ev.length - 1]); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

// the element whose visible text matches, clicked at its centre with the mouse
async function clickText(page, re, sel = '*') {
  const h = await page.evaluateHandle((reS, sel) => { const r = new RegExp(reS); const els = [...document.querySelectorAll(sel)].filter((e) => r.test((e.textContent || '').trim()) && e.getBoundingClientRect().width > 0); return els.sort((a, b) => a.textContent.length - b.textContent.length)[0] || null; }, re.source, sel);
  const el = h.asElement(); if (!el) return false;
  await el.evaluate((e) => e.scrollIntoView({ block: 'center' })); await sleep(300);
  const b = await el.boundingBox(); if (!b) return false;
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); return true;
}
const whoHkpl = (page) => page.evaluate(() => fetch('/api/v1/auth/me', { credentials: 'include' }).then((r) => r.json()).then((j) => ({ email: (j.user || j).email, role: (j.user || j).role })).catch((e) => ({ err: String(e) })));
const whoEngine = (page) => page.evaluate(() => { let t = ''; try { t = localStorage.getItem('boyau_social_token') || ''; const j = JSON.parse(t); t = (j && typeof j === 'object' && 'data' in j) ? j.data : j; /* Taro's H5 storage wraps the value as {data} */ } catch (e) { /* blocked */ } if (!t) return { none: true }; return fetch('/api/i', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ i: t }) }).then((r) => r.json()).then((j) => ({ id: j.id, username: j.username, name: j.name })).catch((e) => ({ err: String(e) })); });

async function signInAs(page, slug, shot) {
  await page.goto(BASE + '/uat.html', { waitUntil: 'networkidle2', timeout: 60000 }); await sleep(800);
  const hit = await clickText(page, new RegExp('^Sign in as .*' + slug + '$|^Open /admin as .*' + slug + '$'), 'a.cta');
  if (!hit) throw new Error('no sign-in button for ' + slug);
  await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 }).catch(() => undefined); await sleep(4000);
  await page.screenshot({ path: '/root/walk/_uat-shell-' + shot + '.png' }).catch(() => undefined);
  return { url: page.url().replace(BASE, ''), text: await page.evaluate(() => document.body.innerText).catch(() => '') };
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  const page = await browser.newPage(); await page.setViewport({ width: 412, height: 915 }); await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]); // qa.html scrolls smoothly — a click right after scrollIntoView lands on the pre-scroll coordinates (walk-day 2 flake: ken/mei/admin cards below the fold)
  const personas = JSON.parse(fs.readFileSync('/root/uat-personas.json', 'utf8')).personas;
  const eng = (slug) => (personas.find((p) => p.slug === slug) || {}).engineUserId;

  // 0. the front door: / lands on the role page; the page renders every role card
  await page.goto(BASE + '/', { waitUntil: 'networkidle2', timeout: 60000 }); await sleep(1000);
  let text = await page.evaluate(() => document.body.innerText);
  await page.screenshot({ path: '/root/walk/_uat-shell-00-page.png', fullPage: false }).catch(() => undefined);
  const cards = await page.$$eval('article.role', (a) => a.map((x) => x.getAttribute('data-role')));
  check('0 / lands on the role page (/qa.html; /uat.html is the old stub) with the role cards', /\/(uat|qa)\.html$/.test(page.url()) && cards.length >= 6, page.url().replace(BASE, '') + ' · cards ' + cards.join(','));
  const dyn = await page.$$eval('a.dyn', (a) => a.map((x) => x.getAttribute('href')));
  check('0b task links resolved to the live meet / club ids', dyn.some((h) => /meet\/index\?id=/.test(h)) && dyn.some((h) => /community\/index\?id=/.test(h)), dyn.filter((h, i, s) => s.indexOf(h) === i).slice(0, 3).join(' '));

  // 1. a task tick persists across a reload (localStorage)
  const before = await page.$eval('#role-host-ken .cnt', (e) => e.textContent);
  const tickEl = await page.$('#tick-host-ken-0'); await tickEl.evaluate((e) => e.scrollIntoView({ block: 'center' })); await sleep(400); const tb = await tickEl.boundingBox(); await page.mouse.click(tb.x + tb.width / 2, tb.y + tb.height / 2); await sleep(300);
  await page.reload({ waitUntil: 'networkidle2' }); await sleep(800);
  const on = await page.$eval('#tick-host-ken-0', (e) => e.getAttribute('aria-checked'));
  const after = await page.$eval('#role-host-ken .cnt', (e) => e.textContent);
  await page.screenshot({ path: '/root/walk/_uat-shell-01-tick.png' }).catch(() => undefined);
  check('1 a ticked task survives a reload', on === 'true' && Number(after) === Number(before) + 1, 'aria-checked=' + on + ' count ' + before + '→' + after);
  await page.evaluate(() => { try { localStorage.removeItem('gb_uat_tasks'); } catch (e) { /* blocked */ } });

  // 2. host-ken: Home, signed in, NEXT UP is his meet
  let r = await signInAs(page, 'host-ken', '02-ken');
  let me = await whoHkpl(page), en = await whoEngine(page);
  check('2 "Sign in as host-ken" lands on the app Home as Ken (hkpl session)', /\/app\/pages\/home\/index/.test(r.url) && me.email === 'uat+host-ken@hkpl-test.silkvo.com', r.url + ' · me=' + JSON.stringify(me));
  check('2b Home shows NEXT UP with UAT Tuesday Doubles', /NEXT UP/.test(r.text) && /UAT Tuesday Doubles/.test(r.text), clean(r.text).slice(0, 140));
  check('2c the engine token is Ken\'s own engine user', en.id === eng('host-ken'), JSON.stringify(en) + ' expected ' + eng('host-ken'));

  // 3. clubowner-mei: Community › My clubs shows the club
  r = await signInAs(page, 'clubowner-mei', '03-mei-home');
  me = await whoHkpl(page); en = await whoEngine(page);
  check('3 "Sign in as clubowner-mei" signs in as Mei (hkpl + engine)', me.email === 'uat+clubowner-mei@hkpl-test.silkvo.com' && en.id === eng('clubowner-mei'), r.url + ' · me=' + JSON.stringify(me) + ' · engine=' + JSON.stringify(en));
  await page.goto(BASE + '/app/pages/community/index?lang=en', { waitUntil: 'networkidle2', timeout: 60000 }); await sleep(4000);
  text = await page.evaluate(() => document.body.innerText);
  await page.screenshot({ path: '/root/walk/_uat-shell-03-mei-clubs.png' }).catch(() => undefined);
  check('3b Community › My clubs shows "UAT Paddle Club"', /My clubs/i.test(text) && /UAT Paddle Club/.test(text), clean(text).slice(0, 140));

  // 4. admin: /admin console with a TENANT_ADMIN session
  r = await signInAs(page, 'admin', '04-admin');
  me = await whoHkpl(page);
  check('4 "Open /admin as admin" lands on the admin console as TENANT_ADMIN', /^\/admin/.test(r.url) && me.role === 'TENANT_ADMIN' && me.email === 'uat+admin@hkpl-test.silkvo.com', r.url + ' · me=' + JSON.stringify(me) + ' · ' + clean(r.text).slice(0, 80));

  // 5. player-amy: new player — onboarding first (nothing yet), then Home signed in with no NEXT UP
  r = await signInAs(page, 'player-amy', '05-amy-first');
  me = await whoHkpl(page);
  const firstUrl = r.url;
  if (!/home\/index/.test(r.url)) { await page.goto(BASE + '/app/pages/home/index?lang=en', { waitUntil: 'networkidle2', timeout: 60000 }); await sleep(4000); r = { url: page.url().replace(BASE, ''), text: await page.evaluate(() => document.body.innerText) }; }
  en = await whoEngine(page);
  await page.screenshot({ path: '/root/walk/_uat-shell-05-amy-home.png' }).catch(() => undefined);
  check('5 "Sign in as player-amy" signs in as Amy; first stop ' + (/onboard/.test(firstUrl) ? 'onboarding (new player)' : firstUrl), me.email === 'uat+player-amy@hkpl-test.silkvo.com' && en.id === eng('player-amy'), 'first=' + firstUrl + ' · me=' + JSON.stringify(me) + ' · engine=' + JSON.stringify(en));
  check('5b Home signed in, no NEXT UP (THIS WEEK banner, Find a game)', /home\/index/.test(r.url) && !/NEXT UP/.test(r.text) && /THIS WEEK|Find a game|meets near you/i.test(r.text) && !/Sign in or sign up/.test(r.text), clean(r.text).slice(0, 140));

  await browser.close();
  fs.writeFileSync('/root/social-engine/probes/uat-shell.verdict.json', JSON.stringify({ id: 'uat-shell', at: new Date().toISOString(), condition_fired: true, verdict: ok ? 'pass' : 'fail', page: BASE + '/uat.html', evidence: ev }, null, 1));
  console.log(ok ? 'pass' : 'fail'); process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('PROBE ERROR', e); ev.push('FAIL probe error — ' + e.message); fs.writeFileSync('/root/social-engine/probes/uat-shell.verdict.json', JSON.stringify({ id: 'uat-shell', at: new Date().toISOString(), condition_fired: true, verdict: 'fail', evidence: ev }, null, 1)); process.exit(1); });

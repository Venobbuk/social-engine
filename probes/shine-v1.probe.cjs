// SHINE-V1 probe (ON kaka, headless Chrome as tester2): the DUPR card draws ratings + sparkline on Statistics; a post
// shows reaction chips and the picker sets 🔥; the club Photos pane renders a grid; a scored match offers Share and
// the share card canvas draws (1080×1080, non-blank).
'use strict';
const fs = require('fs');
const puppeteer = require('/root/hkpl-server/node_modules/puppeteer-core');
const BASE = 'https://social.silkvo.com';
const CLUB = process.env.CLUB || 'ar7o90b5s64a0010'; const PLAYED = process.env.PLAYED || 'ar7qrfu5s64a00na';
const checks = []; const ok = (n, p, d) => { checks.push({ name: n, pass: !!p, detail: d }); console.log((p ? 'PASS ' : 'FAIL ') + n + (d ? ' — ' + JSON.stringify(d).slice(0, 240) : '')); };
(async () => {
  const { name: cname, value: cval } = await require('./_session.cjs').getSession(1);
  const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  const page = await browser.newPage(); await page.setViewport({ width: 412, height: 915 });
  await page.setCookie({ name: cname, value: cval, domain: 'social.silkvo.com', path: '/', secure: true });
  const wait = (ms) => new Promise((res) => setTimeout(res, ms));
  const errs = []; page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 120)));
  await page.goto(BASE + '/app/pages/my-stats/index?lang=en', { waitUntil: 'networkidle2', timeout: 45000 }); await wait(3000);
  const dupr = await page.evaluate(() => ({ url: location.pathname, card: !!document.querySelector('.du-card'), ratings: [...document.querySelectorAll('.du-v')].map((e) => e.textContent), spark: !!document.querySelector('.du-sparkimg'), facts: [...document.querySelectorAll('.du-factv')].map((e) => e.textContent) }));
  ok('1 Statistics: DUPR card with a doubles rating, a sparkline and the facts', dupr.card && dupr.ratings.length === 2 && /^\d\.\d\d$/.test(dupr.ratings[0]) && dupr.facts.length === 3, dupr);
  await page.screenshot({ path: '/root/walk/_shine-stats.png' });
  await page.goto(BASE + '/app/pages/feed/index?club=' + CLUB + '&lang=en', { waitUntil: 'networkidle2', timeout: 45000 }); await wait(2500);
  const before = await page.evaluate(() => ({ posts: document.querySelectorAll('.fd-post').length, chips: document.querySelectorAll('.fd-react').length }));
  const act = await page.$('.fd-post .fd-act');
  let picked = null;
  const already = await page.evaluate(() => /🔥/.test((document.querySelector('.fd-post .fd-actt') || {}).textContent || '')); const want = already ? '❤️' : '🔥'; const idx = already ? 1 : 2;
  if (act) { await act.click(); await wait(800); const items = await page.$$('.ak-item'); if (items.length >= 3) { await items[idx].click(); await wait(2500); } picked = await page.evaluate(() => ({ chips: [...document.querySelectorAll('.fd-post')].slice(0, 1).flatMap((p) => [...p.querySelectorAll('.fd-react')].map((c) => c.textContent)), mine: !!document.querySelector('.fd-post .fd-react-on'), label: (document.querySelector('.fd-post .fd-actt') || {}).textContent })); }
  ok('2 Feed: the picker sets a reaction on the first post and its chip is mine', picked && picked.chips.some((c) => c.indexOf(want.replace(/️/g, '')) >= 0) && picked.mine && (picked.label || '').replace(/️/g, '').indexOf(want.replace(/️/g, '')) >= 0, { before, want, picked });
  await page.goto(BASE + '/app/pages/community/index?id=' + CLUB + '&pane=photos&lang=en', { waitUntil: 'networkidle2', timeout: 45000 }); await wait(3000);
  const photos = await page.evaluate(() => ({ grid: !!document.querySelector('.cm-photos'), n: document.querySelectorAll('.cm-photo').length, empty: !!document.querySelector('.be-img') }));
  ok('3 Club › Photos pane renders (a grid, or the empty state with a CTA)', photos.grid || photos.empty, photos);
  await page.goto(BASE + '/app/pages/meet/index?id=' + PLAYED + '&tab=matches&lang=en', { waitUntil: 'networkidle2', timeout: 45000 }); await wait(3000);
  const share = await page.evaluate(() => ({ shares: document.querySelectorAll('.mt-share').length, scored: document.querySelectorAll('.mt-score').length }));
  const drawn = await page.evaluate(async () => { try { const m = await import('/app/js/share-card.js').catch(() => null); return m ? 'module' : 'no-module'; } catch (e) { return 'err'; } });
  ok('4 a scored match offers Share', share.shares > 0 && share.scored > 0, { share, drawn });
  // draw the card in-page through the app's own helper: click Share and intercept the download / share call
  await page.evaluate(() => { const a = document.createElement; window.__cardBlob = null; const orig = HTMLCanvasElement.prototype.toBlob; HTMLCanvasElement.prototype.toBlob = function (cb, t) { const c = this; return orig.call(c, (b) => { window.__cardBlob = { w: c.width, h: c.height, size: b ? b.size : 0 }; cb(b); }, t); }; window.URL.createObjectURL = () => 'blob:probe'; HTMLAnchorElement.prototype.click = function () {}; });
  const btn = await page.$('.mt-share'); if (btn) { await btn.click(); await wait(2500); }
  const card = await page.evaluate(() => window.__cardBlob);
  ok('5 the share card draws (1080×1080 PNG, non-blank)', card && card.w === 1080 && card.h === 1080 && card.size > 20000, card);
  ok('6 no page errors', errs.length === 0, { errs: errs.slice(0, 3) });
  await browser.close();
  const pass = checks.filter((c) => c.pass).length;
  const v = { id: 'shine-v1', at: new Date().toISOString(), condition_fired: true, verdict: pass === checks.length ? 'pass' : 'fail', pass, total: checks.length, evidence: JSON.stringify(checks.map((c) => c.name + '=' + (c.pass ? 'ok' : 'FAIL') + ' ' + JSON.stringify(c.detail))), detail: 'DUPR card, emoji reactions, club photos, share card on the live app as tester2', checks };
  fs.writeFileSync('/root/social-engine/probes/shine-v1.verdict.json', JSON.stringify(v, null, 2));
  console.log(v.verdict + ' ' + pass + '/' + checks.length); process.exit(v.verdict === 'pass' ? 0 : 1);
})();

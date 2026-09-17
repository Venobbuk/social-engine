// GRADE-V2 probe (ON kaka): the re-grade's remaining rows. Engine: a reset generation ignores the cleared matches
// (counts start at zero), clubs/members answers a plain member. Page (headless Chrome, tester2): no "?" avatar on
// signed-out Home, the brand reads GripBat / 抓拍 by language, the feed composer is not monospace, a notification
// row for a meet deep-links even without a link, the inbox direct thread is titled with the other person.
'use strict';
const fs = require('fs');
const puppeteer = require('/root/hkpl-server/node_modules/puppeteer-core');
const E = 'http://127.0.0.1:3960/api'; const BASE = 'https://social.silkvo.com';
const ADMIN = fs.readFileSync('/root/social-engine.admintoken', 'utf8').trim();
const T = JSON.parse(fs.readFileSync('/root/boyau-test-accounts.json', 'utf8'))[1];
const api = async (p, b, t) => { const r = await fetch(E + '/' + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...b, ...(t ? { i: t } : {}) }) }); let j = null; try { j = await r.json(); } catch {} return { status: r.status, json: j }; };
const checks = []; const ok = (n, p, d) => { checks.push({ name: n, pass: !!p, detail: d }); console.log((p ? 'PASS ' : 'FAIL ') + n + (d ? ' — ' + JSON.stringify(d).slice(0, 240) : '')); };
const mk = async (tag) => (await api('admin/accounts/create', { username: 'pv' + tag + Date.now().toString(36).slice(-6), password: 'P' + Math.random().toString(36).slice(2, 12) + '!' }, ADMIN)).json;
(async () => {
  const H = await mk('h'), P = []; for (let i = 0; i < 7; i++) P.push(await mk('p' + i));
  const c = await api('meets/create', { name: '[probe] reset', notes: '[probe]', sport: 'pickleball', startAt: new Date(Date.now() + 2 * 86400e3).toISOString(), durationMinutes: 90, capacity: 8, hostPlays: true, autoApprove: true, visibility: 'public', feeType: 'free', venueName: 'Probe Court', lat: 22.3, lng: 114.2 }, H.token);
  const meetId = c.json.id; for (const u of P) await api('meets/join', { meetId }, u.token);
  // a skewed first generation: 1 court, 1 round (4 play, 3 sit), persisted
  await api('meets/matches/generate', { meetId, scheme: 'ROTATING_PARTNERS', courts: 1, limitRounds: 1, prioritizeLeastMatches: true, persist: true }, H.token);
  // reset + 7 rounds: the seat counts of the NEW generation must be even (the cleared round is not a baseline)
  const g = await api('meets/matches/generate', { meetId, scheme: 'ROTATING_PARTNERS', courts: 1, limitRounds: 7, prioritizeLeastMatches: true, persist: true, reset: true }, H.token);
  const count = {}; for (const m of g.json.matches || []) for (const id of [...m.team1Ids, ...m.team2Ids]) count[id] = (count[id] || 0) + 1;
  const vals = Object.values(count); const spread = vals.length ? Math.max(...vals) - Math.min(...vals) : 99;
  const all = (await api('meets/matches/list', { meetId }, H.token)).json || [];
  ok('E1 reset generation: 7 rounds × 1 court over 8 players (28 seats) → 3 or 4 each (spread ≤ 1), only the new rounds remain', g.status === 200 && spread <= 1 && all.length === 7, { counts: vals, total: all.length });
  // members for members
  const club = (await api('channels/create', { name: '[probe] members', description: 'p' }, H.token)).json;
  await api('channels/follow', { channelId: club.id }, P[0].token);
  const m1 = await api('clubs/members', { channelId: club.id }, P[0].token);
  const m2 = await api('clubs/members', { channelId: club.id }, P[1].token);
  ok('E2 clubs/members: a member sees the list, a non-member is refused', m1.status === 200 && m1.json.total >= 2 && m2.status !== 200, { member: m1.status, total: m1.json && m1.json.total, nonMember: m2.status });
  await api('meets/cancel', { meetId }, H.token); await api('channels/update', { channelId: club.id, isArchived: true, name: '[probe] archived' }, H.token);
  for (const u of [H, ...P]) await api('admin/delete-account', { userId: u.id }, ADMIN);

  // page
  const { name: cname, value: cval } = await require('./_session.cjs').getSession(1);
  const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  const wait = (ms) => new Promise((res) => setTimeout(res, ms));
  const anon = await browser.createBrowserContext(); const pa = await anon.newPage(); await pa.setViewport({ width: 412, height: 915 });
  await pa.goto(BASE + '/app/pages/home/index?lang=en', { waitUntil: 'networkidle2', timeout: 45000 }); await wait(1500);
  const home = await pa.evaluate(() => ({ q: (document.body.innerText.match(/\?/g) || []).length, avatarImg: !!document.querySelector('.bi-avimg'), brand: (document.querySelector('.sh-app-brand') || {}).textContent, title: document.title, icon: (document.querySelector('link[rel="icon"]') || {}).href }));
  ok('P1 signed-out Home: silhouette avatar, no "?" text, GripBat brand + mark', home.avatarImg && home.q === 0 && home.brand === 'GripBat' && /GripBat/.test(home.title) && /gripbat-(mark|icon)/.test(home.icon || ''), home);
  await pa.goto(BASE + '/app/pages/home/index?lang=zh_Hant', { waitUntil: 'networkidle2', timeout: 45000 }); await wait(1500);
  const homeZh = await pa.evaluate(() => ({ brand: (document.querySelector('.sh-app-brand') || {}).textContent, title: document.title, mine: /我的抓拍/.test(document.body.innerText), club: /俱樂部/.test(document.body.innerText) }));
  ok('P2 zh Home: brand 抓拍, "我的抓拍", club is 球會 not 俱樂部', homeZh.brand === '抓拍' && /抓拍/.test(homeZh.title) && homeZh.mine && !homeZh.club, homeZh);
  const page = await browser.newPage(); await page.setViewport({ width: 412, height: 915 });
  await page.setCookie({ name: cname, value: cval, domain: 'social.silkvo.com', path: '/', secure: true });
  await page.goto(BASE + '/app/pages/feed/index?lang=en', { waitUntil: 'networkidle2', timeout: 45000 }); await wait(1500);
  const acts = await page.$$('.ah-act'); if (acts.length) await acts[0].click(); await wait(800);
  const font = await page.evaluate(() => { const h = document.querySelector('.fd-input'); const t = h && h.querySelector('textarea'); const cs = t && getComputedStyle(t); return { font: cs && cs.fontFamily, size: cs && cs.fontSize }; });
  ok('P3 feed composer takes the page face (not monospace)', font.font && !/monospace/.test(font.font) && parseFloat(font.size) >= 14, font);
  await page.goto(BASE + '/app/pages/notifications/index?lang=en', { waitUntil: 'networkidle2', timeout: 45000 }); await wait(2000);
  const rowsN = await page.$$('.nt-item');
  let notif = { rows: rowsN.length };
  for (const row of rowsN) { const txt = await row.evaluate((e) => e.textContent || ''); if (/confirmed|invited|cancelled/i.test(txt)) { await row.click(); await wait(2000); notif = { rows: rowsN.length, text: txt.slice(0, 60), url: page.url() }; break; } }
  ok('P4 a meet notification row opens its meet (or, for a row minted before it carried a name, My activities)', /\/pages\/meet\/index\?id=|\/pages\/meets\/index\?mine=1/.test(notif.url || ''), notif);
  await page.goto(BASE + '/app/pages/inbox/index?filter=direct&lang=en', { waitUntil: 'networkidle2', timeout: 45000 }); await wait(2000);
  const direct = await page.evaluate(() => [...document.querySelectorAll('.ib-item')].map((e) => e.textContent || '').slice(0, 5));
  ok('P5 inbox direct threads are titled with the other person (not 波友測試 2)', direct.length > 0 && direct.every((t) => !/波友測試 2|GripBat測試 2/.test(t.split(/You:|:/)[0])), { direct: direct.map((t) => t.slice(0, 40)) });
  await browser.close();
  const pass = checks.filter((c) => c.pass).length;
  const v = { id: 'grade-v2', at: new Date().toISOString(), condition_fired: true, verdict: pass === checks.length ? 'pass' : 'fail', pass, total: checks.length, evidence: JSON.stringify(checks.map((c) => c.name + '=' + (c.pass ? 'ok' : 'FAIL') + ' ' + JSON.stringify(c.detail))), detail: 'reset baseline + members on the live engine; GripBat brand, silhouette avatar, composer font, notification deep-link, inbox titles in headless Chrome', checks };
  fs.writeFileSync('/root/social-engine/probes/grade-v2.verdict.json', JSON.stringify(v, null, 2));
  console.log(v.verdict + ' ' + pass + '/' + checks.length); process.exit(v.verdict === 'pass' ? 0 : 1);
})();

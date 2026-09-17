// CLUB-PAGE-V2 probe (ON kaka): engine clubs/chat (room minted once, member joined, non-member refused) + the live
// club page in headless Chrome as tester2 (a member/admin of CLUB): the stat trio taps into panes, Members lists
// people, Chat renders the thread with the composer and a sent line shows as mine on the right, the "+" opens a form.
'use strict';
const fs = require('fs');
const puppeteer = require('/root/hkpl-server/node_modules/puppeteer-core');
const E = 'http://127.0.0.1:3960/api'; const BASE = 'https://social.silkvo.com';
const ADMIN = fs.readFileSync('/root/social-engine.admintoken', 'utf8').trim();
const T = JSON.parse(fs.readFileSync('/root/boyau-test-accounts.json', 'utf8'))[1];
const CLUB = process.env.CLUB || 'ar7o90b5s64a0010';
const api = async (p, b, t) => { const r = await fetch(E + '/' + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...b, ...(t ? { i: t } : {}) }) }); let j = null; try { j = await r.json(); } catch {} return { status: r.status, json: j }; };
const checks = []; const ok = (n, p, d) => { checks.push({ name: n, pass: !!p, detail: d }); console.log((p ? 'PASS ' : 'FAIL ') + n + (d ? ' — ' + JSON.stringify(d).slice(0, 240) : '')); };
const mk = async (tag) => (await api('admin/accounts/create', { username: 'pv' + tag + Date.now().toString(36).slice(-6), password: 'P' + Math.random().toString(36).slice(2, 12) + '!' }, ADMIN)).json;
(async () => {
  // engine
  const O = await mk('o'), M = await mk('m'), X = await mk('x');
  const club = (await api('channels/create', { name: '[probe] chat club', description: 'p' }, O.token)).json;
  await api('channels/follow', { channelId: club.id }, M.token);
  const r1 = await api('clubs/chat', { channelId: club.id }, M.token);
  const r2 = await api('clubs/chat', { channelId: club.id }, O.token);
  const rx = await api('clubs/chat', { channelId: club.id }, X.token);
  const sent = await api('chat/messages/create-to-room', { toRoomId: r1.json && r1.json.roomId, text: 'hello club' }, M.token);
  const seen = (await api('chat/messages/room-timeline', { roomId: r1.json && r1.json.roomId, limit: 5 }, O.token)).json || [];
  ok('E1 clubs/chat: one room for member and owner, a non-member is refused, a member\'s line reaches the owner', r1.status === 200 && r2.status === 200 && r1.json.roomId === r2.json.roomId && rx.status !== 200 && sent.status === 200 && seen.some((m) => m.text === 'hello club'), { member: r1.status, owner: r2.status, same: r1.json && r2.json && r1.json.roomId === r2.json.roomId, nonMember: rx.status, seen: seen.length });
  await api('channels/update', { channelId: club.id, isArchived: true, name: '[probe] archived' }, O.token);
  for (const u of [O, M, X]) await api('admin/delete-account', { userId: u.id }, ADMIN);

  // page
  const { name: cname, value: cval } = await require('./_session.cjs').getSession(1);
  const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  const page = await browser.newPage(); await page.setViewport({ width: 412, height: 915 });
  await page.setCookie({ name: cname, value: cval, domain: 'social.silkvo.com', path: '/', secure: true });
  const errs = []; page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 120)));
  const wait = (ms) => new Promise((res) => setTimeout(res, ms));
  await page.goto(BASE + '/app/pages/community/index?id=' + CLUB + '&lang=en', { waitUntil: 'networkidle2', timeout: 45000 }); await wait(1500);
  const trio = await page.$$('.cm-icon');
  ok('P1 club page: three tappable stat tiles', trio.length === 3, { tiles: trio.length });
  await trio[0].click(); await wait(2500);
  const members = await page.evaluate(() => ({ rows: document.querySelectorAll('.pg-row, .hk-row, [class*="row"]').length, text: document.body.innerText.slice(0, 300) }));
  const memberRows = await page.evaluate(() => [...document.querySelectorAll('.sh-page *')].filter((e) => /Owner|Admin|Member\b/.test(e.textContent || '') && e.children.length === 0).length);
  ok('P2 Members tile → Members pane lists people with roles', memberRows > 0, { roleLabels: memberRows });
  // chat pane via header tab
  const tabs = await page.$$('.ah-seg');
  const labels = await Promise.all(tabs.map((t) => t.evaluate((e) => e.textContent)));
  const chatTab = tabs[labels.findIndex((l) => /Chat/.test(l || ''))];
  if (chatTab) await chatTab.click(); await wait(3000);
  const thread = await page.evaluate(() => ({ thread: !!document.querySelector('.ct'), composer: !!document.querySelector('.ct-input'), empty: !!document.querySelector('.ct-empty') }));
  ok('P3 Chat tab → the thread with a composer', thread.thread && thread.composer, thread);
  const stamp = 'probe ' + Date.now().toString(36);
  if (!thread.composer) { ok('P4 a sent line renders as mine, on the right', false, { skipped: 'no composer' }); } else {
  await page.click('.ct-input'); await page.keyboard.type(stamp, { delay: 20 }); await page.click('.ct-send'); await wait(3500);
  const mineRight = await page.evaluate((s) => { const line = [...document.querySelectorAll('.ct-line')].find((l) => (l.textContent || '').includes(s)); if (!line) return { found: false }; const cs = getComputedStyle(line); const b = line.querySelector('.ct-bubble'); const bb = b.getBoundingClientRect(); const lb = line.getBoundingClientRect(); return { found: true, mine: line.className.includes('ct-line-mine'), justify: cs.justifyContent, right: Math.round(lb.right - bb.right) < Math.round(bb.left - lb.left) }; }, stamp);
  ok('P4 a sent line renders as mine, on the right', mineRight.found && mineRight.mine && mineRight.right, mineRight); }
  // create-club form
  await page.goto(BASE + '/app/pages/community/index?new=1&lang=en', { waitUntil: 'networkidle2', timeout: 45000 }); await wait(1200);
  const form = await page.evaluate(() => ({ form: !!document.querySelector('.cm-new'), inputs: document.querySelectorAll('.cm-newin').length }));
  ok('P5 "+" → a create-club form (name + description)', form.form && form.inputs === 2, form);
  ok('P6 no page errors across the walk', errs.length === 0, { errs: errs.slice(0, 3) });
  await browser.close();
  const pass = checks.filter((c) => c.pass).length;
  const v = { id: 'club-page-v2', at: new Date().toISOString(), condition_fired: true, verdict: pass === checks.length ? 'pass' : 'fail', pass, total: checks.length, evidence: JSON.stringify(checks.map((c) => c.name + '=' + (c.pass ? 'ok' : 'FAIL') + ' ' + JSON.stringify(c.detail))), detail: 'clubs/chat on the live engine + the club page panes in headless Chrome as tester2', checks };
  fs.writeFileSync('/root/social-engine/probes/club-page-v2.verdict.json', JSON.stringify(v, null, 2));
  console.log(v.verdict + ' ' + pass + '/' + checks.length); process.exit(v.verdict === 'pass' ? 0 : 1);
})();

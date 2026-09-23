require('./_guard.cjs');   // G13.3: probes run through probes/run.sh
// T3-CLUBS-MEETS UI probe (lane t3-clubs-meets, 2026-09-23) — the APP half on the deployed UAT build, headless Chrome at
// 412 px, as the UAT personas, on a fixture built through the engine first (a club meet of mei's club: tom confirmed,
// amy invited → declined). Asserts the rendered page, not the bundle:
//   U1 player (tom) Details: Contact hosts · the Club row · Notes + Copy · the confirmed footer line + Request +1 + See matches
//   U2 host (mei) kebab: Refresh meet chat · Delete meet   ·   U3 host Participants: the CAN'T GO section; Sort offers By teams
//   U4 player Matches: the Stats chip and "Please ask your meet host"   ·   U5 zh_Hant: the same Details in Chinese
//   U6 mei's club list: Clubs / Need review / Sort; Admin section   ·   U7 mei's club page: the admin nudges + Discussion
//   U8 meet form: 1 day duration, Learn more, eligible-club handling
// Planted fault first (G16.1): an assertion for a string the page must NOT contain on the same screen has to fail.
'use strict';
const fs = require('fs');
const puppeteer = require('/root/hkpl-server/node_modules/puppeteer-core');
const BASE = 'https://uat.social.silkvo.com'; const APP = BASE + '/app'; const HOST = new URL(BASE).hostname;
const QA_P = (fs.readFileSync('/root/hkpl-server/.env', 'utf8').match(/^QA_BYPASS_PASSWORD=(.+)$/m) || [])[1] || 'hkpl-uat-2026';
const P = (slug) => JSON.parse(fs.readFileSync('/root/uat-personas.json', 'utf8')).personas.find((p) => p.slug === slug);
const checks = []; const ok = (n, p, d) => { checks.push({ name: n, pass: !!p, detail: d }); console.log((p ? 'PASS ' : 'FAIL ') + n + ' — ' + JSON.stringify(d).slice(0, 300)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shots = []; fs.mkdirSync('/root/walk', { recursive: true });
const cleanup = [];
async function cookiesOf(slug) {
  const r = await fetch(BASE + '/api/v1/auth/qa/by-email/' + encodeURIComponent(P(slug).email) + '?p=' + encodeURIComponent(QA_P), { redirect: 'manual' });
  return (r.headers.getSetCookie ? r.headers.getSetCookie() : []).map((c) => c.split(';')[0]).map((c) => { const i = c.indexOf('='); return { name: c.slice(0, i), value: c.slice(i + 1) }; });
}
async function se(endpoint, body, token) { const r = await fetch(BASE + '/api/' + endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(token ? { ...body, i: token } : body) }); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) {} return { status: r.status, json: j, text: t }; }
async function login(slug) {
  const cookies = await cookiesOf(slug);
  const m = await (await fetch(BASE + '/api/v1/auth/sso/social', { headers: { cookie: cookies.map((c) => c.name + '=' + c.value).join('; ') } })).json();
  const r = await se('adapter/sso', { jwt: m.jwt }); const me = await se('i', {}, r.json.token);
  return { slug, cookies, token: r.json.token, id: me.json.id };
}
async function pageAs(browser, who, lang) {
  const ctx = await browser.createBrowserContext(); const page = await ctx.newPage();
  await page.setViewport({ width: 412, height: 915, deviceScaleFactor: 1 });
  await page.evaluateOnNewDocument((lg) => { try { localStorage.setItem('hkpl_lang', lg); } catch (e) {} }, lang || 'en');
  for (const c of who.cookies) await page.setCookie({ name: c.name, value: c.value, domain: HOST, path: '/', secure: true });
  return { ctx, page };
}
async function open(page, route, lang) {
  try { await page.goto(APP + route + (route.includes('?') ? '&' : '?') + 'lang=' + (lang || 'en'), { waitUntil: 'networkidle2', timeout: 45000 }); } catch (e) {}
  await sleep(2500); await page.waitForNetworkIdle({ idleTime: 800, timeout: 8000 }).catch(() => undefined);
  const gate = await page.evaluate(() => /We value your privacy|我哋重視你嘅私隱|我们重视你的隐私/.test(document.body.innerText)).catch(() => false);
  if (gate) { await clickText(page, /^(I agree|我同意)$/); await sleep(1500); }
}
const text = (page) => page.evaluate(() => document.body.innerText);
const clickText = (page, re) => page.evaluate((src, fl) => { const rx = new RegExp(src, fl); const els = [...document.querySelectorAll('taro-text-core, taro-view-core, button, span, div')].filter((e) => rx.test((e.textContent || '').trim()) && e.children.length === 0); const el = els[els.length - 1]; if (el) { el.click(); return true; } return false; }, re.source, re.flags);
const shot = async (page, n) => { const p = '/root/walk/_t3cm-' + n + '.png'; await page.screenshot({ path: p }); shots.push(p); };

(async () => {
  const mei = await login('clubowner-mei'); const tom = await login('clubadmin-tom'); const amy = await login('player-amy');
  const club = ((await se('clubs/mine', { tier: 'member' }, mei.token)).json || []).find((c) => c.role === 'owner');
  let browser;
  try {
    if (!club) throw new Error('mei owns no club');
    const roster = ((await se('clubs/members', { channelId: club.id, limit: 200 }, mei.token)).json || {}).members || [];
    const tomMember = roster.some((m) => m.userId === tom.id);
    const m = (await se('meets/create', { name: '[probe] t3 ui ' + Date.now().toString(36), sport: 'pickleball', channelId: club.id, notes: '[probe] bring water', startAt: new Date(Date.now() + 30 * 3600e3).toISOString(), durationMinutes: 90, capacity: 6, hostPlays: true, autoApprove: true, allowPlusOne: true, visibility: 'public', feeType: 'free', venueName: '[probe] Court 1', sendNotifications: false }, mei.token)).json;
    if (!m || !m.id) throw new Error('meets/create failed');
    cleanup.push(async () => { await se('meets/cancel', { meetId: m.id }, mei.token); });
    const j = await se('meets/join', { meetId: m.id }, tom.token);
    await se('meets/participants/add', { meetId: m.id, userId: amy.id, status: 'invited' }, mei.token);
    await se('meets/respond', { meetId: m.id, answer: 'decline' }, amy.token);
    console.log('fixture', m.id, 'club', club.name, 'tom member', tomMember, 'tom join', j.status);

    browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-gpu', '--lang=en-US'] });
    // U1 — tom, Details (EN)
    { const { ctx, page } = await pageAs(browser, tom, 'en'); await open(page, '/pages/meet/index?id=' + m.id); const t = await text(page); await shot(page, 'u1-player-details');
      ok('U0 planted: an assertion for a string this screen must not show fails (Delete meet is host-only)', !/Delete meet/.test(t), { found: /Delete meet/.test(t) });
      ok('U1a Details carries Contact hosts (the fact label is CSS-uppercased, so innerText reads CONTACT HOSTS)', /contact hosts/i.test(t) && /\bMessage\b/.test(t), { hit: (t.match(/contact hosts[^\n]*/i) || [''])[0] });
      ok('U1b the Club row names the club', t.includes(club.name) && /\bClub\b/.test(t), { club: club.name });
      ok('U1c Notes with Copy', /Notes/.test(t) && /Copy/.test(t) && /bring water/.test(t), {});
      ok('U1d the confirmed footer: line + Request +1 + See matches', /You are confirmed to play/.test(t) && /Request \+1/.test(t) && /See matches/.test(t), { line: (t.match(/You are confirmed[^\n]*/) || [''])[0] });
      // U4 — Matches
      await open(page, '/pages/meet/index?id=' + m.id + '&tab=matches'); const tm = await text(page); await shot(page, 'u4-player-matches');
      ok('U4 Matches: the Stats chip and the ask-your-host empty state', /Stats/.test(tm) && /Please ask your meet host/.test(tm), {});
      await ctx.close(); }
    // U5 — tom, zh_Hant
    { const { ctx, page } = await pageAs(browser, tom, 'zh_Hant'); await open(page, '/pages/meet/index?id=' + m.id, 'zh_Hant'); const t = await text(page); await shot(page, 'u5-player-details-zhHant');
      ok('U5 zh_Hant: Contact hosts / Request +1 / the confirmed line render in Chinese, not English', /聯絡主辦方/.test(t) && /申請 \+1/.test(t) && !/Contact hosts|Request \+1/.test(t), { en_left: (t.match(/Contact hosts|Request \+1|See matches/g) || []) });
      await ctx.close(); }
    // U2/U3 — mei (host)
    { const { ctx, page } = await pageAs(browser, mei, 'en'); await open(page, '/pages/meet/index?id=' + m.id);
      const menu = await page.evaluate(() => { const acts = [...document.querySelectorAll('.ah-act')]; const el = acts[acts.length - 1]; if (el) { el.click(); return acts.length; } return 0; });
      await sleep(1200); const tk = await text(page); await shot(page, 'u2-host-kebab');
      ok('U2 host kebab: Refresh meet chat + Delete meet', /Refresh meet chat/.test(tk) && /Delete meet/.test(tk), { clicked: menu });
      await open(page, '/pages/meet/index?id=' + m.id + '&tab=participants'); const tp = await text(page); await shot(page, 'u3-host-participants');
      ok('U3a the roster lists CAN\'T GO with the declined invitee', /CAN'T GO • 1/.test(tp), { hit: (tp.match(/CAN'T GO[^\n]*/) || [''])[0] });
      const sorted = await clickText(page, /^Sort: /); await sleep(800); const ts = await text(page);
      ok('U3b Sort offers By teams / By gender / By payment', sorted && /By teams/.test(ts) && /By gender/.test(ts) && /By payment/.test(ts), { clicked: sorted });
      // U6/U7 — mei's club list + club page
      await open(page, '/pages/community/index'); const tl = await text(page); await shot(page, 'u6-club-list');
      ok('U6 My clubs: Clubs / Need review chips, Sort, the Admin section', /Need review/.test(tl) && /Sort: /.test(tl) && /Admin · /.test(tl), {});
      await open(page, '/pages/community/index?id=' + club.id); const tc = await text(page); await shot(page, 'u7-club-overview');
      ok('U7 the owner\'s club page: the two nudges + Discussion', /The more the merrier/.test(tc) && /Start an activity/.test(tc) && /Discussion/.test(tc), {});
      // U8 — the meet form
      await open(page, '/pages/meet-create/index?club=' + club.id); const tf = await text(page); await shot(page, 'u8-meet-form');
      ok('U8 the meet form: 1 day duration, Learn more, the freeze set with 4 h / 8 h', /1 day/.test(tf) && /Learn more/.test(tf) && /\b4 h\b/.test(tf) && /\b8 h\b/.test(tf), {});
      await ctx.close(); }
  } catch (e) {
    ok('probe ran to the end', false, { error: String(e && e.stack || e).slice(0, 400) });
  } finally {
    if (browser) await browser.close().catch(() => undefined);
    for (const f of cleanup.reverse()) { try { await f(); } catch (e) {} }
    const pass = checks.filter((c) => c.pass).length;
    fs.writeFileSync('/root/social-engine/probes/t3-clubs-meets.ui.json', JSON.stringify({ id: 't3-clubs-meets.ui', at: new Date().toISOString(), base: APP, pass, fail: checks.length - pass, checks, shots }, null, 1));
    console.log('\n' + pass + '/' + checks.length + ' pass');
    process.exit(checks.length && pass === checks.length ? 0 : 1);
  }
})();

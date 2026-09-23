require('./_guard.cjs');   // G13.3: probes run through probes/run.sh
// T3-CLUBS-MEETS fix round — L6 re-check of the six bugs the S3 verifier saw (2026-09-23), on the deployed UAT build and
// engine, as the UAT personas, each with its own planted counter-check:
//   1  Reviewing rows: Cancel request cancels IN THE ENGINE and the page stays on My clubs; Accept joins, page stays
//   2  a meet keeps its venue id on create AND update (read back from meets/show and the DB); a bogus id is dropped
//   3  a private club opened by a stranger: the generic screen, WITHOUT the club's name; its owner still sees the club
//   4  a private club's card says Private (its owner's list), a public one Public — the engine pack carries visibility
//   5  a member opening one post (?note=) is not told to "Join a club"
//   6  a post written right after a rename shows the new name, not "A player"
'use strict';
const fs = require('fs'); const cp = require('child_process');
const puppeteer = require('/root/hkpl-server/node_modules/puppeteer-core');
const BASE = 'https://uat.social.silkvo.com'; const APP = BASE + '/app'; const HOST = new URL(BASE).hostname;
const QA_P = (fs.readFileSync('/root/hkpl-server/.env', 'utf8').match(/^QA_BYPASS_PASSWORD=(.+)$/m) || [])[1] || 'hkpl-uat-2026';
const P = (slug) => JSON.parse(fs.readFileSync('/root/uat-personas.json', 'utf8')).personas.find((p) => p.slug === slug);
const checks = []; const ok = (n, p, d) => { checks.push({ name: n, pass: !!p, detail: d }); console.log((p ? 'PASS ' : 'FAIL ') + n + ' — ' + JSON.stringify(d).slice(0, 300)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); const cleanup = []; const shots = [];
const sql = (q) => cp.execSync('docker exec social-engine-db-1 psql -U social -d se_sbx -tA -c ' + JSON.stringify(q), { encoding: 'utf8' }).trim();
async function cookiesOf(slug) { const r = await fetch(BASE + '/api/v1/auth/qa/by-email/' + encodeURIComponent(P(slug).email) + '?p=' + encodeURIComponent(QA_P), { redirect: 'manual' }); return (r.headers.getSetCookie ? r.headers.getSetCookie() : []).map((c) => c.split(';')[0]).map((c) => { const i = c.indexOf('='); return { name: c.slice(0, i), value: c.slice(i + 1) }; }); }
async function se(endpoint, body, token) { const r = await fetch(BASE + '/api/' + endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(token ? { ...body, i: token } : body) }); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) {} return { status: r.status, json: j, text: t }; }
async function login(slug) { const cookies = await cookiesOf(slug); const m = await (await fetch(BASE + '/api/v1/auth/sso/social', { headers: { cookie: cookies.map((c) => c.name + '=' + c.value).join('; ') } })).json(); const r = await se('adapter/sso', { jwt: m.jwt }); const me = await se('i', {}, r.json.token); return { slug, cookies, token: r.json.token, id: me.json.id, name: me.json.name }; }
async function pageAs(browser, who) { const ctx = await browser.createBrowserContext(); const page = await ctx.newPage(); await page.setViewport({ width: 412, height: 915, deviceScaleFactor: 1 }); await page.evaluateOnNewDocument(() => { try { localStorage.setItem('hkpl_lang', 'en'); } catch (e) {} }); for (const c of who.cookies) await page.setCookie({ name: c.name, value: c.value, domain: HOST, path: '/', secure: true }); return { ctx, page }; }
async function open(page, route) { try { await page.goto(APP + route + (route.includes('?') ? '&' : '?') + 'lang=en', { waitUntil: 'networkidle2', timeout: 45000 }); } catch (e) {} await sleep(2500); await page.waitForNetworkIdle({ idleTime: 800, timeout: 8000 }).catch(() => undefined); }
const text = (page) => page.evaluate(() => document.body.innerText);
const shot = async (page, n) => { const p = '/root/walk/_t3fix-' + n + '.png'; await page.screenshot({ path: p }); shots.push(p); };
// a REAL click on the leaf element whose text matches (the verifier's own method: page.click on the element's box)
async function clickLeaf(page, re) { const h = await page.evaluateHandle((src) => { const rx = new RegExp(src); return [...document.querySelectorAll('taro-button-core, button, taro-text-core, taro-view-core')].reverse().find((e) => rx.test((e.textContent || '').trim()) && [...e.children].every((c) => !rx.test((c.textContent || '').trim()))) || null; }, re.source); const el = h.asElement(); if (!el) return false; await el.click(); return true; }

(async () => {
  const mei = await login('clubowner-mei'); const tom = await login('clubadmin-tom'); const amy = await login('player-amy'); const ken = await login('host-ken');
  let browser;
  try {
    // ---------- fixtures (engine): an approval club amy asks to join, a club that invites amy, a private club, a venue
    const mk = async (name, patch) => { const c = (await se('channels/create', { name }, mei.token)).json; cleanup.push(async () => { await se('channels/update', { channelId: c.id, isArchived: true }, mei.token); }); if (patch) await se('clubs/settings/update', { channelId: c.id, ...patch }, mei.token); return c; };
    const cReq = await mk('[probe] t3fix approval ' + Date.now().toString(36), { gateType: 'approval' });
    const cInv = await mk('[probe] t3fix invite ' + Date.now().toString(36), { gateType: 'approval' });
    const cPriv = await mk('[probe] t3fix hidden ' + Date.now().toString(36), { visibility: 'private' });
    await se('channels/follow', { channelId: cReq.id }, amy.token);
    const jr = await se('clubs/join', { channelId: cReq.id }, amy.token);
    const ic = await se('clubs/invitations/create', { channelId: cInv.id, userId: amy.id }, mei.token);
    const before = (await se('clubs/settings/show', { channelId: cReq.id }, amy.token)).json;
    ok('1·0 fixture: amy has a pending request and an invitation', jr.json && jr.json.status === 'requested' && before.myRequest === 'pending' && ic.status === 200, { join: jr.json, myRequest: before.myRequest, invite: ic.status });

    browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-gpu', '--lang=en-US'] });
    // ---------- 1: Reviewing rows answered in place
    { const { ctx, page } = await pageAs(browser, amy); await open(page, '/pages/community/index');
      await clickLeaf(page, /^Need review/); await sleep(1500); await shot(page, '1a-review');
      const t0 = await text(page);
      ok('1·1 the Reviewing section lists both rows', t0.includes(cReq.name) && t0.includes(cInv.name), {});
      const clicked = await page.evaluate((nm) => { const row = [...document.querySelectorAll('.pg-row')].find((r) => (r.textContent || '').includes(nm)); const b = row && [...row.querySelectorAll('taro-button-core, button, [data-ctl="button"]')].find((x) => /Cancel request/.test(x.textContent || '')); if (!b) return false; b.scrollIntoView(); return true; }, cReq.name);
      const btn = await page.evaluateHandle((nm) => { const row = [...document.querySelectorAll('.pg-row')].find((r) => (r.textContent || '').includes(nm)); return row && [...row.querySelectorAll('*')].reverse().find((x) => /^Cancel request$/.test((x.textContent || '').trim())) || null; }, cReq.name);
      if (btn.asElement()) await btn.asElement().click(); await sleep(1200); await shot(page, '1b-cancel-dialog');
      const urlAfterTap = page.url();
      await clickLeaf(page, /^Cancel request$/); await sleep(2500); await shot(page, '1c-after-cancel');
      const st = (await se('clubs/settings/show', { channelId: cReq.id }, amy.token)).json;
      ok('1·2 Cancel request: the page stayed on My clubs (the row tap did not fire)', clicked && !/[?&]id=/.test(urlAfterTap) && !/[?&]id=/.test(page.url()), { url: page.url() });
      ok('1·3 …and the request is cancelled IN THE ENGINE (read back)', st && st.myRequest !== 'pending', { myRequest: st && st.myRequest });
      await open(page, '/pages/community/index'); await clickLeaf(page, /^Need review/); await sleep(1200);
      const acc = await page.evaluateHandle((nm) => { const row = [...document.querySelectorAll('.pg-row')].find((r) => (r.textContent || '').includes(nm)); return row && [...row.querySelectorAll('*')].reverse().find((x) => /^Accept$/.test((x.textContent || '').trim())) || null; }, cInv.name);
      if (acc.asElement()) await acc.asElement().click(); await sleep(2500); await shot(page, '1d-after-accept');
      const mem = ((await se('clubs/members', { channelId: cInv.id, limit: 50 }, mei.token)).json || {}).members || [];
      ok('1·4 Accept: amy is a member (read back) and the page stayed on My clubs', mem.some((m) => m.userId === amy.id) && !/[?&]id=/.test(page.url()), { url: page.url(), member: mem.some((m) => m.userId === amy.id) });
      // 3: the private club, as a stranger
      await open(page, '/pages/community/index?id=' + cPriv.id); const t3 = await text(page); await shot(page, '3a-private-stranger');
      ok('3·1 a stranger sees the generic private-or-gone screen', /private or no longer exists/.test(t3) && /Join by code/.test(t3), {});
      ok('3·2 …which does not name the club (G15.5)', !t3.includes(cPriv.name), {});
      await ctx.close(); }
    { const { ctx, page } = await pageAs(browser, mei);
      await open(page, '/pages/community/index?id=' + cPriv.id); const t = await text(page); await shot(page, '3b-private-owner');
      ok('3·3 planted: the owner opening the same link sees the club (name on screen)', t.includes(cPriv.name) && !/private or no longer exists/.test(t), {});
      // 4: the owner's list shows Private on the private club's card, Public on a public one
      await open(page, '/pages/community/index'); const tl = await text(page); await shot(page, '4-owner-list');
      const cards = await page.evaluate(() => [...document.querySelectorAll('.cm-club')].map((c) => (c.textContent || '').replace(/\s+/g, ' ')));
      const privCard = cards.find((c) => c.includes('[probe] t3fix hidden')); const pubCard = cards.find((c) => c.includes('[probe] t3fix approval'));
      ok('4·1 the private club\'s card says Private', !!privCard && /Private ·/.test(privCard) && !/Public ·/.test(privCard), { card: privCard && privCard.slice(0, 120) });
      ok('4·2 planted: a public club\'s card still says Public', !!pubCard && /Public ·/.test(pubCard), { card: pubCard && pubCard.slice(0, 120) });
      const packed = (await se('channels/show', { channelId: cPriv.id }, mei.token)).json;
      ok('4·3 the engine pack carries visibility=private', packed && packed.visibility === 'private', { visibility: packed && packed.visibility });
      await ctx.close(); }
    // ---------- 2: the venue id
    { const venue = (await se('venues/search', { includeUnderReview: true, limit: 5 }, ken.token)).json;
      const v1 = Array.isArray(venue) && venue[0], v2 = Array.isArray(venue) && venue[1];
      if (!v1 || !v2) ok('2·0 two venues on UAT', false, { n: Array.isArray(venue) ? venue.length : venue });
      else {
        const m = (await se('meets/create', { name: '[probe] t3fix venue ' + Date.now().toString(36), sport: 'pickleball', startAt: new Date(Date.now() + 30 * 3600e3).toISOString(), durationMinutes: 60, capacity: 4, hostPlays: true, visibility: 'public', feeType: 'free', sendNotifications: false, venueId: v1.id, venueName: v1.name }, ken.token)).json;
        cleanup.push(async () => { await se('meets/cancel', { meetId: m.id }, ken.token); });
        ok('2·1 create keeps the venue id (meets/show + DB)', m.venueId === v1.id && sql(`select "venueId" from meet where id='${m.id}'`) === v1.id, { sent: v1.id, packed: m.venueId });
        const u = (await se('meets/update', { meetId: m.id, venueId: v2.id, venueName: v2.name }, ken.token)).json;
        ok('2·2 update changes it (read back from the DB)', u && u.venueId === v2.id && sql(`select "venueId" from meet where id='${m.id}'`) === v2.id, { packed: u && u.venueId });
        const b = (await se('meets/update', { meetId: m.id, venueId: 'zzzzzzzzzzzzzzzz' }, ken.token)).json;
        ok('2·3 planted: an id that is no venue is not stored', b && b.venueId === null, { packed: b && b.venueId });
      } }
    // ---------- 5 + 6: one post, and a post written right after a rename
    { const club = ((await se('clubs/mine', { tier: 'member' }, mei.token)).json || []).find((c) => c.role === 'owner');
      const oldName = tom.name; const fresh = '[probe] Tom T3 ' + Date.now().toString(36).slice(-4);
      cleanup.push(async () => { await se('i/update', { name: oldName }, tom.token); });
      await se('i/update', { name: fresh }, tom.token);
      const n = (await se('notes/create', { text: '[probe] t3fix question\n\n#question', channelId: club.id }, tom.token)).json;
      const noteId = n && (n.createdNote ? n.createdNote.id : n.id);
      cleanup.push(async () => { await se('notes/delete', { noteId }, tom.token); });
      const { ctx, page } = await pageAs(browser, tom);
      await open(page, '/pages/feed/index?note=' + noteId); const t5 = await text(page); await shot(page, '5-post-detail');
      ok('5·1 a member opening one post is not told to join a club', t5.includes('[probe] t3fix question') && !/Join a club to see its posts here/.test(t5), {});
      await open(page, '/pages/feed/index?club=' + club.id); await sleep(1000); const t6 = await text(page); await shot(page, '6-forum-after-rename');
      const card = await page.evaluate(() => { const c = [...document.querySelectorAll('.fd-post')].find((x) => /t3fix question/.test(x.textContent || '')); return c ? (c.textContent || '').replace(/\s+/g, ' ') : ''; });
      const nowName = ((await se('i', {}, tom.token)).json || {}).name || '';   // the name the engine holds NOW (the page's SSO sign-in re-syncs it from the league profile)
      ok('6·1 the new post shows its author\'s current engine name, never "A player"', !!nowName && card.includes(nowName) && !/A player/.test(card), { card: card.slice(0, 160), nowName, renamedTo: fresh });
      await ctx.close(); }
  } catch (e) {
    ok('probe ran to the end', false, { error: String(e && e.stack || e).slice(0, 400) });
  } finally {
    if (browser) await browser.close().catch(() => undefined);
    for (const f of cleanup.reverse()) { try { await f(); } catch (e) {} }
    const pass = checks.filter((c) => c.pass).length;
    fs.writeFileSync('/root/social-engine/probes/t3-clubs-meets.fix-recheck.json', JSON.stringify({ id: 't3-clubs-meets.fix-recheck', at: new Date().toISOString(), pass, fail: checks.length - pass, checks, shots }, null, 1));
    console.log('\n' + pass + '/' + checks.length + ' pass');
    process.exit(checks.length && pass === checks.length ? 0 : 1);
  }
})();

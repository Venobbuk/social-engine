require('./_guard.cjs');   // G13.3: probes run through probes/run.sh
// CLUB-POSTS-LINKS UI probe (lane club-posts-links, 2026-09-24) — the L6 walk of the lane's rows on https://uat.gripbat.com/app/
// at 390 px, as UAT personas (owner mei, member amy, NON-member tom, anonymous), on a fixture built through the engine.
// Real clicks (ElementHandle.click = a mouse event at the element) for every state change, the state read back from the
// engine, never from the same screen (G12.4). Planted fault first (U0). Screenshots → /root/walk/cpl-*.png.
// NEVER presses Promote: the promote card is only read and its filter chips toggled (preview), the send button is not touched.
'use strict';
const fs = require('fs');
const path = require('path');
const puppeteer = require('/root/hkpl-server/node_modules/puppeteer-core');
const SE = 'https://uat.social.silkvo.com';
const APP = (process.env.BRAND || 'https://uat.gripbat.com') + '/app';
const HOST = new URL(APP).hostname;
const QA_P = (fs.readFileSync('/root/hkpl-server/.env', 'utf8').match(/^QA_BYPASS_PASSWORD=(.+)$/m) || [])[1] || 'hkpl-uat-2026';
const P = (slug) => JSON.parse(fs.readFileSync('/root/uat-personas.json', 'utf8')).personas.find((p) => p.slug === slug);
const OUT = process.env.OUT || path.join(__dirname, 'club-posts-links-ui.json');
const checks = []; const ok = (id, n, p, d) => { checks.push({ id, name: n, pass: !!p, detail: d }); console.log((p ? 'PASS ' : 'FAIL ') + id + ' ' + n + ' — ' + JSON.stringify(d).slice(0, 280)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shots = []; fs.mkdirSync('/root/walk', { recursive: true });
const cleanup = [];
const TAG = '[probe] club-posts-links ui ' + Date.now().toString(36);
const { execSync } = require('child_process');
const PGU = execSync('docker exec social-engine-db-1 printenv POSTGRES_USER').toString().trim();
const sql = (q) => execSync('docker exec -i social-engine-db-1 psql -U ' + PGU + ' -d se_sbx -Atq', { input: q }).toString().trim();

async function cookiesOf(slug) {
  const r = await fetch(SE + '/api/v1/auth/qa/by-email/' + encodeURIComponent(P(slug).email) + '?p=' + encodeURIComponent(QA_P), { redirect: 'manual' });
  return (r.headers.getSetCookie ? r.headers.getSetCookie() : []).map((c) => c.split(';')[0]).map((c) => { const i = c.indexOf('='); return { name: c.slice(0, i), value: c.slice(i + 1) }; });
}
async function se(endpoint, body, token) { const r = await fetch(SE + '/api/' + endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(token ? { ...body, i: token } : body) }); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) {} return { status: r.status, json: j, text: t }; }
async function login(slug) {
  const cookies = await cookiesOf(slug);
  const m = await (await fetch(SE + '/api/v1/auth/sso/social', { headers: { cookie: cookies.map((c) => c.name + '=' + c.value).join('; ') } })).json();
  const r = await se('adapter/sso', { jwt: m.jwt }); const me = await se('i', {}, r.json.token);
  return { slug, cookies, token: r.json.token, id: me.json.id };
}
async function delNote(id, who) { await sleep(1200); const d = await se('notes/delete', { noteId: id }, who.token); if (d.status === 429) { await sleep(3000); await se('notes/delete', { noteId: id }, who.token); } }
async function note(who, body) { const r = await se('notes/create', body, who.token); const n = r.json && r.json.createdNote; if (!n) throw new Error('notes/create ' + r.status + ' ' + r.text.slice(0, 160)); return n; }
async function pageAs(browser, who, lang) {
  const ctx = await browser.createBrowserContext(); const page = await ctx.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: false });
  await page.evaluateOnNewDocument((lg) => { try { localStorage.setItem('hkpl_lang', lg); } catch (e) {} }, lang || 'en');
  if (who) for (const c of who.cookies) await page.setCookie({ name: c.name, value: c.value, domain: HOST, path: '/', secure: true });
  return { ctx, page };
}
async function open(page, route, lang) {
  try { await page.goto(APP + route + (route.includes('?') ? '&' : '?') + 'lang=' + (lang || 'en'), { waitUntil: 'networkidle2', timeout: 45000 }); } catch (e) {}
  await sleep(2500); await page.waitForNetworkIdle({ idleTime: 800, timeout: 10000 }).catch(() => undefined);
  const gate = await page.evaluate(() => /We value your privacy|我哋重視你嘅私隱|我們重視你的私隱|我们重视你的隐私/.test(document.body.innerText)).catch(() => false);
  if (gate) { await click(page, /^(I agree|我同意)$/); await sleep(1500); }
}
const text = (page) => page.evaluate(() => document.body.innerText);
/** The LAST leaf element whose own text matches `re` (inside `within` when given), as a handle — then a REAL mouse click. */
async function handleOf(page, re, within) {
  const h = await page.evaluateHandle((src, fl, w) => {
    const rx = new RegExp(src, fl); const root = w ? document.querySelector(w) : document;
    if (!root) return null;
    const els = [...root.querySelectorAll('taro-text-core, taro-view-core, taro-button-core, button, span, div')].filter((e) => rx.test((e.textContent || '').trim()) && ![...e.children].some((c) => rx.test((c.textContent || '').trim())));
    return els[els.length - 1] || null;
  }, re.source, re.flags, within || null);
  return h.asElement();
}
async function click(page, re, within) { const el = await handleOf(page, re, within); if (!el) return false; await el.scrollIntoView().catch(() => undefined); await el.click().catch(async () => { await page.evaluate((e) => e.click(), el); }); await sleep(900); return true; }
async function typeInto(page, selector, index, value) { const els = await page.$$(selector); const el = els[index]; if (!el) return false; await el.click(); await page.keyboard.type(value, { delay: 15 }); await sleep(300); return true; }
const shot = async (page, n) => { const p = '/root/walk/cpl-' + n + '.png'; await page.screenshot({ path: p, fullPage: true }).catch(() => page.screenshot({ path: p })); shots.push(p); return p; };
const noteOf = (id, who) => se('notes/show', { noteId: id }, who.token).then((r) => r.json);
const latestBy = (who, chan) => sql(`SELECT id FROM note WHERE "userId" = '${who.id}' ${chan ? `AND "channelId" = '${chan}'` : 'AND "channelId" IS NULL'} AND text LIKE '%${TAG}%' ORDER BY id DESC LIMIT 1;`);

let mei, amy, tom, ken, browser;
(async () => {
  mei = await login('clubowner-mei'); amy = await login('player-amy'); tom = await login('clubadmin-tom'); ken = await login('host-ken');
  try {
    // ---------------- fixture (engine)
    const C = (await se('channels/create', { name: TAG + ' club' }, mei.token)).json;
    if (!C || !C.id) throw new Error('channels/create');
    cleanup.push(async () => { await se('clubs/settings/update', { channelId: C.id, handle: null }, mei.token); await se('channels/update', { channelId: C.id, isArchived: true }, mei.token); });
    await se('clubs/join', { channelId: C.id }, amy.token);
    const amyRole = (await se('clubs/settings/show', { channelId: C.id }, amy.token)).json;
    const tomRole = (await se('clubs/settings/show', { channelId: C.id }, tom.token)).json;
    if (!amyRole.isMember || tomRole.isMember || tomRole.isAdmin) throw new Error('fixture roles wrong');   // G16.5
    const other = (await se('meets/create', { name: TAG + ' other meet', sport: 'pickleball', startAt: new Date(Date.now() + 30 * 3600e3).toISOString(), durationMinutes: 60, capacity: 8, hostPlays: true, autoApprove: true, visibility: 'public', feeType: 'free', sendNotifications: false }, ken.token)).json;
    cleanup.push(async () => { await se('meets/cancel', { meetId: other.id }, ken.token); });
    const pm = (await se('meets/create', { name: TAG + ' promote meet', sport: 'pickleball', channelId: C.id, startAt: new Date(Date.now() + 20 * 3600e3).toISOString(), durationMinutes: 60, capacity: 8, hostPlays: true, autoApprove: true, visibility: 'public', feeType: 'free', sendNotifications: false }, mei.token)).json;
    cleanup.push(async () => { await se('meets/cancel', { meetId: pm.id }, mei.token); });
    const pub = await note(mei, { channelId: C.id, text: TAG + ' PUBLIC-POST' });
    const mem = await note(mei, { channelId: C.id, text: TAG + ' MEMBERS-POST', visibility: 'followers' });
    const adm = await note(mei, { channelId: C.id, text: TAG + ' ADMINS-POST', visibility: 'specified' });
    const rich = await note(mei, { channelId: C.id, cw: 'Saturday ladder', text: TAG + ' **Bring water** and <i>smile</i> [the rules](https://example.com/rules)\n' + APP.replace('/app', '') + '/m/' + other.referenceCode });
    const poll = await note(mei, { channelId: C.id, text: TAG + ' POLL', poll: { choices: ['Opt A', 'Opt B'], allowAddChoices: true } });
    const handle = 'cpl_ui_' + Date.now().toString(36);
    // amy is the promote meet's club audience; a gender fact on her makes the gender chips measurable (restored in finally)
    const was = sql(`SELECT coalesce(gender, 'none') FROM meet_player_level WHERE "userId" = '${amy.id}' AND sport = 'pickleball';`) || 'none';
    await se('meets/level', { sport: 'pickleball', gender: 'female' }, amy.token);
    cleanup.push(async () => { await se('meets/level', { sport: 'pickleball', gender: was || 'none' }, amy.token); });

    browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--lang=en-US'] });

    // ---------------- U1 member amy: the club forum (audience, title, MFM, card, poll controls)
    { const { ctx, page } = await pageAs(browser, amy, 'en'); await open(page, '/pages/feed/index?club=' + C.id); const t = await text(page); await shot(page, 'u1-member-forum');
      ok('U0', 'PLANTED: the admins-only post must NOT be on the member\'s screen (an assertion for it would pass only if the rule is broken)', !t.includes('ADMINS-POST'), { adminsShown: t.includes('ADMINS-POST') });
      ok('U1a', 'member sees the Public and the Members post (B-content-editor.07)', t.includes('PUBLIC-POST') && t.includes('MEMBERS-POST'), {});
      ok('U1b', 'the title (native cw) is drawn as the post title (B-content-editor.02)', /Saturday ladder/.test(t), {});
      ok('U1c', 'MFM drawn: bold / italic / link text without the markup (B-content-editor.03)', /Bring water and smile the rules/.test(t.replace(/\s+/g, ' ')) && !t.includes('**Bring') && !t.includes('[the rules]'), { line: (t.match(/[^\n]*Bring water[^\n]*/) || [''])[0] });
      const boldWeight = await page.evaluate(() => { const el = [...document.querySelectorAll('.pp-b')].find((e) => /Bring water/.test(e.textContent || '')); return el ? getComputedStyle(el).fontWeight : null; });
      ok('U1d', 'the bold span renders bold (computed font-weight ≥ 700)', Number(boldWeight) >= 700, { boldWeight });
      ok('U1e', 'the /m/<code> line is drawn as a MEET CARD with the meet\'s name, not as a raw link (B-content-editor.08)', t.includes('other meet') && !t.includes('/m/' + other.referenceCode), {});
      ok('U1f', 'the poll offers "+ Add option" (the author allowed it)', /\+ Add option/.test(t), {});
      // U2 poll: real clicks, engine read-back
      await click(page, /^Opt A$/); await sleep(1500);
      let pr = await noteOf(poll.id, amy);
      const v1 = pr.poll.choices.map((c) => c.isVoted);
      await click(page, /^Opt B$/); await sleep(1500);
      pr = await noteOf(poll.id, amy); const v2 = pr.poll.choices.map((c) => c.isVoted + ':' + c.votes);
      ok('U2a', 'real click Opt A → engine: my vote on A; real click Opt B → engine: my vote MOVED to B (B-create-poll.03)', v1[0] === true && v2[0] === 'false:0' && v2[1] === 'true:1', { afterA: v1, afterB: v2 });
      await click(page, /^Opt B$/); await sleep(1500);
      pr = await noteOf(poll.id, amy); const v3 = pr.poll.choices.map((c) => c.isVoted + ':' + c.votes);
      ok('U2b', 'tap my own choice again → engine: vote taken back', v3.every((x) => x === 'false:0'), { v3 });
      await click(page, /^\+ Add option$/); await sleep(600);
      await typeInto(page, '.pp-add input', 0, 'Opt C'); await click(page, /^Add$/, '.pp-add'); await sleep(1800);
      pr = await noteOf(poll.id, mei);
      ok('U2c', 'real "+ Add option" → Opt C stored with addedBy = amy (B-create-poll.02)', pr.poll.choices.some((c) => c.text === 'Opt C' && c.addedBy === amy.id), { choices: pr.poll.choices.map((c) => c.text + '/' + (c.addedBy || '')) });
      await open(page, '/pages/feed/index?club=' + C.id); const t2 = await text(page); await shot(page, 'u2-member-poll-added');
      ok('U2d', 'the added option shows "Added by you" to its author', /Added by you/.test(t2), {});
      // U3 composer (member): real typing, Members audience, title → engine read-back
      await open(page, '/pages/feed/index?club=' + C.id + '&compose=1'); const tc = await text(page); await shot(page, 'u3-member-composer');
      const toolTexts = await page.$$eval('.pc-tool', (els) => els.map((e) => (e.textContent || '').trim()));
      const titleField = (await page.$('.pc-title')) !== null;
      ok('U3a', 'composer: Post to (club chips + My feed), a Title field, tools B / I / Link / Photo / Poll / Activity / Club / Player, Who can see', /Post to/.test(tc) && /My feed/.test(tc) && titleField && ['B', 'I', 'Link', 'Photo', 'Poll', 'Activity', 'Club', 'Player'].every((x) => toolTexts.includes(x)) && /Who can see this post/.test(tc), { toolTexts, titleField });
      ok('U3b', 'type chips: Post · Question · Review; no Announcement for a member (B-content-editor.06)', /Question/.test(tc) && /Review/.test(tc) && !/Announcement/.test((tc.match(/Post to[\s\S]*?Who can see/) || [''])[0]), {});
      ok('U3c', 'audience chips Public / Members / Admins', /Public/.test(tc) && /Members/.test(tc) && /Admins/.test(tc), {});
      await typeInto(page, '.pc-compose input', 0, 'Members only title');
      await typeInto(page, '.pc-compose textarea', 0, TAG + ' COMPOSED-MEMBERS');
      await click(page, /^Members$/, '.pc-compose'); await click(page, /^Post$/, '.pc-send'); await sleep(2500);
      const cid = latestBy(amy, C.id); const cn = cid ? await noteOf(cid, amy) : null; await shot(page, 'u3-after-post');
      ok('U3d', 'real Post → engine: the note has cw "Members only title" and visibility followers (L6 of .02 + .07)', cn && cn.cw === 'Members only title' && cn.visibility === 'followers', { id: cid, cw: cn && cn.cw, vis: cn && cn.visibility });
      if (cid) cleanup.push(async () => { await delNote(cid, amy); });
      // U4 attach a club card via the Club picker (real clicks) + Review type
      await open(page, '/pages/feed/index?club=' + C.id + '&compose=1');
      await typeInto(page, '.pc-compose textarea', 0, TAG + ' REVIEW-WITH-CLUB');
      await click(page, /^Review$/, '.pc-compose'); await click(page, /^Club$/, '.pc-tools'); await sleep(1200); await shot(page, 'u4-club-picker');
      const picked = await click(page, new RegExp('^' + TAG.replace(/[[\]]/g, '\\$&') + ' club$'));
      await sleep(600); await click(page, /^Post$/, '.pc-send'); await sleep(2500);
      const rid = latestBy(amy, C.id); const rn = rid ? await noteOf(rid, amy) : null;
      ok('U4a', 'real Club pick + Review + Post → engine: text carries the club link and #review (B-select-group.01 / .06)', rn && rn.text.includes('/app/pages/community/index?id=' + C.id) && (rn.tags || []).includes('review'), { picked, text: rn && rn.text, tags: rn && rn.tags });
      if (rid) cleanup.push(async () => { await delNote(rid, amy); });
      await open(page, '/pages/feed/index?club=' + C.id); const t4 = await text(page); await shot(page, 'u4-review-card');
      ok('U4b', 'the post shows the REVIEW pill and the club card (club name), not the raw link', /REVIEW|Review/.test(t4) && !t4.includes('/app/pages/community/index?id=' + C.id), {});
      // U5 My feed destination (B-select-channel.02)
      await open(page, '/pages/feed/index?compose=1');
      await click(page, /^My feed$/, '.pc-compose'); await typeInto(page, '.pc-compose textarea', 0, TAG + ' MYFEED-POST'); await click(page, /^Post$/, '.pc-send'); await sleep(2500);
      const fid = latestBy(amy, null); const fnote = fid ? await noteOf(fid, amy) : null;
      ok('U5', 'real "My feed" post → engine: a note with NO club (B-select-channel.02)', fnote && !fnote.channelId, { id: fid, channelId: fnote && fnote.channelId });
      if (fid) cleanup.push(async () => { await delNote(fid, amy); });
      // U6 club menu "Post question" (B-club-menu.05)
      await open(page, '/pages/community/index?id=' + C.id);
      await page.evaluate(() => { const a = [...document.querySelectorAll('.ah-act')]; const el = a[a.length - 1]; if (el) el.click(); }); await sleep(1200);
      const tk = await text(page); await shot(page, 'u6-club-kebab');
      const qa = await click(page, /^Post question$/); await sleep(2500);
      const url = page.url(); const tq = await text(page); await shot(page, 'u6-post-question');
      const onChips = await page.$$eval('.pc-chip-on', (els) => els.map((e) => (e.textContent || '').trim()));
      ok('U6', 'club kebab has "Post question" → opens the composer with Question selected', /Post question/.test(tk) && qa && /type=question/.test(url) && onChips.includes('Question') && /Post to/.test(tq), { url, onChips });
      // U7 outside links (B-set-comms.03): rule OFF → the composer shows the Reclub refusal, nothing stored
      await se('clubs/settings/update', { channelId: C.id, allowOutsideLinks: false }, mei.token);
      await open(page, '/pages/feed/index?club=' + C.id + '&compose=1');
      await typeInto(page, '.pc-compose textarea', 0, TAG + ' OUTSIDE ' + APP + '/pages/meet/index?id=' + other.id);
      await click(page, /^Post$/, '.pc-send'); await sleep(1200);
      const tt = await text(page); await shot(page, 'u7-outside-refused');
      const stored = sql(`SELECT count(*) FROM note WHERE text LIKE '%${TAG} OUTSIDE%';`);
      ok('U7', 'rule OFF: the member\'s post with another club\'s meet → "The club admin has restricted links to outside activities." and nothing stored', /restricted links to outside activities/.test(tt) && stored === '0', { stored });
      await se('clubs/settings/update', { channelId: C.id, allowOutsideLinks: true }, mei.token);
      await ctx.close(); }

    // ---------------- U8 NON-member tom and anonymous (G15.5)
    for (const [who, tag] of [[tom, 'nonmember'], [null, 'anon']]) {
      const { ctx, page } = await pageAs(browser, who, 'en'); await open(page, '/pages/feed/index?club=' + C.id); const t = await text(page); await shot(page, 'u8-' + tag + '-forum');
      ok('U8-' + tag, (who ? 'NON-member' : 'anonymous') + ' sees the Public post only — no Members / Admins post (G15.5)', t.includes('PUBLIC-POST') && !t.includes('MEMBERS-POST') && !t.includes('ADMINS-POST'), { pub: t.includes('PUBLIC-POST'), mem: t.includes('MEMBERS-POST'), adm: t.includes('ADMINS-POST') });
      await open(page, '/pages/feed/index?note=' + mem.id); const tn = await text(page); await shot(page, 'u8-' + tag + '-members-post-by-link');
      ok('U8-' + tag + '-link', (who ? 'NON-member' : 'anonymous') + ' opening the members post by its link sees no text of it', !tn.includes('MEMBERS-POST'), { shown: tn.includes('MEMBERS-POST') });
      await ctx.close();
    }

    // ---------------- U9 owner mei: Manage club (handle + rule), invite tabs, promote filters, announcement
    { const { ctx, page } = await pageAs(browser, mei, 'en'); await open(page, '/pages/club-admin/index?id=' + C.id); const t = await text(page);
      ok('U9a', 'Manage club › General: Club handle + Allow outside activity links', /Club handle/.test(t) && /Allow outside activity links/.test(t), {});
      await typeInto(page, '.cr-card input', 0, handle); await sleep(1500); const th = await text(page); await shot(page, 'u9-handle-available');
      ok('U9b', 'live availability: "@<handle> is available" (B-set-profile.03)', th.includes('@' + handle + ' is available'), {});
      await click(page, /^Save handle$/); await sleep(1800);
      const sh = (await se('clubs/settings/show', { channelId: C.id }, tom.token)).json;
      ok('U9c', 'real Save → engine: the club\'s handle read back', sh && sh.handle === handle, { handle: sh && sh.handle });
      const sw = await page.$$('.cr-opt [role=switch], .cr-opt .nut-switch, .cr-opt taro-view-core');
      const swEl = await page.$('.cr-opt .ui-switch') || (sw.length ? sw[sw.length - 1] : null);
      if (swEl) { await swEl.click(); await sleep(1800); }
      const s2 = (await se('clubs/settings/show', { channelId: C.id }, mei.token)).json;
      ok('U9d', 'real switch tap → engine: allowOutsideLinks false (B-set-comms.03)', s2 && s2.allowOutsideLinks === false, { read: s2 && s2.allowOutsideLinks, found: !!swEl });
      await se('clubs/settings/update', { channelId: C.id, allowOutsideLinks: true }, mei.token);
      // invite tabs
      await open(page, '/pages/community/index?id=' + C.id + '&pane=members'); await click(page, /^Invite players$/); await sleep(1500);
      const ti = await text(page); await shot(page, 'u10-invite-tabs');
      ok('U10', 'Invite players: search + Friends · Saved · Recent activity · Meets · Free agents · Spectators · Club tags (B-invite-friends.01)', ['Friends', 'Saved', 'Recent activity', 'Meets', 'Free agents', 'Spectators', 'Club tags'].every((x) => ti.includes(x)), { missing: ['Friends', 'Saved', 'Recent activity', 'Meets', 'Free agents', 'Spectators', 'Club tags'].filter((x) => !ti.includes(x)) });
      await click(page, /^Recent activity$/); await sleep(2500); const tr = await text(page); await shot(page, 'u10-invite-recent');
      ok('U10b', 'the Recent activity tab loads a list or its empty line (not a spinner)', /meets together|No recent activity yet\./.test(tr), {});
      // promote filters (preview only)
      await open(page, '/pages/meet/index?id=' + pm.id + '&tab=participants'); const tp = await text(page); await shot(page, 'u11-promote-filters');
      ok('U11a', 'promote card: Choose skill levels / genders / age groups + Select All (A-promote-meet.04)', /Choose skill levels/.test(tp) && /Choose genders/.test(tp) && /Choose age groups/.test(tp) && /All selected|Select All/.test(tp), {});
      const reachLine = (x) => (x.match(/(\d+) players ·/) || [])[1];
      await click(page, /^Club members$/); await sleep(2000); const r0 = reachLine(await text(page));
      await click(page, /^Male$/); await sleep(2500); const rF = reachLine(await text(page)); await shot(page, 'u11-promote-male-off');
      await click(page, /^Male$/); await sleep(1500); await click(page, /^Female$/); await sleep(2500); const tM = await text(page); const rM = reachLine(tM); await shot(page, 'u11-promote-female-off');
      const apiF = (await se('meets/promote', { meetId: pm.id, preview: true, audience: 'club', genders: ['female'] }, mei.token)).json;
      const apiM = (await se('meets/promote', { meetId: pm.id, preview: true, audience: 'club', genders: ['male'] }, mei.token)).json;
      const apiAll = (await se('meets/promote', { meetId: pm.id, preview: true, audience: 'club' }, mei.token)).json;
      const screenM = rM != null ? Number(rM) : (/no players matching your filters/.test(tM) ? 0 : null);
      ok('U11b', 'real chip taps: all / Male off (= female) / Female off (= male) each equal the engine preview; amy is female so female = 1, male = 0 (not a blind zero)', Number(r0) === apiAll.reach && Number(rF) === apiF.reach && apiF.reach === 1 && screenM === apiM.reach && apiM.reach === 0, { screenAll: r0, engineAll: apiAll.reach, screenFemale: rF, engineFemale: apiF.reach, screenMale: screenM, engineMale: apiM.reach });
      const promoted = (await se('meets/show', { meetId: pm.id }, mei.token)).json;
      ok('U11c', 'nothing was sent (Promote never pressed): meet not promoted', promoted && !promoted.promotedAt, { promotedAt: promoted && promoted.promotedAt });
      // announcement type (admin)
      await open(page, '/pages/feed/index?club=' + C.id + '&compose=1');
      // the Announcement chip appears once the composer's own clubs/settings/show (isAdmin) answers — wait for it (≤ 12 s)
      const t0 = Date.now(); await page.waitForFunction(() => /Announcement/.test(document.body.innerText), { timeout: 12000 }).catch(() => undefined);
      const ta = await text(page); await shot(page, 'u12-owner-composer'); console.log('announcement chip after ms', Date.now() - t0);
      ok('U12a', 'the owner\'s composer offers Announcement', /Announcement/.test(ta), {});
      await click(page, /^Announcement$/, '.pc-compose'); await typeInto(page, '.pc-compose textarea', 0, TAG + ' ANNOUNCED'); await click(page, /^Post announcement$/, '.pc-send'); await sleep(3000);
      const aid = latestBy(mei, C.id); const pins = (await se('clubs/settings/show', { channelId: C.id }, mei.token)).json.pinnedNoteIds || [];
      ok('U12b', 'real Announcement post → engine: pinned on the club (clubs/posts/announce)', aid && pins.includes(aid), { aid, pins });
      if (aid) cleanup.push(async () => { await se('clubs/posts/announce', { channelId: C.id, noteId: aid, on: false }, mei.token); await delNote(aid, mei); });
      // zh_Hant render of the composer
      await ctx.close(); }
    { const { ctx, page } = await pageAs(browser, mei, 'zh_Hant'); await open(page, '/pages/feed/index?club=' + C.id + '&compose=1', 'zh_Hant'); const t = await text(page); await shot(page, 'u13-composer-zhHant');
      ok('U13', 'zh_Hant: 發佈到 / 誰可以看到此帖子 / 我的動態, and no English composer labels', /發佈到/.test(t) && /誰可以看到此帖子/.test(t) && /我的動態/.test(t) && !/Who can see this post|Post to|My feed/.test(t), { en: (t.match(/Who can see this post|Post to|My feed|Title \(Optional\)/g) || []) });
      await ctx.close(); }

    // ---------------- U14 the short-link page (the nginx rewrite itself is staged, not live)
    { const { ctx, page } = await pageAs(browser, amy, 'en');
      await open(page, '/pages/link/index?m=' + other.referenceCode); await sleep(2000); const u1 = page.url(); await shot(page, 'u14-link-meet');
      ok('U14a', 'pages/link?m=<code> replaces itself with the meet page (A-short-links.01, app half)', u1.includes('/pages/meet/index?id=' + other.id), { url: u1 });
      await open(page, '/pages/link/index?club=' + handle); await sleep(2000); const u2 = page.url(); await shot(page, 'u14-link-club');
      ok('U14b', 'pages/link?club=<handle> opens the club (B-link-club.02, app half)', u2.includes('/pages/community/index?id=' + C.id), { url: u2 });
      await open(page, '/pages/link/index?m=zzzz0000'); const tb = await text(page); await shot(page, 'u14-link-bad');
      ok('U14c', 'a wrong code shows Reclub\'s "Swing and a miss!"', /Swing and a miss/.test(tb), {});
      // the REAL short links, typed as a visitor would (nginx 302 → pages/link, whose query ends in a bare "&" when there are no args)
      const ROOT = APP.replace(/\/app$/, '');
      try { await page.goto(ROOT + '/m/' + other.referenceCode, { waitUntil: 'networkidle2', timeout: 45000 }); } catch (e) {}
      await sleep(4000); const u3 = page.url(); const t3 = await text(page); await shot(page, 'u14-real-m-link');
      ok('U14e', 'typing https://uat.gripbat.com/m/<code> lands on that meet (A-short-links.01)', u3.includes('/pages/meet/index?id=' + other.id) && t3.includes('other meet'), { url: u3 });
      try { await page.goto(ROOT + '/clubs/@' + handle, { waitUntil: 'networkidle2', timeout: 45000 }); } catch (e) {}
      await sleep(4000); const u4 = page.url(); await shot(page, 'u14-real-club-link');
      ok('U14f', 'typing https://uat.gripbat.com/clubs/@<handle> lands on the club (B-link-club.02)', u4.includes('/pages/community/index?id=' + C.id), { url: u4 });
      // the share sheet now hands out the short link
      await open(page, '/pages/meet/index?id=' + other.id);
      const acts = await page.$$('.ah-act'); if (acts[0]) { await acts[0].click(); await sleep(1500); }
      const shareUrl = await page.$eval('.sh2-url', (e) => (e.textContent || '').trim()).catch(() => ''); await shot(page, 'u14-share-sheet');
      ok('U14g', 'the meet share sheet shows the /m/<code> short link', shareUrl === HOST + '/m/' + other.referenceCode, { shareUrl });
      await ctx.close(); }
    const sl = await fetch(APP.replace('/app', '') + '/m/' + other.referenceCode, { redirect: 'manual' });
    ok('U14d', 'https://uat.gripbat.com/m/<code> → 302 to /app/pages/link/index?m=<code> (nginx SHORT-LINKS-V1)', sl.status === 302 && String(sl.headers.get('location') || '').includes('/app/pages/link/index?m=' + other.referenceCode), { status: sl.status, location: sl.headers.get('location') });
    const sc = await fetch(APP.replace('/app', '') + '/clubs/@' + handle, { redirect: 'manual' });
    ok('U14h', 'https://uat.gripbat.com/clubs/@<handle> → 302 to /app/pages/link/index?club=<handle>', sc.status === 302 && String(sc.headers.get('location') || '').includes('/app/pages/link/index?club=' + handle), { status: sc.status, location: sc.headers.get('location') });
  } catch (e) {
    ok('Z', 'probe ran to the end', false, { error: String(e && e.stack || e).slice(0, 500) });
  } finally {
    if (browser) await browser.close().catch(() => undefined);
    for (const f of cleanup.reverse()) { try { await f(); } catch (e) { /* keep cleaning */ } }
    let left = -1;
    try {
      const who = Object.fromEntries([mei, amy, tom, ken].filter(Boolean).map((u) => [u.id, u]));
      for (const row of sql(`SELECT id || '|' || "userId" FROM note WHERE text LIKE '%${TAG}%';`).split('\n').filter(Boolean)) { const [id, uid] = row.split('|'); if (who[uid]) await delNote(id, who[uid]); }
      left = Number(sql(`SELECT count(*) FROM note WHERE text LIKE '%[probe] club-posts-links%';`)) + Number(sql(`SELECT count(*) FROM meet WHERE name LIKE '[probe] club-posts-links%' AND status <> 'cancelled';`)) + Number(sql(`SELECT count(*) FROM channel WHERE name LIKE '[probe] club-posts-links%' AND "isArchived" = false;`));
    } catch (e) { console.log('litter count failed ' + e); }
    ok('Z1', 'cleanup: no [probe] club-posts-links note / live meet / live club left (DB)', left === 0, { left });
    const pass = checks.filter((c) => c.pass).length;
    fs.writeFileSync(OUT, JSON.stringify({ id: 'club-posts-links.ui', at: new Date().toISOString(), app: APP, viewport: '390x844', pass, fail: checks.length - pass, checks, shots }, null, 1));
    console.log('\n' + pass + '/' + checks.length + ' pass → ' + OUT);
    process.exit(checks.length && pass === checks.length ? 0 : 1);
  }
})();

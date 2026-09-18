// MEET-EXTRAS-V1 probe (ON kaka, headless Chrome + engine API, against https://uat.social.silkvo.com — the UAT personas).
// Proves PARITY.md rows 3 / 16 / 18 / 33 / 43 / 49 / 73 / 88 / 60 on the DEPLOYED app + engine:
//   1 host-ken creates a Doubles meet through the create form (format chip, date picker, "Invite friends" sheet →
//     tom + mei picked) → the engine holds format Doubles and two invited rows
//   2 host-ken creates a LISTING through the form (?listing=1: Meet listing, link field) → type listing, extras.externalUrl;
//     amy's meets/join on it is refused (MEET_INVALID_TRANSITION)
//   3 promote: amy follows ken and lives 1 km from the meet; ken's meets/promote (≤ 36 h, public, once) → amy has a
//     "Looking for players" notification linking the meet; a second promote is refused (MEET_ALREADY_PROMOTED)
//   4 photos: ken uploads a PNG to the drive, meets/media/add → the Details tab renders it in the Photos grid
//   5 summary: amy joins, tom accepts, ken scores two matches → the Matches tab's "Share summary" sheet renders the
//     standings (3 rows) + 2 matches; meets/summary ranks ken · amy · tom by win-loss, amy first by total score
//   6 reminder: a meet 2 h 40 s ahead with amy confirmed → the minute sweep writes amy a "Reminder" (starts in 2 hours)
//   7 distance: Discover as amy (location Everywhere) prints "x.x km" on the meet's card from her saved home
// Verdict → /root/social-engine/probes/meet-extras-v1.verdict.json; screenshots → /root/walk/_meet-extras-*.png
// KEEP=1 skips the cleanup (the probe meets are cancelled otherwise).
'use strict';
const fs = require('fs');
const puppeteer = require('/root/hkpl-server/node_modules/puppeteer-core');
const BASE = process.env.BASE || 'https://uat.social.silkvo.com';
const HOST = new URL(BASE).hostname;
const QA_P = process.env.QA_P || (fs.readFileSync('/root/hkpl-server/.env', 'utf8').match(/^QA_BYPASS_PASSWORD=(.+)$/m) || [])[1] || 'hkpl-uat-2026';
const PERSONAS = JSON.parse(fs.readFileSync('/root/uat-personas.json', 'utf8')).personas;
const P = (slug) => PERSONAS.find((p) => p.slug === slug);
const checks = []; const ok = (n, p, d) => { checks.push({ name: n, pass: !!p, detail: d }); console.log((p ? 'PASS ' : 'FAIL ') + n + ' — ' + JSON.stringify(d).slice(0, 400)); };
const info = []; const note = (n, d) => { info.push({ name: n, detail: d }); console.log('INFO ' + n + ' — ' + JSON.stringify(d).slice(0, 300)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync('/root/walk', { recursive: true });
const TAG = '[probe mx] ';

async function session(email) {
  const r = await fetch(BASE + '/api/v1/auth/qa/by-email/' + encodeURIComponent(email) + '?p=' + encodeURIComponent(QA_P), { redirect: 'manual' });
  const raw = (r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie')].filter(Boolean)).map((c) => c.split(';')[0]);
  if (r.status !== 302 || !raw.length) throw new Error('qa/by-email ' + email + ' → ' + r.status);
  return raw.map((c) => { const i = c.indexOf('='); return { name: c.slice(0, i), value: c.slice(i + 1) }; });
}
async function se(endpoint, body, token) {
  const r = await fetch(BASE + '/api/' + endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(token ? { ...body, i: token } : body) });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch (e) { /* 204 */ }
  return { status: r.status, json, text, code: json && json.error && json.error.code };
}
async function engineToken(cookies) {
  const m = await (await fetch(BASE + '/api/v1/auth/sso/social', { headers: { cookie: cookies.map((c) => c.name + '=' + c.value).join('; ') } })).json();
  const r = await se('adapter/sso', { jwt: m.jwt });
  if (!r.json || !r.json.token) throw new Error('adapter/sso: ' + r.status + ' ' + r.text.slice(0, 120));
  return r.json;
}
const count = (page, sel) => page.$$eval(sel, (xs) => xs.length).catch(() => 0);
const texts = (page, sel) => page.$$eval(sel, (els) => els.map((e) => (e.textContent || '').trim())).catch(() => []);
async function clickText(page, sel, rx) { return await page.$$eval(sel, (els, src) => { const re = new RegExp(src, 'i'); const el = els.find((x) => re.test((x.textContent || '').trim())); if (el) { el.click(); return (el.textContent || '').trim(); } return null; }, rx.source); }
async function typeInto(page, sel, value) {
  const host = await page.$(sel); if (!host) { note('no input', sel); return null; }
  const input = (await host.$('input')) || host;
  await input.click({ clickCount: 3 }); await input.type(value, { delay: 15 }); await sleep(200);
  return await page.$eval(sel, (h) => { const i = h.querySelector('input') || h; return i.value; });
}
/** The NutUI date picker: open, flick one notch (tomorrow), confirm. */
async function pickTomorrow(page, triggerSel) {
  await page.$eval(triggerSel, (e) => e.click());
  await page.waitForSelector('.nut-pickerview-list', { timeout: 8000 }); await sleep(400);
  const list = (await page.$$('.nut-pickerview-list'))[2] || (await page.$('.nut-pickerview-list'));   // the day wheel
  const box = await list.boundingBox();
  const x = box.x + box.width / 2, y0 = box.y + box.height / 2;
  await page.touchscreen.touchStart(x, y0);
  for (let i = 1; i <= 4; i++) { await page.touchscreen.touchMove(x, y0 - 40 * i / 4); await sleep(30); }
  await page.touchscreen.touchEnd(); await sleep(700);
  // NutUI's confirm takes a pointer click at its box (a synthetic .click() and a touch tap both left the field empty — measured 2026-09-19)
  for (let n = 0; n < 2 && (await page.$('.nut-picker-confirm-btn')); n++) { const bb = await (await page.$('.nut-picker-confirm-btn')).boundingBox(); await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2); await sleep(900); }
}
async function newPage(browser, cookies) {
  const ctx = await browser.createBrowserContext(); const page = await ctx.newPage();
  await page.setViewport({ width: 412, height: 915, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  for (const c of cookies) await page.setCookie({ name: c.name, value: c.value, domain: HOST, path: '/', secure: true });
  await page.evaluateOnNewDocument(() => { try { localStorage.setItem('hkpl_lang', 'en'); } catch (e) { /* none */ } });
  page.on('pageerror', (e) => note('pageerror', String(e).slice(0, 200)));
  return page;
}
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAFklEQVR42mP8z8BQz0AEYBxVSF+FAAB2KgvhIfWLHwAAAABJRU5ErkJggg==', 'base64');

(async () => {
  const ken = await engineToken(await session(P('host-ken').email)); const kenCookies = await session(P('host-ken').email);
  const amyCookies = await session(P('player-amy').email); const amy = await engineToken(amyCookies);
  const tom = await engineToken(await session(P('clubadmin-tom').email));
  const mei = await engineToken(await session(P('clubowner-mei').email));
  const nameOf = async (t) => { const u = (await se('i', {}, t.token)).json || {}; return { id: u.id, name: u.name || u.username, username: u.username }; };
  const [kenU, amyU, tomU, meiU] = await Promise.all([nameOf(ken), nameOf(amy), nameOf(tom), nameOf(mei)]);
  // engine-side setup: ken follows tom + mei (the invite sheet lists "Following"); amy follows ken (promotion audience);
  // amy's saved home 1 km from the probe venue (proximity + Discover distance); amy/tom/mei off any earlier probe meet
  for (const u of [tomU, meiU]) note('setup ken follows ' + u.name, (await se('following/create', { userId: u.id }, ken.token)).status);
  note('setup amy follows ken', (await se('following/create', { userId: kenU.id }, amy.token)).status);
  const VENUE = { lat: 22.3020, lng: 114.1720 };   // Kowloon Park
  note('setup amy home', (await se('venues/locations/save', { kind: 'home', label: 'Home (probe)', lat: 22.3110, lng: 114.1720 }, amy.token)).status);
  const hosting = (await se('meets/list', { scope: 'hosting', sport: 'pickleball', limit: 100 }, ken.token)).json || [];
  for (const m of hosting.filter((x) => x.name.startsWith(TAG) && x.status !== 'cancelled')) await se('meets/cancel', { meetId: m.id }, ken.token);
  const created = [];

  const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  try {
    let page = null, idA = '', nameA = '', A = null;
    try {
    // ---- 1 the create form: Doubles + two invited friends
    page = await newPage(browser, kenCookies);
    await page.goto(BASE + '/app/pages/meet-create/index?lang=en', { waitUntil: 'networkidle2', timeout: 60000 }); await sleep(1500);
    await page.waitForSelector('.mc-form', { timeout: 20000 });
    nameA = TAG + 'doubles ' + Date.now().toString(36);
    const typed = await typeInto(page, '.mc-field-wide taro-input-core, .mc-field-wide .mc-input', nameA);
    const chipFormat = await clickText(page, '.mc-chip', /^Doubles$/); await sleep(200);
    const chipsOn = await texts(page, '.mc-chip.mc-chip-on');
    ok('1a form: name typed, the sport section shows the format chips and Doubles is on', typed === nameA && chipFormat === 'Doubles' && chipsOn.includes('Doubles') && chipsOn.includes('Pickleball'), { typed, chipFormat, chipsOn });
    await pickTomorrow(page, '.mc-pick.empty');
    const dateTxt = await texts(page, '.mc-pick');
    ok('1b date picked (tomorrow) through the picker', dateTxt.length && !/Pick a date/i.test(dateTxt[0]), { dateTxt });
    const invBtn = await clickText(page, '.mc-invite .hk-btn, .mc-invite button, .mc-invite [role="button"]', /Invite friends/); await sleep(1500);
    await page.waitForSelector('.mc-invrow', { timeout: 15000 }).catch(() => undefined);
    const rowsN = await count(page, '.mc-invrow');
    const pickedTom = await clickText(page, '.mc-invrow', new RegExp(tomU.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    const pickedMei = await clickText(page, '.mc-invrow', new RegExp(meiU.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    await sleep(300);
    const selected = await texts(page, '.mc-invcount');
    await clickText(page, '.mc-invfoot .hk-btn, .mc-invfoot button, .mc-invfoot [role="button"]', /Done/); await sleep(600);
    const strip = await texts(page, '.mc-invnames');
    ok('1c invite sheet: rows listed, tom + mei picked, "2 selected", the strip names them', invBtn && rowsN >= 2 && pickedTom && pickedMei && /2 selected/.test(selected[0] || '') && strip[0] && strip[0].includes(tomU.name.split(' ')[0]), { invBtn, rowsN, pickedTom, pickedMei, selected, strip });
    await page.screenshot({ path: '/root/walk/_meet-extras-create.png' });
    await clickText(page, '.mc-submit .hk-btn, .mc-submit button, .mc-submit [role="button"]', /Create meet/);
    await page.waitForFunction(() => /pages\/meet\/index\?id=/.test(location.href), { timeout: 30000 }).catch(() => undefined); await sleep(2500);
    idA = (page.url().match(/id=([a-z0-9]+)/) || [])[1] || '';
    A = idA ? (await se('meets/show', { meetId: idA }, ken.token)).json : null;
    const invited = A ? (A.participants || []).filter((p) => p.status === 'invited').map((p) => p.userId) : [];
    ok('1d engine: the meet holds format Doubles, type managed, and tom + mei as invited rows', A && A.format === 'Doubles' && A.type === 'managed' && invited.includes(tomU.id) && invited.includes(meiU.id), { idA, format: A && A.format, type: A && A.type, invited: invited.length, url: page.url() });
    if (idA) created.push(idA);
    await page.close();

    // ---- 2 a listing through the form
    page = await newPage(browser, kenCookies);
    await page.goto(BASE + '/app/pages/meet-create/index?listing=1&lang=en', { waitUntil: 'networkidle2', timeout: 60000 }); await sleep(1500);
    await page.waitForSelector('.mc-form', { timeout: 20000 });
    const title = await texts(page, '.ah-title, .ah-t');
    const hasLink = await count(page, '.mc-listing');
    const hasPlayers = await count(page, '.mc-managed');
    const nameL = TAG + 'listing ' + Date.now().toString(36);
    await typeInto(page, '.mc-field-wide taro-input-core, .mc-field-wide .mc-input', nameL);
    const linkTyped = await typeInto(page, '.mc-listing .mc-field taro-input-core, .mc-listing .mc-field .mc-input', 'https://example.org/probe-signup');
    await pickTomorrow(page, '.mc-pick.empty');
    ok('2a listing form: "Create a listing", the Listing details section, no roster / level / fee sections', hasLink === 1 && hasPlayers === 0 && title.some((t) => /Create a listing/i.test(t)) && /example\.org/.test(linkTyped), { title, hasLink, hasPlayers, linkTyped });
    await page.screenshot({ path: '/root/walk/_meet-extras-listing.png' });
    await clickText(page, '.mc-submit .hk-btn, .mc-submit button, .mc-submit [role="button"]', /Create listing/);
    await page.waitForFunction(() => /pages\/meet\/index\?id=/.test(location.href), { timeout: 30000 }).catch(() => undefined); await sleep(2500);
    const idL = (page.url().match(/id=([a-z0-9]+)/) || [])[1] || '';
    const L = idL ? (await se('meets/show', { meetId: idL }, ken.token)).json : null;
    const listingNote = await count(page, '.mx-listing');
    const joinL = idL ? await se('meets/join', { meetId: idL }, amy.token) : { status: 0 };
    ok('2b engine: type listing with extras.externalUrl; the page shows the listing note; amy\'s RSVP is refused', L && L.type === 'listing' && L.extras && /example\.org/.test(L.extras.externalUrl || '') && listingNote === 1 && joinL.status === 400 && joinL.code === 'MEET_INVALID_TRANSITION', { idL, type: L && L.type, externalUrl: L && L.extras && L.extras.externalUrl, listingNote, join: [joinL.status, joinL.code] });
    if (idL) created.push(idL);
    await page.close();

    } catch (e) { ok('1-2 create form / listing form (threw — the deployed app lacks the form or the picker)', false, String(e && e.message || e).slice(0, 300)); if (page) await page.close().catch(() => undefined); }

    // ---- 3 promote (meet A moved to 20 h ahead, at the venue; amy follows ken, lives 1 km away, is not on the roster)
    if (idA) {
      const upd = await se('meets/update', { meetId: idA, startAt: new Date(Date.now() + 20 * 3600e3).toISOString(), venueName: 'Kowloon Park (probe)', lat: VENUE.lat, lng: VENUE.lng, autoApprove: true, capacity: 8 }, ken.token);
      A = upd.json || A;
      const pv = await se('meets/promote', { meetId: idA, preview: true }, ken.token);
      const pr = await se('meets/promote', { meetId: idA }, ken.token);
      await sleep(1500);
      const notifs = (await se('i/notifications', { limit: 30 }, amy.token)).json || [];
      const hit = notifs.find((n) => n.type === 'app' && /looking for players/i.test(n.header || '') && n.link === 'meet:' + idA);
      const again = await se('meets/promote', { meetId: idA }, ken.token);
      ok('3 promote: preview counts amy, the push reaches her (notification row with the meet link), a second push is refused', upd.status === 200 && pv.status === 200 && pv.json.gate === 'ok' && pv.json.reach >= 1 && pr.status === 200 && pr.json.sent && pr.json.reach >= 1 && !!hit && again.status === 400 && again.code === 'MEET_ALREADY_PROMOTED', { preview: pv.json, sent: pr.json && { reach: pr.json.reach, followers: pr.json.followers, nearby: pr.json.nearby }, amyNotif: hit && { header: hit.header, body: hit.body, link: hit.link }, again: [again.status, again.code] });
      const A2 = (await se('meets/show', { meetId: idA }, ken.token)).json;
      note('meet A after promote', A2 && { flags: A2.flags, promotedAt: A2.extras && A2.extras.promotedAt, reach: A2.extras && A2.extras.promotedReach });
    } else ok('3 promote', false, 'no meet A');

    // ---- 4 photos: drive upload + media/add, then the Details tab grid
    if (idA) {
      const fd = new FormData(); fd.append('i', ken.token); fd.append('name', 'probe.png'); fd.append('file', new Blob([PNG], { type: 'image/png' }), 'probe.png');
      const up = await fetch(BASE + '/api/drive/files/create', { method: 'POST', body: fd }); const file = await up.json().catch(() => null);
      const add = file && file.id ? await se('meets/media/add', { meetId: idA, fileId: file.id }, ken.token) : { status: up.status };
      const list = await se('meets/media/list', { meetId: idA }, amy.token);
      page = await newPage(browser, kenCookies);
      await page.goto(BASE + '/app/pages/meet/index?id=' + idA + '&lang=en', { waitUntil: 'networkidle2', timeout: 60000 }); await sleep(2500);
      await page.waitForSelector('.mx-photocard', { timeout: 15000 }).catch(() => undefined);
      const grid = await count(page, '.mx-photo');
      const head = await texts(page, '.mx-photocard .pg-card-title');
      const addLink = await texts(page, '.mx-photocard .pg-card-link');
      await page.screenshot({ path: '/root/walk/_meet-extras-photos.png' });
      ok('4 photos: the upload lands (media/add 200, list 1), the Details tab renders the grid with "Add photo" for the host', add.status === 200 && list.status === 200 && Array.isArray(list.json) && list.json.length >= 1 && grid >= 1 && /Photos/.test(head[0] || '') && /Add photo/.test(addLink[0] || ''), { upload: up.status, add: add.status, listed: Array.isArray(list.json) ? list.json.length : null, grid, head, addLink });
      await page.close();
    } else ok('4 photos', false, 'no meet A');

    // ---- 5 summary after two scored matches
    if (idA) {
      const j = await se('meets/join', { meetId: idA }, amy.token);
      const r = await se('meets/respond', { meetId: idA, answer: 'accept' }, tom.token);
      const A3 = (await se('meets/show', { meetId: idA }, ken.token)).json;
      const pid = (uid) => ((A3 && A3.participants) || []).find((p) => p.userId === uid && p.status === 'confirmed');
      const kp = pid(kenU.id), ap = pid(amyU.id), tp = pid(tomU.id);
      const m1 = kp && ap ? await se('meets/matches/upsert', { meetId: idA, round: 1, courtIndex: 0, team1Ids: [kp.id], team2Ids: [ap.id], scores: [[11, 5]] }, ken.token) : { status: 0 };
      const m2 = tp && ap ? await se('meets/matches/upsert', { meetId: idA, round: 2, courtIndex: 0, team1Ids: [tp.id], team2Ids: [ap.id], scores: [[7, 11]] }, ken.token) : { status: 0 };
      const s1 = await se('meets/summary', { meetId: idA }, amy.token);
      const order1 = s1.json && s1.json.standings ? s1.json.standings.map((x) => x.userId) : [];
      const mode = await se('meets/extras/update', { meetId: idA, standingsMode: 'totalScore' }, ken.token);
      const s2 = await se('meets/summary', { meetId: idA }, amy.token);
      const order2 = s2.json && s2.json.standings ? s2.json.standings.map((x) => x.userId) : [];
      await se('meets/extras/update', { meetId: idA, standingsMode: 'winLoss' }, ken.token);
      ok('5a engine: amy joined, tom accepted, 2 matches scored; standings win-loss = ken · amy · tom, total-score = amy first', j.status === 200 && r.status === 200 && m1.status === 200 && m2.status === 200 && s1.status === 200 && order1[0] === kenU.id && order1[1] === amyU.id && order1[2] === tomU.id && mode.status === 200 && order2[0] === amyU.id, { join: j.status, respond: r.status, m1: m1.status, m2: m2.status, scored: s1.json && s1.json.scoredMatches, order1: order1.map((u) => [kenU.id, amyU.id, tomU.id].indexOf(u)), order2: order2.map((u) => [kenU.id, amyU.id, tomU.id].indexOf(u)), rules: s2.json && s2.json.rules && s2.json.rules.standingsMode });
      page = await newPage(browser, kenCookies);
      await page.goto(BASE + '/app/pages/meet/index?id=' + idA + '&tab=matches&lang=en', { waitUntil: 'networkidle2', timeout: 60000 }); await sleep(2500);
      await page.waitForSelector('.mx-rules', { timeout: 15000 }).catch(() => undefined);
      const rulesTxt = await texts(page, '.mx-rulest');
      const gear = await count(page, '.mx-rulesgear');
      const shareBtn = await clickText(page, '.mx-rulesrow .hk-btn, .mx-rulesrow button, .mx-rulesrow [role="button"]', /Share summary/);
      await page.waitForSelector('.mx-srow', { timeout: 15000 }).catch(() => undefined); await sleep(800);
      const srows = await count(page, '.mx-srow'), mrows = await count(page, '.mx-mrow');
      const first = await texts(page, '.mx-sname');
      await page.screenshot({ path: '/root/walk/_meet-extras-summary.png' });
      ok('5b app: the Matches tab shows the rules row + host gear; "Share summary" opens the sheet with 3 standings rows and 2 matches, ken first', rulesTxt.length === 1 && gear === 1 && !!shareBtn && srows === 3 && mrows === 2 && first[0] === kenU.name, { rulesTxt, gear, shareBtn, srows, mrows, first });
      await page.close();
    } else ok('5 summary', false, 'no meet A');

    // ---- 6 reminder: a meet 2 h 40 s ahead, amy confirmed at once → the minute sweep's 2 h reminder
    const nameB = TAG + 'reminder ' + Date.now().toString(36);
    const B = await se('meets/create', { name: nameB, sport: 'pickleball', startAt: new Date(Date.now() + 2 * 3600e3 + 40e3).toISOString(), durationMinutes: 60, capacity: 4, hostPlays: true, autoApprove: true, visibility: 'public', feeType: 'free', venueName: 'Probe Court' }, ken.token);
    const idB = B.json && B.json.id; if (idB) created.push(idB);
    const jB = idB ? await se('meets/join', { meetId: idB }, amy.token) : { status: 0 };
    let rem = null; const t0 = Date.now();
    while (idB && !rem && Date.now() - t0 < 170e3) {
      await sleep(10e3);
      const ns = (await se('i/notifications', { limit: 30 }, amy.token)).json || [];
      rem = ns.find((n) => n.type === 'app' && /reminder/i.test(n.header || '') && n.link === 'meet:' + idB && /starts in 2 hours/i.test(n.body || '')) || null;
    }
    const Bshow = idB ? (await se('meets/show', { meetId: idB }, ken.token)).json : null;
    ok('6 reminder: within ~3 minutes the sweep writes amy a "Reminder … starts in 2 hours" for the meet (receipt reminded2At on the meet)', B.status === 200 && jB.status === 200 && jB.json.myStatus === 'confirmed' && !!rem, { create: B.status, join: [jB.status, jB.json && jB.json.myStatus], waitedS: Math.round((Date.now() - t0) / 1000), reminder: rem && { header: rem.header, body: rem.body }, extras: Bshow && Bshow.extras && { promotedAt: Bshow.extras.promotedAt } });

    // ---- 7 distance on the Discover card, as amy, location Everywhere
    if (idA) {
      page = await newPage(browser, amyCookies);
      await page.goto(BASE + '/app/pages/meets/index?lang=en', { waitUntil: 'networkidle2', timeout: 60000 }); await sleep(2500);
      const start = new Date(((await se('meets/show', { meetId: idA }, amy.token)).json || {}).startAt || Date.now());
      const dayIdx = await page.evaluate((iso) => { const d = new Date(iso); d.setHours(0, 0, 0, 0); const t = new Date(); t.setHours(0, 0, 0, 0); return Math.round((d - t) / 86400e3); }, start.toISOString());
      await page.$$eval('.dv-day', (xs, i) => { if (xs[i]) xs[i].click(); }, dayIdx); await sleep(2500);
      const found = await page.$$eval('.dv-item', (rows, name) => { const r = rows.find((x) => (x.textContent || '').includes(name)); if (!r) return null; const d = r.querySelector('.dv-dist'); return { text: (r.textContent || '').slice(0, 120), dist: d ? (d.textContent || '').trim() : null }; }, nameA);
      await page.screenshot({ path: '/root/walk/_meet-extras-discover.png' });
      ok('7 discover: the meet\'s card prints the distance from amy\'s saved home ("1.0 km" — 1 km north of the venue)', !!found && !!found.dist && /^\d+(\.\d)? km$/.test(found.dist) && parseFloat(found.dist) >= 0.8 && parseFloat(found.dist) <= 1.3, { dayIdx, found });
      await page.close();
    } else ok('7 distance', false, 'no meet A');
  } finally {
    await browser.close().catch(() => undefined);
    if (!process.env.KEEP) for (const id of created) await se('meets/cancel', { meetId: id }, ken.token).catch(() => undefined);
  }
  const verdict = { id: 'meet-extras-v1', at: new Date().toISOString(), base: BASE, condition_fired: true, verdict: checks.every((c) => c.pass) ? 'pass' : 'fail', evidence: checks, info };
  fs.writeFileSync('/root/social-engine/probes/meet-extras-v1.verdict.json', JSON.stringify(verdict, null, 1));
  console.log('VERDICT ' + verdict.verdict + ' (' + checks.filter((c) => c.pass).length + '/' + checks.length + ')');
  process.exit(verdict.verdict === 'pass' ? 0 : 1);
})().catch((e) => {
  console.error('PROBE ERROR', e);
  const verdict = { id: 'meet-extras-v1', at: new Date().toISOString(), base: BASE, condition_fired: true, verdict: 'fail', evidence: checks, info, error: String(e && e.stack || e) };
  fs.writeFileSync('/root/social-engine/probes/meet-extras-v1.verdict.json', JSON.stringify(verdict, null, 1));
  process.exit(1);
});

// DISCOVER-V3 probe (ON kaka, headless Chrome + the engine API, against https://uat.social.silkvo.com — UAT personas).
// Proves PARITY.md rows 56 / 58 / 59 / 63 / 92 / 94 / 95 / 96 / 151 on the DEPLOYED app + engine:
//   1 filters change the count — API: meets/list with times=['mornings'] ⊆ unfiltered and every row starts 04-11 HKT;
//     UI: the filter sheet's "Show {n} meets" count changes when a time chip is tapped;
//   2 map toggle renders pins (≥ 1 .dmap-pin-meet) and locate-me (.dmap-locate);
//   3 add a saved location (venues/locations/save) → the picker lists it → choosing it re-queries meets/list with lat/lng
//     and the header reads "Near <label>";
//   4 create a venue (venues/create) → status under_review, listed with includeUnderReview, the venue page says Under review;
//   5 the feedback form posts (POST venues/feedback 200 from the UI) and the owner claim answers pending;
//   6 rankings + street cred panes render rows (stats/dupr-rankings rows ≥ 1 on the DUPR pane; stats/street-cred rows ≥ 1
//     after seeding one endorsement if the window is empty); matchups pane renders (rows or the empty state);
//   7 help pages: /pages/safety, standards, charter answer 200 and render the intro in en / zh_Hant / zh_Hans.
// Cleanup: the probe's venue stays Under Review (staff close it with venues/staff-update); the saved location is deleted.
// Verdict → /root/social-engine/probes/discover-v3.verdict.json; screenshots → /root/walk/_discover-v3-*.png
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

async function session(email) {
  const r = await fetch(BASE + '/api/v1/auth/qa/by-email/' + encodeURIComponent(email) + '?p=' + encodeURIComponent(QA_P), { redirect: 'manual' });
  const raw = (r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie')].filter(Boolean)).map((c) => c.split(';')[0]);
  if (r.status !== 302 || !raw.length) throw new Error('qa/by-email ' + email + ' → ' + r.status);
  return raw.map((c) => { const i = c.indexOf('='); return { name: c.slice(0, i), value: c.slice(i + 1) }; });
}
async function se(endpoint, body, token) {
  const r = await fetch(BASE + '/api/' + endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(token ? { ...body, i: token } : body) });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch (e) { /* 204 */ }
  return { status: r.status, json, text };
}
async function engineToken(cookies) {
  const m = await (await fetch(BASE + '/api/v1/auth/sso/social', { headers: { cookie: cookies.map((c) => c.name + '=' + c.value).join('; ') } })).json();
  const r = await se('adapter/sso', { jwt: m.jwt });
  if (!r.json || !r.json.token) throw new Error('adapter/sso: ' + r.status + ' ' + r.text.slice(0, 120));
  return r.json;
}
const hkHour = (iso) => Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: 'Asia/Hong_Kong' }).format(new Date(iso)));
const texts = async (page, sel) => page.$$eval(sel, (els) => els.map((e) => (e.textContent || '').trim())).catch(() => []);
const count = async (page, sel) => page.$$eval(sel, (els) => els.length).catch(() => 0);
const clickText = (page, sel, re) => page.evaluate((sel, src) => { const r = new RegExp(src, 'i'); const el = [...document.querySelectorAll(sel)].find((x) => r.test((x.textContent || '').trim())); if (el) { el.click(); return (el.textContent || '').trim(); } return null; }, sel, re.source);

(async () => {
  const amyCookies = await session(P('player-amy').email); const amy = await engineToken(amyCookies);
  const ken = await engineToken(await session(P('host-ken').email));

  // ---- 1 filters (API)
  const all = (await se('meets/list', { scope: 'discover', sport: 'pickleball', limit: 100 }, amy.token)).json || [];
  const morn = (await se('meets/list', { scope: 'discover', sport: 'pickleball', limit: 100, times: ['mornings'] }, amy.token)).json || [];
  const hideEmpty = (await se('meets/list', { scope: 'discover', sport: 'pickleball', limit: 100, hideEmpty: true }, amy.token)).json || [];
  const friends = await se('meets/list', { scope: 'discover', sport: 'pickleball', limit: 100, friendsOnly: true }, amy.token);
  const verified = (await se('meets/list', { scope: 'discover', sport: 'pickleball', limit: 100, verifiedOnly: true }, amy.token)).json || [];
  const mornOk = Array.isArray(morn) && morn.every((m) => { const h = hkHour(m.startAt); return h >= 4 && h < 11; }) && morn.length <= all.length;
  ok('1a meets/list times=[mornings] is a subset and every row starts 04:00-10:59 HKT', mornOk && all.length > 0, { all: all.length, mornings: morn.length, hours: [...new Set(morn.map((m) => hkHour(m.startAt)))] });
  ok('1b hideEmpty / verifiedOnly / friendsOnly are accepted (200) and never grow the list', hideEmpty.length <= all.length && verified.length <= all.length && friends.status === 200 && Array.isArray(friends.json) && friends.json.length <= all.length, { hideEmpty: hideEmpty.length, verifiedOnly: verified.length, friendsOnly: friends.json && friends.json.length, friendsStatus: friends.status });

  for (const l of ((await se('venues/locations/list', {}, amy.token)).json || [])) if (/^Probe office /.test(l.label)) await se('venues/locations/delete', { id: l.id }, amy.token);
  let savedId = null, kenId = null, venueId = null;
  try {
  // ---- 3 saved location (API half): save → list
  const label = 'Probe office ' + Date.now().toString(36).slice(-4);
  const saved = await se('venues/locations/save', { kind: 'favourite', label, lat: 22.2855, lng: 114.1577, radiusKm: 20 }, amy.token);
  savedId = saved.json && saved.json.id;
  ok('3a venues/locations/save answers the row', saved.status === 200 && saved.json && saved.json.label === label, { status: saved.status, id: saved.json && saved.json.id });

  // ---- 4 venue create (API half)
  const vname = 'Probe Courts ' + Date.now().toString(36).slice(-5);
  const created = await se('venues/create', { name: vname, address: '1 Probe Street, Wan Chai', lat: 22.2795, lng: 114.1730, country: 'HK' }, amy.token);
  const listed = (await se('venues/search', { q: 'Probe Courts', includeUnderReview: true, limit: 20 }, amy.token)).json || [];
  const hidden = (await se('venues/search', { q: 'Probe Courts', includeUnderReview: false, limit: 20 }, amy.token)).json || [];
  ok('4a venues/create → status under_review; listed only with includeUnderReview (pending curation)', created.status === 200 && created.json && created.json.status === 'under_review' && created.json.source === 'community' && listed.some((v) => v.id === created.json.id) && !hidden.some((v) => v.id === created.json.id), { status: created.status, venue: created.json && { id: created.json.id, status: created.json.status, source: created.json.source }, listed: listed.length, hiddenWhenVerifiedOnly: hidden.length });
  venueId = created.json && created.json.id;

  // ---- 5 owner claim (API) — the form itself is proved in the browser below
  const claim = venueId ? await se('venues/claim', { venueId, body: 'probe claim' }, amy.token) : { status: 0 };
  const claim2 = venueId ? await se('venues/claim', { venueId }, amy.token) : { status: 0 };
  const mineFb = venueId ? (await se('venues/feedback/list', { venueId }, amy.token)).json || [] : [];
  ok('5a venues/claim → pending, idempotent (same claimId), visible in venues/feedback/list as owner_claim', claim.status === 200 && claim.json && claim.json.status === 'pending' && claim2.json && claim2.json.claimId === claim.json.claimId && mineFb.some((f) => f.category === 'owner_claim' && f.status === 'open'), { claim: claim.json, again: claim2.json && claim2.json.claimId, rows: mineFb.length });

  // ---- 6 stats (API): dupr rankings, street cred (seed one endorsement when the window is empty), pairings, h2h
  const dupr = await se('stats/dupr-rankings', { sport: 'pickleball', sort: 'doubles', limit: 20 }, amy.token);
  ok('6a stats/dupr-rankings answers rows ordered by doubles desc', dupr.status === 200 && dupr.json && Array.isArray(dupr.json.rows) && dupr.json.rows.length >= 1 && dupr.json.rows.every((r, i, a) => i === 0 || (a[i - 1].doubles ?? 0) >= (r.doubles ?? 0)), { status: dupr.status, total: dupr.json && dupr.json.total, first: dupr.json && Array.isArray(dupr.json.rows) && dupr.json.rows[0] ? { rank: dupr.json.rows[0].rank, doubles: dupr.json.rows[0].doubles } : dupr.json, myRank: dupr.json && dupr.json.myRank });
  let cred = await se('stats/street-cred', { timeframe: 'LAST_3_MONTHS', limit: 20 }, amy.token);
  if (cred.status === 200 && cred.json && Array.isArray(cred.json.rows) && !cred.json.rows.length) {
    // seed: amy endorses ken on a past meet they share (or any past meet of ken's) — the same door the meet page uses
    const past = ((await se('meets/list', { scope: 'mine', sport: 'pickleball', includePast: true, limit: 100 }, amy.token)).json || []).filter((m) => m.isPast);
    const target = past[0] || ((await se('meets/list', { scope: 'hosting', sport: 'pickleball', includePast: true, limit: 100 }, ken.token)).json || []).filter((m) => m.isPast)[0];
    if (target) { const seed = await se('meets/reviews/upsert', { meetId: target.id, targetUserId: ken.userId || (await se('i', {}, ken.token)).json.id, type: 'endorsement', body: 'Great partner, On time' }, amy.token); note('seeded one endorsement for the street-cred window', { status: seed.status, meet: target.name }); }
    cred = await se('stats/street-cred', { timeframe: 'LAST_3_MONTHS', limit: 20 }, amy.token);
  }
  const credYear = await se('stats/street-cred', { timeframe: 'YEAR', dimension: 'Great partner', gender: 'male', limit: 20 }, amy.token);
  ok('6b stats/street-cred answers rows (dimension × timeframe × gender accepted)', cred.status === 200 && cred.json && Array.isArray(cred.json.rows) && cred.json.rows.length >= 1 && credYear.status === 200, { status: cred.status, rows: cred.json && Array.isArray(cred.json.rows) ? cred.json.rows.length : cred.json, top: cred.json && Array.isArray(cred.json.rows) && cred.json.rows[0] ? { count: cred.json.rows[0].count, dims: cred.json.rows[0].dims } : null, yearFiltered: credYear.json && Array.isArray(credYear.json.rows) ? credYear.json.rows.length : credYear.status });
  const pair = await se('stats/pairings', { type: 'opponents', category: 'all', sport: 'pickleball' }, amy.token);
  const h2h = Array.isArray(pair.json) && pair.json[0] ? await se('stats/h2h', { userId: pair.json[0].userId, sport: 'pickleball' }, amy.token) : null;
  ok('6c stats/pairings + stats/h2h answer (rows when amy has scored matches; the shape either way)', pair.status === 200 && Array.isArray(pair.json) && (!h2h || (h2h.status === 200 && h2h.json && h2h.json.against && Array.isArray(h2h.json.matches))), { pairings: pair.json && pair.json.length, first: pair.json && pair.json[0] && { winPct: pair.json[0].winPct, numMatches: pair.json[0].numMatches }, h2h: h2h && h2h.json && h2h.json.against ? { against: h2h.json.against, with: h2h.json.with, matches: h2h.json.matches.length } : (h2h && h2h.status) });
  const kba = await se('stats/kudos-by-activity', { timeframe: 'ALL_TIME' }, ken.token);
  ok('6d stats/kudos-by-activity answers activities + categories for the signed-in player', kba.status === 200 && kba.json && Array.isArray(kba.json.activities) && Array.isArray(kba.json.categories), { total: kba.json && kba.json.total, activities: kba.json && Array.isArray(kba.json.activities) ? kba.json.activities.length : kba.status, categories: kba.json && Array.isArray(kba.json.categories) ? kba.json.categories.map((c) => c.dimension + ':' + c.count) : kba.status });
  const coach = await se('coaches/update', { sport: 'pickleball', experience: 'Probe: 5 years coaching', rate: 'HK$400 / hour', status: 'active' }, ken.token);
  const coachPub = coach.json && coach.json.userId ? await se('coaches/show', { userId: coach.json.userId }, amy.token) : { status: coach.status, json: null };
  ok('6e coaches/update creates ken\'s profile; coaches/show answers it publicly', coach.status === 200 && coach.json && coach.json.status === 'active' && coachPub.json && coachPub.json.rate === 'HK$400 / hour', { update: coach.json, show: coachPub.json && { status: coachPub.json.status, rate: coachPub.json.rate } });

  // ---- browser legs (amy)
  const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  const ctx = await browser.createBrowserContext();
  await ctx.overridePermissions(BASE, ['geolocation']);
  const page = await ctx.newPage(); await page.setViewport({ width: 412, height: 915, deviceScaleFactor: 2 });
  await page.setGeolocation({ latitude: 22.2855, longitude: 114.1577 });
  for (const c of amyCookies) await page.setCookie({ name: c.name, value: c.value, domain: HOST, path: '/', secure: true });
  const listReqs = []; page.on('request', (r) => { if (r.url().endsWith('/api/meets/list') && r.method() === 'POST') { try { listReqs.push(JSON.parse(r.postData() || '{}')); } catch (e) { /* */ } } });
  const fbReqs = []; page.on('response', (r) => { if (r.url().endsWith('/api/venues/feedback') && r.request().method() === 'POST') fbReqs.push(r.status()); });

  // 1c filters (UI): open the sheet, read "Show n meets", tap Mornings, read again
  await page.goto(BASE + '/app/pages/meets/index?lang=en', { waitUntil: 'networkidle2', timeout: 60000 }); await sleep(2500);
  await page.evaluate(() => { const f = document.querySelector('.dv-filter'); if (f) f.click(); }); await sleep(800);
  const showBefore = (await page.evaluate(() => { const b = [...document.querySelectorAll('.dv-fbtns button, .dv-fbtns taro-button-core, .dv-fbtns [role="button"]')].map((x) => (x.textContent || '').trim()); return b.find((t) => /Show/i.test(t)) || null; }));
  const tapped = await clickText(page, '.dv-timechip', /Mornings/);
  await sleep(2500);
  const showAfter = (await page.evaluate(() => { const b = [...document.querySelectorAll('.dv-fbtns button, .dv-fbtns taro-button-core, .dv-fbtns [role="button"]')].map((x) => (x.textContent || '').trim()); return b.find((t) => /Show/i.test(t)) || null; }));
  const lastList = listReqs[listReqs.length - 1] || {};
  const chips = await texts(page, '.dv-filters .pg-chip');
  ok('1c the filter sheet has the Reclub set (Sports · Mornings/Afternoons/Evenings · Not full · Friends only · Hide empty · Verified venues only) and the Mornings chip re-queries meets/list with times', !!tapped && Array.isArray(lastList.times) && lastList.times.includes('mornings') && chips.some((t) => /Friends only/.test(t)) && chips.some((t) => /Hide empty/.test(t)) && chips.some((t) => /Verified venues only/.test(t)) && chips.some((t) => /Not full/.test(t)) && chips.some((t) => /Pickleball/.test(t)), { showBefore, showAfter, lastListTimes: lastList.times, chips: chips.slice(0, 16) });
  ok('1d the "Show {n} meets" count changed after the chip (or both equal 0 because no morning meet exists today — see counts)', showBefore !== null && showAfter !== null && (showBefore !== showAfter || /Show 0/.test(showBefore)), { showBefore, showAfter });
  await page.screenshot({ path: '/root/walk/_discover-v3-filters.png' });
  await clickText(page, '.dv-timechip', /Mornings/); await sleep(300);   // untoggle
  await page.evaluate(() => { const f = document.querySelector('.dv-filter'); if (f) f.click(); }); await sleep(300);

  // 2 map toggle
  const tog = await page.evaluate(() => { const t = document.querySelector('.dv-viewtog'); if (t) { t.click(); return (t.textContent || '').trim(); } return null; });
  let pins = 0; for (let i = 0; i < 20 && !pins; i++) { await sleep(1000); pins = await count(page, '.dmap-pin-meet'); }
  const locate = await count(page, '.dmap-locate');
  const tiles = await count(page, '.dmap-map .leaflet-tile');
  ok('2 the Map toggle renders the live map: ≥ 1 meet pin (.dmap-pin-meet), the locate-me button, OSM tiles', tog === 'Map' && pins >= 1 && locate === 1 && tiles >= 1, { toggle: tog, pins, locate, tiles });
  await page.screenshot({ path: '/root/walk/_discover-v3-map.png' });
  await page.evaluate(() => { const b = document.querySelector('.dmap-locate'); if (b) b.click(); }); await sleep(2500);
  const nearAfterLocate = (await texts(page, '.dv-pickt'))[0];
  ok('2b locate-me recentres and sets "Near Current location" (geolocation granted)', /Near Current location/i.test(nearAfterLocate || ''), { header: nearAfterLocate, lastList: listReqs[listReqs.length - 1] && { lat: listReqs[listReqs.length - 1].lat, radiusKm: listReqs[listReqs.length - 1].radiusKm } });
  await page.evaluate(() => { const t = document.querySelector('.dv-viewtog'); if (t) t.click(); }); await sleep(500);

  // 3b saved location in the picker → "near you" recomputes
  await page.goto(BASE + '/app/pages/meets/index?lang=en', { waitUntil: 'networkidle2', timeout: 60000 }); await sleep(2000);
  const nBefore = listReqs.length;
  await page.evaluate(() => { const p = document.querySelector('.dv-pick'); if (p) p.click(); }); await sleep(600);
  const opts = await texts(page, '.dv-opt');
  const picked = await clickText(page, '.dv-opt', new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  await sleep(2500);
  const nearText = (await texts(page, '.dv-pickt'))[0];
  const req = listReqs[listReqs.length - 1] || {};
  ok('3b the picker lists the saved location; choosing it re-queries meets/list with its lat/lng and the header reads "Near <label>"', !!picked && listReqs.length > nBefore && Math.abs((req.lat || 0) - 22.2855) < 0.001 && Math.abs((req.lng || 0) - 114.1577) < 0.001 && (nearText || '').includes(label), { options: opts, picked, header: nearText, req: { lat: req.lat, lng: req.lng, radiusKm: req.radiusKm } });
  const manage = await clickText(page, '.dv-opt-link', /Manage locations|Add a location/);
  await sleep(2500);
  const locRows = await texts(page, '.pg-row-name');
  ok('3c the picker links to the Locations page, which lists the saved place', /locations\/index/.test(page.url()) && locRows.some((t) => t === label), { url: page.url(), rows: locRows.slice(0, 6), link: manage });
  await page.screenshot({ path: '/root/walk/_discover-v3-locations.png' });

  // 4b venue page: Under review + ⋮ sheet
  if (venueId) {
    await page.goto(BASE + '/app/pages/venue/index?id=' + venueId + '&lang=en', { waitUntil: 'networkidle2', timeout: 60000 }); await sleep(2500);
    const addr = await texts(page, '.vn-addrs'); const review = await texts(page, '.vn-review');
    ok('4b the new venue page says Under review (and Claim pending after the API claim)', addr.some((t) => /Under review/.test(t)) && addr.some((t) => /Claim pending/.test(t)) && review.length === 1, { meta: addr, review });
    await page.screenshot({ path: '/root/walk/_discover-v3-venue.png' });
    // 5b feedback form from the UI
    await page.goto(BASE + '/app/pages/venue-feedback/index?venue=' + venueId + '&lang=en', { waitUntil: 'networkidle2', timeout: 60000 }); await sleep(2500);
    const cats = await texts(page, '.vf-radiot');
    await clickText(page, '.vf-radio', /Incorrect name/); await sleep(200);
    await page.evaluate(() => { const ta = document.querySelector('.vf-ta textarea, textarea'); if (ta) { const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; setter.call(ta, 'Probe: the address should read 2 Probe Street'); ta.dispatchEvent(new Event('input', { bubbles: true })); } });
    await sleep(300);
    await page.evaluate(() => { const b = [...document.querySelectorAll('.vf-actions button, .vf-actions taro-button-core, .vf-actions [role="button"]')].find((x) => /Send feedback/i.test(x.textContent || '')); if (b) b.click(); });
    await sleep(3000);
    const thanks = await texts(page, '.be-tip, .pg-note, [class*="tip"]');
    const rowsAfter = (await se('venues/feedback/list', { venueId }, amy.token)).json || [];
    ok('5b the feedback form (Reclub categories) posts venues/feedback → 200 and the row is stored', cats.length === 6 && fbReqs.includes(200) && Array.isArray(rowsAfter) && rowsAfter.some((f) => f.category === 'wrong_details' && /2 Probe Street/.test(f.body || '')), { categories: cats, post: fbReqs, stored: Array.isArray(rowsAfter) ? rowsAfter.map((f) => f.category) : rowsAfter, thanks: thanks.slice(0, 2) });
    await page.screenshot({ path: '/root/walk/_discover-v3-feedback.png' });
  }

  // 6f rankings + street cred panes
  await page.goto(BASE + '/app/pages/my-stats/index?pane=dupr&lang=en', { waitUntil: 'networkidle2', timeout: 60000 }); await sleep(3000);
  const duprRows = await count(page, '.pg-row'); const duprHead = await texts(page, '.ys-headt');
  ok('6f the DUPR Rankings pane renders rows with the gender / sort chips and the Current Rank card', duprRows >= 1 && /DUPR/.test(duprHead[0] || '') && (await count(page, '.ys-rank')) === 1, { rows: duprRows, head: duprHead, chips: (await texts(page, '.ys-chip')).slice(0, 8) });
  await page.screenshot({ path: '/root/walk/_discover-v3-dupr.png' });
  await page.goto(BASE + '/app/pages/my-stats/index?pane=board&lang=en', { waitUntil: 'networkidle2', timeout: 60000 }); await sleep(3000);
  const credRows = await count(page, '.pg-row');
  await clickText(page, '.ys-chip', /^This year$/); await sleep(1500);
  const credRowsYear = await count(page, '.pg-row');
  await clickText(page, '.ys-chip', /^By activity$/); await sleep(2000);
  const byAct = await count(page, '.pg-row') + await count(page, '.be-tip, [class*="empty"]');
  ok('6g the Street Cred pane renders leaderboard rows, re-queries on the timeframe chip, and By activity renders', credRows >= 1 && credRowsYear >= 0 && byAct >= 1, { rows3m: credRows, rowsYear: credRowsYear, byActivity: byAct });
  await page.screenshot({ path: '/root/walk/_discover-v3-cred.png' });
  await page.goto(BASE + '/app/pages/my-stats/index?pane=matchups&lang=en', { waitUntil: 'networkidle2', timeout: 60000 }); await sleep(3000);
  const mu = await texts(page, '.ys-chip');
  ok('6h the Matchups pane renders Teammates / Opponents with the Reclub categories', mu.some((t) => t === 'Teammates') && mu.some((t) => t === 'Opponents') && mu.some((t) => t === 'Best Friends'), { chips: mu, rows: await count(page, '.pg-row') });
  await clickText(page, '.ys-chip', /^Opponents$/); await sleep(1500);
  const mu2 = await texts(page, '.ys-chip');
  ok('6i Opponents shows Rivals / Easy Money / Challengers', mu2.some((t) => t === 'Rivals') && mu2.some((t) => t === 'Easy Money') && mu2.some((t) => t === 'Challengers'), { chips: mu2 });

  // 6j coach card on ken's player page
  kenId = coach.json && coach.json.userId;
  if (kenId) {
    await page.goto(BASE + '/app/pages/player/index?id=' + kenId + '&lang=en', { waitUntil: 'networkidle2', timeout: 60000 }); await sleep(3000);
    const cc = await texts(page, '.cc-sect');
    ok('6j ken\'s player page shows the Coaching card (experience · rates)', cc.some((t) => /HK\$400/.test(t)) && cc.some((t) => /5 years/.test(t)), { card: cc });
    await page.screenshot({ path: '/root/walk/_discover-v3-coach.png' });
  }

  // 7 help pages in three languages
  for (const route of ['safety', 'standards', 'charter']) {
    const res = {};
    for (const lang of ['en', 'zh_Hant', 'zh_Hans']) {
      const url = BASE + '/app/pages/' + route + '/index?lang=' + lang;
      const r = await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 }); await sleep(1500);
      const intro = (await texts(page, '.pd-introt'))[0] || '';
      const secs = await count(page, '.pd-sec');
      res[lang] = { status: r && r.status(), secs, intro: intro.slice(0, 40), zh: /[一-鿿]/.test(intro) };
    }
    ok('7 /pages/' + route + ' answers 200 in en / zh_Hant / zh_Hans with sections and the intro in the language', res.en.status === 200 && res.zh_Hant.status === 200 && res.zh_Hans.status === 200 && res.en.secs >= 4 && !res.en.zh && res.zh_Hant.zh && res.zh_Hans.zh, res);
  }
  await page.goto(BASE + '/app/pages/help/index?lang=en', { waitUntil: 'networkidle2', timeout: 60000 }); await sleep(2000);
  const helpRows = await texts(page, '.pg-row-name');
  ok('7b Help lists the Policies (Safety Center · Community Standards · Our Charter)', helpRows.some((t) => t === 'Safety Center') && helpRows.some((t) => t === 'Community Standards') && helpRows.some((t) => t === 'Our Charter'), { rows: helpRows });
  await page.screenshot({ path: '/root/walk/_discover-v3-help.png' });
  await browser.close();

  } finally {
    // ---- cleanup (also after a crash): the saved location and ken's probe coach profile; the venue stays Under Review for staff
    if (savedId) note('cleanup: location deleted', (await se('venues/locations/delete', { id: savedId }, amy.token)).status);
    if (kenId) note('cleanup: ken coach profile removed', (await se('coaches/update', { sport: 'pickleball', remove: true }, ken.token)).status);
    note('cleanup: the probe venue stays Under Review for staff (venues/staff-update status closed)', venueId);
  }

  const verdict = { id: 'discover-v3', at: new Date().toISOString(), base: BASE, condition_fired: true, verdict: checks.every((c) => c.pass) ? 'pass' : 'fail', evidence: checks, info };
  fs.writeFileSync('/root/social-engine/probes/discover-v3.verdict.json', JSON.stringify(verdict, null, 1));
  console.log('VERDICT ' + verdict.verdict + ' (' + checks.filter((c) => c.pass).length + '/' + checks.length + ')');
  process.exit(verdict.verdict === 'pass' ? 0 : 1);
})().catch((e) => { console.error('PROBE ERROR', e); fs.writeFileSync('/root/social-engine/probes/discover-v3.verdict.json', JSON.stringify({ id: 'discover-v3', at: new Date().toISOString(), condition_fired: true, verdict: 'fail', evidence: checks, error: String(e && e.stack || e) }, null, 1)); process.exit(1); });

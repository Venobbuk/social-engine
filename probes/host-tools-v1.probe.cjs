// HOST-TOOLS-V1 probe (ON kaka, node 20 + headless Chrome, against https://uat.social.silkvo.com — the UAT personas).
// Proves PARITY.md rows 17 / 26 / 28 / 30 / 32 / 38 / 41 / 45 on the DEPLOYED engine + app, against host-ken's
// "UAT Thursday Open Play" (arai4oggizsc000i) with tom + mei joined through the API:
//   API  bulk-tag two players · roles (coach / referee) · generate teams (preview, persist, blind for a player) ·
//        a custom match saved · DUPR manager lists the connected state · submit-dupr-all answers · a receipt uploaded
//        to the drive and pinned · chat-mute for a player AND for the host (room owner)
//   UI   (as host-ken) the seven sort options reorder the confirmed grid · role chips + team swatches on cells ·
//        the participant sheet opens on a cell · Payments manager filters + "See receipt" · the kebab mute item fires
// Cleanup puts everything back (KEEP=1 skips it). FAILS until the orchestrator deploys the engine + the app.
// Verdict → /root/social-engine/probes/host-tools-v1.verdict.json; screenshots → /root/walk/_host-tools-v1-*.png
'use strict';
const fs = require('fs');
const puppeteer = require('/root/hkpl-server/node_modules/puppeteer-core');
const BASE = process.env.BASE || 'https://uat.social.silkvo.com';
const HOST = new URL(BASE).hostname;
const MEET_ID = process.env.MEET_ID || 'arai4oggizsc000i';
const QA_P = process.env.QA_P || (fs.readFileSync('/root/hkpl-server/.env', 'utf8').match(/^QA_BYPASS_PASSWORD=(.+)$/m) || [])[1] || 'hkpl-uat-2026';
const PERSONAS = JSON.parse(fs.readFileSync('/root/uat-personas.json', 'utf8')).personas;
const P = (slug) => PERSONAS.find((p) => p.slug === slug);
const checks = []; const ok = (n, p, d) => { checks.push({ name: n, pass: !!p, detail: d }); console.log((p ? 'PASS ' : 'FAIL ') + n + ' — ' + JSON.stringify(d).slice(0, 400)); };
const info = []; const note = (n, d) => { info.push({ name: n, detail: d }); console.log('INFO ' + n + ' — ' + JSON.stringify(d).slice(0, 300)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync('/root/walk', { recursive: true });
const shots = [];
const shot = async (page, n) => { const p = '/root/walk/_host-tools-v1-' + n + '.png'; await page.screenshot({ path: p }); shots.push(p); };

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
const names = async (page, sel) => page.$$eval(sel, (els) => els.map((e) => (e.textContent || '').trim()));
const clickText = (page, sel, re) => page.evaluate((sel, src) => { const rx = new RegExp(src, 'i'); const el = [...document.querySelectorAll(sel)].find((x) => rx.test(x.textContent || '')); if (el) { el.click(); return true; } return false; }, sel, re.source);
// a 1x1 PNG for the receipt upload
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

(async () => {
  // ---- setup (engine API): ken hosts, tom + mei on the roster (confirmed), submitMatches on so the DUPR bar shows
  const kenCookies = await session(P('host-ken').email); const ken = await engineToken(kenCookies);
  const tom = await engineToken(await session(P('clubadmin-tom').email));
  const mei = await engineToken(await session(P('clubowner-mei').email));
  let meet = (await se('meets/show', { meetId: MEET_ID }, ken.token)).json;
  if (!meet || !meet.id) throw new Error('meets/show ' + MEET_ID + ' failed — run /root/uat-personas.cjs first');
  if (!meet.isHost) throw new Error('host-ken is not the host of ' + MEET_ID);
  if (!meet.submitMatches || !meet.autoApprove) { const u = await se('meets/update', { meetId: meet.id, submitMatches: true, autoApprove: true }, ken.token); note('setup: meets/update submitMatches+autoApprove', { status: u.status }); if (u.json && u.json.id) meet = u.json; }
  for (const [who, t] of [['tom', tom.token], ['mei', mei.token]]) { const j = await se('meets/join', { meetId: meet.id, plusOnes: 0 }, t); note('setup: ' + who + ' meets/join', { status: j.status, myStatus: j.json && j.json.myStatus, code: j.json && j.json.error && j.json.error.code }); }
  meet = (await se('meets/show', { meetId: meet.id }, ken.token)).json;
  const row = (uid) => (meet.participants || []).find((p) => p.userId === uid);
  let pTom = row(tom.userId), pMei = row(mei.userId);
  if (pTom && pTom.status !== 'confirmed') { await se('meets/participants/update', { meetId: meet.id, participantId: pTom.id, status: 'confirmed' }, ken.token); }
  if (pMei && pMei.status !== 'confirmed') { await se('meets/participants/update', { meetId: meet.id, participantId: pMei.id, status: 'confirmed' }, ken.token); }
  meet = (await se('meets/show', { meetId: meet.id }, ken.token)).json; pTom = row(tom.userId); pMei = row(mei.userId);
  ok('0 setup: host-ken hosts the meet, tom + mei confirmed, submitMatches on', meet.isHost && pTom && pMei && pTom.status === 'confirmed' && pMei.status === 'confirmed' && meet.submitMatches, { id: meet.id, name: meet.name, confirmed: meet.confirmed, capacity: meet.capacity, tom: pTom && pTom.status, mei: pMei && pMei.status });
  if (!pTom || !pMei) throw new Error('tom / mei not on the roster');

  // ---- API: the new doors
  // 1. bulk tag
  const b1 = await se('meets/participants/bulk', { meetId: meet.id, participantIds: [pTom.id, pMei.id], tag: 'paid' }, ken.token);
  const b1tom = b1.json && b1.json.meet && (b1.json.meet.participants || []).find((p) => p.id === pTom.id);
  const b1mei = b1.json && b1.json.meet && (b1.json.meet.participants || []).find((p) => p.id === pMei.id);
  ok('1 meets/participants/bulk {tag:paid} on tom + mei → both rows carry paid, updated=2', b1.status === 200 && b1.json.updated === 2 && b1tom && b1tom.tags.includes('paid') && b1mei && b1mei.tags.includes('paid'), { status: b1.status, updated: b1.json && b1.json.updated, tom: b1tom && b1tom.tags, mei: b1mei && b1mei.tags, err: b1.json && b1.json.error });
  const b1x = await se('meets/participants/bulk', { meetId: meet.id, participantIds: [pTom.id], tag: 'paid' }, tom.token);
  ok('1b a non-host is refused (MEET_NOT_HOST)', b1x.status === 400 && b1x.json && b1x.json.error && b1x.json.error.code === 'MEET_NOT_HOST', { status: b1x.status, code: b1x.json && b1x.json.error && b1x.json.error.code });
  // 2. roles
  const r1 = await se('meets/participants/update', { meetId: meet.id, participantId: pTom.id, isCoach: true }, ken.token);
  const r2 = await se('meets/participants/update', { meetId: meet.id, participantId: pMei.id, isReferee: true, isPaymentCollector: true }, ken.token);
  const r2tom = r2.json && (r2.json.participants || []).find((p) => p.id === pTom.id); const r2mei = r2.json && (r2.json.participants || []).find((p) => p.id === pMei.id);
  ok('2 roles: tom isCoach, mei isReferee + isPaymentCollector (meets/participants/update)', r1.status === 200 && r2.status === 200 && r2tom && r2tom.isCoach && r2mei && r2mei.isReferee && r2mei.isPaymentCollector, { tom: r2tom && { isCoach: r2tom.isCoach }, mei: r2mei && { isReferee: r2mei.isReferee, isPaymentCollector: r2mei.isPaymentCollector } });
  // 3. generate teams: preview then persist with blind 60 min
  const g0 = await se('meets/participants/generate-teams', { meetId: meet.id, numTeams: 2, balanceSkill: true, seed: 7, persist: false }, ken.token);
  const g0ids = g0.json && Array.isArray(g0.json.teams) ? g0.json.teams.flatMap((t) => t.participantIds) : [];
  ok('3 generate-teams preview: 2 teams, every confirmed player dealt once, nothing persisted', g0.status === 200 && g0.json.persisted === false && g0.json.teams.length === 2 && g0ids.includes(pTom.id) && g0ids.includes(pMei.id) && new Set(g0ids).size === g0ids.length, { status: g0.status, teams: g0.json && g0.json.teams, err: g0.json && g0.json.error });
  const g1 = await se('meets/participants/generate-teams', { meetId: meet.id, numTeams: 2, balanceSkill: true, seed: 7, persist: true, blindTeamsMinutes: 60 }, ken.token);
  const g1tom = g1.json && g1.json.meet && (g1.json.meet.participants || []).find((p) => p.id === pTom.id);
  ok('4 generate-teams persist (same seed): the same deal is written — tom carries a teamKey, meet.blindTeamsMinutes=60', g1.status === 200 && g1.json.persisted === true && g1tom && !!g1tom.teamKey && g1.json.meet.blindTeamsMinutes === 60 && JSON.stringify(g1.json.teams) === JSON.stringify(g0.json.teams), { status: g1.status, tomTeam: g1tom && g1tom.teamKey, blind: g1.json && g1.json.meet && g1.json.meet.blindTeamsMinutes, same: g1.json && JSON.stringify(g1.json.teams) === JSON.stringify(g0.json && g0.json.teams) });
  const asTom = (await se('meets/show', { meetId: meet.id }, tom.token)).json;
  const asKen = (await se('meets/show', { meetId: meet.id }, ken.token)).json;
  ok('5 blind teams: a player sees no teamKey on anyone while the host sees them (meet starts in the future)', asTom && (asTom.participants || []).every((p) => p.teamKey == null) && asKen && (asKen.participants || []).some((p) => !!p.teamKey), { tomSees: asTom && (asTom.participants || []).map((p) => p.teamKey), kenSees: asKen && (asKen.participants || []).map((p) => p.teamKey) });
  const g2 = await se('meets/participants/generate-teams', { meetId: meet.id, numTeams: 2, balanceSkill: true, seed: 7, persist: true, blindTeamsMinutes: null }, ken.token);
  const asTom2 = (await se('meets/show', { meetId: meet.id }, tom.token)).json;
  ok('6 blind off (blindTeamsMinutes:null) → the player sees the teams', g2.status === 200 && asTom2 && (asTom2.participants || []).some((p) => !!p.teamKey) && asTom2.blindTeamsMinutes == null, { status: g2.status, blind: asTom2 && asTom2.blindTeamsMinutes, tomSees: asTom2 && (asTom2.participants || []).map((p) => p.teamKey) });
  // 7. custom match
  const m1 = await se('meets/matches/upsert', { meetId: meet.id, round: 9, courtIndex: 2, team1Ids: [pTom.id], team2Ids: [pMei.id] }, ken.token);
  const ml = await se('meets/matches/list', { meetId: meet.id }, ken.token);
  const saved = m1.json && m1.json.id && Array.isArray(ml.json) ? ml.json.find((x) => x.id === m1.json.id) : null;
  ok('7 a custom match by hand: round 9, court 3, tom vs mei saved and listed', m1.status === 200 && saved && saved.round === 9 && saved.courtIndex === 2 && saved.team1Ids[0] === pTom.id && saved.team2Ids[0] === pMei.id, { status: m1.status, saved: saved && { round: saved.round, courtIndex: saved.courtIndex, t1: saved.team1Ids, t2: saved.team2Ids }, err: m1.json && m1.json.error });
  // 8. DUPR manager
  const dm = await se('meets/dupr-manager', { meetId: meet.id }, ken.token);
  const dmTom = dm.json && dm.json.players && dm.json.players.find((p) => p.participantId === pTom.id);
  const dmMatch = dm.json && dm.json.matches && dm.json.matches.find((m) => m.matchId === (m1.json && m1.json.id));
  ok('8 meets/dupr-manager: tom + mei listed with a connected boolean; the custom match listed unscored', dm.status === 200 && dmTom && typeof dmTom.connected === 'boolean' && dm.json.players.some((p) => p.participantId === pMei.id) && dmMatch && dmMatch.scored === false && dm.json.total >= 2, { status: dm.status, connected: dm.json && dm.json.connected, total: dm.json && dm.json.total, tom: dmTom, match: dmMatch, err: dm.json && dm.json.error });
  const dmx = await se('meets/dupr-manager', { meetId: meet.id }, tom.token);
  ok('8b a non-host is refused', dmx.status === 400 && dmx.json && dmx.json.error && dmx.json.error.code === 'MEET_NOT_HOST', { status: dmx.status });
  // 9. submit all
  const sa = await se('meets/matches/submit-dupr-all', { meetId: meet.id }, ken.token);
  ok('9 meets/matches/submit-dupr-all answers the counts; the unscored custom match is skipped', sa.status === 200 && typeof sa.json.skipped === 'number' && sa.json.skipped >= 1 && Array.isArray(sa.json.results), { status: sa.status, body: sa.json });
  // 10. receipt: upload a PNG to the drive as ken, pin it to tom
  const fd = new FormData(); fd.append('i', ken.token); fd.append('file', new Blob([PNG], { type: 'image/png' }), 'receipt-' + Date.now() + '.png');
  const up = await fetch(BASE + '/api/drive/files/create', { method: 'POST', body: fd }); const upj = await up.json().catch(() => ({}));
  const rc = upj.id ? await se('meets/participants/receipt', { meetId: meet.id, participantId: pTom.id, fileId: upj.id }, ken.token) : { status: 0, json: null };
  const rcShow = (await se('meets/show', { meetId: meet.id }, ken.token)).json; const rcTom = rcShow && (rcShow.participants || []).find((p) => p.id === pTom.id);
  const img = rcTom && rcTom.receiptUrl ? await fetch(rcTom.receiptUrl).then((r) => r.status).catch(() => 0) : 0;
  ok('10 receipt: drive upload → meets/participants/receipt pins it → meets/show carries receiptUrl (fetch 200) + receiptAt + receiptById=ken', up.status === 200 && rc.status === 200 && rcTom && !!rcTom.receiptUrl && img === 200 && !!rcTom.receiptAt && rcTom.receiptById === ken.userId, { upload: up.status, fileId: upj.id, receipt: rc.status, url: rcTom && rcTom.receiptUrl, img, at: rcTom && rcTom.receiptAt, err: rc.json && rc.json.error });
  const rcx = await se('meets/participants/receipt', { meetId: meet.id, participantId: pTom.id, fileId: upj.id }, mei.token);
  ok('10b another player cannot pin a receipt on tom', rcx.status === 400, { status: rcx.status, code: rcx.json && rcx.json.error && rcx.json.error.code });
  // 11. chat mute: a player (membership row) and the host (room owner)
  const cmTom = await se('meets/chat-mute', { meetId: meet.id, mute: true }, tom.token); const cmTomShow = (await se('meets/show', { meetId: meet.id }, tom.token)).json;
  const cmKen = await se('meets/chat-mute', { meetId: meet.id, mute: true }, ken.token); const cmKenShow = (await se('meets/show', { meetId: meet.id }, ken.token)).json;
  const roomTom = meet.chatRoomId ? await se('chat/rooms/show', { roomId: meet.chatRoomId }, tom.token) : { status: 0, json: null };
  ok('11 meets/chat-mute: tom (member) → chatMuted true on meets/show and chat/rooms/show isMuted; ken (room owner) → 200 + chatMuted true', cmTom.status === 200 && cmTomShow.chatMuted === true && cmKen.status === 200 && cmKenShow.chatMuted === true && (!meet.chatRoomId || (roomTom.json && roomTom.json.isMuted === true)), { tom: cmTom.status, tomMuted: cmTomShow.chatMuted, roomMuted: roomTom.json && roomTom.json.isMuted, ken: cmKen.status, kenMuted: cmKenShow.chatMuted, err: cmKen.json && cmKen.json.error });
  await se('meets/chat-mute', { meetId: meet.id, mute: false }, tom.token);   // leave tom audible; ken stays muted for the UI check below

  // ---- UI (as host-ken): sort menu, role chips, team swatches, the participant sheet, the Payments manager, the kebab mute
  const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  const ctx = await browser.createBrowserContext(); const page = await ctx.newPage(); await page.setViewport({ width: 412, height: 915, deviceScaleFactor: 2 });
  for (const c of kenCookies) await page.setCookie({ name: c.name, value: c.value, domain: HOST, path: '/', secure: true });
  const mutes = []; page.on('request', (r) => { if (r.url().endsWith('/api/meets/chat-mute') && r.method() === 'POST') { try { mutes.push(JSON.parse(r.postData() || '{}')); } catch (e) { mutes.push({ raw: r.postData() }); } } });
  const url = BASE + '/app/pages/meet/index?id=' + meet.id + '&tab=participants&lang=en';
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 }); await sleep(2500);
  await shot(page, 'roster');
  const grid = '.mt-sech ~ .mt-grid .mt-cell .mt-celln';
  const order0 = await names(page, grid);
  await page.evaluate(() => { const s = document.querySelectorAll('.mt-sort'); if (s[0]) s[0].click(); }); await sleep(900);
  const items = await names(page, '.ak-item');
  ok('12 Sort ▾ lists the seven Reclub options: Last confirmed · Alphabetical · Skill level · Courts · Attendance · DUPR singles · DUPR doubles', items.length === 7 && /Last confirmed/.test(items[0]) && /Alphabetical/.test(items[1]) && /Skill level/.test(items[2]) && /Courts/.test(items[3]) && /Attendance/.test(items[4]) && /DUPR singles/.test(items[5]) && /DUPR doubles/.test(items[6]), { items, order0 });
  await shot(page, 'sortsheet');
  const orders = {};
  for (const opt of ['Alphabetical', 'Skill level', 'Courts', 'Attendance', 'DUPR singles', 'DUPR doubles', 'Last confirmed']) {
    if (!(await page.$('.ak-item'))) { await page.evaluate(() => { const s = document.querySelectorAll('.mt-sort'); if (s[0]) s[0].click(); }); await sleep(800); }
    await clickText(page, '.ak-item', new RegExp('^' + opt)); await sleep(600);
    orders[opt] = { order: await names(page, grid), label: (await names(page, '.mt-sort'))[0] };
  }
  const alpha = order0.slice().sort((a, b) => a.localeCompare(b));
  ok('13 each option is applied (the label reads it) and Alphabetical equals the alphabetical order of the confirmed grid', Object.keys(orders).every((k) => new RegExp('Sort: ' + k).test(orders[k].label)) && orders['Alphabetical'].order.join('|') === alpha.join('|') && Object.values(orders).every((o) => o.order.length === order0.length), { orders, alpha });
  // role chips + team swatches on the cells (roles set in 2, teams in 4)
  const roles = await names(page, '.mt-htrole'); const swatches = await page.$$eval('.mt-cell .mt-htswatch-sm', (els) => els.length);
  ok('14 roster cells carry the role chips (Coach · Referee · Collector) and a team swatch per assigned player', roles.includes('Coach') && roles.includes('Referee') && roles.includes('Collector') && swatches >= 2, { roles, swatches });
  // the participant sheet on a confirmed cell (tom's)
  const tomName = pTom.displayName || (pTom.user && (pTom.user.name || pTom.user.username)) || '';
  await page.evaluate((n) => { const c = [...document.querySelectorAll('.mt-sech ~ .mt-grid .mt-cell')].find((x) => (x.textContent || '').indexOf(n) > -1); if (c) c.click(); }, tomName); await sleep(900);
  const sheetTitles = await names(page, '.mt-htsheet .mt-genl');
  ok('15 tapping tom\'s cell opens the participant sheet: Roles · Status · Assign a team · Assign a court · Payment · Method · Attendance', sheetTitles.some((t) => /Roles/.test(t)) && sheetTitles.some((t) => /Assign a team/.test(t)) && sheetTitles.some((t) => /Assign a court/.test(t)) && sheetTitles.some((t) => /Attendance/.test(t)), { sheetTitles, tomName });
  await shot(page, 'psheet');
  await page.keyboard.press('Escape'); await page.evaluate(() => { const o = document.querySelector('.nut-overlay, .nut-popup-overlay'); if (o) o.click(); }); await sleep(600);
  // Payments manager: filters + See receipt on tom
  await page.evaluate(() => { const c = [...document.querySelectorAll('.mt-quickc')].find((x) => /Payments/.test(x.textContent || '')); if (c) c.click(); }); await sleep(800);
  const filters = await names(page, '.mt-htfilters .pg-chip, .mt-htfilters .mt-sort'); const receipts = await names(page, '.mt-htreceipt');
  ok('16 Payments manager: Receipt only · Unpaid · By status ▾ filters, and tom\'s row reads "See receipt"', filters.some((f) => /Receipt only/.test(f)) && filters.some((f) => /Unpaid/.test(f)) && filters.some((f) => /By status/.test(f)) && receipts.some((r) => /See receipt/.test(r)), { filters, receipts });
  await shot(page, 'payments');
  await clickText(page, '.mt-htfilters .pg-chip', /Receipt only/); await sleep(500);
  const rowsAfter = await names(page, '.mt-add .pg-row .pg-row-name, .mt-add .pg-row');
  ok('17 Receipt only keeps only tom (the one receipt on the roster)', rowsAfter.length >= 1 && rowsAfter.some((r) => r.indexOf(tomName) > -1) && !rowsAfter.some((r) => r.indexOf((pMei.user && (pMei.user.name || pMei.user.username)) || ' ') > -1), { rowsAfter });
  // DUPR Manager bar → the sheet with Player list / Matches
  await page.evaluate(() => { const c = document.querySelector('.mt-htduprc'); if (c) c.click(); }); await sleep(1500);
  const duprChips = await names(page, '.ui-sheet .mt-htok, .ui-sheet .mt-htno');
  ok('18 the DUPR Manager bar opens the sheet: a Connected / Not connected chip per confirmed player', duprChips.length >= 2 && duprChips.every((c) => /connected/i.test(c)), { duprChips });
  await shot(page, 'dupr');
  await page.evaluate(() => { const o = document.querySelector('.nut-overlay, .nut-popup-overlay'); if (o) o.click(); }); await sleep(600);
  // kebab: "Turn on chat notifications" (ken is muted from 11) → tap → POST meets/chat-mute {mute:false}
  await page.evaluate(() => { const a = document.querySelectorAll('.ah-act'); if (a[a.length - 1]) a[a.length - 1].click(); }); await sleep(800);
  const kebab = await names(page, '.ak-item');
  const hadItem = kebab.some((k) => /Turn on chat notifications/.test(k));
  await clickText(page, '.ak-item', /Turn on chat notifications/); await sleep(1500);
  const kenAfter = (await se('meets/show', { meetId: meet.id }, ken.token)).json;
  ok('19 Details kebab carries "Turn on chat notifications" (ken muted) → tap → POST meets/chat-mute {mute:false} → chatMuted false', hadItem && mutes.length >= 1 && mutes[mutes.length - 1].mute === false && kenAfter.chatMuted === false, { kebab, mutes, chatMuted: kenAfter.chatMuted });
  await shot(page, 'kebab');
  await browser.close();

  // ---- cleanup
  if (!process.env.KEEP) {
    await se('meets/participants/bulk', { meetId: meet.id, participantIds: [pTom.id, pMei.id], tag: 'paid', untag: true, clearTeam: true, clearCourt: true }, ken.token);
    await se('meets/participants/update', { meetId: meet.id, participantId: pTom.id, isCoach: false }, ken.token);
    await se('meets/participants/update', { meetId: meet.id, participantId: pMei.id, isReferee: false, isPaymentCollector: false }, ken.token);
    await se('meets/participants/generate-teams', { meetId: meet.id, reset: true }, ken.token);
    if (m1.json && m1.json.id) await se('meets/matches/delete', { meetId: meet.id, matchId: m1.json.id }, ken.token);
    await se('meets/participants/receipt', { meetId: meet.id, participantId: pTom.id, fileId: null }, ken.token);
    if (upj.id) await se('drive/files/delete', { fileId: upj.id }, ken.token);
    await se('meets/chat-mute', { meetId: meet.id, mute: false }, ken.token);
    const fin = (await se('meets/show', { meetId: meet.id }, ken.token)).json;
    note('cleanup', { tags: fin && (fin.participants || []).map((p) => p.tags), teams: fin && (fin.participants || []).map((p) => p.teamKey), receipts: fin && (fin.participants || []).filter((p) => p.receiptUrl).length });
  }
  const pass = checks.filter((c) => c.pass).length;
  const v = { id: 'host-tools-v1', at: new Date().toISOString(), base: BASE, meet: { id: meet.id, name: meet.name }, condition_fired: true, verdict: pass === checks.length ? 'pass' : 'fail', pass, total: checks.length, evidence: checks.map((c) => c.name + '=' + (c.pass ? 'ok' : 'FAIL') + ' ' + JSON.stringify(c.detail).slice(0, 400)), info, detail: 'API (bulk tag, roles, generate teams + blind, custom match, DUPR manager, submit-dupr-all, receipt upload, chat-mute member + owner) and headless Chrome on ' + BASE + ' as host-ken (7 sorts, role chips, team swatches, participant sheet, Payments manager filters + See receipt, DUPR bar, kebab mute)', checks, screenshots: shots };
  fs.writeFileSync('/root/social-engine/probes/host-tools-v1.verdict.json', JSON.stringify(v, null, 2));
  console.log(v.verdict + ' ' + pass + '/' + checks.length); process.exit(v.verdict === 'pass' ? 0 : 1);
})().catch((e) => {
  console.error('PROBE CRASH', e && e.stack || e);
  const v = { id: 'host-tools-v1', at: new Date().toISOString(), base: BASE, condition_fired: true, verdict: 'fail', pass: checks.filter((c) => c.pass).length, total: checks.length, evidence: [...checks.map((c) => c.name + '=' + (c.pass ? 'ok' : 'FAIL') + ' ' + JSON.stringify(c.detail).slice(0, 400)), 'CRASH ' + String(e && e.message || e)], info, checks, screenshots: shots };
  fs.writeFileSync('/root/social-engine/probes/host-tools-v1.verdict.json', JSON.stringify(v, null, 2));
  process.exit(2);
});

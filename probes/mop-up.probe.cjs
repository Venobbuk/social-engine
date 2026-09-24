// mop-up L6 probe (lane mop-up, 2026-09-24). UAT only: https://uat.gripbat.com/app/ at 390 px through /root/gen/browser-slot.sh.
// Every account, club, meet, schedule and post it makes is "[probe] mop-up …", made by this run and removed in `finally`
// (accounts are fresh [probe] native sign-ups — no persona and no real user is ever notified; promote is pressed only after
// its own preview says the audience is exactly this run's two [probe] members).
// MODE=before runs against the build without the change (the planted fault: the old app) and MUST read the UI rows as
// failing; MODE=after is the proof. ONLY=pull,show,… runs a subset. Output: probes/mop-up.<mode>.json (+ mop-up.verdict.json
// written by mop-up-verdict.cjs, which also folds in the sub-lanes mop-up-comp / mop-up-chat).
// @claims route pages/meet/index :: mop-up :: pull,show,swap,promote,dupr-manager
// @claims route pages/community/index|pages/player/index|pages/meets/index|pages/feed/index|pages/lessons/index|pages/lesson/index|pages/more/index|pages/my-stats/index|pages/charter/index|pages/help/index|pages/meet-create/index|pages/home/index :: mop-up
// @claims endpoint meets/participants/swap|meets/update|meets/promote|meets/dupr-manager|adapter/account/delete|users/show :: mop-up
'use strict';
const fs = require('fs');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const L = require('/root/gen/mop-up/mu-lib.cjs');
const MODE = process.env.MODE || 'after';
const ONLY = (process.env.ONLY || '').split(',').filter(Boolean);
const RUN = Date.now().toString(36).slice(-6);
const PFX = '[probe] mop-up';
const OUT = '/root/social-engine/probes/mop-up.' + MODE + '.json';
const R = { id: 'mop-up', mode: MODE, at: new Date().toISOString(), run: RUN, rows: {}, detail: {}, cleanup: [] };
const FIX = { accts: [], meets: [], clubs: [], schedules: [], notes: [] };
const log = (m, d) => console.log(m + (d !== undefined ? ' ' + JSON.stringify(d).slice(0, 700) : ''));
function row(item, id, ok, level, evidence) { R.rows[id] = { item, id, status: ok ? 'closed' : 'still-open', level: ok ? level : level + ' (not met)', evidence }; log((ok ? 'PASS ' : 'FAIL ') + id, evidence); }
async function step(name, fn) { if (ONLY.length && !ONLY.includes(name)) return; try { await fn(); } catch (e) { R.detail['error:' + name] = String(e && e.stack || e).slice(0, 900); log('STEP-ERROR ' + name, String(e && e.message || e)); } }
const sql = (q) => execFileSync('docker', ['exec', '-i', 'social-engine-db-1', 'psql', '-U', 'social', '-d', 'se_sbx', '-qtA'], { input: q }).toString().trim();
const lit = (s) => "'" + String(s).replace(/'/g, "''") + "'";
const future = (days, h = 11) => { const d = new Date(Date.now() + days * 86400e3); d.setUTCHours(h, 0, 0, 0); return d.toISOString(); };
async function se(ep, body, tok) { const r = await L.se(ep, body, tok); return r; }
async function must(ep, body, tok) { const r = await se(ep, body, tok); if (r.status >= 300) throw new Error(ep + ' ' + r.status + ' ' + (r.text || '').slice(0, 300)); return r.json; }

// ---- fresh [probe] native accounts (GRIPBAT-ACCOUNTS-V1: sign-up → emailed code, which UAT's sandbox mail hands back)
const TERMS = sql(`select version from gb_terms_acceptance group by 1 order by max("acceptedAt") desc limit 1`);
async function mkAcct(tag, { consent = true } = {}) {
  const email = `mopup-${RUN}-${tag}@example.invalid`, password = 'Mu-' + crypto.randomBytes(8).toString('hex');
  const a = { tag, email, password, token: '', userId: '', username: '' }; FIX.accts.push(a);
  a.username = 'mu' + RUN + tag;
  const su = await se('signup', { emailAddress: email, password, lang: 'en' });
  const code = su.json && su.json._dev_code;
  if (code) {
    const done = await se('signup-pending', { code }); a.token = done.json && done.json.i; if (!a.token) throw new Error('signup-pending ' + done.status);
    await must('gb/account/username', { username: a.username }, a.token);
  } else if (su.json && su.json.error && su.json.error.code === 'REGISTRATION_CLOSED') {
    // UAT's public sign-up is closed (meta.disableRegistration): Misskey's own staff door makes the account (REUSED,
    // server/api/endpoints/admin/accounts/create.ts), signed in by the admin persona — same native account, no email
    const adm = await L.who('admin');
    const r = await must('admin/accounts/create', { username: a.username, password }, adm.token); a.token = r.token; a.via = 'admin/accounts/create';
  } else throw new Error('signup ' + tag + ' ' + su.status + ' ' + su.text.slice(0, 200));
  const me = await must('i/update', { name: PFX + ' ' + tag + ' ' + RUN }, a.token); a.userId = me.id; a.name = me.name;
  if (consent) await must('meets/level', { sport: 'pickleball', acceptTerms: TERMS }, a.token);
  return a;
}
// a browser context signed in as a [probe] account (the lib's newCtx does personas; this plants the same storage)
async function ctxFor(b, a, { onboarded = true, width = 390 } = {}) {
  const ctx = await b.createBrowserContext(); const page = await ctx.newPage();
  await page.setViewport({ width, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  page.__req = []; page.__resp = []; page.__failed = []; page.__errors = [];
  page.on('request', (r) => { const u = r.url(); if (u.includes('/api/') && r.method() === 'POST') page.__req.push({ at: Date.now(), url: u.replace(/^https:\/\/[^/]+/, ''), body: (r.postData() || '').replace(/"i":"[^"]+"/, '"i":"…"').slice(0, 3000) }); });
  page.on('response', (r) => { const u = r.url(); if (u.includes('/api/')) page.__resp.push({ at: Date.now(), url: u.replace(/^https:\/\/[^/]+/, ''), status: r.status() }); });
  page.on('pageerror', (e) => page.__errors.push(String(e).slice(0, 300)));
  await page.goto(L.APPHOST + '/app/', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => undefined);
  await page.evaluate((t, ob) => { localStorage.setItem('boyau_social_token', JSON.stringify({ data: t })); localStorage.setItem('hkpl_lang_ok', JSON.stringify({ data: '1' })); if (ob) localStorage.setItem('boyau_onboarded', '1'); }, a.token, onboarded);
  return { ctx, page };
}
const txt = (p) => L.text(p);
const dumpUI = (page) => page.evaluate(() => ({ url: location.pathname + location.search, sheets: Array.from(document.querySelectorAll('.nut-popup, [role=dialog], [class*=sheet]')).filter((x) => x.getBoundingClientRect().height > 20).map((x) => x.className + ' :: ' + x.innerHTML.replace(/<img[^>]*>/g, '').replace(/ src="[^"]*"/g, '').slice(0, 1800)), text: document.body.innerText.slice(0, 1500) }));
async function clickSel(page, sel, i = 0) { const n = await page.$$(sel); if (!n[i]) throw new Error('no ' + sel); await n[i].evaluate((e) => e.scrollIntoView({ block: 'center' })); await L.sleep(300); await n[i].click(); await L.sleep(900); }
const visible = (page, sel) => page.evaluate((sel) => Array.from(document.querySelectorAll(sel)).filter((e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 2 && r.height > 2 && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05; }).length, sel);
async function typeIn(page, sel, s) { const el = await page.$(sel); if (!el) throw new Error('no input ' + sel); await el.click({ clickCount: 3 }); await page.keyboard.type(s, { delay: 25 }); await L.sleep(1500); }

let A, B, C, D, E, F, M1, M2, CLUB, BRW;
(async () => {
  BRW = await L.browser();
  try {
    R.detail.bundle = ((await (await fetch(L.APPHOST + '/app/')).text()).match(/js\/app\.[0-9a-f]+\.js/) || [''])[0];
    // ---------------------------------------------------------------- fixtures
    A = await mkAcct('a'); B = await mkAcct('b'); C = await mkAcct('c'); F = await mkAcct('f');
    CLUB = await must('channels/create', { name: PFX + ' club with a deliberately long name for the pill ' + RUN, description: PFX }, A.token); FIX.clubs.push(CLUB.id);
    R.detail.clubOpen = (await se('clubs/settings/update', { channelId: CLUB.id, gateType: 'open' }, A.token)).status;
    R.detail.joins = []; for (const x of [B, C]) R.detail.joins.push((await se('clubs/join', { channelId: CLUB.id }, x.token)).json);
    M1 = await must('meets/create', { name: PFX + ' m1 ' + RUN, sport: 'pickleball', type: 'managed', startAt: future(3), durationMinutes: 90, capacity: 8, visibility: 'public', feeType: 'free', autoApprove: true, sendNotifications: true, submitMatches: true, channelId: CLUB.id }, A.token); FIX.meets.push(M1.id);
    for (const x of [B, C]) await must('meets/join', { meetId: M1.id }, x.token);
    R.detail.fixtures = { A: A.userId, B: B.userId, C: C.userId, F: F.userId, club: CLUB.id, m1: M1.id };
    const show = async (tok, id) => (await se('meets/show', { meetId: id }, tok)).json || {};
    const partOf = (m, uid) => (m.participants || []).find((p) => p.userId === uid);

    // ---------------------------------------------------------------- 1. pull to refresh, on four pages
    await step('pull', async () => {
      const pages = [['meet', 'meet/index?id=' + M1.id, 'm1 ' + RUN], ['club', 'community/index?id=' + CLUB.id, 'deliberately long'], ['player', 'player/index?id=' + B.userId, 'b ' + RUN], ['discover', 'meets/index', 'Discover']];
      const K = await ctxFor(BRW, A); const out = {};
      for (const [k, route, want] of pages) {
        await L.open(K.page, route); await L.sleep(2500);
        const url0 = K.page.url(); K.page.__resp = [];
        await L.pullDown(K.page, 180, 195, 230); await L.sleep(4500);
        const after = K.page.__resp.filter((r) => !/\/api\/(i|meta)$/.test(r.url)).length;
        const url1 = K.page.url(); const t = await txt(K.page);
        const sameRoute = url1.split('?')[0] === url0.split('?')[0] && (route.includes('?') ? url1.includes(route.split('?')[1].split('&')[0]) : true);
        out[k] = { refetched: after, sameRoute, contentBack: t.toLowerCase().includes(want.toLowerCase()), shot: await L.shot(K.page, MODE + '-pull-' + k) };
      }
      // a drag that starts on an open sheet must NOT reload the page (the fault the H5 pull could introduce)
      await L.open(K.page, 'meet/index?id=' + M1.id + '&tab=participants'); await L.sleep(2500);
      let sheetSafe = null;
      try { await L.clickText(K.page, 'Sort', { contains: true, wait: 1200 }); const url0 = K.page.url(); K.page.__resp = []; await L.pullDown(K.page, 200, 195, 560); await L.sleep(3000); sheetSafe = { stillOpen: (await visible(K.page, '.nut-popup')) > 0, reloads: K.page.__resp.filter((r) => /meets\/show/.test(r.url)).length, sameUrl: K.page.url() === url0 }; } catch (e) { sheetSafe = { error: e.message }; }
      await K.ctx.close();
      const ok = Object.values(out).every((o) => o.refetched > 0 && o.sameRoute && o.contentBack) && sheetSafe && sheetSafe.reloads === 0;
      row('1 pull-to-refresh (every H5 page)', 'pull.all-pages', ok, 'L6', { pages: out, sheetDragDoesNotReload: sheetSafe });
    });

    // ---------------------------------------------------------------- 2a. Show settings are the host's, on the meet (A-meet-detail.45)
    await step('show', async () => {
      const K = await ctxFor(BRW, A); await L.open(K.page, 'meet/index?id=' + M1.id + '&tab=participants'); await L.sleep(2500);
      K.page.__req = [];
      await L.clickText(K.page, 'Show:', { contains: true, sel: '.mt-sort', wait: 1500 });
      const flip = async (label) => { const ok = await K.page.evaluate((label) => { const r = Array.from(document.querySelectorAll('.mt-genopt')).find((x) => (x.querySelector('.mt-genoptt') || {}).innerText === label); if (!r) return false; const sw = r.lastElementChild; sw.scrollIntoView({ block: 'center' }); sw.setAttribute('data-mu', 'sw'); return true; }, label); if (!ok) throw new Error('no switch ' + label); await K.page.click('[data-mu="sw"]'); await K.page.evaluate(() => document.querySelector('[data-mu="sw"]').removeAttribute('data-mu')); await L.sleep(1800); };
      await flip('Gender'); await flip('Level');
      const sent = K.page.__req.filter((r) => r.url.includes('meets/update')).map((r) => (r.body.match(/"rosterVisibility":\[[^\]]*\]/) || [''])[0]);
      const hostShot = await L.shot(K.page, MODE + '-show-host-sheet'); await K.ctx.close();
      const back = (await show(A.token, M1.id)).rosterVisibility;
      const K2 = await ctxFor(BRW, B); await L.open(K2.page, 'meet/index?id=' + M1.id + '&tab=participants'); await L.sleep(3000);
      const t2 = await txt(K2.page); const levelChips = await visible(K2.page, '.mt-level');
      const playerShot = await L.shot(K2.page, MODE + '-show-player'); await K2.ctx.close();
      const ok = sent.length >= 2 && Array.isArray(back) && back.includes('show_gender') && !back.includes('show_level') && !/Show:/.test(t2) && levelChips === 0;
      row('2 A-meet-detail.45 host-wide Show', 'meet.45.show-host-wide', ok, 'L6', { sent, readBack: back, playerSeesShowControl: /Show:/.test(t2), playerLevelChips: levelChips, hostShot, playerShot });
    });

    // ---------------------------------------------------------------- 7. DUPR Manager names the teams when opened from Participants
    await step('dupr', async () => {
      const m = await show(A.token, M1.id); const pb = partOf(m, B.userId), pc = partOf(m, C.userId);
      await must('meets/matches/upsert', { meetId: M1.id, round: 1, team1Ids: [pb.id], team2Ids: [pc.id] }, A.token);
      const K = await ctxFor(BRW, A); await L.open(K.page, 'meet/index?id=' + M1.id + '&tab=participants'); await L.sleep(2500);
      await L.clickText(K.page, 'Manager', { sel: '.mt-quickt', wait: 2500 });
      await L.clickText(K.page, 'Matches', { within: '.nut-popup', wait: 2000 });
      const rowsTxt = await K.page.evaluate(() => Array.from(document.querySelectorAll('.nut-popup .pg-row-name')).map((x) => x.innerText));
      const shot = await L.shot(K.page, MODE + '-dupr-manager'); await K.ctx.close();
      const named = rowsTxt.filter((t) => / vs /.test(t) && t.includes('b ' + RUN) && t.includes('c ' + RUN));
      row('7 DUPR Manager team names from Participants', 'dupr.manager-team-names', named.length >= 1, 'L6', { rows: rowsTxt, shot });
    });

    // ---------------------------------------------------------------- 2b. Swap my spot (A-meet-detail.47) — new engine door
    await step('swap', async () => {
      // refusals first (each is a planted fault the door must catch)
      const notIn = await se('meets/participants/swap', { meetId: M1.id, userId: C.userId }, F.token);         // F holds no seat
      const hostOut = await se('meets/participants/swap', { meetId: M1.id, userId: F.userId }, A.token);       // the host cannot swap out
      const toConfirmed = await se('meets/participants/swap', { meetId: M1.id, userId: C.userId }, B.token);  // C already has a seat
      M2 = await must('meets/create', { name: PFX + ' m2 private ' + RUN, sport: 'pickleball', type: 'managed', startAt: future(4), durationMinutes: 90, capacity: 4, visibility: 'private', feeType: 'free', autoApprove: true, sendNotifications: false }, A.token); FIX.meets.push(M2.id);
      await must('meets/participants/add', { meetId: M2.id, userId: B.userId, status: 'confirmed' }, A.token);
      const toStranger = await se('meets/participants/swap', { meetId: M2.id, userId: F.userId }, B.token);   // private meet, F outside it
      const before = await show(A.token, M1.id);
      // the real flow, in the app, as B: footer → Swap my spot → find F → Give spot → Confirm
      const K = await ctxFor(BRW, B); await L.open(K.page, 'meet/index?id=' + M1.id); await L.sleep(2500);
      await L.clickText(K.page, 'Swap my spot', { wait: 1800 });
      R.detail.swapUI = await dumpUI(K.page);
      await typeIn(K.page, '.nut-popup input, [role=dialog] input, input', F.username);
      await L.sleep(1500);
      const found = await K.page.evaluate((nm) => { const r = Array.from(document.querySelectorAll('.nut-popup .pg-row')).find((x) => x.innerText.includes(nm)); if (!r) return false; const b = Array.from(r.querySelectorAll('*')).find((x) => x.innerText && x.innerText.trim() === 'Give spot'); if (!b) return false; b.scrollIntoView({ block: 'center' }); b.setAttribute('data-mu', 'give'); return true; }, 'f ' + RUN);
      if (!found) { R.detail.swapSheet = (await txt(K.page)).slice(0, 1500); throw new Error('taker row with Give spot not found'); }
      await K.page.click('[data-mu="give"]'); await L.sleep(1500);
      const dlg = await K.page.evaluate(() => (document.querySelector('.nut-dialog') || {}).innerText || '');
      K.page.__req = [];
      await L.clickText(K.page, 'Confirm', { within: '.nut-dialog', wait: 3500 });
      const sent = K.page.__req.filter((r) => r.url.includes('meets/participants/swap')).map((r) => r.body);
      const shot = await L.shot(K.page, MODE + '-swap-after'); await K.ctx.close();
      const after = await show(A.token, M1.id);
      const fRow = partOf(after, F.userId), bRow = partOf(after, B.userId), bOld = partOf(before, B.userId);
      const fn = (await se('i/notifications', { limit: 10 }, F.token)).json || []; const an = (await se('i/notifications', { limit: 10 }, A.token)).json || [];
      const told = fn.find((n) => n.header === 'Spot handed to you' && /gave you their spot/.test(n.body || '')); const hostTold = an.find((n) => n.header === 'Spot swapped');
      const ok = notIn.status === 400 && hostOut.status === 400 && toConfirmed.status === 400 && toStranger.status === 400 && sent.length === 1 && fRow && fRow.status === 'confirmed' && !bRow && bOld && fRow.id === bOld.id && after.confirmed === before.confirmed && !!told && !!hostTold;
      row('2 A-meet-detail.47 Swap my spot', 'meet.47.swap', ok, 'L6', { refused: { noSeat: notIn.json && notIn.json.error && notIn.json.error.code, host: hostOut.json && hostOut.json.error && hostOut.json.error.code, takerHasSeat: toConfirmed.json && toConfirmed.json.error && toConfirmed.json.error.code, privateStranger: toStranger.json && toStranger.json.error && toStranger.json.error.code }, dialog: dlg.slice(0, 200), sent, seat: { sameRow: !!(fRow && bOld && fRow.id === bOld.id), takerStatus: fRow && fRow.status, giverGone: !bRow, confirmed: [before.confirmed, after.confirmed] }, takerNotified: told && { header: told.header, body: told.body }, hostNotified: !!hostTold, shot });
    });

    // ---------------------------------------------------------------- 2c. Promote with a [probe]-only audience (A-promote-meet.06) + 4 the audience chip is readable
    await step('promote', async () => {
      const M3 = await must('meets/create', { name: PFX + ' promote ' + RUN, sport: 'pickleball', type: 'managed', startAt: future(1, 11), durationMinutes: 90, capacity: 8, visibility: 'public', feeType: 'free', autoApprove: true, sendNotifications: true, channelId: CLUB.id }, A.token); FIX.meets.push(M3.id);   // promote opens 36 h before the start
      const pv = await must('meets/promote', { meetId: M3.id, preview: true, audience: 'club' }, A.token);
      R.detail.promotePreview = pv;
      if (pv.reach !== 2 || pv.club !== 2) { row('2 A-promote-meet.06', 'promote.06', false, 'L6', { refusedToPress: 'preview audience is not exactly the two [probe] members', preview: pv }); return; }
      const K = await ctxFor(BRW, A); await L.open(K.page, 'meet/index?id=' + M3.id + '&tab=participants'); await L.sleep(3000);
      R.detail.promoteUI = await dumpUI(K.page);
      await L.clickText(K.page, 'Club members', { wait: 1200 });
      const chip = await K.page.evaluate(() => { const c = Array.from(document.querySelectorAll('.pg-chip.pg-tab-on')).find((x) => x.innerText.trim() === 'Club members'); if (!c) return null; c.setAttribute('data-mu', 'chip'); return true; });
      const contrast = chip ? await L.contrastOf(K.page, '[data-mu="chip"]') : null;
      K.page.__req = [];
      await L.clickText(K.page, 'Promote', { sel: '.btn, [class*=btn], .mx-promote *', wait: 1500 }).catch(async () => L.clickText(K.page, 'Promote', { wait: 1500 }));
      if (await visible(K.page, '.nut-dialog')) await L.clickText(K.page, 'Confirm', { within: '.nut-dialog', wait: 3500 });
      const sent = K.page.__req.filter((r) => r.url.includes('meets/promote')).map((r) => r.body);
      const t = await txt(K.page); const shot = await L.shot(K.page, MODE + '-promote-result'); await K.ctx.close();
      const got = async (x) => ((await se('i/notifications', { limit: 10 }, x.token)).json || []).filter((n) => /is looking for players/.test(n.body || '') && (n.link === 'meet:' + M3.id || (n.body || '').includes('a ' + RUN))).length;   // the body names the HOST, not the meet (MeetExtras.ts:243)
      const nb = await got(B), nc = await got(C), nf = await got(F);
      const ok = sent.some((b) => /"audience":"club"/.test(b) && !/"preview":true/.test(b)) && nb === 1 && nc === 1 && nf === 0 && /2 players/.test(t);
      row('2 A-promote-meet.06 promote ([probe] audience)', 'promote.06', ok, 'L6', { preview: { reach: pv.reach, club: pv.club }, sent, received: { B: nb, C: nc, outsiderF: nf }, resultText: (t.match(/[^\n]*promoted[^\n]*/i) || [''])[0], shot });
      row('4 selected chip readable (Get more players audience)', 'visual.chip-promote', !!contrast && contrast.ratio >= 4.5, 'L6', { contrast });
    });

    // ---------------------------------------------------------------- 2d. listing popup from the Discover card (A-meet-listings-popup.01)
    await step('listing', async () => {
      const LM = await must('meets/create', { name: PFX + ' listing ' + RUN, sport: 'pickleball', type: 'listing', startAt: new Date(Math.ceil((Date.now() + 3 * 3600e3) / 3600e3) * 3600e3).toISOString(),   /* today: Discover opens on TODAY */ durationMinutes: 90, capacity: 8, visibility: 'public', feeType: 'free', lat: 22.2819, lng: 114.1581, venueName: PFX + ' venue', sendNotifications: false }, A.token); FIX.meets.push(LM.id);
      const K = await ctxFor(BRW, B); await L.open(K.page, 'meets/index?pane=meets'); await L.sleep(2500);
      let has = null;
      for (let i = 0; i < 14 && !has; i++) {
        has = await K.page.evaluate((nm) => { const card = Array.from(document.querySelectorAll('.dv-item')).find((x) => x.innerText.includes(nm)); if (!card) return null; const chip = Array.from(card.querySelectorAll('.dv-chip')).find((c) => c.innerText.trim() === 'Listing'); if (!chip) return 'nochip'; chip.scrollIntoView({ block: 'center' }); chip.setAttribute('data-mu', 'lchip'); return 'ok'; }, 'listing ' + RUN);
        if (!has) { await K.page.evaluate(() => { document.querySelectorAll('.taro_page, .sh-app-body').forEach((x) => { x.scrollTop += 1500; }); window.scrollBy(0, 1500); }); await L.sleep(1200); }
      }
      R.detail.listingInList = has; if (!has) R.detail.listingUI = await dumpUI(K.page); R.detail.listingMeet = await se('meets/show', { meetId: LM.id }, B.token).then((r) => r.json && { type: r.json.type, lat: r.json.lat, startAt: r.json.startAt, visibility: r.json.visibility });
      let popup = '';
      if (has === 'ok') { K.page.__req = []; await K.page.click('[data-mu="lchip"]'); await L.sleep(1500); popup = await K.page.evaluate(() => Array.from(document.querySelectorAll('.nut-dialog, .nut-popup')).map((x) => x.innerText).join('\n')); }
      const nav = K.page.url(); const shot = await L.shot(K.page, MODE + '-listing-popup'); await K.ctx.close();
      row('2 A-meet-listings-popup.01', 'listing.popup.01', has === 'ok' && /This listing contains only information/.test(popup) && !/meet\/index/.test(nav), 'L6', { card: has, popup: popup.slice(0, 300), stayedOnDiscover: !/meet\/index/.test(nav), shot });
    });

    // ---------------------------------------------------------------- 2e. a deleted account's page (E-player.02) — deleted through the grace door
    await step('deleted', async () => {
      D = await mkAcct('d');
      const del = await se('adapter/account/delete', { password: D.password }, D.token);
      const sched = sql(`select count(*) from gb_account_deletion where "userId" = ${lit(D.userId)}`);
      // the 7-day grace is fast-forwarded for THIS [probe] account only (UAT database), then the minute sweep purges it
      sql(`update gb_account_deletion set "purgeAt" = now() - interval '1 minute' where "userId" = ${lit(D.userId)}`);
      let us = null; const end = Date.now() + 200e3;
      while (Date.now() < end) { us = await se('users/show', { userId: D.userId }, B.token); if (us.json && us.json.error && us.json.error.code === 'USER_DELETED') break; await L.sleep(8000); }
      const K = await ctxFor(BRW, B); await L.open(K.page, 'player/index?id=' + D.userId); await L.sleep(3000);
      const t = await txt(K.page); const shot = await L.shot(K.page, MODE + '-player-deleted'); await K.ctx.close();
      row('2 E-player.02 deleted-account message', 'player.02.deleted', del.status === 200 && sched === '1' && us && us.json && us.json.error && us.json.error.code === 'USER_DELETED' && /no longer available on GripBat/.test(t), 'L6', { graceDoor: del.status + ' ' + JSON.stringify(del.json || {}).slice(0, 120), graceRow: sched, usersShow: us && us.json && us.json.error && us.json.error.code, pageSays: (t.match(/[^\n]*no longer available[^\n]*/) || [''])[0], shot });
    });

    // ---------------------------------------------------------------- 4. visual family
    await step('visual', async () => {
      // (a) every selected chip on Discover's filter sheet reads light on dark
      const K = await ctxFor(BRW, B); await L.open(K.page, 'meets/index?pane=meets'); await L.sleep(2500);
      await clickSel(K.page, '.dv-filter').catch(() => undefined); await L.sleep(1200);
      const chips = await K.page.evaluate(() => { const out = []; document.querySelectorAll('.pg-chip.pg-tab-on, .pg-tab.pg-tab-on').forEach((el, i) => { const r = el.getBoundingClientRect(); if (r.width < 2) return; el.setAttribute('data-muc', String(i)); out.push(String(i)); }); return out; });
      const ratios = []; for (const i of chips) ratios.push(await L.contrastOf(K.page, '[data-muc="' + i + '"]'));
      const cshot = await L.shot(K.page, MODE + '-discover-chips');
      row('4 selected chips readable (Discover filters, every pg-tab-on)', 'visual.chips-discover', ratios.length > 0 && ratios.every((r) => r && r.ratio >= 4.5), 'L6', { n: ratios.length, worst: ratios.slice().sort((a, b) => a.ratio - b.ratio).slice(0, 3), shot: cshot });
      // (b) People rows: no lone leading separator
      await L.open(K.page, 'meets/index?pane=people'); await L.sleep(3500);
      const subs = await K.page.evaluate(() => Array.from(document.querySelectorAll('.pg-row-sub')).map((x) => x.innerText));
      const bad = subs.filter((s) => /^\s*·/.test(s) || /·\s*$/.test(s));
      const pshot = await L.shot(K.page, MODE + '-people-rows'); await K.ctx.close();
      row('4 People rows: no stray " · "', 'visual.people-sep', subs.length > 0 && bad.length === 0, 'L6', { rows: subs.length, bad: bad.slice(0, 5), followerOnlyRows: subs.filter((s) => /^\d+ followers?$/.test(s)).length, shot: pshot });
      // (c) the feed's type pill stays on the card (long club name + Announcement)
      const note = await must('notes/create', { text: PFX + ' announcement ' + RUN, channelId: CLUB.id }, A.token); FIX.notes.push(note.createdNote ? note.createdNote.id : note.id);
      await se('clubs/posts/announce', { channelId: CLUB.id, noteId: note.createdNote ? note.createdNote.id : note.id, on: true }, A.token);
      const K3 = await ctxFor(BRW, B); await L.open(K3.page, 'feed/index'); await L.sleep(4000);
      const pill = await K3.page.evaluate((nm) => { const post = Array.from(document.querySelectorAll('.fd-post')).find((x) => x.innerText.includes(nm)); if (!post) return null; const p = post.querySelector('.fd-annpill'); if (!p) return 'nopill'; p.scrollIntoView({ block: 'center' }); const pr = p.getBoundingClientRect(), cr = post.getBoundingClientRect(); const seen = (el) => { const r = el.getBoundingClientRect(); if (r.width < 4) return false; const hit = document.elementFromPoint(r.left + Math.min(r.width - 2, 8), r.top + r.height / 2); return !!hit && (hit === el || el.contains(hit)); }; const nm2 = post.querySelector('.fd-club'); return { pill: p.innerText, pillRight: Math.round(pr.right), cardRight: Math.round(cr.right), vw: window.innerWidth, width: Math.round(pr.width), pillSeen: seen(p), pillEndSeen: (() => { const hit = document.elementFromPoint(pr.right - 3, pr.top + pr.height / 2); return !!hit && (hit === p || p.contains(hit)); })(), nameSeen: !!nm2 && seen(nm2), clipped: pr.right > cr.right - 1 || pr.right > window.innerWidth }; }, 'announcement ' + RUN);
      const fshot = await L.shot(K3.page, MODE + '-feed-pill');
      const pillPlant = await K3.page.evaluate((nm) => { const post = Array.from(document.querySelectorAll('.fd-post')).find((x) => x.innerText.includes(nm)); const p = post && post.querySelector('.fd-annpill'); const name = post && post.querySelector('.fd-club'); if (!p || !name) return null; name.appendChild(p); name.style.display = 'block'; const pr = p.getBoundingClientRect(); const hit = document.elementFromPoint(pr.right - 3, pr.top + pr.height / 2); return { pillEndSeen: !!hit && (hit === p || p.contains(hit)) }; }, 'announcement ' + RUN);
      R.detail.selftestPill = pillPlant;
      row('self-test: the pill check fails on the old markup (pill inside the nowrap name)', 'selftest.pill-plant', !!pillPlant && pillPlant.pillEndSeen === false, 'L6 (planted in the page)', { planted: pillPlant });
      await K3.ctx.close();
      row('4 feed announcement pill not clipped (G5)', 'visual.feed-pill', !!pill && typeof pill === 'object' && !pill.clipped && pill.width > 20 && pill.pillSeen && pill.pillEndSeen && pill.nameSeen, 'L6', { pill, shot: fshot });
      // (d) coach tab: "Generate now" and "Edit" do not touch; (e) "Buy a pack of 8 lessons"
      const sc = await se('coaches/schedules/create', { channelId: CLUB.id, name: PFX + ' lesson ' + RUN, weekday: 3, startTime: '19:00', durationMinutes: 60, capacity: 4, bookingMode: 'pack', packSize: 8, visibility: 'public', sendNotifications: false, priceTiers: [{ minParticipants: 1, maxParticipants: 4, pricePerPerson: 20000, currency: 'HKD' }] }, A.token);
      R.detail.schedule = sc.status + ' ' + (sc.text || '').slice(0, 200);
      if (sc.json && sc.json.id) FIX.schedules.push(sc.json.id);
      const K4 = await ctxFor(BRW, A); await L.open(K4.page, 'lessons/index'); await L.sleep(2500);
      await L.clickText(K4.page, 'Coaching', { wait: 3000 });
      const gap = await K4.page.evaluate((nm) => { const r = Array.from(document.querySelectorAll('.pg-row')).find((x) => x.innerText.includes(nm)); if (!r) return null; const g = r.querySelector('.ls-genlink'), v = r.querySelector('.pg-row-val'); if (!g || !v) return 'missing'; g.scrollIntoView({ block: 'center' }); const a = g.getBoundingClientRect(), b = v.getBoundingClientRect(); return { gen: g.innerText, val: v.innerText, gapPx: Math.round(b.left - a.right), sameLine: Math.abs(a.top - b.top) < 12, rowRight: Math.round(r.getBoundingClientRect().right), valRight: Math.round(b.right) }; }, 'lesson ' + RUN);
      const gshot = await L.shot(K4.page, MODE + '-coach-row'); await K4.ctx.close();
      row('4 "Generate now" clear of "Edit" (coach tab)', 'visual.generate-edit', !!gap && typeof gap === 'object' && gap.gapPx >= 8 && gap.valRight <= gap.rowRight, 'L6', { gap, shot: gshot });
      let packT = '', kshot = '';
      if (sc.json && sc.json.id) { const K5 = await ctxFor(BRW, B); await L.open(K5.page, 'lesson/index?id=' + sc.json.id); await L.sleep(3500); packT = await txt(K5.page); kshot = await L.shot(K5.page, MODE + '-lesson-pack'); await K5.ctx.close(); }
      row('4 "Buy a pack of 8 lessons" (article)', 'visual.pack-article', /Buy a pack of 8 lessons/.test(packT) && !/Buy a 8/.test(packT), 'L6', { found: (packT.match(/Buy a[^\n]*/) || [''])[0], shot: kshot });
      // (f) "Together null–1": the engine answers a stranger with numbers (SEC-CHEM-V3), the app guards a missing value
      const gp = (await se('stats/gb-pairs', { pairs: [[B.userId, C.userId]] }, F.token)).json;
      row('4 "Together null–1" (round-robin Matches)', 'visual.together-null', Array.isArray(gp) && gp.every((z) => typeof z.wins === 'number' && typeof z.expected === 'number'), 'L5 engine + L2 app guard (TOGETHER-NULL-V1, pages/meet/index.tsx pairLine)', { gbPairsAsStranger: gp, note: 'no pair with a shared rated history exists among this run\'s fresh accounts, so the line is not drawn on screen' });
    });

    // ---------------------------------------------------------------- 5. overlays: one stacking rule
    await step('overlay', async () => {
      E = await mkAcct('e', { consent: false });   // no terms accepted, no saved place, not onboarded
      const K = await ctxFor(BRW, E, { onboarded: false }); await L.open(K.page, 'home/index');
      const samples = [];
      for (let i = 0; i < 8; i++) {
        await L.sleep(800);
        samples.push(await K.page.evaluate(() => {
          const vis = (sel) => Array.from(document.querySelectorAll(sel)).some((e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 2 && r.height > 2 && s.display !== 'none' && s.visibility !== 'hidden'; });
          const gate = vis('.cg, .ag'); const dialog = vis('.nut-dialog');
          const fab = Array.from(document.querySelectorAll('.fb-fab')).find((f) => f.getBoundingClientRect().width > 4); let fabOnTop = null;
          if (fab) { const r = fab.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); fabOnTop = !!hit && (hit === fab || fab.contains(hit)); }
          return { path: location.pathname, gate, dialog, fabOnTop };
        }));
      }
      const shot1 = await L.shot(K.page, MODE + '-overlay-gate');
      const fabPlant = await K.page.evaluate(() => { if (!document.querySelector('.cg, .ag')) return null; document.documentElement.removeAttribute('data-gb-gate'); const fab = Array.from(document.querySelectorAll('.fb-fab')).find((f) => f.getBoundingClientRect().width > 4); if (!fab) return null; const r = fab.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); const out = { fabOnTop: !!hit && (hit === fab || fab.contains(hit)) }; document.documentElement.setAttribute('data-gb-gate', '1'); return out; });
      row('self-test: the report-button check sees it covered under the old stacking', 'selftest.fab-plant', !!fabPlant && fabPlant.fabOnTop === false, 'L6 (planted in the page)', { planted: fabPlant });
      const badGate = samples.filter((s) => s.gate && (s.dialog || s.fabOnTop === false));
      // accept the terms: the gate goes, and the waiting prompt may now show (never over onboarding)
      let afterAgree = [];
      if (samples.some((s) => s.gate)) {
        await L.clickText(K.page, 'I agree', { wait: 1500 }).catch(() => undefined);
        for (let i = 0; i < 6; i++) { await L.sleep(800); afterAgree.push(await K.page.evaluate(() => ({ path: location.pathname, gate: !!document.querySelector('.cg, .ag'), dialog: Array.from(document.querySelectorAll('.nut-dialog')).some((e) => e.getBoundingClientRect().height > 2), dialogText: ((document.querySelector('.nut-dialog') || {}).innerText || '').slice(0, 60) }))); }
      }
      const overOnboarding = afterAgree.filter((s) => /onboard|signin/.test(s.path) && s.dialog);
      const shot2 = await L.shot(K.page, MODE + '-overlay-after-agree'); await K.ctx.close();
      row('5 gate above page prompts; report button above the gate', 'overlay.stacking', samples.some((s) => s.gate) && badGate.length === 0 && overOnboarding.length === 0, 'L6', { gateSeen: samples.filter((s) => s.gate).length, dialogOverGate: samples.filter((s) => s.gate && s.dialog).length, fabCovered: samples.filter((s) => s.gate && s.fabOnTop === false).length, afterAgree, shots: [shot1, shot2] });
    });

    // ---------------------------------------------------------------- 6. G15.15 wording: no league / HKPL on GripBat screens, EN / 繁 / 简
    await step('wording', async () => {
      const routes = ['more/index', 'meets/index?pane=venues', 'meet-create/index', 'my-stats/index', 'charter/index', 'help/index', 'venue/index?id=' + (sql(`select id from venue where status = 'under_review' limit 1`) || 'none')];
      const K = await ctxFor(BRW, B); const hits = {};
      for (const lang of ['en', 'zh', 'cn']) for (const r of routes) {
        await L.open(K.page, r, lang); await L.sleep(2200);
        if (r === 'help/index') { await K.page.evaluate(() => document.querySelectorAll('[class*=hp-]').forEach((x) => x.click && 0)); }
        const t = await txt(K.page); const m = t.match(/[^\n]*(league|hkpl|聯賽|联赛|香港匹克球聯賽)[^\n]*/gi);
        if (m) hits[lang + ' ' + r] = m.slice(0, 4);
      }
      const shot = await L.shot(K.page, MODE + '-wording-last'); await K.ctx.close();
      row('6 G15.15 wording (league / HKPL)', 'wording.g15-15', Object.keys(hits).length === 0, 'L6', { routes, langs: ['en', 'zh', 'cn'], hits, shot });
    });
  } catch (e) { R.detail.fatal = String(e && e.stack || e).slice(0, 1200); log('FATAL', R.detail.fatal); }
  finally {
    // ---------------------------------------------------------------- cleanup: everything this run made
    for (const id of FIX.schedules) { try { const r = await se('coaches/schedules/delete', { scheduleId: id, id }, A.token); R.cleanup.push({ schedule: id, s: r.status }); } catch (e) { R.cleanup.push({ schedule: id, e: e.message }); } }
    for (const id of FIX.meets) { try { const r = await se('meets/cancel', { meetId: id }, A.token); const d = await se('meets/delete', { meetId: id }, A.token); R.cleanup.push({ meet: id, cancel: r.status, del: d.status }); } catch (e) { R.cleanup.push({ meet: id, e: e.message }); } }
    for (const id of FIX.clubs) { try { const r = await se('channels/update', { channelId: id, isArchived: true }, A.token); R.cleanup.push({ club: id, archived: r.status }); } catch (e) { R.cleanup.push({ club: id, e: e.message }); } }
    for (const a of FIX.accts) { if (a === D) continue; try { const r = await se('i/delete-account', { password: a.password }, a.token); R.cleanup.push({ acct: a.tag, deleted: r.status }); } catch (e) { R.cleanup.push({ acct: a.tag, e: e.message }); } }
    try { R.cleanup.push({ pendingRemoved: sql(`with d as (delete from user_pending where email like ${lit('mopup-' + RUN + '%')} returning 1) select count(*) from d`) }); } catch (e) { R.cleanup.push({ pending: e.message }); }
    R.cleanupFailed = R.cleanup.filter((c) => c.e || (c.deleted && c.deleted >= 300) || (c.archived && c.archived >= 300)).length;
    try { await BRW.close(); } catch (e) { /* closed */ }
    R.summary = { closed: Object.values(R.rows).filter((r) => r.status === 'closed').length, open: Object.values(R.rows).filter((r) => r.status !== 'closed').map((r) => r.id) };
    fs.writeFileSync(OUT, JSON.stringify(R, null, 1));
    log('SUMMARY', R.summary); log('CLEANUP-FAILED', R.cleanupFailed);
  }
})();

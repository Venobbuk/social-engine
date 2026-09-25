require('/root/social-engine/probes/_guard.cjs');   // G13.3
// fix-S4 L6 PROBE (lane fix-S4, 2026-09-25) — closes the S4 discover/venues re-check rows (recheck.json) on UAT
// (uat.gripbat.com, 390 px, EN + 繁) with real clicks, every state change read back from the engine.
// MODE=before runs against the build WITHOUT the change (the planted fault: the must-fail rows must fail);
// MODE=after is the proof. ONLY=K1,K2 runs a subset. Output probes/fix-S4.<mode>.json; verdict by fix-S4-verdict.cjs.
// Personas (native): mei = club owner / comp host, amy = player, tom + ken = entrants, admin = cleanup of accounts.
// Every fixture is "[probe] fix-S4 …", made here and removed in `finally`.
// @claims route pages/meets/index|pages/meet-create/index|pages/venue-create/index|pages/home/index|pages/onboard/index|pages/venue-edit/index|pages/venue-media/index|pages/community-center/index :: fix-S4
// @claims endpoint clubs/mine|clubs/by-code|competitions/matches/list|competitions/matches/availability|venues/create|venues/pin|geo/reverse :: fix-S4
'use strict';
const fs = require('fs');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const puppeteer = require('/root/hkpl-server/node_modules/puppeteer-core');
const { getNativeToken } = require('/root/social-engine/probes/_native-session.cjs');
const APP = 'https://uat.gripbat.com';
const MODE = process.env.MODE || 'after';
const ONLY = (process.env.ONLY || '').split(',').filter(Boolean);
const RUN = Date.now().toString(36).slice(-5);
const P = '[probe] fix-S4 ';
const DIR = '/root/social-engine/probes';
const SHOTS = DIR + '/fix-S4-shots/' + MODE;
fs.mkdirSync(SHOTS, { recursive: true });
const OUT = DIR + '/fix-S4.' + MODE + '.json';
const KPSC = 'ar7iv198jhqz0008';   // Kowloon Park Sports Centre (verified)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = { id: 'fix-S4', mode: MODE, at: new Date().toISOString(), run: RUN, build: {}, rows: {}, checks: [], plants: [], fx: {}, errors: [], cleanup: [] };
const save = () => fs.writeFileSync(OUT, JSON.stringify(R, null, 1));
const log = (m) => console.log(m);
function chk(row, name, pass, ev, vs) {
  const e = typeof ev === 'string' ? ev : JSON.stringify(ev);
  R.checks.push({ row, name, pass: !!pass, ev: String(e).slice(0, 1500) });
  const r = R.rows[row] || (R.rows[row] = { id: row, checks: 0, passed: 0, status: 'still-open', evidence: [], vsReclub: null });
  r.checks++; if (pass) r.passed++; r.evidence.push((pass ? 'ok ' : 'NO ') + name + ' :: ' + String(e).slice(0, 500));
  r.status = r.passed === r.checks ? 'closed' : 'still-open';
  if (vs) r.vsReclub = vs;
  log((pass ? 'ok   ' : 'NO   ') + row + ' ' + name + ' :: ' + String(e).slice(0, 300)); save();
}
const sql = (q) => execFileSync('docker', ['exec', '-i', 'social-engine-db-1', 'psql', '-U', 'social', '-d', 'se_sbx', '-qtA'], { input: q }).toString().trim();
const lit = (s) => "'" + String(s).replace(/'/g, "''") + "'";
async function api(ep, body, who) {
  for (let i = 0; i < 5; i++) {
    const r = await fetch(APP + '/api/' + ep, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(who ? { ...body, i: who.token } : body) });
    let j = null; const t = await r.text(); try { j = JSON.parse(t); } catch (e) { /* 204 */ }
    if (r.status !== 429) return { s: r.status, j, t };
    const reset = j && j.error && j.error.info && j.error.info.reset; const w = Math.min(90000, Math.max(3000, reset ? reset * 1000 - Date.now() + 1500 : 20000));
    log('[429] ' + ep + ' wait ' + Math.round(w / 1000) + 's'); await sleep(w);
  }
  return { s: 429, j: null, t: '' };
}
async function must(ep, body, who) { const r = await api(ep, body, who); if (r.s >= 300) throw new Error(ep + ' ' + r.s + ' ' + (r.t || '').slice(0, 300)); return r.j; }
async function step(name, fn) {
  if (ONLY.length && !ONLY.includes(name)) return;
  const t0 = Date.now();
  try { await fn(); } catch (e) { R.errors.push(name + ': ' + String(e && e.stack || e).slice(0, 600)); log('ERR ' + name + ' ' + (e && e.message)); save(); }
  log('STEP ' + name + ' ' + Math.round((Date.now() - t0) / 1000) + 's');
}

// ------------------------------------------------------------------ browser (the S4 re-check's harness, followup4.cjs)
let browser;
async function newPage(who, tag, o = {}) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  const init = { token: who ? who.token : null, loc: o.loc === undefined ? { kind: 'everywhere', label: 'Everywhere' } : o.loc, onboarded: o.onboarded !== false, filter: o.filter || null };
  await page.evaluateOnNewDocument((init) => {
    if (location.hostname !== 'uat.gripbat.com') return;
    try {
      if (!sessionStorage.getItem('__fs4_init')) {
        sessionStorage.setItem('__fs4_init', '1');
        if (init.token) localStorage.setItem('boyau_social_token', JSON.stringify({ data: init.token }));
        if (init.loc) localStorage.setItem('boyau_discover_loc', JSON.stringify({ data: JSON.stringify(init.loc) }));
        localStorage.setItem('boyau_discover_filter', JSON.stringify({ data: JSON.stringify(init.filter || { level: '', gender: '', fee: '', club: '', hideFull: false, times: [], friendsOnly: false, hideEmpty: false, verifiedOnly: false, clubsOnly: false }) }));
        localStorage.setItem('gb_loc_prompted', JSON.stringify({ data: '1' }));
        localStorage.setItem('gb_loc_asked', JSON.stringify({ data: '1' }));
        localStorage.setItem('boyau_push_dismissed', JSON.stringify({ data: '1' }));
        localStorage.setItem('hkpl_lang_ok', JSON.stringify({ data: '1' }));
        if (init.onboarded) localStorage.setItem('boyau_onboarded', '1');
      }
    } catch (e) { /* */ }
  }, init);
  const net = [];
  page.on('response', async (res) => {
    const u = res.url(); if (!/\/api\//.test(u) || /\.js(\?|$)/.test(u)) return;
    const q = res.request(); let body = null; try { body = JSON.parse(q.postData() || 'null'); } catch (e) { body = (q.postData() || '').slice(0, 120); }
    if (body && body.i) body.i = '<tok>';
    let json = null; try { json = await res.json(); } catch (e) { /* */ }
    net.push({ t: Date.now(), ep: u.replace(/^https:\/\/[^/]+\/api\//, ''), status: res.status(), body, json });
  });
  page.on('pageerror', (e) => R.errors.push(tag + ' pageerror ' + String(e.message).slice(0, 160)));
  const H = {
    page, ctx, net,
    async go(p, lang = 'en') {
      const url = APP + '/app/pages/' + p + (p.includes('?') ? '&' : '?') + 'lang=' + lang;
      try { await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 }); } catch (e) { R.errors.push(tag + ' goto ' + p + ' ' + e.message.slice(0, 80)); }
      await sleep(2200); await page.waitForNetworkIdle({ idleTime: 600, timeout: 8000 }).catch(() => undefined);
      if (/We value your privacy/.test(await H.text())) { await H.click('Accept all') || await H.click('I agree') || await H.click('Accept'); await sleep(1000); }
    },
    async text() { return page.evaluate(() => (document.body ? document.body.innerText : '')).catch(() => ''); },
    async shot(name) { const f = SHOTS + '/' + tag + '-' + name + '.png'; await page.screenshot({ path: f }).catch(() => undefined); return f.replace(DIR + '/', 'probes/'); },
    async find(label, opts = {}) {
      const h = await page.evaluateHandle((label, within, loose) => {
        const root = within ? document.querySelector(within) : document.body; if (!root) return null;
        const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
        const L = label.toLowerCase(); let best = null;
        for (const el of root.querySelectorAll('*')) { const t = (el.innerText || '').trim().toLowerCase(); if (!t) continue; if ((loose ? t.includes(L) : t === L) && vis(el)) best = el; }
        return best;
      }, label, opts.within || null, !!opts.loose);
      return h.asElement();
    },
    async click(label, opts = {}) { const el = await H.find(label, opts); if (!el) return false; await el.evaluate((x) => x.scrollIntoView({ block: 'center' })).catch(() => undefined); await sleep(250); try { await el.click(); } catch (e) { return false; } await sleep(opts.wait || 1000); return true; },
    async req(re, fn, ms = 10000) { const n0 = net.length; await fn(); const t0 = Date.now(); while (Date.now() - t0 < ms) { const hit = net.slice(n0).find((x) => re.test(x.ep)); if (hit) { await sleep(300); return hit; } await sleep(200); } return null; },
    async waitText(re, ms = 8000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { const t = await H.text(); if (re.test(t)) return true; await sleep(250); } return false; },
  };
  return H;
}
const rectOf = (H, sel, label) => H.page.evaluate((sel, label) => {
  const els = [...document.querySelectorAll(sel)].filter((e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.display !== 'none' && (!label || (e.innerText || '').includes(label)); });
  const e = els[0]; if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height };
}, sel, label || null).catch(() => null);
/* 5B/5C: elementFromPoint at the control's centre returns the control (or inside it) at rest AND with its scroll container
 * at its end (N/A when the control is off screen at the end); target >= 24x24 CSS px. */
async function hit(el) {
  if (!el) return { ok: false, why: 'no element' };
  const r = await el.evaluate((e) => {
    const inside = (x) => !!x && (x === e || e.contains(x));
    const test = () => { const q = e.getBoundingClientRect(); if (!q.width || !q.height) return 'hidden'; const cx = q.x + q.width / 2, cy = q.y + q.height / 2; if (cy < 0 || cy > innerHeight || cx < 0 || cx > innerWidth) return 'offscreen'; const t = document.elementFromPoint(cx, cy); return inside(t) ? true : ((t && (t.className || t.tagName)) + '').slice(0, 60); };
    e.scrollIntoView({ block: 'center' }); const q0 = e.getBoundingClientRect(); const size = { w: Math.round(q0.width), h: Math.round(q0.height) };
    const rest = test();
    let sc = e.parentElement; while (sc && !(sc.scrollHeight > sc.clientHeight + 2 && /(auto|scroll)/.test(getComputedStyle(sc).overflowY))) sc = sc.parentElement;
    const cont = sc || document.scrollingElement; const prev = cont.scrollTop; cont.scrollTop = cont.scrollHeight;
    const end = test(); cont.scrollTop = prev; e.scrollIntoView({ block: 'center' });
    return { size, rest, end };
  }).catch((x) => ({ err: String(x).slice(0, 80) }));
  r.ok = r.rest === true && (r.end === true || r.end === 'offscreen') && r.size && r.size.w >= 24 && r.size.h >= 24;
  return r;
}
const HITS = [];
async function hitChk(row, label, el) { const h = await hit(el); HITS.push({ row, label, ...h }); chk(row, '5B/5C finger hit-test + >=24px: ' + label, h.ok, h); return h; }
const overlap = (a, b) => !!a && !!b && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

// ------------------------------------------------------------------ fixtures
const FX = { clubs: [], meets: [], comps: [], venues: [], accts: [] };
R.fx = FX;
async function mkAcct(i, named) {
  const username = 'fs4' + RUN + 'p' + i, password = 'Fs4-' + crypto.randomBytes(8).toString('hex'), email = 'fs4-' + RUN + '-' + i + '@example.invalid';
  const a = { i, username, password, email, token: '', userId: '' }; FX.accts.push(a);
  const su = await api('signup', { emailAddress: email, password, lang: 'en' });
  const code = su.j && su.j._dev_code;
  if (code) { const done = await api('signup-pending', { code }); a.token = done.j && done.j.i; if (!a.token) throw new Error('signup-pending ' + done.s); await must('gb/account/username', { username }, a); }
  else { const r = await must('admin/accounts/create', { username, password }, await getNativeToken('admin')); a.token = r.token; a.via = 'admin'; }
  const me = named ? await must('i/update', { name: P + 'P' + i + ' ' + RUN }, a) : await must('i', {}, a); a.userId = me.id;
  return a;
}
const dayIso = (days, h) => { const d = new Date(Date.now() + days * 86400e3); d.setMinutes(0, 0, 0); if (h != null) d.setHours(h); return d.toISOString(); };

(async () => {
  const mei = await getNativeToken('clubowner-mei'), amy = await getNativeToken('player-amy'), tom = await getNativeToken('clubadmin-tom'), ken = await getNativeToken('host-ken');
  R.build.engineRev = execFileSync('docker', ['inspect', '-f', '{{index .Config.Labels "org.opencontainers.image.revision"}}', 'social-engine-web-uat-1']).toString().trim();
  R.build.appBundle = ((await (await fetch(APP + '/app/')).text()).match(/app\.[0-9a-f]+\.js/) || [''])[0];
  log('engine ' + R.build.engineRev + ' app ' + R.build.appBundle + ' mode ' + MODE + ' run ' + RUN);
  const TERMS = sql(`select version from gb_terms_acceptance group by 1 order by max("acceptedAt") desc limit 1`);
  browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--lang=en-US'] });
  try {
    // ---- fixtures: mei's OWN seeded club "UAT Paddle Club" (owner, never followed — the re-check's case) gets KPSC as its venue
    // (its venueIds are restored in finally) and a [probe] meet in 3 h. channels/create is rate-limited for mei by other lanes.
    const F = { id: 'ari4he5s3hac000m' }; FX.F = F.id;
    const S0 = await must('clubs/settings/show', { channelId: F.id }, mei); FX.venueIds0 = S0.venueIds || [];
    await must('clubs/settings/update', { channelId: F.id, venueIds: [KPSC] }, mei); FX.venuesSet = true;
    const follows = sql(`select count(*) from channel_following where "followeeId"=${lit(F.id)} and "followerId"=${lit(mei.userId)}`);
    R.fx.meiFollowsF = follows;
    const MF = await must('meets/create', { name: P + 'club meet ' + RUN, startAt: new Date(Date.now() + 3 * 3600e3).toISOString(), durationMinutes: 90, capacity: 8, channelId: F.id, venueId: KPSC, venueName: 'Kowloon Park Sports Centre', sport: 'pickleball' }, mei); FX.meets.push(MF.id);

    // ================= K1 C-meet-filters.04 — Clubs only keeps the meets of a club I OWN (not followed)
    await step('K1', async () => {
      const H = await newPage(mei, 'K1');
      await H.go('meets/index?view=list');
      const before = await H.text();
      await H.page.click('.dv-filter').catch(() => undefined); await sleep(700);
      await hitChk('C-meet-filters.04', 'Clubs only chip', await H.find('Clubs only', { within: '.dv-filters' }));
      await H.click('Clubs only', { within: '.dv-filters' });
      const show = await H.find('Show', { within: '.dv-fbtns', loose: true }); if (show) { await show.click(); await sleep(2200); }
      const after = await H.page.$$eval('.dv-item', (e) => e.map((x) => x.innerText.replace(/\s+/g, ' ').slice(0, 100))).catch(() => []);
      const sh = await H.shot('clubs-only');
      const mine = await must('clubs/mine', { tier: 'member' }, mei);
      chk('C-meet-filters.04', 'mei owns UAT Paddle Club (channel_following rows: ' + follows + '); Discover › Filters › Clubs only keeps "' + P + 'club meet"', /club meet/.test(before) && after.some((x) => x.includes(P + 'club meet ' + RUN)) && mine.some((c) => c.id === F.id && c.role === 'owner'), { after: after.slice(0, 5), shot: sh }, { before: 'worse', after: 'equal', why: 'the clubs I own / run / belong to, like Reclub userClubsOnly' });
      await H.page.reload({ waitUntil: 'networkidle2' }).catch(() => undefined); await sleep(3500);
      const again = await H.page.$$eval('.dv-item', (e) => e.map((x) => x.innerText.replace(/\s+/g, ' ').slice(0, 100))).catch(() => []);
      const badge = await H.page.$('.dv-filter-on');
      chk('C-meet-filters.04', '5D reload-persist: after a reload the filter is still on and the club meet still listed', !!badge && again.some((x) => x.includes(P + 'club meet ' + RUN)), { again: again.slice(0, 3), filterOn: !!badge });
      await H.ctx.close();
    });

    // ================= K2 C-discover.11 — a letters-only club code opens the club
    await step('K2', async () => {
      const code = sql(`select "refCode" from club_setting s join channel c on c.id=s."channelId" where s."refCode" ~ '^[A-Z]{6}$' and not c."isArchived" and s.visibility='public' order by s."refCode" limit 1`);
      const club = await must('clubs/by-code', { code }, amy);
      const H = await newPage(amy, 'K2');
      await H.go('meets/index');
      const inp = await H.page.$('.dv-searchin input, input.dv-searchin');
      if (inp) { await inp.click(); await inp.type(code, { delay: 30 }); }
      const seen = await H.waitText(new RegExp('Open the club with code ' + code), 6000);
      const sh = await H.shot('code-row');
      let url = '';
      if (seen) await hitChk('C-discover.11', 'the club-code row', await H.page.$('.dv-code'));
      if (seen) { await H.click('Open the club with code ' + code, { loose: true }); await sleep(3000); url = H.page.url(); }
      chk('C-discover.11', 'letters-only code ' + code + ' → row "Open the club with code ' + code + ' · ' + (club && club.name) + '" → club page', seen && url.includes('community/index?id=' + club.id), { code, club: club && club.name, url, shot: sh }, { before: 'worse', after: 'better', why: 'every real code opens; the row appears only when the club exists and names it (Reclub shows a row that can fail on tap)' });
      await H.ctx.close();
    });

    // ================= K3 C-select-venue.03 — the club's venues first in the picker
    await step('K3', async () => {
      const H = await newPage(mei, 'K3');
      await H.go('meet-create/index?club=' + F.id);
      const vin = await H.page.$('input[placeholder="Search venues or type a place"]');
      if (vin) { await vin.click(); await sleep(3500); }
      const t = await H.page.$eval('.mc-venues', (e) => e.innerText.replace(/\n+/g, ' | ')).catch(() => '');
      const sh = await H.shot('picker');
      const iClub = t.indexOf('Club venues'), iK = t.indexOf('Kowloon Park Sports Centre'), iRecent = t.indexOf('Your recent venues'), iNear = t.indexOf('Near you');
      chk('C-select-venue.03', 'before typing: "Club venues · Kowloon Park Sports Centre" above recent / nearby', iClub >= 0 && iK > iClub && (iRecent < 0 || iRecent > iK) && (iNear < 0 || iNear > iK), { picker: t.slice(0, 400), shot: sh }, { before: 'worse', after: 'equal', why: 'club venues, recent venues, nearby venues — Reclub loadClubVenues order' });
      const row = await H.find('Kowloon Park Sports Centre', { within: '.mc-venues' });
      const rowTap = row ? (await row.evaluateHandle((e) => e.closest('.mc-venue') || e)).asElement() : null;
      if (iClub >= 0) await hitChk('C-select-venue.03', 'the club venue row', rowTap);
      if (rowTap && iClub >= 0) { await rowTap.click(); await sleep(900); }
      const v = await H.page.$eval('input[placeholder="Search venues or type a place"]', (e) => e.value).catch(() => '');
      if (iClub >= 0) chk('C-select-venue.03', 'a tap on the club venue picks it into the form', v === 'Kowloon Park Sports Centre', { value: v });
      await H.ctx.close();
    });

    // ================= K4 C-select-venue.04 — Add venue returns into the meet form with the new venue selected
    await step('K4', async () => {
      const H = await newPage(amy, 'K4');
      await H.go('meet-create/index');
      const nameIn = await H.page.$('.mc-input input, input.mc-input');
      const draftName = P + 'draft ' + RUN;
      if (nameIn) { await nameIn.click({ clickCount: 3 }); await nameIn.type(draftName, { delay: 5 }); await sleep(500); }
      const vin = await H.page.$('input[placeholder="Search venues or type a place"]');
      if (vin) { await vin.click(); await sleep(2500); }
      const addRow = await H.find('Add venue', { within: '.mc-venues' });
      await hitChk('C-select-venue.04', 'the Add venue row', addRow ? (await addRow.evaluateHandle((e) => e.closest('.mc-venue') || e)).asElement() : null);
      await H.click('Add venue', { within: '.mc-venues' }); await sleep(2500);
      const addUrl = H.page.url();
      const li = await H.page.$('.pls-in input, .pls input');
      if (li) { await li.click(); await li.type('https://www.google.com/maps/@22.3009,114.1868,18z', { delay: 5 }); await sleep(4000); const h1 = (await H.page.$$('.pls-hits .pg-row'))[0]; if (h1) { await h1.click(); await sleep(900); } await H.click('Confirm', { within: '.pls-confirm' }); await sleep(1000); }
      await H.click('Next step'); await sleep(2500);
      if (/Create new/.test(await H.text())) { await H.click('Create new'); await sleep(800); }
      const nin = await H.page.$('.vc-in input, input.vc-in');
      const vname = P + 'court ' + RUN;
      if (nin) { await nin.click({ clickCount: 3 }); await H.page.keyboard.press('Backspace'); await nin.type(vname, { delay: 5 }); }
      const cr = await H.req(/^venues\/create$/, () => H.click('Create'), 12000);
      await sleep(3500);
      const vid = cr && cr.json && cr.json.id; if (vid) FX.venues.push(vid); FX.venueK4 = vid;
      const url = H.page.url();
      const vals = await H.page.$$eval('.mc-input input, input.mc-input', (e) => e.map((x) => x.value)).catch(() => []);
      const sh = await H.shot('back-in-form');
      chk('C-select-venue.04', 'meet form › Add venue (?back=meet-create) › Create → back on meet-create, the typed name kept, the new venue selected', /back=meet-create/.test(addUrl) && cr && cr.status === 200 && /meet-create\/index/.test(url) && vals.includes(draftName) && vals.includes(vname), { addUrl, create: cr && cr.status, url, vals: vals.slice(0, 4), shot: sh }, { before: 'worse', after: 'equal', why: 'Add venue → back to the form, selected, nothing typed is lost (Reclub)' });
      await H.ctx.close();
    });

    // ================= K5 C-discover.18 — comp cards: "Registration opens in n days" and "n upcoming matches"
    const day = 86400e3;
    await step('K5', async () => {
      const CR = await must('competitions/create', { name: P + 'R ' + RUN, sport: 'pickleball', format: 'roundRobin', participantType: 'singles', maxEntries: 8, visibility: 'public', autoApprove: true, startAt: new Date(Date.now() + 10 * day).toISOString(), registrationOpenAt: new Date(Date.now() + 3 * day - 3600e3).toISOString(), registrationCloseAt: new Date(Date.now() + 8 * day).toISOString() }, mei); FX.comps.push(CR.id);
      await must('competitions/status', { competitionId: CR.id, action: 'publish' }, mei);
      const CD = await must('competitions/create', { name: P + 'D ' + RUN, sport: 'pickleball', format: 'roundRobin', participantType: 'singles', maxEntries: 8, visibility: 'public', autoApprove: true, startAt: new Date(Date.now() + 2 * day).toISOString(), registrationOpenAt: new Date(Date.now() - day).toISOString(), registrationCloseAt: new Date(Date.now() + day).toISOString() }, mei); FX.comps.push(CD.id); FX.CD = CD.id;
      await must('competitions/status', { competitionId: CD.id, action: 'publish' }, mei);
      for (const w of [amy, tom, ken]) await must('competitions/enter', { competitionId: CD.id }, w);
      await must('competitions/status', { competitionId: CD.id, action: 'start' }, mei);
      const ms = await must('competitions/matches/list', { competitionId: CD.id }, mei);
      FX.upcoming = ms.filter((m) => (m.status === 'pending' || m.status === 'inProgress') && m.entry1Id && m.entry2Id).length;
      const H = await newPage(amy, 'K5');
      await H.go('meets/index?pane=comps');
      await H.waitText(/upcoming match/, 6000);
      const cards = await H.page.$$eval('.dv-item', (e) => e.map((x) => x.innerText.replace(/\s+/g, ' ').slice(0, 220))).catch(() => []);
      const cR = cards.find((x) => x.includes(P + 'R ' + RUN)) || '', cD = cards.find((x) => x.includes(P + 'D ' + RUN)) || '';
      const shR = await H.shot('comps-en');
      const bigPill = await H.page.$$eval('.dv-item .dv-chip', (e) => e.map((x) => x.innerText.trim()).filter((t) => t.length > 10)).catch(() => []);
      const cardD = await H.page.evaluateHandle((n) => [...document.querySelectorAll('.dv-item')].find((x) => x.innerText.includes(n)) || null, P + 'D ' + RUN).then((h) => h.asElement()).catch(() => null);
      await hitChk('C-discover.18', 'the competition card', cardD);
      await H.go('meets/index?pane=comps', 'zh_Hant'); await H.waitText(/未開始的比賽/, 6000);
      const zt = await H.text(); const shZ = await H.shot('comps-zh');
      chk('C-discover.18', 'R card: "Registration opens in 3 days" (a [probe] comp in that state); D card: "' + FX.upcoming + ' upcoming matches" from the draw, the state in words (no bare "Open" pill); 繁 "' + FX.upcoming + ' 場未開始的比賽"', /Registration opens in 3 days/.test(cR) && new RegExp(FX.upcoming + ' upcoming matches').test(cD) && FX.upcoming > 0 && !bigPill.length && new RegExp(FX.upcoming + ' 場未開始的比賽').test(zt), { cR, cD, bigPill, shR, shZ }, { before: 'worse', after: 'equal', why: 'Reclub card anatomy: registration state in words + n upcoming matches; the status no longer squeezes the title (layout pass is fix-S6)' });
      await H.ctx.close();
    });

    // ================= K6 C-home.11 — Home comp card lists my matches with Can go / Maybe / Can't go
    await step('K6', async () => {
      if (!FX.CD) throw new Error('no comp D');
      const H = await newPage(amy, 'K6');
      await H.go('home/index');
      await H.waitText(new RegExp(P.replace(/[[\]]/g, '\\$&') + 'D ' + RUN), 8000);
      const has = await H.page.$$eval('.ma-cmrow', (e) => e.map((x) => x.innerText.replace(/\s+/g, ' '))).catch(() => []);
      await H.page.evaluate(() => { const e = document.querySelector('.ma-cm'); if (e) e.scrollIntoView({ block: 'center' }); }).catch(() => undefined); await sleep(600);
      const sh = await H.shot('home-comp-matches');
      let r = null;
      const btn = await H.page.evaluateHandle(() => { const row = document.querySelector('.ma-cmrow'); if (!row) return null; return [...row.querySelectorAll('.pg-chip')].find((x) => x.innerText.trim() === 'Maybe') || null; }).then((h) => h.asElement()).catch(() => null);
      if (btn) await hitChk('C-home.11', 'the Maybe chip under the Home comp card', btn);
      if (btn) r = await H.req(/^competitions\/matches\/availability$/, () => btn.click(), 8000);
      await sleep(1200);
      const mine = (await must('competitions/matches/list', { competitionId: FX.CD }, amy)).filter((m) => m.myAvailability === 'maybe');
      const on = await H.page.$$eval('.ma-cmrow .pg-tab-on', (e) => e.map((x) => x.innerText.trim())).catch(() => []);
      const sh2 = await H.shot('home-maybe');
      // 5D: reload-persist, and the other party (the host) sees it — in the engine and on the match page
      await H.page.reload({ waitUntil: 'networkidle2' }).catch(() => undefined); await sleep(4000);
      const on2 = await H.page.$$eval('.ma-cmrow .pg-tab-on', (e) => e.map((x) => x.innerText.trim())).catch(() => []);
      const hostView = mine[0] ? (await must('competitions/matches/list', { competitionId: FX.CD }, mei)).find((m) => m.id === mine[0].id) : null;
      const hostSees = !!hostView && hostView.availability && hostView.availability[amy.userId] === 'maybe';
      let hostPage = '';
      if (mine[0]) { const M2 = await newPage(mei, 'K6host'); await M2.go('tournament-match/index?id=' + FX.CD + '&m=' + mine[0].id); hostPage = await M2.text(); await M2.shot('host-match-page'); await M2.ctx.close(); }
      chk('C-home.11', '5D reload-persist (Maybe still chosen after a reload) + the other party: host mei reads amy = maybe (engine) and her match page shows "Maybe"', on2.includes('Maybe') && hostSees && /Maybe/.test(hostPage), { on2, hostSees, hostPageHasMaybe: /Maybe/.test(hostPage) });
      await H.go('home/index', 'zh_Hant'); await sleep(1500);
      const zt = await H.page.$$eval('.ma-cmrow', (e) => e.map((x) => x.innerText.replace(/\s+/g, ' '))).catch(() => []);
      chk('C-home.11', 'amy Home › Competitions: the comp card lists her matches (vs opponent) with Can go / Maybe / Can\'t go; Maybe → competitions/matches/availability 200 → the engine reads maybe; 繁 去得到 / 待定 / 去唔到', has.length >= 1 && /vs /.test(has[0]) && /Can go/.test(has[0]) && /Maybe/.test(has[0]) && /Can't go/.test(has[0]) && r && r.status === 200 && mine.length === 1 && on.includes('Maybe') && zt.some((x) => /去得到/.test(x) && /待定/.test(x) && /去唔到/.test(x)), { rows: has.slice(0, 2), req: r && r.status, engineMaybe: mine.length, on, zt: zt.slice(0, 1), sh, sh2 }, { before: 'worse', after: 'better', why: 'Reclub\'s matches RSVP under the card, plus the opponent named and a tap-again clear' });
      await H.ctx.close();
    });

    // ================= K7 C-home.13 — By friends empty state with a network: "See recent activities"
    await step('K7', async () => {
      const A = await mkAcct(1, true), B = await mkAcct(2, true);
      for (const a of [A, B]) await api('meets/level', { sport: 'pickleball', acceptTerms: TERMS, onboarded: true }, a);
      const M = await must('meets/create', { name: P + 'network meet ' + RUN, startAt: dayIso(2, 11), durationMinutes: 60, capacity: 4, venueId: KPSC, venueName: 'Kowloon Park Sports Centre', sport: 'pickleball', visibility: 'private' }, A); FX.meets.push(M.id); FX.meetOwner = FX.meetOwner || {}; FX.meetOwner[M.id] = A;
      await must('meets/participants/add', { meetId: M.id, userId: B.userId, status: 'confirmed' }, A);
      const H = await newPage(A, 'K7');
      await H.go('home/index');
      await H.click('By friends'); await sleep(2500);
      const t = await H.text(); const sh = await H.shot('by-friends');
      const ok1 = /No upcoming meets from people you have played with\./.test(t) && /See recent activities/.test(t) && !/Add friends to see their activities/.test(t);
      if (ok1) { const b = await H.find('See recent activities'); await hitChk('C-home.13', 'See recent activities', b ? (await b.evaluateHandle((e) => e.closest('.hk-btn, [data-ctl=button], .is-tap') || e)).asElement() : null); }
      let url = ''; if (ok1) { await H.click('See recent activities'); await sleep(3000); url = H.page.url(); }
      const sh2 = await H.shot('recent');
      chk('C-home.13', '[probe] persona with a network (1 player) and no upcoming friend meets: By friends → "No upcoming meets from people you have played with." + See recent activities → network › Recent', ok1 && /network\/index\?pane=recent/.test(url), { url, sh, sh2 }, { before: 'equal', after: 'equal', why: 'Reclub: "Add friends to see their activities" + See recent activities — same next step' });
      await H.ctx.close();
    });

    // ================= K8 C-home.08 — the search button never covers the Home tiles
    await step('K8', async () => {
      const H = await newPage(amy, 'K8');
      await H.go('home/index'); await sleep(1500);
      await H.page.evaluate(() => { const s = document.querySelector('.sh-app-body') || document.scrollingElement; if (s) s.scrollTop = 0; window.scrollTo(0, 0); }); await sleep(800);
      const tile = await rectOf(H, '.bt-tile', 'My activities'); const fab = await rectOf(H, '.ma-fab');
      const sh = await H.shot('top');
      // floating buttons belong to lane SHELL-FAMILY (coordinator 2026-09-25): measured and handed over, not judged here
      R.fx.fabHandoff = { tile, fab, overlaps: overlap(tile, fab), sh };
      // the pinned crest root cause: Home stays mounted; a venue pinned while Home is below the stack shows on return
      if (FX.venueK4) {
        await H.go('home/index'); await H.waitText(/Hi, /, 8000);
        const tileEl = await H.page.evaluateHandle(() => [...document.querySelectorAll('.bt-tile')].find((x) => /My network/.test(x.innerText)) || null).then((h) => h.asElement()).catch(() => null);
        if (tileEl) { await tileEl.evaluate((e) => e.scrollIntoView({ block: 'center' })); await sleep(300); const bb = await tileEl.boundingBox(); if (bb) await H.page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2); }
        await sleep(3000);
        const away = H.page.url();
        await must('venues/pin', { venueId: FX.venueK4, pinned: true }, amy); FX.pinned = true;
        await H.page.goBack().catch(() => undefined); await sleep(3500);
        const crest = await H.page.$$eval('.bt-crest', (e) => e.map((x) => x.innerText.trim())).catch(() => []);
        const sh3 = await H.shot('crest-on-return');
        const cEl = await H.page.evaluateHandle((n) => [...document.querySelectorAll('.bt-crest')].find((x) => x.innerText.includes(n)) || null, P + 'court ' + RUN).then((h) => h.asElement()).catch(() => null);
        if (cEl) await hitChk('C-home.08', 'the pinned venue crest', cEl);
        const st = sql(`select status from venue where id=${lit(FX.venueK4)}`);
        chk('C-home.08', 'pinned crest: an Under-review venue (' + st + ') pinned while Home sits below the stack shows as "📍 ' + P + 'court" when Home returns (root cause: the bar was read once at mount)', away.includes('network/index') && crest.some((x) => x.includes('📍') && x.includes(P + 'court ' + RUN)), { away, crest: crest.slice(0, 6), status: st, sh3 });
      }
      await H.ctx.close();
    });

    // ================= K9 one header: venue-edit / venue-media / community-center
    await step('K9', async () => {
      const H = await newPage(amy, 'K9');
      const res = {};
      for (const [row, route] of [['C-venue.13', 'venue-edit/index?id=' + (FX.venueK4 || KPSC)], ['C-venue.13', 'venue-media/index?id=' + (FX.venueK4 || KPSC)], ['C-community-detail.01', 'community-center/index']]) {
        await H.go(route);
        const backs = await H.page.$$eval('.ah-lead', (e) => e.filter((x) => { const r = x.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).length).catch(() => -1);
        const heads = await H.page.$$eval('.ah', (e) => e.filter((x) => { const r = x.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).length).catch(() => -1);
        const sh = await H.shot(route.split('/')[0]);
        res[route] = { backs, heads, sh };
        chk(row, route.split('/')[0] + ': exactly one header with one Back button at 390 px', backs === 1, { backs, heads, sh }, { before: 'worse', after: 'equal', why: 'one header, one Back — Reclub anatomy' });
        if (backs === 1) await hitChk(row, route.split('/')[0] + ' Back button', await H.page.$('.ah-lead'));
      }
      await H.ctx.close();
    });

    // ================= K10 C-discover.23 — 繁 "n 個活動" for one and many (no 活動紀錄)
    await step('K10', async () => {
      const H = await newPage(amy, 'K10');
      await H.go('meets/index?pane=venues&view=list', 'zh_Hant'); await sleep(2000);
      const rows = await H.page.$$eval('.pg-row-sub', (e) => e.map((x) => x.innerText)).catch(() => []);
      const sh = await H.shot('venues-zh');
      const one = rows.filter((x) => /(^|· )1 個活動/.test(x)).length, many = rows.filter((x) => /(^|· )([2-9]|\d{2,}) 個活動/.test(x)).length, old = rows.filter((x) => /活動紀錄/.test(x)).length;
      chk('C-discover.23', '繁 Discover › Venues: "1 個活動" and "n 個活動" — one word, no "活動紀錄"', old === 0 && (one + many) > 0, { one, many, old, sample: rows.filter((x) => /活動/.test(x)).slice(0, 3), sh }, { before: 'worse', after: 'equal', why: 'consistent Chinese wording' });
      await H.ctx.close();
    });

    // ================= K11 C-map-picker.02 — the pin address never repeats the street
    await step('K11', async () => {
      const g = await must('geo/reverse', { lat: 22.268764, lng: 114.169235, language: 'en' });
      const line = [g && g.label, g && g.address].filter(Boolean).join(', ');
      const streets = (line.match(/Magazine Gap Road/g) || []).length;
      chk('C-map-picker.02', 'geo/reverse (the map picker\'s door) at the re-check point: one street number, "' + line + '"', streets === 1 && !/27 Magazine Gap Road/.test(line), { line }, { before: 'worse', after: 'equal', why: 'a clean address under the pin' });
    });

    // ================= K12 E-onb-location.02 quality — onboarding name error only after a touch
    await step('K12', async () => {
      const C = await mkAcct(3, false);
      await api('meets/level', { sport: 'pickleball', acceptTerms: TERMS }, C);
      const H = await newPage(C, 'K12', { onboarded: false });
      await H.go('onboard/index'); await sleep(1500);
      const t0 = await H.text(); const sh = await H.shot('step0');
      const field = await H.page.$('input[name="obname"], [name="obname"] input, .ob-card input');
      const hasField = !!field;
      if (field) await hitChk('E-onb-location.02', 'the name field (kit TextField box)', (await field.evaluateHandle((e) => { let p = e; for (let k = 0; k < 4 && p && p.getBoundingClientRect().height < 24; k++) p = p.parentElement; return p || e; })).asElement());
      // typing then clearing: the error shows only once the person touched the field
      if (field) { await field.click(); await field.type('Ab', { delay: 30 }); await sleep(400); await H.page.keyboard.press('Backspace'); await H.page.keyboard.press('Backspace'); await sleep(600); }
      const tClear = await H.text();
      const nx = await H.click('Next') || await H.click('Continue'); await sleep(900);
      const t1 = await H.text(); const sh2 = await H.shot('after-next');
      chk('E-onb-location.02', 'typed then cleared: "Please enter your name" appears (a touched, empty field)', /Please enter your name/.test(tClear), {});
      chk('E-onb-location.02', 'first onboarding step: no "Please enter your name" before anything is typed; it appears once Next is pressed with the name empty (the check sees it)', hasField && !/Please enter your name/.test(t0) && nx && /Please enter your name/.test(t1), { hasField, nx, sh, sh2 }, { before: 'better', after: 'better', why: 'area chips + current location + search + map pin; no premature error' });
      await H.ctx.close();
    });

    // ================= K13 C-filter-dates.01 — one range calendar
    await step('K13', async () => {
      const H = await newPage(amy, 'K13');
      await H.go('meets/index?view=list');
      let taps = 0;
      await H.page.click('.dv-filter').catch(() => undefined); taps++; await sleep(700);
      const chipEl = await H.find('Pick dates', { within: '.dv-filters' });
      if (chipEl) await hitChk('C-filter-dates.01', 'the Dates chip', (await chipEl.evaluateHandle((e) => e.closest('.pg-chip') || e)).asElement());
      const chip = await H.click('Pick dates', { within: '.dv-filters' }); if (chip) taps++;
      await sleep(900);
      const days = await H.page.$$('.rc-d.is-tap');
      if (days.length > 3) await hitChk('C-filter-dates.01', 'a day of the range calendar', days[1]);
      if (days.length > 3) { await days[1].click(); taps++; await sleep(300); await days[3].click(); taps++; await sleep(300); }
      const sum = await H.page.$eval('.rc-sum', (e) => e.innerText).catch(() => '');
      const sh = await H.shot('calendar');
      const conf = await H.find('Confirm', { within: '.rc' });
      if (conf) await hitChk('C-filter-dates.01', 'Confirm in the range calendar', (await conf.evaluateHandle((e) => e.closest('.hk-btn, [data-ctl=button], .is-tap') || e)).asElement());
      let lr = null;
      if (chip) { lr = await H.req(/^meets\/list$/, () => H.click('Confirm', { within: '.rc' }), 9000); taps++; await sleep(900); }
      const show = await H.find('Show', { within: '.dv-fbtns', loose: true });
      if (show) { const lr2 = await H.req(/^meets\/list$/, () => show.click(), 5000); taps++; if (!lr) lr = lr2; }
      await sleep(1500);
      const sh2 = await H.shot('range-list');
      const b = lr && lr.body; const spanDays = b && b.from && b.to ? Math.round((new Date(b.to) - new Date(b.from)) / 86400e3) : null;
      const chipTxt = await H.page.$eval('.dv-rangechip', (e) => e.innerText.replace(/\s+/g, ' ')).catch(() => '');
      chk('C-filter-dates.01', 'Filters › Dates is ONE range calendar: first day, last day, Confirm (' + taps + ' taps incl. opening Filters and Show) → meets/list {from,to} 3 days → strip chip', chip && / – /.test(sum) && lr && lr.status === 200 && spanDays === 3 && / – /.test(chipTxt), { taps, sum, span: spanDays, chip: chipTxt, sh, sh2 }, { before: 'worse', after: 'equal', why: 'one range calendar + Confirm, as Reclub (was two wheel pickers)' });
      await H.ctx.close();
    });

    // ================= K14 G2 — share cards on the GripBat origin
    await step('K14', async () => {
      const u = APP + '/app/pages/meet/index?id=' + MF.id;
      const t = await (await fetch(u, { headers: { 'user-agent': 'WhatsApp/2.23.20.0' } })).text();
      const img = (t.match(/og:image" content="([^"]+)/) || [])[1] || '', url = (t.match(/og:url" content="([^"]+)/) || [])[1] || '';
      const ir = img ? await fetch(img) : null;
      chk('G2', 'meet share card (crawler UA): og:image + og:url on uat.gripbat.com, image 200, no "silkvo" anywhere in the card', img.startsWith(APP + '/') && url.startsWith(APP + '/app/pages/meet/index?id=' + MF.id) && ir && ir.status === 200 && !/silkvo/.test(t), { img, url, imgStatus: ir && ir.status, silkvo: (t.match(/silkvo/g) || []).length });
    });

    // ================= K15 meet form venue hint says the venue's REAL state (Under review vs Verified)
    await step('K15', async () => {
      const vname = P + 'hint court ' + RUN;
      const cv = await must('venues/create', { name: vname, address: P + '1 Probe Road ' + RUN, lat: 22.3011, lng: 114.1712 }, amy); FX.venues.push(cv.id);
      const st = sql(`select status from venue where id=${lit(cv.id)}`);
      const H = await newPage(amy, 'K15');
      await H.go('meet-create/index');
      const pickBy = async (q, name) => {
        const vin = await H.page.$('input[placeholder="Search venues or type a place"], input[placeholder="搜尋場地或輸入地點"]'); if (!vin) return false;
        await vin.click({ clickCount: 3 }); await H.page.keyboard.press('Backspace'); await vin.type(q, { delay: 20 }); await sleep(2500);
        const row = await H.page.evaluateHandle((n) => [...document.querySelectorAll('.mc-venue')].find((x) => (x.innerText || '').includes(n)) || null, name).then((h) => h.asElement()).catch(() => null);
        if (!row) return false; await hitChk('C-select-venue.04', 'venue search row "' + name.slice(0, 30) + '"', row); await row.click(); await sleep(1500); return true;
      };
      const hintNow = () => H.page.evaluate(() => { const i = document.querySelector('input[placeholder="Search venues or type a place"], input[placeholder="搜尋場地或輸入地點"]'); let r = i; for (let k = 0; k < 6 && r && !/Venue|場地/.test(r.innerText || ''); k++) r = r.parentElement; return r ? (r.innerText || '').replace(/\s+/g, ' ').slice(0, 160) : ''; }).catch(() => '');
      const p1 = await pickBy(RUN, vname); await sleep(1200); const h1 = await hintNow(); const sh1 = await H.shot('under-review');
      const p2 = await pickBy('Kowloon Park', 'Kowloon Park Sports Centre'); await sleep(1500); const h2 = await hintNow(); const sh2 = await H.shot('verified');
      await H.go('meet-create/index', 'zh_Hant'); const p3 = await pickBy(RUN, vname); await sleep(1500); const h3 = await hintNow(); const sh3 = await H.shot('under-review-zh');
      chk('C-select-venue.04', 'meet form hint = the venue\'s real state: a just-added venue (' + st + ') reads "Under review" (never "Verified venue"); Kowloon Park (verified) reads "Verified venue"; 繁 審核中', st === 'under_review' && p1 && /Under review/.test(h1) && !/Verified venue/.test(h1) && p2 && /Verified venue/.test(h2) && p3 && /審核中/.test(h3) && !/已認證場地/.test(h3), { h1, h2, h3, sh1, sh2, sh3 }, { before: 'worse', after: 'equal', why: 'the form never claims a venue is verified when it is under review' });
      await H.ctx.close();
    });

    // ================= plants (G16.1): the checks must be able to fail
    await step('PLANT', async () => {
      const H = await newPage(mei, 'PLANT');
      await H.go('meets/index');
      const inp = await H.page.$('.dv-searchin input, input.dv-searchin');
      if (inp) { await inp.click(); await inp.type('ZZZZZZ', { delay: 30 }); }
      const seen = await H.waitText(/Open the club with code ZZZZZZ/, 4000);
      R.plants.push({ name: 'a code no club has (ZZZZZZ) shows NO club row (the K2 check can read absence)', fired: !seen });
      R.plants.push({ name: 'overlap() reports a real overlap', fired: overlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 }) && !overlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: 0, w: 5, h: 5 }) });
      R.plants.push({ name: 'a planted label is NOT found', fired: !(await H.find('fix-S4 planted label ' + RUN)) });
      await H.ctx.close();
    });
  } finally {
    try { if (browser) await browser.close(); } catch (e) { /* */ }
    if (FX.pinned && FX.venueK4) { const r = await api('venues/pin', { venueId: FX.venueK4, pinned: false }, amy); R.cleanup.push({ unpin: r.s }); }
    for (const id of FX.comps) { let r = await api('competitions/delete', { competitionId: id }, mei); if (r.s === 400) { await api('competitions/cancel', { competitionId: id }, mei); r = await api('competitions/delete', { competitionId: id }, mei); } R.cleanup.push({ comp: id, s: r.s }); }
    for (const id of FX.meets) { const owner = (FX.meetOwner && FX.meetOwner[id]) || mei; const c = await api('meets/cancel', { meetId: id }, owner); R.cleanup.push({ meet: id, cancel: c.s }); }
    for (const id of FX.meets) { try { R.cleanup.push({ meetRows: id, del: sql(`with d as (delete from meet where id=${lit(id)} returning 1) select count(*) from d`) }); } catch (e) { R.cleanup.push({ meetRows: id, e: e.message }); } }
    for (const id of FX.venues) { const r = await api('venues/delete', { venueId: id }, amy); R.cleanup.push({ venue: id, s: r.s }); }
    try { R.cleanup.push({ venuesByName: sql(`with d as (delete from venue where name like ${lit(P + '%' + RUN + '%')} returning 1) select count(*) from d`) }); } catch (e) { R.cleanup.push({ venuesByName: e.message }); }
    if (FX.venuesSet) { const r = await api('clubs/settings/update', { channelId: FX.F, venueIds: FX.venueIds0 }, mei); R.cleanup.push({ clubVenuesRestored: r.s, to: FX.venueIds0 }); }
    for (const id of FX.clubs) { const r = await api('channels/update', { channelId: id, isArchived: true }, mei); R.cleanup.push({ club: id, archived: r.s }); }
    for (const a of FX.accts) { if (!a.token) continue; const r = await api('i/delete-account', { password: a.password }, a); R.cleanup.push({ acct: a.username, deleted: r.s }); }
    try { R.cleanup.push({ pendingRemoved: sql(`with d as (delete from user_pending where email like ${lit('fs4-' + RUN + '-%')} returning 1) select count(*) from d`) }); } catch (e) { R.cleanup.push({ pending: e.message }); }
    try { R.leftover = sql(`select (select count(*) from channel where name like ${lit('%fix-S4%' + RUN + '%')} and "isArchived"=false)||'/'||(select count(*) from meet where name like ${lit('%fix-S4%' + RUN + '%')} and status <> 'cancelled')||'/'||(select count(*) from venue where name like ${lit('%fix-S4%' + RUN + '%')})||'/'||(select count(*) from competition where name like ${lit('%fix-S4%' + RUN + '%')})`); } catch (e) { R.leftover = 'query failed: ' + e.message; }
    R.cleanupFailed = R.cleanup.filter((c) => c.e || (c.archived && c.archived >= 300) || (c.deleted && c.deleted >= 300) || (c.comp && c.s >= 300)).length;
    R.summary = { closed: Object.values(R.rows).filter((r) => r.status === 'closed').map((r) => r.id), open: Object.values(R.rows).filter((r) => r.status !== 'closed').map((r) => r.id), plants: R.plants, leftover: R.leftover, cleanupFailed: R.cleanupFailed, errors: R.errors.length };
    save(); log('SUMMARY ' + JSON.stringify(R.summary));
  }
})().catch((e) => { R.errors.push('FATAL ' + (e && e.stack || e)); save(); console.error(e); process.exit(1); });

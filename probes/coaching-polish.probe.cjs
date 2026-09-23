require('./_guard.cjs');   // G13.3: probes run through probes/run.sh, which sweeps afterwards
// coaching-polish.probe.cjs — the three coaching needs_operator items, proven on the REAL path (UAT, headless Chrome
// on the box, through the deployed app) with API/DB read-back. PHASE=before|after — the same walk on the build that
// is live, so BEFORE is measured by the instrument that later reads AFTER (and must read the fault first).
//   1. PERSON-NAME-V2  a name-less account (engine name NULL, username hkpl_<hex>) is walked as its COACH across
//      roster (coaching dashboard + meet participants), chat (meet chat), profile (player page), notifications and the
//      lesson page: every visible text node + aria-label/title/alt is searched for /hkpl_[0-9a-f]{6,}/.
//   2. GROUP-PRICE-V1  first booker into an empty GROUP slot (tiers 1:HKD 200 / 2-4:HKD 120): the price locked in
//      meet_participant."agreedPrice" (DB), the confirm sheet text (after), the quote guard (planted wrong quote).
//   3. SIGNED-OUT     an anonymous context opens the lesson slot, the Lessons hub and the coach profile; tapping Book
//      must prompt a sign-in that carries next= back to the slot.
// G13: fixtures are '[probe] CP-<stamp>'; the name-less account is a persona whose name is restored in finally.
'use strict';
const fs = require('fs');
const { execFileSync } = require('child_process');
const puppeteer = require('/root/hkpl-server/node_modules/puppeteer-core');
const L = require('/root/social-engine/probes/sec-lib.cjs');

const PHASE = process.env.PHASE || 'before';
const R = L.makeReport('coaching-polish-' + PHASE);
const TAG = '[probe] CP-' + L.stamp;
const SHOTS = '/root/walk/coaching-polish/' + PHASE;
const APP = L.BASE + '/app';
const HANDLE = /hkpl_[0-9a-f]{6,}/gi;
fs.mkdirSync(SHOTS, { recursive: true });

function sql(text) { return execFileSync('docker', ['exec', '-i', 'social-engine-db-1', 'psql', '-U', 'social', '-d', 'se_sbx', '-tAq', '-v', 'ON_ERROR_STOP=1', '-f', '-'], { input: text, encoding: 'utf8' }).trim(); }
const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
function hkWeekday(days) { const d = new Date(Date.now() + days * 86400000 + 8 * 3600000); const wd = d.getUTCDay(); return wd === 0 ? 7 : wd; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const OUT = { phase: PHASE, personname: { surfaces: {} }, pricing: {}, signed_out: {}, shots: [] };
const CLEAN = { channels: [], schedules: [], leave: [], messages: [], restoreName: null };
let people;

async function mustSe(ep, body, tok, what) { const r = await L.se(ep, body, tok); if (r.status >= 300) throw new Error((what || ep) + ' -> ' + r.status + ' ' + r.text.slice(0, 200)); return r.json; }

async function browserCtx(browser, persona, lang) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 412, height: 915, deviceScaleFactor: 1 });
  await page.evaluateOnNewDocument((lg) => { try { localStorage.setItem('hkpl_lang', lg); } catch (e) { /* */ } }, lang || 'en');
  if (persona) {
    const host = new URL(L.BASE).hostname;
    const cookies = persona.cookie.split('; ').map((kv) => { const i = kv.indexOf('='); return { name: kv.slice(0, i), value: kv.slice(i + 1), domain: host, path: '/', secure: true }; });
    await page.setCookie(...cookies);
  }
  return { ctx, page };
}
async function open(page, route, lang) {
  const url = APP + route + (route.includes('?') ? '&' : '?') + 'lang=' + (lang || 'en');
  try { await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 }); } catch (e) { R.info('goto slow ' + route, String(e.message).slice(0, 80)); }
  await sleep(2500);
  await page.waitForNetworkIdle({ idleTime: 800, timeout: 8000 }).catch(() => undefined);
  // the terms consent gate (GB-LEGAL) covers the app for a persona who has not accepted today's version: accept it the
  // way a user does, so the screenshot shows the page (the DOM checks read the page underneath either way)
  const gate = await page.evaluate(() => /We value your privacy|我哋重視你嘅私隱|我们重视你的隐私/.test(document.body.innerText)).catch(() => false);
  if (gate) {
    const ok = await clickText(page, /^(I agree|我同意)$/);
    await page.waitForNetworkIdle({ idleTime: 800, timeout: 8000 }).catch(() => undefined);
    await sleep(1200);
    if (!OUT.consentAccepted) OUT.consentAccepted = [];
    OUT.consentAccepted.push({ route, ok });
  }
}
/** every visible text node + the attributes a screen reader / tooltip reads */
async function handlesOnScreen(page) {
  return await page.evaluate((src) => {
    const re = new RegExp(src, 'gi'); const hits = [];
    const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n;
    while ((n = w.nextNode())) { const t = n.nodeValue || ''; const el = n.parentElement; if (!el || !vis(el)) continue; const m = t.match(re); if (m) hits.push({ where: 'text', m: m[0], ctx: t.trim().slice(0, 90) }); }
    for (const el of document.querySelectorAll('[aria-label],[title],[alt]')) for (const a of ['aria-label', 'title', 'alt']) { const v = el.getAttribute(a); if (v && re.test(v)) hits.push({ where: a, ctx: v.slice(0, 90) }); re.lastIndex = 0; }
    if (re.test(document.title)) hits.push({ where: 'document.title', ctx: document.title });
    return { hits, text: (document.body.innerText || '').slice(0, 3000) };
  }, HANDLE.source);
}
async function shot(page, name) { const p = SHOTS + '/' + name + '.png'; await page.screenshot({ path: p }).catch(() => undefined); OUT.shots.push(p); }
async function clickText(page, re, sel) {
  const ok = await page.evaluate((src, s) => {
    const rx = new RegExp(src);
    const els = [...document.querySelectorAll(s || '[role=button],button,.is-tap,taro-button-core,.btn,[class*=Btn],[class*=tab]')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && rx.test((e.innerText || e.textContent || '').trim()); });
    els.sort((a, b) => (a.innerText || '').length - (b.innerText || '').length);
    if (!els[0]) return false; els[0].click(); return true;
  }, re.source, sel || null);
  await sleep(1500);
  return ok;
}

async function main() {
  const mei = await L.signIn('clubowner-mei');   // the coach (club owner)
  const amy = await L.signIn('player-amy');       // first booker into the empty group slot
  const ken = await L.signIn('host-ken');         // the NAME-LESS account
  const tom = await L.signIn('clubadmin-tom');    // the planted wrong quote
  people = { mei, amy, ken, tom };
  const P = (slug) => L.persona(slug);
  for (const p of [mei, amy, ken, tom]) p.email = P(p.slug).email;
  const kenRow = JSON.parse(sql(`SELECT row_to_json(t) FROM (SELECT username, name FROM "user" WHERE id=${q(ken.id)}) t;`));
  R.info('identities', { mei: mei.id, amy: amy.id, ken: ken.id, kenUsername: kenRow.username, kenName: kenRow.name });

  // ---- fixture: a club Mei owns, a GROUP slot with a private and a group band ----------------------------------
  const club = await mustSe('channels/create', { name: TAG + ' academy', description: 'coaching-polish fixture' }, mei.token, 'club');
  CLEAN.channels.push(club.id);
  const sch = await mustSe('coaches/schedules/create', {
    channelId: club.id, name: TAG + ' Group drills', weekday: hkWeekday(2), startTime: '19:00', durationMinutes: 60, capacity: 4,
    bookingMode: 'several', packSize: 4, publishLeadHours: 672, cancellationPolicy: { windowHours: 24 }, visibility: 'public',
    priceTiers: [{ minParticipants: 1, maxParticipants: 1, pricePerPerson: 200, currency: 'HKD' }, { minParticipants: 2, maxParticipants: 4, pricePerPerson: 120, currency: 'HKD' }],
    venueName: TAG + ' court', paymentInfo: 'FPS 5555 0000',
  }, mei.token, 'schedule');
  CLEAN.schedules.push(sch.id);
  await mustSe('coaches/schedules/run', { scheduleId: sch.id }, mei.token, 'run');
  const shown = await mustSe('coaches/schedules/show', { scheduleId: sch.id }, amy.token, 'show');
  const lessons = (shown.upcoming || []).filter((m) => m.status !== 'cancelled');
  R.chk(lessons.length >= 3, 'fixture: group slot materialised >= 3 lessons', { n: lessons.length, sid: sch.id });
  const [L1, L2, L3] = lessons;
  OUT.fixture = { scheduleId: sch.id, club: club.id, L1: L1.id, L2: L2.id, L3: L3 && L3.id, feeAmountOnMeet: L1.feeAmount, pricingFromEngine: shown.pricing || null };
  R.info('engine quote on the slot (packSchedule.pricing)', shown.pricing || 'absent (old engine)');
  R.info('meet.feeAmount the shared meet screen shows', L1.feeAmount);

  // ---- 1. the NAME-LESS account: Ken's engine name -> NULL (restored in finally) -------------------------------
  CLEAN.restoreName = kenRow.name;
  await mustSe('i/update', { name: null }, ken.token, 'ken name null');
  const kenNow = JSON.parse(sql(`SELECT row_to_json(t) FROM (SELECT username, name FROM "user" WHERE id=${q(ken.id)}) t;`));
  R.chk(kenNow.name === null && /^hkpl_[0-9a-f]+$/.test(kenNow.username), 'fixture: Ken is name-less in the engine (name NULL, username hkpl_<hex>)', kenNow);
  // Ken books L2 (a roster row + the host notification the engine composes with name ?? username) and posts in its chat
  await mustSe('coaches/lessons/book', { meetId: L2.id }, ken.token, 'ken book L2'); CLEAN.leave.push([ken, L2.id]);
  const l2 = await mustSe('meets/show', { meetId: L2.id }, ken.token, 'meet show');
  if (l2.chatRoomId) { const msg = await mustSe('chat/messages/create-to-room', { toRoomId: l2.chatRoomId, text: TAG + ' see you at drills' }, ken.token, 'chat'); CLEAN.messages.push([ken, msg.id]); }
  // the engine's OWN answer carries the handle in `name` (the root cause, before the app sees it)
  const dash = await mustSe('coaches/my-lessons', { range: 'month' }, mei.token, 'coach dashboard');
  const rosterRow = (dash.lessons.find((x) => x.meetId === L2.id) || { roster: [] }).roster.find((r) => r.userId === ken.id);
  R.info('engine roster row for Ken (raw API)', rosterRow ? { name: rosterRow.name, username: rosterRow.username } : null);
  OUT.personname.engine_roster_name = rosterRow ? rosterRow.name : null;
  await sleep(1500);
  const notes = await mustSe('i/notifications', { limit: 20 }, mei.token, 'notifications');
  const handleNote = notes.find((n) => n.type === 'app' && /hkpl_[0-9a-f]{6,}/.test(String(n.body || '') + String(n.header || '')));
  R.info('engine notification body with the handle (raw API)', handleNote ? handleNote.body : null);

  // ---- 2. pricing: the first booker into the EMPTY group slot ---------------------------------------------------
  const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-gpu', '--lang=en-US'] });
  try {
    if (PHASE === 'before') {
      // BEFORE = the engine as it ran: Amy books through the API (the confirm sheet had no plain-language line)
      await mustSe('coaches/lessons/book', { meetId: L1.id }, amy.token, 'amy book L1'); CLEAN.leave.push([amy, L1.id]);
    } else {
      // AFTER: planted fault first — a quote that is not the engine's must book NOTHING
      const bad = await L.se('coaches/lessons/book', { meetId: L1.id, quotedPrice: 999 }, tom.token);
      const tomRows = sql(`SELECT count(*) FROM meet_participant WHERE "meetId"=${q(L1.id)} AND "userId"=${q(tom.id)};`);
      R.chk(bad.status === 400 && bad.json && bad.json.error && bad.json.error.code === 'COACH_PRICE_CHANGED' && tomRows === '0', 'GROUP-PRICE: a stale/wrong quote is refused and nothing is booked (planted fault)', { status: bad.status, code: bad.json && bad.json.error && bad.json.error.code, rows: tomRows });
      OUT.pricing.planted_wrong_quote = { status: bad.status, code: bad.json && bad.json.error && bad.json.error.code, participant_rows: Number(tomRows) };
      // Amy books L1 through the APP: lesson page -> Book -> confirm sheet -> Confirm
      const { ctx, page } = await browserCtx(browser, amy, 'en');
      await open(page, '/pages/lesson/index?id=' + sch.id);
      await shot(page, '01-lesson-page-group-slot-amy-en');
      const lessonText = await page.evaluate(() => document.body.innerText);
      OUT.pricing.lesson_page_group_note = /This is a group lesson: you pay the group rate/.test(lessonText);
      // the first "Book" row button (L1 is the earliest occurrence)
      const tapped = await clickText(page, /^Book$/);
      const sheet = await page.evaluate(() => document.body.innerText);
      const want = 'You pay HKD 120 now. If this runs as a private lesson the coach will confirm the private rate with you first.';
      R.chk(tapped && sheet.includes(want), 'GROUP-PRICE: the confirm sheet states the plain-language price', { tapped, found: sheet.includes(want), excerpt: (sheet.match(/You pay[^\n]*/) || [''])[0] });
      OUT.pricing.confirm_sheet_line = (sheet.match(/You pay[^\n]*/) || [''])[0];
      await shot(page, '02-confirm-sheet-group-price-amy-en');
      const confirmed = await clickText(page, /^Confirm$/);
      await sleep(2500);
      R.chk(confirmed, 'GROUP-PRICE: tapped Confirm on the sheet', { confirmed });
      CLEAN.leave.push([amy, L1.id]);
      await shot(page, '03-after-confirm-amy-en');
      await ctx.close();
      // the 繁 sheet, looked at and dismissed (L3 left unbooked)
      if (L3) {
        const z = await browserCtx(browser, tom, 'zh_Hant');
        await open(z.page, '/pages/lesson/index?id=' + sch.id, 'zh_Hant');
        await clickText(z.page, /^預約$|^预约$/);
        const zt = await z.page.evaluate(() => document.body.innerText);
        OUT.pricing.confirm_sheet_line_zh_Hant = (zt.match(/你現在支付[^\n]*/) || [''])[0];
        R.chk(/你現在支付 HKD 120。/.test(zt), 'GROUP-PRICE: the 繁 confirm sheet states the price in Chinese', OUT.pricing.confirm_sheet_line_zh_Hant);
        await shot(z.page, '04-confirm-sheet-group-price-tom-zh_Hant');
        await z.ctx.close();
      }
    }
    const amyPrice = sql(`SELECT "agreedPrice" FROM meet_participant WHERE "meetId"=${q(L1.id)} AND "userId"=${q(amy.id)} AND status='confirmed';`);
    OUT.pricing.first_booker_locked_price = amyPrice === '' ? null : Number(amyPrice);
    OUT.pricing.bands = { private: 200, group: 120 };
    R.info('first booker into the empty group slot: agreedPrice locked in DB', { phase: PHASE, agreedPrice: OUT.pricing.first_booker_locked_price });
    if (PHASE === 'after') R.chk(OUT.pricing.first_booker_locked_price === 120, 'GROUP-PRICE: the first booker is charged the GROUP band (DB agreedPrice = 120), not the private 200', { agreedPrice: amyPrice });

    // ---- 1b. walk as the COACH: every surface Ken (name-less) appears on ------------------------------------------
    {
      const { ctx, page } = await browserCtx(browser, mei, 'en');
      const surfaces = [
        ['coaching-roster', '/pages/lessons/index', async () => { await clickText(page, /^Coaching$/); await sleep(1500); await page.evaluate(() => window.scrollTo(0, 0)); }],
        ['meet-roster', '/pages/meet/index?id=' + L2.id + '&tab=participants'],
        ['meet-chat', '/pages/meet/index?id=' + L2.id + '&tab=chat'],
        ['profile', '/pages/player/index?id=' + ken.id],
        ['notifications', '/pages/notifications/index'],
        ['lesson-owner', '/pages/lesson/index?id=' + sch.id],
      ];
      let total = 0;
      for (const [name, route, then] of surfaces) {
        await open(page, route);
        if (then) await then();
        const got = await handlesOnScreen(page);
        // coaching roster: scroll the lesson with Ken into view so the shot shows him
        if (name === 'coaching-roster') await page.evaluate(() => { const el = [...document.querySelectorAll('*')].find((e) => /Group drills/.test(e.innerText || '') && e.children.length < 8); if (el) el.scrollIntoView(); }).catch(() => undefined);
        await shot(page, '1' + String(surfaces.findIndex((s) => s[0] === name)) + '-' + name + '-coach-en');
        const kenLabel = name === 'coaching-roster' || name === 'meet-roster' || name === 'meet-chat' || name === 'profile' || name === 'notifications'
          ? (got.text.match(/A player[^\n]{0,40}/) || [null])[0] : null;
        OUT.personname.surfaces[name] = { handles: got.hits.length, samples: got.hits.slice(0, 4), label_seen: kenLabel };
        total += got.hits.length;
        R.info('surface ' + name, { handles: got.hits.length, sample: got.hits[0] || null, label: kenLabel });
      }
      if (PHASE === 'after') {
        // the private-rate hint on the coach's roster for L1 (1 booked in a 2-4 group band)
        await open(page, '/pages/lessons/index'); await clickText(page, /^Coaching$/); await sleep(1500);
        const t = await page.evaluate(() => document.body.innerText);
        OUT.pricing.coach_private_hint = (t.match(/Only 1 booked[^\n]*/) || [null])[0];
        R.chk(!!OUT.pricing.coach_private_hint, 'GROUP-PRICE: the coach sees "agree the private rate with your student first" on a group lesson with 1 booked', OUT.pricing.coach_private_hint);
        await page.evaluate(() => { const el = [...document.querySelectorAll('*')].find((e) => /Only 1 booked/.test(e.innerText || '') && e.children.length < 4); if (el) el.scrollIntoView({ block: 'center' }); }).catch(() => undefined);
        await shot(page, '20-coach-private-rate-hint-en');
      }
      OUT.personname.handles_on_screen = total;
      if (PHASE === 'after') R.chk(total === 0, 'PERSON-NAME: a name-less account shows NO machine handle across roster/chat/profile/coaching/notifications', { total });
      else R.info('PERSON-NAME BEFORE: machine handles on screen', { total });
      await ctx.close();
    }

    // ---- 3. SIGNED-OUT visitor ---------------------------------------------------------------------------------
    {
      // the hub first, in a FRESH signed-out context; wait for the list rather than trusting a fixed sleep
      if (PHASE === 'after') {
        const hb = await browserCtx(browser, null, 'en');
        const consoleErrs = []; hb.page.on('console', (m) => { if (m.type() === 'error') consoleErrs.push(m.text().slice(0, 140)); });
        await open(hb.page, '/pages/lessons/index');
        await hb.page.waitForFunction(() => /Lessons you can book/.test(document.body.innerText), { timeout: 12000 }).catch(() => undefined);
        const h = await hb.page.evaluate(() => document.body.innerText);
        OUT.signed_out.hub_browse_lists_slot = h.includes('Lessons you can book') && h.includes('Group drills');
        R.chk(OUT.signed_out.hub_browse_lists_slot, 'SIGNED-OUT: the Lessons hub lists bookable lessons', { ok: OUT.signed_out.hub_browse_lists_slot });
        await shot(hb.page, '33-signed-out-lessons-hub-en');
        await open(hb.page, '/pages/more/index');
        await hb.page.waitForFunction(() => /Lessons/.test(document.body.innerText), { timeout: 8000 }).catch(() => undefined);
        const mt = await hb.page.evaluate(() => document.body.innerText);
        OUT.signed_out.more_has_lessons_entry = /Lessons/.test(mt);
        OUT.signed_out.console_errors_on_hub_and_more = consoleErrs;
        R.chk(consoleErrs.length === 0, 'SIGNED-OUT: the coaching gate logs no console error (hub + More)', consoleErrs);
        await shot(hb.page, '35-signed-out-more-lessons-entry-en');
        await hb.ctx.close();
      }
      const { ctx, page } = await browserCtx(browser, null, 'en');
      await open(page, '/pages/lesson/index?id=' + sch.id);
      const t = await page.evaluate(() => document.body.innerText);
      OUT.signed_out.lesson_page_renders_slot = t.includes('Group drills') && /HKD 120/.test(t);
      OUT.signed_out.lesson_page_state = t.includes('Coaching lessons are not available yet.') ? 'off (dark for signed-out)' : (OUT.signed_out.lesson_page_renders_slot ? 'browsable' : 'other');
      await shot(page, '30-signed-out-lesson-page-en');
      if (PHASE === 'after') {
        R.chk(OUT.signed_out.lesson_page_renders_slot, 'SIGNED-OUT: a visitor sees the lesson slot (name + price) without signing in', { state: OUT.signed_out.lesson_page_state });
        const tapped = await clickText(page, /^Book$/);
        const m = await page.evaluate(() => document.body.innerText);
        OUT.signed_out.book_prompts_sign_in = tapped && m.includes('Sign in to book');
        await shot(page, '31-signed-out-book-prompts-sign-in-en');
        R.chk(OUT.signed_out.book_prompts_sign_in, 'SIGNED-OUT: tapping Book prompts "Sign in to book"', { tapped });
        await clickText(page, /^Sign in$/);
        await sleep(2500);
        OUT.signed_out.after_sign_in_tap_url = page.url();
        R.chk(/pages\/signin\/index/.test(page.url()) && decodeURIComponent(page.url()).includes('/pages/lesson/index?id=' + sch.id), 'SIGNED-OUT: the prompt goes to sign-in with next= back to this slot', { url: page.url() });
        await shot(page, '32-signed-out-sign-in-page-en');
        await open(page, '/pages/coach/index?id=' + mei.id);
        const c = await page.evaluate(() => document.body.innerText);
        OUT.signed_out.coach_profile_lists_slot = c.includes('Group drills');
        R.chk(OUT.signed_out.coach_profile_lists_slot, 'SIGNED-OUT: the coach profile shows the coach\'s lessons', { ok: OUT.signed_out.coach_profile_lists_slot });
        await shot(page, '34-signed-out-coach-profile-en');
      } else {
        R.info('SIGNED-OUT BEFORE: lesson page state', OUT.signed_out.lesson_page_state);
      }
      await ctx.close();
    }
  } finally { await browser.close().catch(() => undefined); }
}

async function cleanup() {
  try {
    if (people && CLEAN.restoreName !== null) { const r = await L.se('i/update', { name: CLEAN.restoreName }, people.ken.token); R.info('cleanup: Ken name restored', { status: r.status, name: CLEAN.restoreName }); }
    for (const [p, id] of CLEAN.messages) await L.se('chat/messages/delete', { messageId: id }, p.token).catch(() => undefined);
    for (const [p, id] of CLEAN.leave) await L.se('meets/leave', { meetId: id }, p.token).catch(() => undefined);
    for (const sid of CLEAN.schedules) { const r = await L.se('coaches/schedules/delete', { scheduleId: sid }, people.mei.token); R.info('cleanup: schedule deleted', { status: r.status }); }
    // lessons a student still held when the schedule went: cancel them, so no '[probe]' meet stays live
    sql(`UPDATE meet SET status='cancelled' WHERE name LIKE ${q(TAG + '%')} AND status <> 'cancelled';`);
    for (const ch of CLEAN.channels) sql(`UPDATE channel SET "isArchived"=true WHERE id=${q(ch)};`);
    // the lesson meets' own rows (host rows, meet chat rooms): the age-gated sweep leaves fresh ones for 45 min, so the owner clears them
    sql(`DELETE FROM meet_participant WHERE "meetId" IN (SELECT id FROM meet WHERE name LIKE ${q(TAG + '%')} AND status='cancelled'); DELETE FROM chat_room WHERE name LIKE ${q(TAG + '%')};`);
    const left = sql(`SELECT (SELECT count(*) FROM meet WHERE name LIKE ${q(TAG + '%')} AND status<>'cancelled') || ',' || (SELECT count(*) FROM channel WHERE name LIKE ${q(TAG + '%')} AND "isArchived"=false) || ',' || (SELECT count(*) FROM coach_schedule WHERE name LIKE ${q(TAG + '%')});`);
    R.info('cleanup: live fixtures left (meets,clubs,schedules)', left);
  } catch (e) { R.info('cleanup error', String(e && e.message)); }
}

main().then(async () => { await cleanup(); }).catch(async (e) => { console.error('THREW ' + (e && e.stack || e)); R.chk(false, 'probe threw', String(e && e.message || e)); await cleanup(); })
  .then(() => { const v = R.write(); fs.writeFileSync('/root/social-engine/probes/coaching-polish-' + PHASE + '.out.json', JSON.stringify(OUT, null, 1)); process.exit(v.verdict === 'pass' ? 0 : 7); });

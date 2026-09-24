// fix-S8 — L6 probe for the S8 kudos + chat re-check closure (lane fix-S8, 2026-09-25).
//   bash /root/gen/browser-slot.sh node /root/social-engine/probes/fix-S8.probe.cjs            (PHASE=after, default)
//   PHASE=before bash /root/gen/browser-slot.sh node /root/social-engine/probes/fix-S8.probe.cjs  (the plant: old app live)
// Real Chrome at 390 px (EN + 繁 where the row is text), personas signed in NATIVELY (probes/_native-session.cjs through
// probes/mop-up-lib.cjs — REUSED), every state change read back from the engine. NO SQL: fixtures go through the API only;
// a kudos is dated into a closed month through the engine's sandbox door stats/kudos-awards/sandbox-date (AWARD-SANDBOX-DOOR-V1).
// Fixtures are '[probe] fix-S8 …' on UAT only, cleaned in `finally`.
// Output: probes/fix-S8.<phase>.json; the verdict (probes/fix-S8.verdict.json) is written by fix-S8-verdict.cjs from both.
// @claims app pages/my-stats/index :: fix-S8 :: street cred filter, learn more, board request, load more
// @claims app pages/inbox/index :: fix-S8 :: filing, avatars, swipe
// @claims app pages/chat/index :: fix-S8 :: support header, presence, members gutter, brand links
// @claims engine i/gb-prefs|users/show|chat/history|stats/kudos-awards/sandbox-date :: fix-S8
'use strict';
const fs = require('fs');
process.env.MU_SHOTS = '/root/social-engine/probes/fix-S8-shots';   // before the lib reads it
const L = require('/root/social-engine/probes/mop-up-lib.cjs');
const PHASE = process.env.PHASE === 'before' ? 'before' : 'after';
// ONLY=<row ids>: a focused re-run of those rows (no meet / competition fixtures) → fix-S8.<phase>.only.json
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
const OUT = '/root/social-engine/probes/fix-S8.' + PHASE + (ONLY ? '.only' : '') + '.json';
fs.mkdirSync(process.env.MU_SHOTS, { recursive: true });
if (!L.APPHOST.includes('uat.')) throw new Error('refusing: not UAT');
const TAG = '[probe] fix-S8';
const RUN = Date.now().toString(36).slice(-4);
const sleep = L.sleep;
const R = { id: 'fix-S8', phase: PHASE, at: new Date().toISOString(), run: RUN, rows: {}, api: {}, fx: {}, errors: [], cleanup: {} };
const row = (id, ok, evidence) => { R.rows[id] = { ok: !!ok, evidence }; console.log((ok ? 'PASS ' : 'FAIL ') + id + ' — ' + JSON.stringify(evidence).slice(0, 300)); };
async function tryRow(id, fn) { if (ONLY && !ONLY.includes(id)) return; try { await fn(); } catch (e) { R.errors.push(id + ': ' + (e && e.message)); row(id, false, { error: String(e && e.message).slice(0, 300) }); } }
const low = (s) => String(s || '').toLowerCase();
const must = async (label, ep, body, tok) => { const r = await L.se(ep, body, tok); R.api[label] = r.status; if (r.status >= 300) throw new Error(label + ' ' + r.status + ' ' + String(r.text).slice(0, 200)); return r.json; };
const T = (page) => L.text(page);
async function ctx(b, who, lang) { const c = await L.newCtx(b, who, 390, 844); if (lang) await c.page.evaluate((l) => { try { localStorage.setItem('hkpl_lang', JSON.stringify({ data: l })); } catch (e) { /* */ } }, lang).catch(() => undefined); return c; }
async function clickSel(page, sel) {
  const box = await page.evaluate((s) => { const e = Array.from(document.querySelectorAll(s)).filter((x) => x.getBoundingClientRect().width > 2).pop(); if (!e) return null; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, sel);
  if (!box) return false; await sleep(200); await page.mouse.click(box.x, box.y); await sleep(1500); return true;
}
async function clickAct(page, label) {
  const box = await page.evaluate((l) => { const e = Array.from(document.querySelectorAll('.ah-act')).find((x) => (x.textContent || '').includes(l)); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, label);
  if (!box) return false; await page.mouse.click(box.x, box.y); await sleep(1500); return true;
}
const dialogUp = (page) => page.evaluate(() => Array.from(document.querySelectorAll('.ak-content')).some((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && /congratulat/i.test(e.textContent || ''); }));
async function finger(page, sel, pick) {
  return page.evaluate((sel, pick) => {
    const all = Array.from(document.querySelectorAll(sel)).filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (!pick || (e.textContent || '').includes(pick)); });
    const el = all[0]; if (!el) return { found: false };
    const hit = () => { const r = el.getBoundingClientRect(); if (r.bottom <= 0 || r.top >= innerHeight) return 'offscreen'; const x = r.left + r.width / 2, y = r.top + r.height / 2; const t = document.elementFromPoint(x, y); return !!t && (t === el || el.contains(t)); };
    el.scrollIntoView({ block: 'center' }); const r0 = el.getBoundingClientRect(); const rest = hit();
    let c = el.parentElement; while (c && !(c.scrollHeight > c.clientHeight + 2 && /auto|scroll/.test(getComputedStyle(c).overflowY))) c = c.parentElement;
    if (c) c.scrollTop = c.scrollHeight; window.scrollTo(0, document.documentElement.scrollHeight); const end = hit();
    const covered = end === false ? (() => { const r = el.getBoundingClientRect(); const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return t ? (t.className || t.tagName).toString().slice(0, 60) : null; })() : null;
    el.scrollIntoView({ block: 'center' });
    return { found: true, w: Math.round(r0.width), h: Math.round(r0.height), atRest: rest, atEnd: end, coveredBy: covered, ok: rest === true && end !== false && r0.width >= 24 && r0.height >= 24 };
  }, sel, pick || '');
}
async function swipeLeft(page, sel, dx = 170) {
  const box = await page.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.x + r.width - 30, y: r.y + r.height / 2 }; }, sel);
  if (!box) return false;
  const c = await page.target().createCDPSession();
  await c.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x, y: box.y }] });
  for (let i = 1; i <= 10; i++) { await c.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: box.x - (dx * i) / 10, y: box.y + i * 0.3 }] }); await sleep(20); }
  await c.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await c.detach().catch(() => undefined); await sleep(600); return true;
}

(async () => {
  const ken = await L.who('host-ken'), amy = await L.who('player-amy'), tom = await L.who('clubadmin-tom'), mei = await L.who('clubowner-mei'), adm = await L.who('admin');
  const HOST = { ken, tom, mei, admin: adm };
  const FX = R.fx; FX.meets = []; FX.reviews = [];
  const sup = await L.se('users/show', { username: 'boyau' }, ken.token); FX.support = sup.json && sup.json.id;
  let b; const T0 = Date.now();
  try {
    // ======================== fixtures (API only) ========================
    // meets/create is a per-user bucket (30, one back every 2 min): a 429 moves to the next host instead of waiting on one
    const raw = async (ep, body, tok) => { const r = await fetch(L.APPHOST + '/api/' + ep, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, i: tok }) }); let j = null; try { j = await r.json(); } catch (e) { /* 204 */ } return { status: r.status, json: j }; };
    const mk = async (hk0, name, extra) => {
      const order = hk0 === 'any' ? H4 : [hk0];
      let m = null, hk = null, startAt = null;
      for (let round = 0; round < 40 && !m; round++) {
        for (const k of order) { startAt = new Date(Date.now() + 50e3); const r = await raw('meets/create', { name, startAt: startAt.toISOString(), durationMinutes: 15, capacity: 6, visibility: 'private', autoApprove: true, hostPlays: true, sendNotifications: false, sport: 'pickleball', feeType: 'free' }, HOST[k].token); if (r.status === 200 && r.json && r.json.id) { m = r.json; hk = k; break; } if (r.status !== 429) throw new Error('meets/create ' + name + ' ' + r.status + ' ' + JSON.stringify(r.json).slice(0, 160)); }
        if (!m) await sleep(30e3);
      }
      if (!m) throw new Error('meets/create ' + name + ': every host rate-limited for 20 min');
      const host = HOST[hk]; FX.lastStart = startAt.getTime(); R.api['meets/create ' + name] = 200 + ' by ' + hk;
      FX.meets.push({ id: m.id, host: hk }); FX.lmHost = FX.lmHost || {}; FX.lmHost[m.id] = hk;
      for (const u of extra) await must('add ' + name, 'meets/participants/add', { meetId: m.id, userId: u.userId, status: 'confirmed' }, host.token);
      return m.id;
    };
    const H4 = (process.env.LM_HOSTS || 'admin,ken,tom,mei').split(',');
    if (!ONLY) {
    FX.m1 = await mk('mei', TAG + ' M1 ' + RUN, [amy, tom]); FX.m1Start = FX.lastStart;
    FX.ma = await mk('admin', TAG + ' award ' + RUN, [amy]);
    FX.lm = [];
   // meets/create is 30 an hour per user — pick hosts whose hour is free   // meets/create is 30 an hour per user: spread over four hosts
    for (let i = 0; i < 31; i++) FX.lm.push(await mk('any', TAG + ' LM' + String(i + 1).padStart(2, '0') + ' ' + RUN, [amy]));
    // a competition Ken hosts, finished (the ended-competition popup)
    const c = await must('competitions/create', 'competitions/create', { name: TAG + ' comp ' + RUN, startAt: new Date(Date.now() + 86400e3).toISOString(), format: 'roundRobin', participantType: 'singles', maxEntries: 8, visibility: 'private' }, ken.token);
    FX.comp = c.id;
    for (const [n, u] of [['Ken', ken], ['Amy', amy], ['Mei', mei]]) await must('entry ' + n, 'competitions/entries/update', { competitionId: FX.comp, name: TAG + ' ' + n, userIds: [u.userId], status: 'confirmed' }, ken.token);
    for (const a of ['publish', 'start', 'finish']) await must('comp ' + a, 'competitions/status', { competitionId: FX.comp, action: a }, ken.token);
    }
    // a hand-made group Tom owns, Amy joined; a long unbroken name (the notification wrap row) and a brand link
    const RO = HOST[process.env.ROOM_OWNER || 'tom'];   // chat/rooms/create is 10 a day per user
    const g = await must('chat/rooms/create', 'chat/rooms/create', { name: TAG + ' grp ' + RUN + ' ' + 'Averyveryverylongunbrokengroupnamewithoutanyspacesatalltotestwrapping'.slice(0, 60), description: TAG + ', deleted in finally' }, RO.token);
    FX.room = g.id;
    await must('invite amy', 'chat/rooms/invitations/create', { roomId: FX.room, userId: amy.userId }, RO.token);
    await must('amy joins', 'chat/rooms/join', { roomId: FX.room }, amy.token);
    await must('invite mei', 'chat/rooms/invitations/create', { roomId: FX.room, userId: mei.userId }, RO.token);
    await must('mei joins', 'chat/rooms/join', { roomId: FX.room }, mei.token);
    await must('msg link', 'chat/messages/create-to-room', { toRoomId: FX.room, text: TAG + ' link https://gripbat.com/how.html' }, RO.token);
    // a mention of Amy whose body is one long unbroken word (the notification-wrap row)
    await must('msg long mention', 'chat/messages/create-to-room', { toRoomId: FX.room, text: '@' + amy.username + ' ' + TAG + ' ' + 'Longunbrokenword'.repeat(7) }, RO.token);
    console.log('fixtures made in', Math.round((Date.now() - T0) / 1000), 's');

    b = await L.browser();

    // ---- Mei chooses "Exact time" through Settings (real click) — read at the END, ≥ 16 min later (E-chat-room.01)
    await tryRow('E-chat-room.01:setting', async () => {
      const { page, ctx: cx } = await ctx(b, 'clubowner-mei');
      await L.open(page, 'social-settings/index');
      const t = await T(page);
      const has = /show when i was last active/i.test(t);
      const fg = await finger(page, '.pp-chip', 'Exact time');
      let clicked = false; if (has) clicked = await L.clickText(page, 'Exact time').then(() => true).catch(() => false);
      await sleep(2500);
      const pr = await L.se('i/gb-prefs', {}, mei.token);
      R.fx.meiPrefSetAt = Date.now();
      await page.reload({ waitUntil: 'networkidle2' }).catch(() => undefined); await sleep(2000);
      const persisted = await page.evaluate(() => { const on = document.querySelector('.pp-chip-on'); return on ? on.textContent.trim() : null; });
      row('E-chat-room.01:setting', has && clicked && fg.ok && persisted === 'Exact time' && pr.json && pr.json.lastActiveExact === true, { control: has, clicked, finger: fg, afterReload: persisted, stored: pr.json, shot: await L.shot(page, PHASE + '-presence-setting') });
      await cx.close();
    });
    // the privacy half, at the engine: exact time only to a signed-in viewer, never to an anonymous one
    await tryRow('E-chat-room.01:privacy', async () => {
      const signed = await L.se('users/show', { userId: mei.userId }, ken.token);
      const anon = await L.se('users/show', { userId: mei.userId });
      const amyRough = await L.se('users/show', { userId: amy.userId }, ken.token);   // Amy never opted in
      row('E-chat-room.01:privacy', !!(signed.json && signed.json.lastActiveAt) && !(anon.json && anon.json.lastActiveAt) && !(amyRough.json && amyRough.json.lastActiveAt),
        { signedIn: signed.json && signed.json.lastActiveAt, anonymous: anon.json && anon.json.lastActiveAt || null, notOptedIn: amyRough.json && amyRough.json.lastActiveAt || null });
    });

    // ---- wait for the meets to start, then the kudos (hosts → Amy)
    if (!ONLY) {
    const wait = (FX.lastStart + 8e3) - Date.now(); if (wait > 0) await sleep(wait);   // every meet has started (the engine's review rule)
    for (let i = 0; i < FX.lm.length; i++) { const host = HOST[FX.lmHost[FX.lm[i]]]; await must('kudos LM' + i, 'meets/reviews/upsert', { meetId: FX.lm[i], targetUserId: amy.userId, type: 'endorsement', body: 'Serving' }, host.token); }
    await must('kudos MA', 'meets/reviews/upsert', { meetId: FX.ma, targetUserId: amy.userId, type: 'endorsement', body: 'Heart, Dinking' }, adm.token);
    await must('warning M1', 'meets/reviews/upsert', { meetId: FX.m1, targetUserId: amy.userId, type: 'warning', body: TAG + ' warning reason' }, tom.token);
    }

    // ======================== rows ========================
    // D-street-cred-leaderboard.02 — the "All kudos + this month" board (the root cause, request captured)
    await tryRow('D-street-cred-leaderboard.02', async () => {
      const { page, ctx: cx } = await ctx(b, 'host-ken');
      await L.open(page, 'my-stats/index?pane=board');
      const month = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 7);
      const label = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5) - 1, 15)).toLocaleDateString('en', { month: 'short', year: 'numeric', timeZone: 'UTC' });
      if (await page.$('.ys-filterbar')) await clickSel(page, '.ys-filterbar .hk-btn');
      page.__req = []; page.__resp = [];
      await L.clickText(page, 'All kudos'); await sleep(1500);
      await L.clickText(page, label); await sleep(2500);
      if (await page.$('.ys-filtersheet')) { await L.clickText(page, 'Done').catch(() => undefined); await sleep(800); }
      const reqs = page.__req.filter((r) => r.url.includes('stats/street-cred'));
      const resps = page.__resp.filter((r) => r.url.includes('stats/street-cred'));
      const last = reqs[reqs.length - 1]; const lastR = resps[resps.length - 1];
      const t = await T(page);
      const empty = /No kudos in this period yet/i.test(t); const amyRow = /Amy/.test(t);
      row('D-street-cred-leaderboard.02', !!last && !/"gender":null/.test(last.body) && lastR && lastR.status === 200 && !empty && amyRow,
        { request: last && last.body, status: lastR && lastR.status, emptyShown: empty, amyOnBoard: amyRow, month: label, shot: await L.shot(page, PHASE + '-board-all-month') });
      await cx.close();
    });
    // D-street-cred-leaderboard.01 — the board is above the fold at 390 px (one filter control, not ~30 chips)
    await tryRow('D-street-cred-leaderboard.01', async () => {
      const { page, ctx: cx } = await ctx(b, 'host-ken');
      await L.open(page, 'my-stats/index?pane=board'); await sleep(1500);
      const m = await page.evaluate(() => {
        const chips = Array.from(document.querySelectorAll('.ys-chip')).filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !e.closest('.ys-filtersheet'); }).length;
        const card = Array.from(document.querySelectorAll('.ys-rank')).filter((e) => e.getBoundingClientRect().height > 0)[0];
        return { chips, firstCardTop: card ? Math.round(card.getBoundingClientRect().top + window.scrollY) : null, filterBar: !!document.querySelector('.ys-filterbar') };
      });
      const fg = await finger(page, '.ys-filterbar .hk-btn');
      row('D-street-cred-leaderboard.01', fg.ok && m.filterBar && m.chips <= 3 && m.firstCardTop != null && m.firstCardTop < 844, { ...m, finger: fg, shot: await L.shot(page, PHASE + '-board-fold') });
      await cx.close();
    });
    // D-kudo-ranking.02 — Learn more opens the kudos / Street Cred article (EN + 繁)
    for (const lang of ['en', 'zh_Hant']) await tryRow('D-kudo-ranking.02:' + lang, async () => {
      const { page, ctx: cx } = await ctx(b, 'host-ken', lang);
      await L.open(page, 'my-stats/index?pane=board', lang); await sleep(1000);
      const before = page.url(); const fg = await finger(page, '.ys-note.is-tap', lang === 'en' ? 'Learn more' : '了解更多');
      await L.clickText(page, lang === 'en' ? 'Learn more' : '了解更多'); await sleep(2000);
      const t = await T(page);
      const need = lang === 'en' ? ['How Street Cred is calculated', 'The 18 kudos', 'Up to 3 per player', 'Monthly awards', 'Erne'] : ['戰績如何計算', '18 種讚賞', '每位球員最多 3 個', '每月獎項'];
      const miss = need.filter((n) => !t.includes(n));
      row('D-kudo-ranking.02:' + lang, fg.ok && !miss.length && !/faq/.test(page.url()), { finger: fg, missing: miss, url: page.url().replace(L.APPHOST, ''), from: before.replace(L.APPHOST, ''), shot: await L.shot(page, PHASE + '-learnmore-' + lang) });
      await cx.close();
    });
    // D-street-cred-by-activity.02 — > 30 kudos'd activities: Load more, one page, the 31st arrives
    await tryRow('D-street-cred-by-activity.02', async () => {
      const api = await L.se('stats/kudos-by-activity', { timeframe: 'ALL_TIME', offset: 0, limit: 30 }, amy.token);
      const total = api.json && api.json.activitiesTotal;
      const { page, ctx: cx } = await ctx(b, 'player-amy');
      await L.open(page, 'my-stats/index?pane=board');
      await L.clickText(page, 'By activity'); await sleep(2500);
      const n0 = await page.$$eval('.pg-row', (x) => x.length);
      const fg = await finger(page, '.hk-btn', 'Load more');
      page.__req = [];
      const lm = await L.clickText(page, 'Load more').then(() => true).catch(() => false); await sleep(3000);
      const n1 = await page.$$eval('.pg-row', (x) => x.length);
      const req = page.__req.filter((r) => r.url.includes('kudos-by-activity')).pop();
      row('D-street-cred-by-activity.02', fg.ok && total > 30 && lm && n1 > n0 && req && /"offset":30/.test(req.body), { finger: fg, activitiesTotal: total, rowsBefore: n0, rowsAfter: n1, request: req && req.body, shot: await L.shot(page, PHASE + '-loadmore') });
      await cx.close();
    });
    // A-user-kudos-summary.04 — own profile: "You haven't earned any kudos for Erne yet."
    await tryRow('A-user-kudos-summary.04', async () => {
      const { page, ctx: cx } = await ctx(b, 'player-amy');
      await L.open(page, 'player/index?id=' + amy.userId); await sleep(1500);
      await L.clickText(page, 'Erne'); await sleep(2000);
      const t = await T(page);
      row('A-user-kudos-summary.04', /You haven[’']t earned any kudos for Erne yet\./.test(t) && !/You hasn/.test(t), { line: (t.match(/You ha[^\n]*Erne[^\n]*/) || [''])[0], shot: await L.shot(page, PHASE + '-self-erne') });
      await cx.close();
    });
    // A-user-kudos-summary.01 (gutter) — "Endorsed by…" is on the 16 px rail
    await tryRow('A-user-kudos-summary.01:gutter', async () => {
      const { page, ctx: cx } = await ctx(b, 'clubadmin-tom');
      await L.open(page, 'player/index?id=' + amy.userId); await sleep(1500);
      const m = await page.evaluate(() => { const e = Array.from(document.querySelectorAll('.ps-kudos-sub')).find((x) => /Endorsed by/.test(x.textContent || '')); if (!e) return null; const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return { left: Math.round(r.left + parseFloat(cs.paddingLeft || '0')), text: e.textContent.trim().slice(0, 60) }; });
      row('A-user-kudos-summary.01:gutter', !!m && m.left >= 12, { ...m, shot: await L.shot(page, PHASE + '-endorsed-gutter') });
      await cx.close();
    });
    // G15.4 — the warning's author is anonymous to the warned player (API + screen)
    await tryRow('G15.4', async () => {
      const api = await L.se('meets/reviews/show', { userId: amy.userId }, amy.token);
      const s = JSON.stringify(api.json || {});
      const leaks = (api.json && Array.isArray(api.json.warnings) ? api.json.warnings : []).filter((w) => w && (w.authorId === tom.userId || (w.author && w.author.id === tom.userId)));
      const { page, ctx: cx } = await ctx(b, 'player-amy');
      await L.open(page, 'reviews/index'); await sleep(1500);
      await L.clickText(page, 'Warnings', { contains: true }).catch(() => undefined); await sleep(1500);
      const t = await T(page);
      const warnVisible = t.includes(TAG + ' warning reason');
      const named = /Tom/.test((t.split(TAG + ' warning reason')[0] || '').split('\n').slice(-4).join(' '));
      row('G15.4', api.status === 200 && !leaks.length && !s.includes(tom.userId) && warnVisible && !named, { apiStatus: api.status, authorIdInPayload: s.includes(tom.userId), warnVisible, namedOnScreen: named, shot: await L.shot(page, PHASE + '-g154') });
      await cx.close();
    });
    // D-award-showcase.01 — a kudos dated into a closed month through the sandbox door → the real award read → popup + profile
    await tryRow('D-award-showcase.01', async () => {
      const plant = await L.se('stats/kudos-awards', { userId: amy.userId, limit: 12 }, amy.token);
      const plantHad = !!(plant.json && plant.json.awards && plant.json.awards.length);
      let dated = null; const now = new Date(Date.now() + 8 * 3600e3);
      for (let back = 3; back <= 6 && !dated; back++) {
        const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1)); const month = d.toISOString().slice(0, 7);
        const r = await L.se('stats/kudos-awards/sandbox-date', { meetId: FX.ma, targetUserId: amy.userId, month }, adm.token);
        R.api['sandbox-date ' + month] = r.status;
        if (r.status === 200) { dated = month; FX.awardMonth = month; }
      }
      if (!dated) throw new Error('the sandbox door refused every month ' + JSON.stringify(R.api));
      const { page, ctx: cx } = await ctx(b, 'player-amy');
      await L.open(page, 'home/index'); await sleep(4000);
      const t = await T(page);
      const monthLbl = new Date(Date.UTC(+dated.slice(0, 4), +dated.slice(5) - 1, 15)).toLocaleDateString('en', { month: 'short', year: 'numeric', timeZone: 'UTC' });
      const popup = /MOST STREET CRED/i.test(t) && t.includes(monthLbl);
      const shotHome = await L.shot(page, PHASE + '-award-popup');
      await cx.close();
      const v = await ctx(b, 'clubadmin-tom');
      await L.open(v.page, 'player/index?id=' + amy.userId); await sleep(2500);
      const t2 = await T(v.page);
      const showcase = /Awards/.test(t2) && /MOST STREET CRED/i.test(t2);
      const shotProf = await L.shot(v.page, PHASE + '-award-showcase');
      await v.ctx.close();
      const after = await L.se('stats/kudos-awards', { userId: amy.userId, month: dated }, amy.token);
      row('D-award-showcase.01', !plantHad && popup && showcase && after.json && after.json.awards.length > 0, { plantHadAward: plantHad, month: dated, popup, showcase, engineAwards: after.json && after.json.awards.map((a) => a.dimension || 'ALL'), shots: [shotHome, shotProf] });
    });
    // E-chat-by-participants.02 — Create group with nobody picked LOOKS disabled and sends nothing
    await tryRow('E-chat-by-participants.02', async () => {
      const { page, ctx: cx } = await ctx(b, 'player-amy', 'zh_Hant');
      await L.open(page, 'inbox/index', 'zh_Hant');
      await clickAct(page, '新訊息');
      await L.clickText(page, '新群組').catch(() => undefined); await sleep(1200);
      const ph = await page.evaluate(() => { const i = document.querySelector('.nc input'); return i ? (i.getAttribute('placeholder') || '') : null; });
      const m = await page.evaluate(() => { const bt = document.querySelector('.nc-create'); if (!bt) return null; return { opacity: Number(getComputedStyle(bt).opacity), disabled: bt.hasAttribute('disabled') }; });
      const fg = await finger(page, '.nc-create');
      page.__req = []; await clickSel(page, '.nc-create'); await sleep(1200);
      const sent = page.__req.filter((r) => /rooms\/create|rooms\/owned/.test(r.url)).length;
      row('E-chat-by-participants.02', fg.found && fg.atRest === true && !!m && m.opacity <= 0.6 && sent === 0 && ph != null && !ph.includes('波友'), { ...m, finger: fg, requestsOnTap: sent, placeholder: ph, shot: await L.shot(page, PHASE + '-create-group') });
      await cx.close();
    });
    // E-chat-room.02 — the GripBat Team thread: no "@boyau" anywhere
    await tryRow('E-chat-room.02', async () => {
      const { page, ctx: cx } = await ctx(b, 'player-amy');
      await L.open(page, 'chat/index?user=' + FX.support); await sleep(1500);
      const t = await T(page);
      row('E-chat-room.02', !/boyau/i.test(t) && /GripBat Team/.test(t), { boyauOnScreen: /boyau/i.test(t), head: t.slice(0, 160), shot: await L.shot(page, PHASE + '-support-head') });
      await cx.close();
    });
    // E-inbox.08 / avatars / E-inbox.07 swipe / Members gutter / brand link / notification wrap
    await tryRow('E-inbox.08', async () => {
      const { page, ctx: cx } = await ctx(b, 'player-amy');
      await L.open(page, 'inbox/index?filter=direct'); await sleep(2000);
      const inDirect = (await T(page)).includes(TAG + ' grp ' + RUN);
      await L.open(page, 'inbox/index?filter=clubs'); await sleep(2000);
      const inClubs = (await T(page)).includes(TAG + ' grp ' + RUN);
      row('E-inbox.08', inDirect && !inClubs, { groupUnderDirect: inDirect, groupUnderClubs: inClubs, shot: await L.shot(page, PHASE + '-inbox-clubs') });
      await L.open(page, 'inbox/index'); await sleep(2500);
      const av = await page.evaluate(() => { const rows = Array.from(document.querySelectorAll('.ib-item')); return { rows: rows.length, noLogo: rows.filter((r) => !r.querySelector('.pg-row-logo')).length, bareRank: rows.filter((r) => { const k = r.querySelector('.pg-row-rank'); return k && /^(•|Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/.test((k.textContent || '').trim()); }).length }; });
      row('E-inbox.avatars', av.rows > 0 && av.noLogo === 0 && av.bareRank === 0, { ...av, shot: await L.shot(page, PHASE + '-inbox-avatars') });
      // swipe the probe group's row left → Mute → the engine says muted → swipe → Unmute
      await tryRow('E-inbox.07', async () => {
        const sel = await page.evaluate((needle) => { const r = Array.from(document.querySelectorAll('.ib-swfront, .ib-item')).find((e) => (e.textContent || '').includes(needle)); if (!r) return null; r.setAttribute('data-probe-row', '1'); return r.className; }, TAG + ' grp ' + RUN);
        if (!sel) throw new Error('probe group row not in the inbox');
        await swipeLeft(page, '[data-probe-row="1"]');
        const off = await page.evaluate(() => { const e = document.querySelector('[data-probe-row="1"]'); return e ? getComputedStyle(e).transform : null; });
        const shotSw = await L.shot(page, PHASE + '-swipe-open');
        const fgm = await page.evaluate(() => { const w = document.querySelector('[data-probe-row="1"]'); const s = w && w.closest('.ib-swipe'); const m = s && s.querySelector('.ib-swbtn-mute'); if (!m) return { found: false }; const r = m.getBoundingClientRect(); const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { found: true, w: Math.round(r.width), h: Math.round(r.height), atRest: !!t && (t === m || m.contains(t)), ok: !!t && (t === m || m.contains(t)) && r.width >= 24 && r.height >= 24 }; });
        page.__req = []; page.__resp = [];
        const btn = await page.evaluate(() => { const w = document.querySelector('[data-probe-row="1"]'); const s = w && w.closest('.ib-swipe'); const m = s && s.querySelector('.ib-swbtn-mute'); if (!m) return null; const r = m.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width }; });
        if (btn) { await page.mouse.click(btn.x, btn.y); await sleep(2000); }
        const muteResp = page.__resp.filter((r) => /mute/.test(r.url)).pop();
        const hist = await L.se('chat/history', { limit: 50, room: true }, amy.token);
        const h = (hist.json || []).find((x) => x.toRoomId === FX.room);
        const muted = !!(h && h.toRoom && h.toRoom.isMuted);
        if (muted) { await L.se('chat/rooms/mute', { roomId: FX.room, mute: false }, amy.token); }
        row('E-inbox.07', fgm.ok && !!btn && /matrix|translate/.test(String(off)) && muteResp && muteResp.status < 300 && muted, { finger: fgm, transform: off, muteButton: !!btn, muteRequest: muteResp, engineMuted: muted, shot: shotSw });
      });
      await cx.close();
    });
    await tryRow('E-chat-settings.members-gutter', async () => {
      const { page, ctx: cx } = await ctx(b, 'player-amy');
      await L.open(page, 'chat/index?room=' + FX.room); await sleep(1500);
      await clickAct(page, 'Chat settings');
      const m = await page.evaluate(() => { const e = Array.from(document.querySelectorAll('.cp-settings .pg-card-title')).find((x) => /Members/.test(x.textContent || '')); if (!e) return null; return { left: Math.round(e.getBoundingClientRect().left), text: e.textContent.trim() }; });
      row('E-chat-settings.members-gutter', !!m && m.left >= 12, { ...m, shot: await L.shot(page, PHASE + '-members-gutter') });
      await cx.close();
    });
    await tryRow('E-chat-room.08:brand-link', async () => {
      const { page, ctx: cx } = await ctx(b, 'player-amy');
      await page.evaluateOnNewDocument(() => { window.__opened = []; window.open = function (u) { window.__opened.push(String(u)); return null; }; });
      await L.open(page, 'chat/index?room=' + FX.room); await sleep(2000);
      await L.clickText(page, 'https://gripbat.com/how.html'); await sleep(1200);
      const opened = await page.evaluate(() => window.__opened || []);
      row('E-chat-room.08:brand-link', opened.length > 0 && opened[0].indexOf('https://uat.gripbat.com/') === 0, { opened, shot: await L.shot(page, PHASE + '-brand-link') });
      await cx.close();
    });
    await tryRow('notification-wrap', async () => {
      const { page, ctx: cx } = await ctx(b, 'player-amy');
      await L.open(page, 'notifications/index'); await sleep(2500);
      const found = (await T(page)).includes('Averyveryverylong');
      const over = await L.overflowRight(page);
      const doc = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      const longWord = await page.evaluate(() => Array.from(document.querySelectorAll('.nt-item')).some((e) => /\S{30,}/.test(e.innerText || '')));
      row('notification-wrap', (found || longWord) && !over.length && doc <= 1, { longBodyOnScreen: found, longUnbrokenWord: longWord, offScreen: over, docOverflowPx: doc, shot: await L.shot(page, PHASE + '-notif-wrap') });
      await cx.close();
    });
    // D-comp-detail.59 — the Congratulations popup: not over the page as it draws; once, a moment later
    await tryRow('D-comp-detail.59', async () => {
      const { page, ctx: cx } = await ctx(b, 'host-ken');
      await page.goto(L.APP + 'tournament/index?id=' + FX.comp + '&lang=en', { waitUntil: 'networkidle2', timeout: 60000 }).catch(() => undefined);
      await sleep(900);
      const early = await dialogUp(page);
      const shotEarly = await L.shot(page, PHASE + '-comp-early');
      await sleep(4500);
      const later = await dialogUp(page);
      const shotLater = await L.shot(page, PHASE + '-comp-later');
      await L.clickText(page, 'Cancel').catch(() => undefined); await sleep(800);
      await page.reload({ waitUntil: 'networkidle2' }).catch(() => undefined); await sleep(5000);
      const again = await dialogUp(page);
      row('D-comp-detail.59', !early && later && !again, { dialogAtFirstPaint: early, dialogAfterPause: later, dialogAgainAfterReload: again, shots: [shotEarly, shotLater] });
      await cx.close();
    });
    // GB-BRAND-BAKED-V1 — hkpl's tenant record unreadable: /app/ still GripBat (navy brand, no league home)
    await tryRow('brand-fallback', async () => {
      const cx = await b.createBrowserContext(); const page = await cx.newPage();
      await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
      await page.setRequestInterception(true);
      page.on('request', (r) => { const u = r.url(); if (/\/api\/v1\/(public\/homepage|tenant|public\/tenant-brand)(\?|$)/.test(u)) r.respond({ status: 503, contentType: 'application/json', body: '{"error":"probe: tenant down"}' }); else r.continue(); });
      await page.goto(L.APP + 'home/index?lang=en', { waitUntil: 'networkidle2', timeout: 60000 }).catch(() => undefined); await sleep(3000);
      const m = await page.evaluate(() => ({ brand: getComputedStyle(document.documentElement).getPropertyValue('--hk-brand').trim(), text: document.body.innerText.slice(0, 3000) }));
      const league = /League by the Numbers|LEAGUE MOMENTS|into one league/i.test(m.text);
      row('brand-fallback', /^#0b192c$/i.test(m.brand) && !league, { brand: m.brand, leagueHome: league, shot: await L.shot(page, PHASE + '-brand-fallback') });
      await cx.close();
    });
    // league words — GripBat standings is not "League Standings"
    await tryRow('league-words', async () => {
      const { page, ctx: cx } = await ctx(b, null);
      await L.open(page, 'standings/index'); await sleep(1000);
      const t = await T(page);
      row('league-words', !/league standings|the league posts|your league|此聯賽/i.test(t), { head: t.slice(0, 200), shot: await L.shot(page, PHASE + '-standings') });
      await cx.close();
    });

    // ======================== the rows that need M1 ENDED (15 min) ========================
    const endAt = FX.m1Start + 15 * 60e3 + 20e3; const w2 = endAt - Date.now();
    if (!ONLY && w2 > 0) { console.log('waiting', Math.round(w2 / 1000), 's for M1 to end'); await sleep(w2); }
    // E-chat-room.01 — Ken reads Mei's exact "Active N ago" in the chat header (Mei untouched for ≥ 15 min); 繁 too
    for (const lang of ['en', 'zh_Hant']) await tryRow('E-chat-room.01:' + lang, async () => {
      const { page, ctx: cx } = await ctx(b, 'host-ken', lang);
      await L.open(page, 'chat/index?user=' + mei.userId, lang); await sleep(2000);
      const head = await page.evaluate(() => { const h = document.querySelector('.ah, header, [class*="app-header"]'); return (h ? h.innerText : document.body.innerText.slice(0, 200)).replace(/\s+/g, ' '); });
      const ok = lang === 'en' ? /Active \d+(m|h) ago/i.test(head) : /\d+ (分鐘|小時)前在線/.test(head);
      row('E-chat-room.01:' + lang, ok, { head: head.slice(0, 160), minutesSinceMeiSet: Math.round((Date.now() - (R.fx.meiPrefSetAt || T0)) / 60000), shot: await L.shot(page, PHASE + '-presence-' + lang) });
      await cx.close();
    });
    // C-home.03 — the host's (Mei's) Home card → ONE tap on Give kudos → the grid (not the Participants tab)
    await tryRow('C-home.03', async () => {
      const { page, ctx: cx } = await ctx(b, 'clubowner-mei');
      try { await page.evaluate(() => { try { localStorage.removeItem('gb_kudos_thanks_dismissed'); } catch (e) { /* */ } }); } catch (e) { /* */ }
      await L.open(page, 'home/index'); await sleep(800);   // a reader taps within a couple of seconds
      const card = /Thank you for hosting!/.test(await T(page));
      const fg = await finger(page, '.kc-box .hk-btn', 'Give kudos');
      page.__req = [];
      const box = await page.evaluate(() => { const bx = Array.from(document.querySelectorAll('.kc-box')).find((x) => /Thank you for/.test(x.textContent || '')); const bt = bx && Array.from(bx.querySelectorAll('.hk-btn')).find((x) => /Give kudos/.test(x.textContent || '')); if (!bt) return null; bt.scrollIntoView({ block: 'center' }); const r = bt.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
      if (box) { await page.mouse.click(box.x, box.y); }
      await sleep(4500);
      const url = page.url(); const t = await T(page);
      const grid = /Tap on anyone to give kudos/.test(t) && /GIVE KUDOS/i.test(t);
      row('C-home.03', fg.ok && card && !!box && grid && /tab=kudos/.test(url) && !/tab=participants/.test(url), { finger: fg, card, oneTap: !!box, url: url.replace(L.APPHOST, ''), gridOpen: grid, shot: await L.shot(page, PHASE + '-home-give') });
      await cx.close();
    });
    // A-give-meet-kudos.02 — the Kudos tab under Give kudos no longer sends you to Participants
    await tryRow('A-give-meet-kudos.02', async () => {
      const { page, ctx: cx } = await ctx(b, 'clubadmin-tom');
      await L.open(page, 'meet/index?id=' + FX.m1 + '&tab=kudos'); await sleep(2500);
      const t = await T(page);
      row('A-give-meet-kudos.02', /Tap Give kudos to thank the players you played with/.test(t) && !/Open Participants and tap a player/.test(t), { line: (t.match(/You have not given kudos[^\n]*/) || [''])[0], shot: await L.shot(page, PHASE + '-kudos-tab') });
      await cx.close();
    });
  } catch (e) {
    R.errors.push('FATAL ' + (e && e.stack || e)); console.log('FATAL', e && e.stack || e);
  } finally {
    // ======================== cleanup (API only) ========================
    const C = R.cleanup;
    try { if (FX.awardMonth) { const r = await L.se('stats/kudos-awards/sandbox-date', { meetId: FX.ma, targetUserId: amy.userId, clearMonth: FX.awardMonth }, adm.token); C.award = r.status + ' ' + JSON.stringify(r.json); } } catch (e) { C.award = 'ERR ' + e.message; }
    try { await L.se('i/gb-prefs', { lastActiveExact: false }, mei.token); C.meiPref = (await L.se('i/gb-prefs', {}, mei.token)).json; } catch (e) { C.meiPref = 'ERR ' + e.message; }
    for (const [who, tok] of Object.entries(HOST).map(([k, v]) => [k, v.token])) {
      for (const m of FX.meets || []) {
        try { const g = await L.se('meets/reviews/list', { direction: 'given', meetId: m.id, limit: 20 }, tok); for (const rv of ((g.json && g.json.rows) || [])) if (rv && rv.id) { const d = await L.se('meets/reviews/delete', { reviewId: rv.id }, tok); C['rv ' + rv.id] = d.status; } } catch (e) { C['rv ' + who] = 'ERR ' + e.message; }
      }
    }
    for (const m of FX.meets || []) { const tok = HOST[m.host].token; const sh = await L.se('meets/show', { meetId: m.id }, tok).catch(() => ({})); const cn = await L.se('meets/cancel', { meetId: m.id }, tok).catch((e) => ({ status: 'ERR' })); const d = await L.se('meets/delete', { meetId: m.id }, tok).catch((e) => ({ status: 'ERR' })); const rm = sh.json && sh.json.chatRoomId ? await L.se('chat/rooms/delete', { roomId: sh.json.chatRoomId }, tok).catch(() => ({ status: 'ERR' })) : { status: 'none' }; C['meet ' + m.id] = 'cancel ' + cn.status + ' delete ' + d.status + ' room ' + rm.status; }
    if (FX.comp) C.comp = (await L.se('competitions/delete', { competitionId: FX.comp }, ken.token).catch((e) => ({ status: 'ERR' }))).status;
    if (FX.room) C.room = (await L.se('chat/rooms/delete', { roomId: FX.room }, HOST[process.env.ROOM_OWNER || 'tom'].token).catch((e) => ({ status: 'ERR' }))).status;
    const left = await L.se('stats/kudos-awards', { userId: amy.userId, limit: 12 }, amy.token).catch(() => null);
    C.awardsLeftForAmy = left && left.json && left.json.awards ? left.json.awards.length : 'unknown';
    if (b) await b.close().catch(() => undefined);
    R.minutes = Math.round((Date.now() - T0) / 60000);
    fs.writeFileSync(OUT, JSON.stringify(R, null, 1));
    console.log('wrote', OUT, 'rows', Object.keys(R.rows).length, 'pass', Object.values(R.rows).filter((x) => x.ok).length, 'cleanup', JSON.stringify(C).slice(0, 600));
  }
})();

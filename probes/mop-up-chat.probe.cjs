// mop-up-chat probe (lane mop-up, sub-lane mop-up-chat, 2026-09-24). UAT only, 390 px, https://uat.gripbat.com/app/.
//   PHASE=before  — the planted faults against the build that is live BEFORE the app fix (expect the bugs to show)
//   PHASE=after   — the same forcing + N unforced runs against the fixed build; writes mop-up-chat.verdict.json
//   ONLY=1,2,3,4  N3=10 N4=10
// Items:
//   1 E-chat-room.08 mention notification (engine ChatService.notifyRoomMentions + app notificationRoute / NOTIF_HEAD)
//   2 D-street-cred-by-activity.02 Load more (fixture: 33 [probe] activities with a kudos for Ken, SQL on se_sbx, cleaned)
//   3 "Could not load this lesson" right after sign-in (forcing: request interception answers 503 to the lesson reads)
//   4 club owner composer missing "Announcement" (forcing: the whoami 502 / clubs/settings/show 503)
// Every fixture is "[probe] mop-up-chat …" and removed in finally; notifications the probe caused are XDEL'd from redis.
// @claims notification chat-mention :: mop-up-chat
// @claims route pages/lesson/index :: mop-up-chat :: transient
// @claims route pages/feed/index :: mop-up-chat :: composer-admin
// @claims route pages/my-stats/index :: mop-up-chat :: by-activity-paging
'use strict';
process.env.MU_SHOTS = process.env.MU_SHOTS || '/root/social-engine/probes/mop-up-chat-shots';
const fs = require('fs');
const { execFileSync } = require('child_process');
const MU = require('/root/gen/mop-up/mu-lib.cjs');
const PHASE = process.env.PHASE || 'after';
const ONLY = (process.env.ONLY || '1,2,3,4').split(',');
const N3 = Number(process.env.N3 || 10), N4 = Number(process.env.N4 || 10);
const TS = Date.now().toString(36);
const TAG = '[probe] mop-up-chat ' + TS;
const CLUB = 'ari4he5s3hac000m';       // UAT Paddle Club — owner clubowner-mei (read only: the composer is opened, nothing posted)
const LESSON = 'ari4jxdx3hac00ba';     // Beginners' Group Clinic — Mei's (read only)
const LOGINS = JSON.parse(fs.readFileSync('/root/uat-native-logins.json', 'utf8'));
const OUT = '/root/social-engine/probes/mop-up-chat' + (PHASE === 'after' ? '' : '.' + PHASE);
const sleep = MU.sleep;
const checks = []; const evidence = []; const cleanupLog = []; let cleanupFailed = false;
function add(item, name, pass, ev) { checks.push({ item, name, pass: !!pass, evidence: ev }); console.log((pass ? 'PASS ' : 'FAIL ') + item + ' ' + name + ' — ' + JSON.stringify(ev).slice(0, 300)); }
async function api(ep, body, tok) { const r = await fetch(MU.APPHOST + '/api/' + ep, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...(tok ? { i: tok } : {}), ...body }) }); let j = null; try { j = await r.json(); } catch (e) { /* 204 */ } return { s: r.status, j }; }
function psql(sql) { return execFileSync('docker', ['exec', '-i', 'social-engine-db-1', 'psql', '-U', 'social', '-d', 'se_sbx', '-tAq', '-v', 'ON_ERROR_STOP=1'], { input: sql }).toString().trim(); }
function redis(args) { return execFileSync('docker', ['exec', 'social-engine-redis-1', 'redis-cli', '-n', '1', ...args]).toString(); }
const txt = (p) => MU.text(p);
async function domClick(page, re, scope) { return page.evaluate((src, flags, scope) => { const re = new RegExp(src, flags); const els = Array.from(document.querySelectorAll(scope || '*')).filter((e) => e.children.length <= 2 && re.test((e.innerText || '').trim())); const el = els[els.length - 1]; if (!el) return false; el.click(); return true; }, re.source, re.flags, scope || null); }

/** Planted fault: answer `status` to the first n requests matching (n < 0 = every one) — puppeteer interception. */
async function force(page, rules) {
  page.__forced = rules.map((r) => ({ ...r, fired: 0 }));
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    if (req.isInterceptResolutionHandled && req.isInterceptResolutionHandled()) return;
    const u = req.url();
    for (const r of page.__forced) {
      if (!r.off && r.re.test(u) && (!r.urlRe || r.urlRe.test(page.url())) && (!r.bodyRe || r.bodyRe.test(req.postData() || '')) && (r.n < 0 || r.fired < r.n)) {
        r.fired++;
        return req.respond({ status: r.status, contentType: 'application/json', body: JSON.stringify({ error: { code: 'PROBE_FORCED', message: 'planted by mop-up-chat' } }) });
      }
    }
    return req.continue();
  });
}
const fired = (page) => (page.__forced || []).map((r) => r.label + ' x' + r.fired);

// ============================================================================================ persona facts (live, not cached)
async function persona(k) { const s = await MU.who(k); const me = await api('i', {}, s.token); if (me.s !== 200) throw new Error('i for ' + k + ' -> ' + me.s); return { key: k, token: s.token, id: me.j.id, username: me.j.username, name: me.j.name || me.j.username }; }

// ============================================================================================ 1. mention notification
async function item1(b, P) {
  const I = 'E-chat-room.08';
  const { mei, ken, amy } = P;
  const notifs = async (p) => ((await api('i/notifications', { limit: 50, markAsRead: false }, p.token)).j || []);
  const withTag = (list, tag) => list.filter((n) => JSON.stringify([n.header, n.body]).includes(tag || TAG));
  let roomId = null, meetId = null;
  try {
    const room = await api('chat/rooms/create', { name: TAG + ' room' }, mei.token); roomId = room.j && room.j.id;
    const inv = await api('chat/rooms/invitations/create', { roomId, userId: ken.id }, mei.token);
    const jn = await api('chat/rooms/join', { roomId }, ken.token);
    const mem = psql(`select string_agg("userId", ',') from chat_room_membership where "roomId" = '${roomId}';`);
    add(I, 'fixture real: [probe] room owned by Mei, Ken a member, Amy not (read back from chat_room_membership)', room.s === 200 && jn.s === 204 && mem.includes(ken.id) && !mem.includes(amy.id), { roomId, create: room.s, invite: inv.s, join: jn.s, members: mem });
    // A — Mei mentions Ken (member), Amy (NOT a member) and herself, by username
    const t1 = TAG + ' A hi @' + ken.username + ' @' + amy.username + ' @' + mei.username + '!';
    const s1 = await api('chat/messages/create-to-room', { toRoomId: roomId, text: t1 }, mei.token);
    await sleep(3500);
    const kA = withTag(await notifs(ken), TAG + ' A'), aA = withTag(await notifs(amy), TAG), mA = withTag(await notifs(mei), TAG + ' A');
    const hdr = mei.name + ' mentioned you in ' + TAG + ' room';
    add(I, 'API: Mei writes "@ken @amy @mei" in the room -> Ken gets exactly one app notification, header "' + hdr + '", link chat:<room>, notifier = Mei', s1.s === 200 && kA.length === 1 && kA[0].header === hdr && kA[0].link === 'chat:' + roomId && kA[0].user && kA[0].user.id === mei.id, { send: s1.s, ken: kA.map((n) => ({ header: n.header, body: n.body, link: n.link, user: n.user && n.user.id })) });
    add(I, 'API: a non-member @mention does not leak (Amy: 0 notifications carrying the tag)', aA.length === 0, { amy: aA.length });
    add(I, 'API: a self-mention does not notify (Mei: 0)', mA.length === 0, { mei: mA.length });
    // B — Ken mentions Mei by DISPLAY NAME as the app's picker writes it (spaces removed)
    const t2 = TAG + ' B @' + mei.name.replace(/\s+/g, '') + ' see you';
    await api('chat/messages/create-to-room', { toRoomId: roomId, text: t2 }, ken.token); await sleep(3500);
    const mB = withTag(await notifs(mei), TAG + ' B');
    add(I, 'API: a mention by squashed display name ("@' + mei.name.replace(/\s+/g, '') + '") notifies Mei once', mB.length === 1 && mB[0].link === 'chat:' + roomId, { mei: mB.map((n) => n.header) });
    // C — planted: the check can read 0 (an @name nobody in the room carries)
    await api('chat/messages/create-to-room', { toRoomId: roomId, text: TAG + ' C @nobody_' + TS }, mei.token); await sleep(3000);
    add(I, 'self-test: a mention of a name nobody in the room carries notifies nobody (the counter can read 0)', withTag(await notifs(ken), TAG + ' C').length === 0 && withTag(await notifs(amy), TAG + ' C').length === 0, {});
    // D — a meet's room: link meetchat:<meet> (opens the meet's Chat tab)
    const start = new Date(Date.now() + 3 * 86400e3).toISOString();
    const mt = await api('meets/create', { name: TAG + ' meet', startAt: start, durationMinutes: 60, capacity: 4, autoApprove: true, visibility: 'public', sendNotifications: false }, ken.token); meetId = mt.j && mt.j.id;
    const mj = await api('meets/join', { meetId }, mei.token);
    const ms = await api('meets/show', { meetId }, ken.token); const meetRoom = ms.j && ms.j.chatRoomId;
    if (meetRoom) {
      await api('chat/messages/create-to-room', { toRoomId: meetRoom, text: TAG + ' D @' + ken.username + ' court 3?' }, mei.token); await sleep(3500);
      const kD = withTag(await notifs(ken), TAG + ' D');
      add(I, 'API: in a MEET room the mention links meetchat:<meet> (the meet\'s Chat tab)', kD.length === 1 && kD[0].link === 'meetchat:' + meetId && kD[0].header === mei.name + ' mentioned you in ' + TAG + ' meet', { create: mt.s, join: mj.s, meetRoom, ken: kD.map((n) => [n.header, n.link]) });
    } else add(I, 'API: meet room mention', false, { create: mt.s, join: mj.s, note: 'meet has no chatRoomId', show: ms.s });
    if (PHASE !== 'after') return;
    // E — L6: Mei types "@Ke", picks Ken from the member suggestions, sends — the real UI path
    { const { ctx, page } = await MU.newCtx(b, 'clubowner-mei', 390);
      try {
        await MU.open(page, 'chat/index?room=' + roomId);
        await page.click('.ct-input input').catch(() => undefined);
        await page.type('.ct-input input', '@' + ken.name.slice(0, 2), { delay: 60 });
        await page.waitForSelector('.ct-mention', { timeout: 8000 }).catch(() => undefined);
        const sug = await page.$$eval('.ct-mention', (els) => els.map((e) => (e.innerText || '').trim()));
        const picked = await domClick(page, new RegExp('^' + ken.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), '.ct-mention');
        await sleep(400); await page.type('.ct-input input', TAG + ' E ui ping', { delay: 20 }); await page.keyboard.press('Enter'); await sleep(3500);
        const sent = page.__req.filter((r) => /chat\/messages\/create-to-room/.test(r.url)).map((r) => JSON.parse(r.body).text);
        const shot = await MU.shot(page, 'i1-mei-mention-sent');
        const kE = withTag(await notifs(ken), TAG + ' E');
        add(I, 'L6 UI (Mei, 390 px): "@" + 2 letters offers Ken, the pick writes "@' + ken.name.replace(/\s+/g, '') + '", Enter sends it, and Ken is notified (read back as Ken)', picked && sent.length === 1 && sent[0].startsWith('@' + ken.name.replace(/\s+/g, '')) && kE.length === 1, { suggestions: sug, sent, kenGot: kE.map((n) => n.header), shot });
      } finally { await ctx.close(); } }
    // F — L6: Ken's Notifications (Inbox) shows it in his language, the tap opens the room
    for (const [lang, want] of [['en', mei.name + ' mentioned you in ' + TAG + ' room'], ['zh_Hant', mei.name + ' 在「' + TAG + ' room」提及了你'], ['zh_Hans', mei.name + ' 在「' + TAG + ' room」提到了你']]) {
      const { ctx, page } = await MU.newCtx(b, 'host-ken', 390);
      try {
        await MU.open(page, 'notifications/index', lang); const t = await txt(page); const shot = await MU.shot(page, 'i1-ken-inbox-' + lang);
        let opened = null;
        if (lang === 'en') { const ok = await domClick(page, new RegExp(want.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), '.nt-item *'); await sleep(2500); opened = { clicked: ok, url: page.url().replace(MU.APPHOST, '') }; await MU.shot(page, 'i1-ken-tap-opens-room'); }
        add(I, 'L6 UI (Ken, 390 px, ' + lang + '): the Notifications row reads "' + want + '"' + (lang === 'en' ? ' and the tap opens /pages/chat/index?room=<room>' : ''), t.includes(want) && (lang !== 'en' || (opened && opened.url.includes('/pages/chat/index?room=' + roomId))), { opened, shot });
      } finally { await ctx.close(); }
    }
  } finally {
    const c = [];
    if (roomId) c.push('room ' + (await api('chat/rooms/delete', { roomId }, mei.token)).s);
    if (meetId) { const d = await api('meets/delete', { meetId }, ken.token); c.push('meet delete ' + d.s); if (d.s >= 300) c.push('meet cancel ' + (await api('meets/cancel', { meetId }, ken.token)).s); }
    // the notifications this probe caused (their header/body carry the tag) are removed from the three inboxes
    let x = 0;
    for (const p of [ken, mei, amy]) {
      const key = 'uat.social.silkvo.com:notificationTimeline:' + p.id;
      const raw = redis(['XREVRANGE', key, '+', '-', 'COUNT', '200']).split('\n');
      for (let i = 0; i < raw.length; i++) if (/^\d+-\d+$/.test(raw[i].trim()) && raw[i + 2] && raw[i + 2].includes(TAG)) { redis(['XDEL', key, raw[i].trim()]); x++; }
    }
    c.push('notifications removed ' + x);
    cleanupLog.push('item1: ' + c.join(' · '));
    const j = c.join(' · '); if (/room [45]\d\d/.test(j) || (/meet delete [45]\d\d/.test(j) && !/meet cancel 20\d/.test(j))) cleanupFailed = true;
  }
}

// ============================================================================================ 2. By activity: Load more
async function item2(b, P) {
  const I = 'D-street-cred-by-activity.02';
  const { mei, ken, tom } = P;
  const ids = [];
  try {
    const rows = []; const revs = [];
    for (let i = 1; i <= 33; i++) {
      const id = 'zmuc' + TS.slice(-6) + String(i).padStart(3, '0'); ids.push(id);
      const at = new Date(Date.now() - i * 86400e3 + 3600e3).toISOString();
      rows.push(`('${id}', 'MU${TS.slice(-5)}${i}', '${mei.id}', '${TAG.replace(/'/g, "''")} kudos ${String(i).padStart(2, '0')}', '${at}', 60, 'private', 'active')`);
      revs.push(`('${id}r', '${i % 2 ? mei.id : tom.id}', '${ken.id}', '${id}', 'endorsement', 'On time', now())`);
    }
    psql(`insert into meet (id, "referenceCode", "hostId", name, "startAt", "durationMinutes", visibility, status) values ${rows.join(',')};\ninsert into meet_review (id, "authorId", "targetUserId", "meetId", type, body, "createdAt") values ${revs.join(',')};`);
    const n = psql(`select count(*) from meet_review r join meet m on m.id = r."meetId" where m.id like 'zmuc${TS.slice(-6)}%' and r."targetUserId" = '${ken.id}';`);
    const p0 = await api('stats/kudos-by-activity', { timeframe: 'LAST_3_MONTHS', offset: 0, limit: 30 }, ken.token);
    const p1 = await api('stats/kudos-by-activity', { timeframe: 'LAST_3_MONTHS', offset: 30, limit: 30 }, ken.token);
    const total = p0.j && p0.j.activitiesTotal;
    const k0 = (p0.j.activities || []).map((a) => a.meetId || a.competitionId), k1 = (p1.j.activities || []).map((a) => a.meetId || a.competitionId);
    add(I, 'fixture real: 33 [probe] activities with a kudos for Ken; the engine pages them (offset 0 -> 30 rows, offset 30 -> the rest, no overlap)', n === '33' && total >= 33 && k0.length === 30 && k1.length === total - 30 && !k1.some((k) => k0.includes(k)), { reviews: n, activitiesTotal: total, page0: k0.length, page1: k1.length });
    const { ctx, page } = await MU.newCtx(b, 'host-ken', 390);
    try {
      await MU.open(page, 'my-stats/index?pane=board');
      await domClick(page, /^By activity$/, '.ys-chip'); await sleep(3000);
      const before = await page.$$eval('.ys-chip', () => 0).catch(() => 0);
      const rowsOf = () => page.evaluate(() => Array.from(document.querySelectorAll('.hk-row, [class*="row-name"], .ui-row')).length);
      const names0 = await page.evaluate((tag) => (document.body.innerText.match(new RegExp(tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' kudos \\d\\d', 'g')) || []), TAG);
      const hasMore = /Load more/.test(await txt(page)); await MU.shot(page, 'i2-by-activity-first-page');
      page.__req = [];
      // a person double-taps: two real DOM clicks in the same tick
      await page.evaluate(() => { const b = Array.from(document.querySelectorAll('*')).filter((e) => (e.innerText || '').trim() === 'Load more' && e.children.length <= 2).pop(); if (b) { b.click(); b.click(); } });
      await sleep(3500);
      const reqs = page.__req.filter((r) => /stats\/kudos-by-activity/.test(r.url)).map((r) => { const j = JSON.parse(r.body); return { offset: j.offset, limit: j.limit }; });
      const names1 = await page.evaluate((tag) => (document.body.innerText.match(new RegExp(tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' kudos \\d\\d', 'g')) || []), TAG);
      const dup = names1.length - new Set(names1).size;
      const shot = await MU.shot(page, 'i2-by-activity-after-load-more');
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await MU.shot(page, 'i2-by-activity-bottom');
      const noMore = !/Load more/.test(await txt(page));
      add(I, 'L6 UI (Ken, 390 px): By activity shows the first page with "Load more"; a (double) tap sends ONE request with offset = rows on screen, appends the rest, 0 duplicates, and the button goes away', hasMore && reqs.length === 1 && reqs[0].offset === 30 && dup === 0 && names1.length === 33 && noMore, { firstPageTagRows: names0.length, requests: reqs, tagRowsAfter: names1.length, duplicates: dup, loadMoreGone: noMore, shot, rowsHint: before && (await rowsOf()) });
    } finally { await ctx.close(); }
  } finally {
    try { psql(`delete from meet_review where "meetId" like 'zmuc${TS.slice(-6)}%'; delete from meet where id like 'zmuc${TS.slice(-6)}%';`); const left = psql(`select count(*) from meet where id like 'zmuc${TS.slice(-6)}%';`); cleanupLog.push('item2: fixture meets left ' + left); if (left !== '0') cleanupFailed = true; } catch (e) { cleanupFailed = true; cleanupLog.push('item2 cleanup FAILED ' + e.message); }
  }
}

// ============================================================================================ 3. lesson right after sign-in
async function signInTo(b, next, rules) {
  const ctx = await b.createBrowserContext(); const page = await ctx.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  page.__api = []; page.on('response', (r) => { if (/\/api\//.test(r.url())) page.__api.push(r.url().replace(/^https:\/\/[^/]+/, '').replace(/\?.*/, '') + ' ' + r.status()); });
  if (rules) await force(page, rules.map((r) => (r.anyPage ? r : { ...r, urlRe: /\/pages\/lesson\// })));   // armed only once the lesson page is the page (anyPage: from the first load)
  await page.goto(MU.APP + 'signin/index?lang=en&next=' + encodeURIComponent(next), { waitUntil: 'networkidle2', timeout: 60000 }).catch(() => undefined);
  await page.evaluate(() => { try { localStorage.setItem('hkpl_lang_ok', JSON.stringify({ data: '1' })); } catch (e) { /* */ } });
  const P = LOGINS['host-ken'];
  await page.type('input[type=email]', P.email); await page.type('input[type=password]', P.password);
  await page.evaluate(() => { const b = document.querySelector('.si-submit'); if (b) b.click(); });
  await page.waitForFunction(() => /\/pages\/lesson\//.test(location.pathname), { timeout: 30000 }).catch(() => null);
  return { ctx, page };
}
const lessonState = async (page, ms = 20000) => { await MU.waitText(page, /Could not load this lesson|This lesson slot was not found|Coaching lessons are not available|section isn.t available|Beginners' Group Clinic/, ms); await sleep(800); const t = await txt(page); return /section isn.t available/.test(t) ? 'unavailable' : /Could not load this lesson/.test(t) ? 'error' : /slot was not found/.test(t) ? 'notfound' : /not available yet/.test(t) ? 'off' : /Beginners' Group Clinic/.test(t) ? 'ok' : 'unknown'; };
async function item3(b) {
  const I = 'lesson-after-signin';
  const next = '/pages/lesson/index?id=' + LESSON;
  const scen = [
    { key: 'F1', label: 'coaches/schedules/show 503 once', rules: [{ label: 'schedules/show', re: /\/api\/coaches\/schedules\/show$/, n: 1, status: 503 }], before: 'notfound', after: 'ok' },
    { key: 'F2', label: 'the coaching gate (endpoint coaches/schedules/of-user) 503 once', rules: [{ label: 'gate', re: /\/api\/endpoint$/, bodyRe: /coaches\/schedules\/of-user/, n: 1, status: 503 }], before: 'off', after: 'ok' },
    { key: 'F3', label: 'adapter-style 429 on the whoami (i) twice', rules: [{ label: 'i', re: /\/api\/i$/, n: 2, status: 429 }], before: 'ok', after: 'ok' },
    { key: 'F4', label: 'coaches/schedules/show 503 every time, then released and Retry pressed', rules: [{ label: 'schedules/show', re: /\/api\/coaches\/schedules\/show$/, n: -1, status: 503 }], before: 'notfound', after: 'error->ok' },
    { key: 'F5', label: 'hkpl down for the whole visit (v1/tenant, public/homepage, public/tenant-brand 502 — as at 16:28 during an hkpl restart)', rules: [{ label: 'hkpl tenant reads', re: /\/api\/v1\/(tenant|public\/homepage|public\/tenant-brand)(\?|$)/, n: -1, status: 502, anyPage: true }], before: 'unavailable', after: 'ok' },
  ];
  const SC = process.env.SCEN ? process.env.SCEN.split(',') : null;
  for (const sc of scen.filter((x) => !SC || SC.includes(x.key))) {
    const { ctx, page } = await signInTo(b, next, sc.rules);
    try {
      let st = await lessonState(page);
      if (sc.key === 'F4' && st === 'error') { page.__forced.forEach((r) => { r.off = true; }); await domClick(page, /^Retry$/); st = 'error->' + await lessonState(page); }
      const shot = await MU.shot(page, 'i3-' + PHASE + '-' + sc.key);
      const want = PHASE === 'after' ? sc.after : sc.before;
      add(I, (PHASE === 'after' ? '' : 'BEFORE (planted) ') + sc.key + ' ' + sc.label + ' -> ' + want, st === want && page.__forced.some((r) => r.fired > 0), { state: st, fired: fired(page), url: page.url().replace(MU.APPHOST, ''), shot });
      if (sc.key === 'F5') { const bar = await page.evaluate(() => Array.from(document.querySelectorAll('.hk-tabbar *, [class*="tabbar"] *')).map((e) => (e.innerText || '').trim()).filter(Boolean).join(' | ')); const league = /Standings|Schedule/.test(bar); add(I, (PHASE === 'after' ? '' : 'BEFORE (planted) ') + 'F5 the tab bar is GripBat\'s (Discover / Inbox), not the league\'s (Schedule / Standings)', PHASE === 'after' ? !league && /Inbox/.test(bar) : league, { bar: bar.slice(0, 200) }); }
    } finally { await ctx.close(); }
  }
  if (PHASE !== 'after' || SC) return;
  const runs = [];
  for (let i = 0; i < N3; i++) {
    const { ctx, page } = await signInTo(b, next, null);
    try { const st = await lessonState(page); const bad = page.__api.filter((x) => !/ 2\d\d$| 304$/.test(x)); runs.push({ i, state: st, sso: page.__api.filter((x) => /adapter\/sso/.test(x)).length, bad }); if (st !== 'ok') await MU.shot(page, 'i3-unforced-' + i); } finally { await ctx.close(); }
  }
  add(I, 'unforced: ' + N3 + ' fresh sign-ins straight to the lesson page all load it; adapter/sso is never called (the door that 429d is gone from /app/)', runs.every((r) => r.state === 'ok' && r.sso === 0), { ok: runs.filter((r) => r.state === 'ok').length + '/' + N3, runs });
}

// ============================================================================================ 4. owner composer Announcement
async function composerRun(b, rules) {
  const { ctx, page } = await MU.newCtx(b, 'clubowner-mei', 390);
  if (rules) await force(page, rules);
  const t0 = Date.now();
  await page.goto(MU.APP + 'feed/index?club=' + CLUB + '&compose=1&lang=en', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => undefined);
  const found = await MU.waitText(page, /Announcement/, 12000);
  const t = await txt(page);
  return { ctx, page, found: !!found, ms: Date.now() - t0, composer: /Post to/.test(t) };
}
async function item4(b) {
  const I = 'owner-composer-announcement';
  const scen = [
    { key: 'G1', label: 'the whoami (i) 502 twice — as at 2026-09-24 14:28:12', rules: [{ label: 'i', re: /\/api\/i$/, n: 2, status: 502 }] },
    { key: 'G2', label: 'clubs/settings/show 503 once', rules: [{ label: 'settings/show', re: /\/api\/clubs\/settings\/show$/, n: 1, status: 503 }] },
  ];
  for (const sc of scen) {
    const r = await composerRun(b, sc.rules);
    try {
      const shot = await MU.shot(r.page, 'i4-' + PHASE + '-' + sc.key);
      const want = PHASE === 'after';
      add(I, (PHASE === 'after' ? '' : 'BEFORE (planted) ') + sc.key + ' ' + sc.label + ' -> Announcement ' + (want ? 'offered' : 'MISSING'), r.found === want && r.page.__forced.some((x) => x.fired > 0), { found: r.found, composerShown: r.composer, ms: r.ms, fired: fired(r.page), shot });
    } finally { await r.ctx.close(); }
  }
  if (PHASE !== 'after') return;
  const runs = [];
  for (let i = 0; i < N4; i++) { const r = await composerRun(b, null); runs.push({ i, found: r.found, ms: r.ms }); if (!r.found) await MU.shot(r.page, 'i4-unforced-miss-' + i); await r.ctx.close(); }
  add(I, 'unforced: ' + N4 + ' fresh opens of the owner\'s composer all offer Announcement', runs.every((r) => r.found), { ok: runs.filter((r) => r.found).length + '/' + N4, ms: runs.map((r) => r.ms) });
}

// ============================================================================================ main
(async () => {
  const b = await MU.browser();
  let P = null;
  try {
    P = { mei: await persona('clubowner-mei'), ken: await persona('host-ken'), amy: await persona('player-amy'), tom: await persona('clubadmin-tom') };
    if (ONLY.includes('1')) await item1(b, P).catch((e) => add('E-chat-room.08', 'item 1 ran', false, { error: e.message }));
    if (ONLY.includes('2')) await item2(b, P).catch((e) => add('D-street-cred-by-activity.02', 'item 2 ran', false, { error: e.message }));
    if (ONLY.includes('3')) await item3(b).catch((e) => add('lesson-after-signin', 'item 3 ran', false, { error: e.message }));
    if (ONLY.includes('4')) await item4(b).catch((e) => add('owner-composer-announcement', 'item 4 ran', false, { error: e.message }));
  } finally { await b.close(); }
  // the historical facts behind items 3 and 4 (nginx access log, read at run time while the files exist)
  const logs = ['/var/log/nginx/access.log', '/var/log/nginx/access.log.1'].filter((f) => fs.existsSync(f));
  const grepLog = (needle, also) => { try { return execFileSync('grep', ['-hF', needle, ...logs]).toString().split('\n').filter((l) => l && (!also || also.every((a) => l.includes(a)))).slice(0, 4).map((l) => l.slice(0, 260)); } catch (e) { return []; } };
  evidence.push({ item: 'lesson-after-signin', what: 'the failing stranger run 2026-09-23 16:31:58 HKT: adapter/sso answered 429 on the lesson page', lines: grepLog('23/Sep/2026:16:31:58', ['adapter/sso', 'lesson']) });
  evidence.push({ item: 'owner-composer-announcement', what: 'the failing U12a run 2026-09-24 14:28:12 HKT: the whoami answered 502; no clubs/settings/show and no competitions/list followed (the composer never mounted)', lines: grepLog('24/Sep/2026:14:28:1', ['compose=1', '"https://uat.gripbat.com/app/pages/feed']).filter((l) => /^47/.test(l)) });
  const byItem = {};
  for (const c of checks) (byItem[c.item] = byItem[c.item] || []).push(c);
  const rows = Object.entries(byItem).map(([item, cs]) => ({ item, status: cs.every((c) => c.pass) ? 'closed' : 'still-open', level: cs.every((c) => c.pass) ? (item === 'E-chat-room.08' || PHASE === 'after' ? 'L6' : 'L5') : 'below L6', evidence: cs.map((c) => (c.pass ? 'PASS ' : 'FAIL ') + c.name) }));
  const v = { id: 'mop-up-chat', phase: PHASE, at: new Date().toISOString(), condition_fired: checks.length > 0, verdict: checks.length ? (checks.every((c) => c.pass) ? 'pass' : 'fail') : 'no_verdict', cleanup: cleanupFailed ? 'CLEANUP FAILED — see cleanupLog' : 'ok', cleanupLog, rows, evidence: [...evidence, ...checks] };
  fs.writeFileSync(OUT + '.verdict.json', JSON.stringify(v, null, 1));
  console.log('verdict', v.verdict, '· cleanup', v.cleanup, '·', OUT + '.verdict.json');
})().catch((e) => { console.error(e); process.exit(1); });

// CLUB-V3 probe (ON kaka, against https://uat.social.silkvo.com — the UAT personas; engine API + headless Chrome).
// Proves PARITY.md rows 104 / 106 / 109 / 113 / 115 / 117 / 118 and the schedule row (40) on the DEPLOYED app + engine:
//   1 pin toggles the Home row      mei: clubs/me/update {pinned} → clubs/mine pinned; the Home crest row marks the club
//   2 take a break hides tom        tom: paused → amy (member, not admin) does not see tom on clubs/members; mei sees paused:true
//   3 Tuesday schedule, 3-day lead  mei: clubs/schedules/create → clubs/schedules/run → a meet exists iff the occurrence is
//                                   inside 72 h; lead → 2 weeks → run → the meet exists (seriesId = schedule), tom invited
//   4 a member tag with expiry      mei: tags/upsert "Weekend" + tags/member tom exp +30 d → members shows it; exp −1 d hides it
//   5 a club venue shows on page    mei: settings/update venueIds → settings/show venues → the club page prints the venue
//   6 announcement pins + notifies  mei: notes/create in the club + posts/announce → channel pinnedNoteIds; tom's notifications
//   7 join by club code as amy      amy: clubs/by-code → the club; clubs/join {accessToken} → member (the approval gate bypassed)
//   8 message admins opens a thread amy: clubs/admins/chat → roomId; amy writes; mei reads it in chat/messages/room-timeline
//   9 awards section renders        mei: settings/update awards → the club page's Awards block prints the title
// Setup / cleanup through the engine API (tom resumed, unpinned, tag + schedule + created meets removed; amy stays a member —
// the nightly UAT reset restores her). Verdict → /root/social-engine/probes/club-v3.verdict.json; shots → /root/walk/_club-v3-*.png
'use strict';
const fs = require('fs');
const puppeteer = require('/root/hkpl-server/node_modules/puppeteer-core');
const BASE = process.env.BASE || 'https://uat.social.silkvo.com';
const HOST = new URL(BASE).hostname;
const QA_P = process.env.QA_P || (fs.readFileSync('/root/hkpl-server/.env', 'utf8').match(/^QA_BYPASS_PASSWORD=(.+)$/m) || [])[1] || 'hkpl-uat-2026';
const PERSONAS = JSON.parse(fs.readFileSync('/root/uat-personas.json', 'utf8')).personas;
const P = (slug) => PERSONAS.find((p) => p.slug === slug);
const CLUB = process.env.CLUB || ((P('clubowner-mei').owns.find((o) => /^club /.test(o)) || '').match(/club .* ([a-z0-9]{16}) /) || [])[1] || 'arai4ohlizsc000l';
const checks = []; const ok = (n, p, d) => { checks.push({ name: n, pass: !!p, detail: d }); console.log((p ? 'PASS ' : 'FAIL ') + n + ' — ' + JSON.stringify(d).slice(0, 400)); };
const note = (n, d) => console.log('INFO ' + n + ' — ' + JSON.stringify(d).slice(0, 300));
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
const code = (r) => (r.json && r.json.error && r.json.error.code) || r.status;

(async () => {
  const meiC = await session(P('clubowner-mei').email); const mei = await engineToken(meiC);
  const tomC = await session(P('clubadmin-tom').email); const tom = await engineToken(tomC);
  const amyC = await session(P('player-amy').email); const amy = await engineToken(amyC);
  const club = (await se('channels/show', { channelId: CLUB }, mei.token)).json;
  const s0 = await se('clubs/settings/show', { channelId: CLUB }, mei.token);
  ok('0 setup: mei is the admin of the club and the club carries a code + link token (CLUB-V3 deployed)', club && s0.status === 200 && s0.json.isAdmin && s0.json.refCode && s0.json.accessToken, { club: club && club.name, status: s0.status, code: code(s0), refCode: s0.json && s0.json.refCode, hasToken: !!(s0.json && s0.json.accessToken) });
  if (s0.status !== 200 || !s0.json.refCode) { finish('the engine does not answer clubs/settings/show with refCode — CLUB-V3 not deployed yet'); return; }
  // tom must be a member and an admin for the probe's roles: tom is the club admin persona; amy joins by code below
  await se('clubs/me/update', { channelId: CLUB, paused: false, pinned: false }, tom.token).catch(() => null);

  // ---- 7 join by club code as amy (first: the other checks need a non-admin member)
  const byCode = await se('clubs/by-code', { code: s0.json.refCode.toLowerCase() }, amy.token);
  const bad = await se('clubs/by-code', { code: 'ZZZZ99' }, amy.token);
  const meAmy0 = (await se('clubs/settings/show', { channelId: CLUB }, amy.token)).json;
  if (meAmy0 && meAmy0.isMember) { await se('channels/unfollow', { channelId: CLUB }, amy.token); note('setup: amy left the club first', true); }
  const gated = await se('clubs/join', { channelId: CLUB }, amy.token);
  const joined = await se('clubs/join', { channelId: CLUB, accessToken: s0.json.accessToken }, amy.token);
  const meAmy = (await se('clubs/settings/show', { channelId: CLUB }, amy.token)).json;
  ok('7 join by club code: by-code finds the club (case-insensitive), a wrong code is NO_SUCH_CLUB; the approval gate answers "requested" but the ?at= token seats amy', byCode.status === 200 && byCode.json.id === CLUB && bad.status !== 200 && code(bad) === 'NO_SUCH_CLUB' && gated.status === 200 && gated.json.status === 'requested' && joined.status === 200 && joined.json.status === 'member' && meAmy && meAmy.isMember, { byCode: byCode.status, found: byCode.json && byCode.json.id, bad: code(bad), gated: gated.json && gated.json.status, joined: joined.json && joined.json.status, isMember: meAmy && meAmy.isMember });

  // ---- 1 pin toggles the Home row
  const pin = await se('clubs/me/update', { channelId: CLUB, pinned: true }, mei.token);
  const mine1 = (await se('clubs/mine', {}, mei.token)).json || [];
  const unpin = await se('clubs/me/update', { channelId: CLUB, pinned: false }, mei.token);
  const mine0 = (await se('clubs/mine', {}, mei.token)).json || [];
  const row1 = mine1.find((c) => c.id === CLUB), row0 = mine0.find((c) => c.id === CLUB);
  ok('1a pin: clubs/me/update {pinned} flips clubs/mine.pinned and the pinned club sorts first', pin.status === 200 && pin.json.pinned === true && row1 && row1.pinned === true && mine1[0].id === CLUB && unpin.json.pinned === false && row0 && row0.pinned === false, { pin: pin.json, first: mine1[0] && mine1[0].name, unpinned: row0 && row0.pinned });
  await se('clubs/me/update', { channelId: CLUB, pinned: true }, mei.token);

  // ---- 2 take a break hides tom
  const pause = await se('clubs/me/update', { channelId: CLUB, paused: true }, tom.token);
  const amyRoster = (await se('clubs/members', { channelId: CLUB, limit: 200 }, amy.token)).json;
  const meiRoster = (await se('clubs/members', { channelId: CLUB, limit: 200 }, mei.token)).json;
  const tomForAmy = amyRoster && amyRoster.members.find((m) => m.userId === tom.userId);
  const tomForMei = meiRoster && meiRoster.members.find((m) => m.userId === tom.userId);
  ok('2 take a break: tom paused → a member (amy) does not see him on the roster; the admin (mei) sees him flagged paused', pause.status === 200 && pause.json.paused === true && amyRoster && !tomForAmy && tomForMei && tomForMei.paused === true, { pause: pause.json, amySees: amyRoster && amyRoster.members.length, tomForAmy: !!tomForAmy, tomForMei: tomForMei && tomForMei.paused });
  const resume = await se('clubs/me/update', { channelId: CLUB, paused: false }, tom.token);
  note('tom resumed', resume.json);

  // ---- 4 a member tag with expiry
  for (const t of ((await se('clubs/tags/list', { channelId: CLUB }, mei.token)).json || [])) if (/^\[probe\]/.test(t.name)) await se('clubs/tags/delete', { channelId: CLUB, tagId: t.id }, mei.token);
  const tag = await se('clubs/tags/upsert', { channelId: CLUB, name: '[probe] Weekend', visibility: 'all' }, mei.token);
  const exp = new Date(Date.now() + 30 * 86400e3).toISOString();
  const tagged = await se('clubs/tags/member', { channelId: CLUB, tagId: tag.json && tag.json.id, userId: tom.userId, on: true, expiresAt: exp }, mei.token);
  const r1 = (await se('clubs/members', { channelId: CLUB, limit: 200 }, mei.token)).json;
  const tomTag = r1 && r1.members.find((m) => m.userId === tom.userId);
  const expired = await se('clubs/tags/member', { channelId: CLUB, tagId: tag.json && tag.json.id, userId: tom.userId, on: true, expiresAt: new Date(Date.now() - 86400e3).toISOString() }, mei.token);
  const r2 = (await se('clubs/members', { channelId: CLUB, limit: 200 }, mei.token)).json;
  const tomTag2 = r2 && r2.members.find((m) => m.userId === tom.userId);
  ok('4 member tag with expiry: "[probe] Weekend" on tom expiring in 30 d shows with expiresAt; dated yesterday it drops off the roster line', tag.status === 200 && tagged.status === 200 && tomTag && tomTag.tags.includes('[probe] Weekend') && tomTag.tagDetails.some((x) => x.name === '[probe] Weekend' && x.expiresAt) && expired.status === 200 && tomTag2 && !tomTag2.tags.includes('[probe] Weekend'), { tag: tag.json && tag.json.name, tags: tomTag && tomTag.tags, exp: tomTag && tomTag.tagDetails.map((x) => x.expiresAt), afterExpiry: tomTag2 && tomTag2.tags });

  // ---- 5 a club venue
  const venues = (await se('venues/search', { q: 'sports', includeUnderReview: true }, mei.token)).json || [];
  const venue = venues[0] || ((await se('venues/search', { q: 'a', includeUnderReview: true }, mei.token)).json || [])[0];
  const setV = venue ? await se('clubs/settings/update', { channelId: CLUB, venueIds: [venue.id] }, mei.token) : { status: 0 };
  const sV = (await se('clubs/settings/show', { channelId: CLUB }, amy.token)).json;
  ok('5 club venue: settings/update venueIds → settings/show packs the venue (name, address) for the page', venue && setV.status === 200 && sV && sV.venues.some((v) => v.id === venue.id && v.name === venue.name), { venue: venue && venue.name, set: setV.status, packed: sV && sV.venues.map((v) => v.name) });

  // ---- 9 awards
  const setA = await se('clubs/settings/update', { channelId: CLUB, awards: [{ title: '[probe] Champions', event: 'UAT Spring League', date: '2026-06-30', placement: '1st' }] }, mei.token);
  const sA = (await se('clubs/settings/show', { channelId: CLUB }, amy.token)).json;
  ok('9a awards: settings/update awards → settings/show awards (public)', setA.status === 200 && sA && sA.awards.some((a) => a.title === '[probe] Champions' && a.placement === '1st'), { awards: sA && sA.awards });

  // ---- 6 announcement pins + notifies
  const stamp = '[probe] announcement ' + Date.now().toString(36);
  const post = await se('notes/create', { text: stamp, channelId: CLUB }, mei.token);
  const noteId = post.json && post.json.createdNote && post.json.createdNote.id;
  const ann = await se('clubs/posts/announce', { channelId: CLUB, noteId, on: true }, mei.token);
  await sleep(1500);
  const ch = (await se('channels/show', { channelId: CLUB }, tom.token)).json;
  const tomNotifs = (await se('i/notifications', { limit: 20 }, tom.token)).json || [];
  const got = tomNotifs.find((n) => n.type === 'app' && /Announcement/.test(n.header || '') && (n.body || '').includes(stamp.slice(0, 30)));
  ok('6 announcement: the post is pinned on the channel (pinnedNoteIds first) and tom got the "Announcement · club" notification', ann.status === 200 && ch && ch.pinnedNoteIds[0] === noteId && Array.isArray(ch.pinnedNotes) && ch.pinnedNotes.some((n) => n.id === noteId) && !!got, { ann: ann.json, pinnedFirst: ch && ch.pinnedNoteIds[0] === noteId, notif: got && { header: got.header, body: got.body, link: got.link } });
  const unann = await se('clubs/posts/announce', { channelId: CLUB, noteId, on: false }, mei.token);
  note('unpinned', unann.json);

  // ---- 8 message admins
  const room = await se('clubs/admins/chat', { channelId: CLUB }, amy.token);
  const line = '[probe] hello admins ' + Date.now().toString(36);
  const sent = room.json ? await se('chat/messages/create-to-room', { toRoomId: room.json.roomId, text: line }, amy.token) : { status: 0 };
  const seen = room.json ? (await se('chat/messages/room-timeline', { roomId: room.json.roomId, limit: 10 }, mei.token)).json || [] : [];
  const again = await se('clubs/admins/chat', { channelId: CLUB }, amy.token);
  ok('8 message admins: amy gets a room with the admins, her line reaches mei in that room, the same room comes back next time', room.status === 200 && sent.status === 200 && seen.some((m) => m.text === line) && again.json && again.json.roomId === room.json.roomId, { room: room.status, sent: sent.status, seen: seen.length, same: again.json && again.json.roomId === (room.json && room.json.roomId) });

  // ---- 3 the Tuesday schedule, 3-day lead → run the job once
  for (const sc of ((await se('clubs/schedules/list', { channelId: CLUB }, mei.token)).json || [])) if (/^\[probe\]/.test(sc.name)) await se('clubs/schedules/delete', { scheduleId: sc.id }, mei.token);
  const sch = await se('clubs/schedules/create', { channelId: CLUB, name: '[probe] Tuesday club night', weekday: 2, startTime: '19:00', durationMinutes: 120, capacity: 8, publishLeadHours: 72, feeType: 'free', visibility: 'public', autoApprove: true }, mei.token);
  const run1 = await se('clubs/schedules/run', { channelId: CLUB }, mei.token);
  const sc1 = sch.json ? (await se('clubs/schedules/show', { scheduleId: sch.json.id }, mei.token)).json : null;
  const hoursAway = sc1 ? (new Date(sc1.nextAt).getTime() - Date.now()) / 3600e3 : NaN;
  const dueNow = hoursAway <= 72;
  ok('3a schedule: created (Tuesday 19:00, lead 3 days); run → a meet is created only when the next Tuesday is inside 72 h (' + Math.round(hoursAway) + ' h away now)', sch.status === 200 && sch.json.weekday === 2 && sch.json.publishLeadHours === 72 && run1.status === 200 && (dueNow ? run1.json.created.length === 1 && sc1.nextMeet : run1.json.created.length === 0 && !sc1.nextMeet), { schedule: sch.json && sch.json.id, nextAt: sc1 && sc1.nextAt, hoursAway: Math.round(hoursAway), created: run1.json && run1.json.created, dueNow });
  const widen = await se('clubs/schedules/update', { scheduleId: sch.json && sch.json.id, publishLeadHours: 336 }, mei.token);
  const run2 = await se('clubs/schedules/run', { channelId: CLUB }, mei.token);
  const sc2 = sch.json ? (await se('clubs/schedules/show', { scheduleId: sch.json.id }, mei.token)).json : null;
  const meet = sc2 && sc2.nextMeet;
  const full = meet ? (await se('meets/show', { meetId: meet.id }, mei.token)).json : null;
  const tomRow = full && (full.participants || []).find((p) => p.userId === tom.userId);
  const tomInvite = (await se('i/notifications', { limit: 20 }, tom.token)).json || [];
  const invited = tomInvite.find((n) => /invited/i.test((n.header || '') + (n.body || '')) && (n.body || '').includes('[probe] Tuesday'));
  const sameDay = meet ? new Date(meet.startAt).getUTCDay() === 2 && new Date(new Date(meet.startAt).getTime() + 8 * 3600e3).getUTCHours() === 19 : false;
  ok('3b lead → 2 weeks, run → the Tuesday 19:00 HKT meet exists with seriesId = the schedule, in the club, and tom is invited (roster row + notification)', widen.status === 200 && run2.status === 200 && meet && meet.seriesId === sch.json.id && meet.channelId === CLUB && sameDay && tomRow && tomRow.status === 'invited' && !!invited, { created: run2.json && run2.json.created, meet: meet && { id: meet.id, startAt: meet.startAt, seriesId: meet.seriesId }, tom: tomRow && tomRow.status, notif: invited && invited.body });
  const run3 = await se('clubs/schedules/run', { channelId: CLUB }, mei.token);
  const pauseS = await se('clubs/schedules/update', { scheduleId: sch.json && sch.json.id, status: 'paused' }, mei.token);
  ok('3c idempotent + pause: a second run creates nothing for the same occurrence; Pause answers status paused', run3.status === 200 && run3.json.created.length === 0 && pauseS.status === 200 && pauseS.json.status === 'paused', { run3: run3.json, paused: pauseS.json && pauseS.json.status });

  // ---- the pages (headless Chrome)
  const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  const errs = [];
  async function pageAs(cookies) { const ctx = await browser.createBrowserContext(); const page = await ctx.newPage(); await page.setViewport({ width: 412, height: 915, deviceScaleFactor: 2 }); for (const c of cookies) await page.setCookie({ name: c.name, value: c.value, domain: HOST, path: '/', secure: true }); page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 160))); return page; }
  const text = (page) => page.evaluate(() => document.body.innerText);
  // mei: Home pinned row
  const pm = await pageAs(meiC);
  await pm.goto(BASE + '/app/pages/home/index?lang=en', { waitUntil: 'networkidle2', timeout: 60000 }); await sleep(2500);
  const crests = await pm.$$eval('.bt-crestt', (els) => els.map((e) => (e.textContent || '').trim())).catch(() => []);
  ok('1b Home (mei): the pinned row marks the pinned club (📌 + name), first', crests.length > 0 && /📌/.test(crests[0]) && crests[0].includes(club.name), { crests });
  await pm.screenshot({ path: '/root/walk/_club-v3-home.png' });
  // amy: the club page — kebab, ID code, venue, awards, REGULAR SCHEDULE, members without tom while paused
  await se('clubs/me/update', { channelId: CLUB, paused: true }, tom.token);
  const pa = await pageAs(amyC);
  await pa.goto(BASE + '/app/pages/community/index?id=' + CLUB + '&lang=en', { waitUntil: 'networkidle2', timeout: 60000 }); await sleep(2500);
  const t1 = await text(pa);
  const acts = await pa.$$('.ah-act');
  ok('5b/9b club page (amy): the venue name and the award title render; the meta line prints "ID: <code>"; REGULAR SCHEDULE block; a kebab beside Share', t1.includes(venue ? venue.name : ' ') && t1.includes('[probe] Champions') && t1.includes('ID: ' + s0.json.refCode) && /REGULAR SCHEDULE/i.test(t1) && acts.length >= 2, { venue: !!venue && t1.includes(venue.name), award: t1.includes('[probe] Champions'), id: t1.includes('ID: ' + s0.json.refCode), schedule: /REGULAR SCHEDULE/i.test(t1), actions: acts.length });
  await pa.screenshot({ path: '/root/walk/_club-v3-club.png', fullPage: true });
  await pa.goto(BASE + '/app/pages/community/index?id=' + CLUB + '&pane=members&lang=en', { waitUntil: 'networkidle2', timeout: 60000 }); await sleep(2500);
  const t2 = await text(pa);
  const tomName = (tomForMei && tomForMei.user && (tomForMei.user.name || tomForMei.user.username)) || 'clubadmin-tom';
  ok('2b Members pane (amy): tom, on a break, is not listed; "Sort by:" control present', !t2.includes(tomName) && /Sort by/i.test(t2), { tomName, listed: t2.includes(tomName), sort: /Sort by/i.test(t2) });
  await pa.screenshot({ path: '/root/walk/_club-v3-members.png', fullPage: true });
  await se('clubs/me/update', { channelId: CLUB, paused: false }, tom.token);
  // amy: join-by-code page renders the club card for the code
  await pa.goto(BASE + '/app/pages/club-join/index?code=' + s0.json.refCode + '&lang=en', { waitUntil: 'networkidle2', timeout: 60000 }); await sleep(2500);
  const t3 = await text(pa);
  ok('7b join page (amy): /pages/club-join?code=<code> shows the club card for the code', t3.includes(club.name) && (await pa.$$('.cjn-cell')).length === 6, { name: t3.includes(club.name), cells: (await pa.$$('.cjn-cell')).length });
  await pa.screenshot({ path: '/root/walk/_club-v3-join.png' });
  // mei: the schedule detail page
  const ps = await pageAs(meiC);
  await ps.goto(BASE + '/app/pages/club-schedule/index?id=' + (sch.json && sch.json.id) + '&lang=en', { waitUntil: 'networkidle2', timeout: 60000 }); await sleep(2500);
  const t4 = await text(ps);
  ok('3d schedule page (mei): "Every Tuesday · 19:00", the Next meet card (Created), Paused badge', /Every Tuesday/.test(t4) && /19:00/.test(t4) && /Next meet/i.test(t4) && /Paused/.test(t4), { every: /Every Tuesday/.test(t4), next: /Next meet/i.test(t4), paused: /Paused/.test(t4) });
  await ps.screenshot({ path: '/root/walk/_club-v3-schedule.png', fullPage: true });
  // mei: club-admin panes present
  await ps.goto(BASE + '/app/pages/club-admin/index?id=' + CLUB + '&pane=venues&lang=en', { waitUntil: 'networkidle2', timeout: 60000 }); await sleep(2500);
  const t5 = await text(ps);
  ok('5c club-admin Venues pane (mei): the picked venue is listed; Schedules / Awards tabs exist', (venue ? t5.includes(venue.name) : false) && /Schedules/.test(t5) && /Awards/.test(t5), { venue: venue && t5.includes(venue.name), tabs: /Schedules/.test(t5) && /Awards/.test(t5) });
  ok('P no page errors across the walk', errs.length === 0, { errs: errs.slice(0, 3) });
  await browser.close();

  // ---- cleanup
  if (!process.env.KEEP) {
    for (const m of (sc2 && sc2.upcoming) || []) await se('meets/cancel', { meetId: m.id }, mei.token);
    if (sch.json) await se('clubs/schedules/delete', { scheduleId: sch.json.id }, mei.token);
    if (tag.json) await se('clubs/tags/delete', { channelId: CLUB, tagId: tag.json.id }, mei.token);
    await se('clubs/settings/update', { channelId: CLUB, awards: [] }, mei.token);
    await se('clubs/me/update', { channelId: CLUB, pinned: false, paused: false }, mei.token);
    if (noteId) await se('notes/delete', { noteId }, mei.token);
    note('cleanup done (amy stays a member; the nightly reset restores)', true);
  }
  finish();

  function finish(reason) {
    const pass = checks.filter((c) => c.pass).length;
    const v = { id: 'club-v3', at: new Date().toISOString(), condition_fired: true, verdict: pass === checks.length && checks.length > 1 ? 'pass' : 'fail', pass, total: checks.length, reason: reason || null, evidence: checks.map((c) => c.name + '=' + (c.pass ? 'ok' : 'FAIL') + ' ' + JSON.stringify(c.detail).slice(0, 300)), detail: 'CLUB-V3 on UAT: pin / take a break / schedule + job / tags with expiry / venue / announcement / join by code + token / message admins / awards — engine API as mei · tom · amy, then the Home, club, members, join, schedule and club-admin pages in headless Chrome', checks };
    fs.writeFileSync('/root/social-engine/probes/club-v3.verdict.json', JSON.stringify(v, null, 2));
    console.log(v.verdict + ' ' + pass + '/' + checks.length + (reason ? ' — ' + reason : '')); process.exit(v.verdict === 'pass' ? 0 : 1);
  }
})().catch((e) => { console.error('probe crashed: ' + (e && e.stack || e)); const v = { id: 'club-v3', at: new Date().toISOString(), condition_fired: true, verdict: 'fail', pass: checks.filter((c) => c.pass).length, total: checks.length, reason: 'crashed: ' + String(e && e.message || e).slice(0, 200), evidence: checks.map((c) => c.name + '=' + (c.pass ? 'ok' : 'FAIL')), checks }; fs.writeFileSync('/root/social-engine/probes/club-v3.verdict.json', JSON.stringify(v, null, 2)); process.exit(1); });

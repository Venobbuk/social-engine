// CHAT-V2 probe (ON kaka, against UAT https://uat.social.silkvo.com — the UAT personas tom · mei · amy · ken).
// Proves the Reclub chat parity rows on the DEPLOYED engine + app (PARITY.md 122 / 126 / 127 / 128 / 129 / 131 / 132 / 135):
//   E1 tom → mei: a text lands on mei's timeline                          (chat/messages/create-to-user · user-timeline)
//   E2 mei reacts ❤️ → tom's copy carries the reaction with mei's userId   (chat/messages/react · the 1-on-1 packer's userId)
//   E3 tom attaches a photo → the message carries the drive file          (drive/files/create · create-to-user fileId)
//   E4 tom shares a meet → attachment.kind = 'meet'                       (create-to-user meetId)
//   E5 message menu: delete own (gone), report mei's (accepted), a second delete of mei's is refused
//   E6 mute: tom mutes the thread → mei's next message raises NO newChatMessage on tom's main stream in 6 s; unmuted → it does
//   E7 inbox unread for mei: chat/history isRead=false while unread, true after the timeline is read
//   E8 meet chat system bubble: amy joins ken's auto-approve meet → the room carries { system: { key: 'joined' } }
//   E9 the settings toggles: chat/notification-prefs update chat=false → show says false → restored
//   P1 tom's chat page: the meet card bubble (.ct-meet) opens the meet; the long-press sheet shows the reaction row + Copy / Delete
//   P2 mei's inbox: the tom row wears the unread dot; opening the thread clears it (a reload shows no dot)
//   P3 ken's meet chat tab: a system line (.ct-sys) says amy joined
// Fails until the orchestrator deploys engine commit d8a7d1767c (+ follow-up) and the app. Verdict → chat-v2.verdict.json.
'use strict';
const fs = require('fs');
const puppeteer = require('/root/hkpl-server/node_modules/puppeteer-core');
const WebSocket = require('/root/hkpl-server/node_modules/ws');
const BASE = process.env.BASE || 'https://uat.social.silkvo.com';
const HOST = new URL(BASE).hostname;
const QA_P = process.env.QA_P || (fs.readFileSync('/root/hkpl-server/.env', 'utf8').match(/^QA_BYPASS_PASSWORD=(.+)$/m) || [])[1] || 'hkpl-uat-2026';
const PERSONAS = JSON.parse(fs.readFileSync('/root/uat-personas.json', 'utf8')).personas;
const P = (slug) => PERSONAS.find((p) => p.slug === slug);
const checks = []; const ok = (n, p, d) => { checks.push({ name: n, pass: !!p, detail: d }); console.log((p ? 'PASS ' : 'FAIL ') + n + ' — ' + JSON.stringify(d).slice(0, 400)); };
const note = (n, d) => console.log('INFO ' + n + ' — ' + JSON.stringify(d).slice(0, 300));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = 'probe ' + Date.now().toString(36);
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
/** Listen on a person's main stream for `ms` and return the newChatMessage events seen. */
function mainStreamEvents(token, ms) {
  return new Promise((resolve) => {
    const seen = []; let done = false;
    const ws = new WebSocket(BASE.replace(/^http/, 'ws') + '/streaming?i=' + encodeURIComponent(token));
    const finish = () => { if (done) return; done = true; try { ws.close(); } catch (e) { /* closed */ } resolve(seen); };
    ws.on('open', () => ws.send(JSON.stringify({ type: 'connect', body: { channel: 'main', id: 'probe-main', params: {} } })));
    ws.on('message', (data) => { try { const j = JSON.parse(String(data)); if (j.type === 'channel' && j.body && j.body.type === 'newChatMessage') seen.push(j.body.body && j.body.body.text); } catch (e) { /* not json */ } });
    ws.on('error', () => finish());
    setTimeout(finish, ms);
  });
}
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
async function uploadPng(token) {
  const fd = new FormData(); fd.append('i', token); fd.append('name', 'probe.png'); fd.append('file', new Blob([PNG], { type: 'image/png' }), 'probe.png');
  const r = await fetch(BASE + '/api/drive/files/create', { method: 'POST', body: fd });
  return { status: r.status, json: await r.json().catch(() => null) };
}
const lp = async (page, sel) => page.evaluate((s) => { const el = document.querySelector(s); if (!el) return false; el.dispatchEvent(new CustomEvent('longpress', { bubbles: true })); return true; }, sel);

(async () => {
  // ---- people
  const tomCookies = await session(P('clubadmin-tom').email); const tom = await engineToken(tomCookies);
  const meiCookies = await session(P('clubowner-mei').email); const mei = await engineToken(meiCookies);
  const kenCookies = await session(P('host-ken').email); const ken = await engineToken(kenCookies);
  const amy = await engineToken(await session(P('player-amy').email));
  const TOM = P('clubadmin-tom').engineUserId, MEI = P('clubowner-mei').engineUserId;
  // fixture: a live host-ken meet (auto-approve) for the card + the system line
  const hosting = (await se('meets/list', { scope: 'hosting', sport: 'pickleball', limit: 100 }, ken.token)).json || [];
  let meet = hosting.find((m) => !m.isPast && m.status !== 'cancelled' && m.autoApprove) || hosting.find((m) => !m.isPast && m.status !== 'cancelled');
  if (!meet) throw new Error('host-ken has no live meet on UAT — run /root/uat-personas.cjs first');
  if (!meet.autoApprove) { const u = await se('meets/update', { meetId: meet.id, autoApprove: true }, ken.token); if (u.status === 200) meet = u.json; }
  note('fixture', { meet: meet.id, name: meet.name, room: meet.chatRoomId });
  await se('chat/threads/mute', { userId: MEI, mute: false }, tom.token);   // start unmuted

  // ---- E1 send
  const sent = await se('chat/messages/create-to-user', { toUserId: MEI, text: stamp + ' hello' }, tom.token);
  const meiTl = (await se('chat/messages/user-timeline', { userId: TOM, limit: 10 }, mei.token)).json || [];
  ok('E1 tom → mei: the text lands on mei\'s timeline', sent.status === 200 && meiTl.some((m) => m.text === stamp + ' hello'), { status: sent.status, seen: meiTl.length });
  const msgId = sent.json && sent.json.id;

  // ---- E2 react
  const rx = await se('chat/messages/react', { messageId: msgId, reaction: '❤️' }, mei.token);
  const tomTl = (await se('chat/messages/user-timeline', { userId: MEI, limit: 10 }, tom.token)).json || [];
  const mine = tomTl.find((m) => m.id === msgId);
  ok('E2 mei reacts ❤️ → tom\'s copy carries 1 heart with mei\'s userId', rx.status === 204 && mine && (mine.reactions || []).length === 1 && mine.reactions[0].userId === MEI, { status: rx.status, reactions: mine && mine.reactions });
  const rx2 = await se('chat/messages/react', { messageId: msgId, reaction: '❤️' }, mei.token);
  const again = ((await se('chat/messages/user-timeline', { userId: MEI, limit: 10 }, tom.token)).json || []).find((m) => m.id === msgId);
  ok('E2b the same reaction twice is one (dedupe)', rx2.status === 204 && again && (again.reactions || []).length === 1, { status: rx2.status, n: again && again.reactions.length });

  // ---- E3 photo
  const up = await uploadPng(tom.token);
  const photo = up.json && up.json.id ? await se('chat/messages/create-to-user', { toUserId: MEI, fileId: up.json.id }, tom.token) : { status: up.status, json: null };
  ok('E3 a photo message carries the drive file', up.status === 200 && photo.status === 200 && photo.json && photo.json.file && photo.json.file.id === up.json.id, { upload: up.status, msg: photo.status, file: photo.json && photo.json.file && photo.json.file.type });

  // ---- E4 meet card
  const card = await se('chat/messages/create-to-user', { toUserId: MEI, meetId: meet.id }, tom.token);
  ok('E4 a shared meet rides as attachment.kind = meet with the snapshot', card.status === 200 && card.json && card.json.attachment && card.json.attachment.kind === 'meet' && card.json.attachment.meetId === meet.id && card.json.attachment.name === meet.name, { status: card.status, attachment: card.json && card.json.attachment });
  const bad = await se('chat/messages/create-to-user', { toUserId: MEI, meetId: 'zzzzzzzzzzzzzzzz' }, tom.token);
  ok('E4b an unknown meet is refused (NO_SUCH_MEET)', bad.status === 400 && bad.json && bad.json.error && bad.json.error.code === 'NO_SUCH_MEET', { status: bad.status, code: bad.json && bad.json.error && bad.json.error.code });

  // ---- E5 menu: delete own / report theirs / cannot delete theirs
  const own = await se('chat/messages/create-to-user', { toUserId: MEI, text: stamp + ' to delete' }, tom.token);
  const del = await se('chat/messages/delete', { messageId: own.json && own.json.id }, tom.token);
  const afterDel = (await se('chat/messages/user-timeline', { userId: MEI, limit: 20 }, tom.token)).json || [];
  ok('E5a delete my own message → gone from the timeline', del.status === 204 && !afterDel.some((m) => m.id === (own.json && own.json.id)), { status: del.status });
  const theirs = await se('chat/messages/create-to-user', { toUserId: TOM, text: stamp + ' from mei' }, mei.token);
  const rep = await se('chat/messages/report', { messageId: theirs.json && theirs.json.id, comment: 'Spam' }, tom.token);
  const delTheirs = await se('chat/messages/delete', { messageId: theirs.json && theirs.json.id }, tom.token);
  const repOwn = await se('chat/messages/report', { messageId: theirs.json && theirs.json.id, comment: 'x' }, mei.token);
  ok('E5b report mei\'s message is accepted; deleting it is refused; reporting your own is refused', rep.status === 204 && delTheirs.status === 400 && repOwn.status === 400, { report: rep.status, deleteTheirs: delTheirs.status, reportOwn: repOwn.status, code: repOwn.json && repOwn.json.error && repOwn.json.error.code });
  await se('chat/messages/user-timeline', { userId: MEI, limit: 1 }, tom.token);   // tom reads (clears his markers before the mute test)
  await sleep(3500);   // let the engine's 3 s 'still unread?' timers of the messages above expire (the marker is per thread, not per message)

  // ---- E6 mute → no notification for tom
  const muted = await se('chat/threads/mute', { userId: MEI, mute: true }, tom.token);
  const shown = (await se('chat/threads/show', { userId: MEI }, tom.token)).json;
  const quiet = mainStreamEvents(tom.token, 6500); await sleep(800);
  await se('chat/messages/create-to-user', { toUserId: TOM, text: stamp + ' muted ping' }, mei.token);
  const quietEvents = await quiet;
  ok('E6a muted: mei\'s message raises no newChatMessage on tom\'s main stream (6 s)', muted.status === 200 && shown && shown.muted === true && quietEvents.length === 0, { mute: muted.status, shownMuted: shown && shown.muted, events: quietEvents });
  const history = (await se('chat/history', { limit: 30, room: false }, tom.token)).json || [];
  const rowMei = history.find((m) => m.fromUserId === MEI || m.toUserId === MEI);
  ok('E6b muted, but the thread still reads UNREAD in the inbox (the marker stays)', rowMei && rowMei.isRead === false, { isRead: rowMei && rowMei.isRead });
  await se('chat/messages/user-timeline', { userId: MEI, limit: 1 }, tom.token);   // read, so the control below has a fresh marker
  await sleep(3500);
  await se('chat/threads/mute', { userId: MEI, mute: false }, tom.token);
  const loud = mainStreamEvents(tom.token, 6500); await sleep(800);
  await se('chat/messages/create-to-user', { toUserId: TOM, text: stamp + ' loud ping' }, mei.token);
  const loudEvents = await loud;
  ok('E6c control — unmuted, the same message DOES raise newChatMessage within 6 s', loudEvents.some((t) => t === stamp + ' loud ping'), { events: loudEvents });

  // ---- E7 inbox unread for mei (tom's messages above are unread for her)
  const hMei = (await se('chat/history', { limit: 30, room: false }, mei.token)).json || [];
  const rowTom = hMei.find((m) => m.fromUserId === TOM || m.toUserId === TOM);
  ok('E7a mei\'s chat/history: the tom thread is unread', rowTom && rowTom.isRead === false, { isRead: rowTom && rowTom.isRead, text: rowTom && rowTom.text });

  // ---- E8 meet chat system line
  await se('meets/leave', { meetId: meet.id }, amy.token);
  const join = await se('meets/join', { meetId: meet.id }, amy.token);
  await sleep(1500);
  const room = (await se('chat/messages/room-timeline', { roomId: meet.chatRoomId, limit: 30 }, ken.token)).json || [];
  const joined = room.find((m) => m.system && m.system.key === 'joined' && m.system.userId === P('player-amy').engineUserId);
  ok('E8 amy joins → the meet room carries a { system: joined } line naming her', join.status === 200 && !!joined, { join: join.status, line: joined && joined.system, roomMsgs: room.length });

  // ---- E9 the settings toggles
  const off = await se('chat/notification-prefs/update', { key: 'chat', on: false }, tom.token);
  const prefs = (await se('chat/notification-prefs/show', {}, tom.token)).json;
  await se('chat/notification-prefs/update', { key: 'chat', on: true }, tom.token);
  const prefs2 = (await se('chat/notification-prefs/show', {}, tom.token)).json;
  ok('E9 notification-prefs: chat off → show false → on again', off.status === 200 && prefs && prefs.chat === false && prefs2 && prefs2.chat === true, { prefs, prefs2 });

  // ---- pages
  const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  const errs = [];
  const open = async (cookies, url) => {
    const ctx = await browser.createBrowserContext(); const page = await ctx.newPage(); await page.setViewport({ width: 412, height: 915, deviceScaleFactor: 2 });
    for (const c of cookies) await page.setCookie({ name: c.name, value: c.value, domain: HOST, path: '/', secure: true });
    page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 120)));
    await page.goto(BASE + url, { waitUntil: 'networkidle2', timeout: 60000 }); await sleep(2500); return page;
  };
  // P1 tom's chat with mei: the card bubble opens the meet; long-press sheet
  let page = await open(tomCookies, '/app/pages/chat/index?user=' + MEI + '&lang=en');
  await page.screenshot({ path: '/root/walk/_chat-v2-thread.png' });
  const p1 = await page.evaluate(() => ({ thread: !!document.querySelector('.ct'), plus: !!document.querySelector('.ct-plus'), card: !!document.querySelector('.ct-meet'), photo: !!document.querySelector('.ct-photo'), pills: document.querySelectorAll('.ct-rx').length, sys: document.querySelectorAll('.ct-sys').length }));
  ok('P1a tom\'s thread renders the "+" attach button, a meet card, a photo bubble and a reaction pill', p1.thread && p1.plus && p1.card && p1.photo && p1.pills >= 1, p1);
  const longpressed = await lp(page, '.ct-line-mine .ct-bubble'); await sleep(900);
  const sheet = await page.evaluate(() => ({ rxrow: document.querySelectorAll('.ct-rxrow .ct-rxbtn').length, acts: [...document.querySelectorAll('.ct-act .ct-actt')].map((e) => (e.textContent || '').trim()) }));
  await page.screenshot({ path: '/root/walk/_chat-v2-menu.png' });
  ok('P1b long-press on my bubble → the sheet: 6 reactions + Copy + Delete (no Report on my own)', longpressed && sheet.rxrow === 6 && sheet.acts.includes('Copy') && sheet.acts.includes('Delete') && !sheet.acts.includes('Report'), sheet);
  await page.keyboard.press('Escape'); await page.evaluate(() => { const o = document.querySelector('.nut-overlay'); if (o) o.click(); }); await sleep(600);
  const hasCard = await page.$('.ct-meet'); if (hasCard) { await hasCard.click(); await sleep(2500); }
  const url = page.url();
  ok('P1c tapping the meet card opens the meet', /\/pages\/meet\/index\?id=/.test(url) && url.includes(meet.id), { url });
  // P2 mei's inbox: unread dot on the tom row, cleared after opening
  page = await open(meiCookies, '/app/pages/inbox/index?filter=direct&lang=en');
  await page.screenshot({ path: '/root/walk/_chat-v2-inbox.png' });
  const p2 = await page.evaluate(() => ({ rows: document.querySelectorAll('.ib-item').length, unread: document.querySelectorAll('.ib-item-unread').length, dots: document.querySelectorAll('.ib-dot').length, markAll: !!document.querySelector('.ah-act') }));
  ok('P2a mei\'s inbox shows an unread row with the dot', p2.unread >= 1 && p2.dots >= 1, p2);
  const opened = await page.evaluate(() => { const r = document.querySelector('.ib-item-unread'); if (!r) return false; r.click(); return true; }); await sleep(3500);   // no unread row → opened=false, P2b fails honestly
  const onChat = /\/pages\/chat\/index/.test(page.url());
  await page.goto(BASE + '/app/pages/inbox/index?filter=direct&lang=en', { waitUntil: 'networkidle2', timeout: 60000 }); await sleep(2500);
  const p2b = await page.evaluate(() => ({ unread: document.querySelectorAll('.ib-item-unread').length }));
  const hMei2 = (await se('chat/history', { limit: 30, room: false }, mei.token)).json || [];
  const rowTom2 = hMei2.find((m) => m.fromUserId === TOM || m.toUserId === TOM);
  ok('P2b opening the row clears it: no unread row after a reload, and chat/history says isRead', opened && onChat && p2b.unread === 0 && rowTom2 && rowTom2.isRead === true, { opened, onChat, after: p2b, isRead: rowTom2 && rowTom2.isRead });
  // P3 ken's meet chat: the system line
  page = await open(kenCookies, '/app/pages/meet/index?id=' + meet.id + '&tab=chat&lang=en');
  await sleep(2000); await page.screenshot({ path: '/root/walk/_chat-v2-meetchat.png' });
  const p3 = await page.evaluate(() => ({ sys: [...document.querySelectorAll('.ct-sys .ct-syst')].map((e) => (e.textContent || '').trim()) }));
  ok('P3 the meet chat tab shows a system line "… has joined the conversation."', p3.sys.some((t) => /has joined the conversation/.test(t)), p3);
  ok('P4 no page errors across the walk', errs.length === 0, { errs: errs.slice(0, 3) });
  await browser.close();

  // ---- cleanup: amy off the meet again so a re-run gets a fresh joined line; tom unmuted (done above)
  if (!process.env.KEEP) await se('meets/leave', { meetId: meet.id }, amy.token);
  const pass = checks.filter((c) => c.pass).length;
  const v = { id: 'chat-v2', at: new Date().toISOString(), condition_fired: true, verdict: pass === checks.length ? 'pass' : 'fail', pass, total: checks.length, evidence: checks.map((c) => c.name + '=' + (c.pass ? 'ok' : 'FAIL') + ' ' + JSON.stringify(c.detail).slice(0, 300)), detail: 'CHAT-V2 on UAT: reactions, photo + meet-card attachments, message menu, per-thread mute (main-stream observed), inbox unread, meet-chat system line, notification prefs; pages in headless Chrome as tom / mei / ken', checks };
  fs.writeFileSync('/root/social-engine/probes/chat-v2.verdict.json', JSON.stringify(v, null, 2));
  console.log(v.verdict + ' ' + pass + '/' + checks.length); process.exit(v.verdict === 'pass' ? 0 : 1);
})().catch((e) => {
  const v = { id: 'chat-v2', at: new Date().toISOString(), condition_fired: true, verdict: 'fail', error: String(e && e.stack || e).slice(0, 600), evidence: checks.map((c) => c.name + '=' + (c.pass ? 'ok' : 'FAIL')), checks };
  fs.writeFileSync('/root/social-engine/probes/chat-v2.verdict.json', JSON.stringify(v, null, 2));
  console.error('fail (threw): ' + (e && e.message)); process.exit(1);
});

// UAT-STD long-content fixtures (standard section 2 "long content filling 2+ screens", 5C "longest language"): a 40-message
// chat between player-amy and host-ken (long lines, CJK, a 2,000-character message) and one public meet hosted by host-ken
// with a long English + CJK name and venue. Every row carries '[probe] uat-std' (G13.1) and is removed by cleanup.cjs with
// proof. Writes the ids to /root/gen/l6-scope/uat-std/fixtures.json for the matrix (variant 'meet@long').
//   bash probes/run.sh uat-std/seed.cjs
'use strict';
require('../_guard.cjs');
const fs = require('fs');
const { getNativeToken } = require('../_native-session.cjs');
const BASE = process.env.BASE || 'https://uat.gripbat.com';
const OUT = process.env.OUT || '/root/gen/l6-scope/uat-std';
async function api(ep, body, tok) {
  for (let i = 0; i < 6; i++) {
    const r = await fetch(BASE + '/api/' + ep, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(Object.assign({ i: tok }, body)) });
    if (r.status === 429) { await new Promise((x) => setTimeout(x, 5000)); continue; }
    let j = null; try { j = await r.json(); } catch (e) { /* 204 */ }
    return { s: r.status, j };
  }
  return { s: 429, j: null };
}
(async () => {
  const amy = await getNativeToken('player-amy'), ken = await getNativeToken('host-ken');
  const fx = { at: new Date().toISOString(), marker: '[probe] uat-std', chat: [], meetId: null };
  const start = new Date(Date.now() + 2 * 86400e3); start.setUTCHours(11, 30, 0, 0);
  const m = await api('meets/create', {
    name: '[probe] uat-std Kowloon Bay Thursday Evening Social Doubles for Intermediate Players 九龍灣星期四晚上中級雙打社交',
    startAt: start.toISOString(), durationMinutes: 120, capacity: 16, visibility: 'public', sendNotifications: false,
    venueName: '[probe] uat-std Kowloon Bay Sports Centre Main Arena Courts 1 to 4 九龍灣體育館主場',
    notes: '[probe] uat-std long notes. ' + 'Bring two paddles, indoor shoes and water. 請帶球拍、室內鞋和水。 '.repeat(12),
  }, ken.token);
  if (m.s !== 200 || !m.j || !m.j.id) throw new Error('meets/create answered ' + m.s + ' ' + JSON.stringify(m.j).slice(0, 200));
  fx.meetId = m.j.id;
  const long = 'This is a deliberately long message to fill the thread and wrap across many lines on a phone screen. 這是一條故意很長的訊息，用來測試聊天畫面在手機上的換行與版面。';
  for (let n = 1; n <= 40; n++) {
    const from = n % 2 ? amy : ken, to = n % 2 ? ken : amy;
    const text = '[probe] uat-std #' + n + ' ' + (n === 20 ? long.repeat(12).slice(0, 1900) : n % 5 === 0 ? long : n % 3 === 0 ? '好 👍' : 'See you at the courts at 7:30pm, bring the new balls 記得帶新球');
    const r = await api('chat/messages/create-to-user', { toUserId: to.userId, text }, from.token);
    if (r.s !== 200 || !r.j || !r.j.id) throw new Error('chat create #' + n + ' answered ' + r.s + ' ' + JSON.stringify(r.j).slice(0, 200));
    fx.chat.push({ id: r.j.id, from: n % 2 ? 'player-amy' : 'host-ken' });
  }
  // read back (G16.5: assert the fixture is real before measuring against it)
  const back = await api('meets/show', { meetId: fx.meetId }, amy.token);
  fx.meetReadBack = back.s === 200 && back.j && back.j.name && back.j.name.startsWith('[probe] uat-std');
  const tl = await api('chat/messages/user-timeline', { userId: ken.userId, limit: 50 }, amy.token);
  fx.chatReadBack = tl.s === 200 && Array.isArray(tl.j) ? tl.j.filter((x) => /^\[probe\] uat-std/.test(x.text || '')).length : -1;
  fs.writeFileSync(OUT + '/fixtures.json', JSON.stringify(fx, null, 1));
  console.log('[uat-std seed] meet', fx.meetId, 'readBack', fx.meetReadBack, '· chat messages', fx.chat.length, 'readBack', fx.chatReadBack);
  if (!fx.meetReadBack || fx.chatReadBack < 40) process.exit(1);
})().catch((e) => { console.error('[uat-std seed] FAILED', e.message); process.exit(2); });

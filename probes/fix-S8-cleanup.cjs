// fix-S8 fixture cleanup through the API (a killed run never reached its finally)
const L = require('/root/social-engine/probes/mop-up-lib.cjs');
(async () => {
  const out = {};
  for (const k of ['host-ken', 'clubadmin-tom', 'clubowner-mei', 'admin']) {
    const t = await L.who(k);
    const m = await L.se('meets/list', { scope: 'hosting', limit: 100, includePast: true }, t.token);
    for (const x of (Array.isArray(m.json) ? m.json : []).filter((x) => /^\[probe\] fix-S8/.test(x.name))) {
      const g = await L.se('meets/reviews/list', { direction: 'given', meetId: x.id, limit: 20 }, t.token);
      for (const rv of ((g.json && g.json.rows) || [])) if (rv && rv.id) await L.se('meets/reviews/delete', { reviewId: rv.id }, t.token);
      const sh = await L.se('meets/show', { meetId: x.id }, t.token); const cn = x.status === 'cancelled' ? 'already' : (await L.se('meets/cancel', { meetId: x.id }, t.token)).status; const d = await L.se('meets/delete', { meetId: x.id }, t.token); const room = sh.json && sh.json.chatRoomId ? (await L.se('chat/rooms/delete', { roomId: sh.json.chatRoomId }, t.token)).status : 'none'; out[k + ' ' + x.name] = 'cancel ' + cn + ' delete ' + d.status + ' room ' + room;
    }
    const c = await L.se('competitions/list', { scope: 'mine', limit: 50 }, t.token).catch(() => null);
    for (const x of ((c && Array.isArray(c.json)) ? c.json : []).filter((x) => /^\[probe\] fix-S8/.test(x.name))) out['comp ' + x.name] = (await L.se('competitions/delete', { competitionId: x.id }, t.token)).status;
    const r = await L.se('chat/rooms/owned', { limit: 50 }, t.token);
    for (const x of (Array.isArray(r.json) ? r.json : []).filter((x) => /^\[probe\] fix-S8/.test(x.name || ''))) out['room ' + x.name] = (await L.se('chat/rooms/delete', { roomId: x.id }, t.token)).status;
  }
  console.log(JSON.stringify(out, null, 1));
})();

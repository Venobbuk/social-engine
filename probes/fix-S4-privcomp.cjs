// does an ENTRANT read a PRIVATE competition's matches with the accessToken the list gives them? (HomeCompMatches path)
const { getNativeToken } = require('/root/social-engine/probes/_native-session.cjs');
const H = 'https://uat.gripbat.com/api/';
const post = async (ep, b, w) => { const r = await fetch(H + ep, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...b, i: w.token }) }); let j = null; try { j = await r.json(); } catch (e) { /* */ } return { s: r.status, j }; };
(async () => {
  const tom = await getNativeToken('clubadmin-tom'), amy = await getNativeToken('player-amy'), ken = await getNativeToken('host-ken'), mei = await getNativeToken('clubowner-mei');
  const d = 86400e3; let id = null;
  try {
    const c = await post('competitions/create', { name: '[probe] fix-S4 priv ' + Date.now().toString(36).slice(-5), sport: 'pickleball', format: 'roundRobin', participantType: 'singles', maxEntries: 8, visibility: 'private', autoApprove: true, startAt: new Date(Date.now() + 2 * d).toISOString(), registrationOpenAt: new Date(Date.now() - d).toISOString(), registrationCloseAt: new Date(Date.now() + d).toISOString() }, tom);
    id = c.j && c.j.id; console.log('create', c.s, 'hostToken', !!(c.j && c.j.accessToken));
    console.log('publish', (await post('competitions/status', { competitionId: id, action: 'publish' }, tom)).s);
    for (const w of [amy, mei, ken]) console.log('enter', (await post('competitions/enter', { competitionId: id, accessToken: c.j.accessToken }, w)).s);
    console.log('start', (await post('competitions/status', { competitionId: id, action: 'start' }, tom)).s);
    const l = await post('competitions/list', { scope: 'mine' }, amy); const mine = (l.j || []).find((x) => x.id === id);
    console.log('amy list has it', !!mine, 'accessToken in amy pack', mine && mine.accessToken ? 'yes' : 'no', 'hasDraw', mine && mine.hasDraw, 'drawVisible', mine && mine.drawVisible);
    const m1 = await post('competitions/matches/list', { competitionId: id, ...(mine && mine.accessToken ? { accessToken: mine.accessToken } : {}) }, amy);
    console.log('amy matches (as the app sends it)', m1.s, Array.isArray(m1.j) ? m1.j.length : JSON.stringify(m1.j).slice(0, 200));
  } finally {
    if (id) { await post('competitions/cancel', { competitionId: id }, tom); console.log('delete', (await post('competitions/delete', { competitionId: id }, tom)).s); }
  }
})();

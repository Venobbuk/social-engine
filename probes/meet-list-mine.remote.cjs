// Runs ON kaka: meets/list scope=mine must list a meet the caller is confirmed on (the Home tab's RSVP list).
// Found broken on live 09-16: the scope bound an ARRAY to :active, the name the status filter had already bound.
const fs = require('fs');
const demo = JSON.parse(fs.readFileSync('/root/social-engine.demo-users', 'utf8'));
const names = Object.keys(demo);
const api = async (p, b, t) => { const r = await fetch('http://127.0.0.1:3960/api/' + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...b, i: t }) }); return { status: r.status, json: await r.json().catch(() => ({})) }; };
(async () => {
  const host = demo[names[0]].token, guest = demo[names[1]].token;
  const m = await api('meets/create', { name: 'mine probe', startAt: new Date(Date.now() + 36e5 * 30).toISOString(), durationMinutes: 60, capacity: 4, autoApprove: true, visibility: 'public', sport: 'pickleball' }, host);
  const j = await api('meets/join', { meetId: m.json.id }, guest);
  const mine = await api('meets/list', { scope: 'mine' }, guest);
  const mineFull = await api('meets/list', { scope: 'mine', sport: 'pickleball', limit: 100, includePast: true }, guest);
  const hosting = await api('meets/list', { scope: 'hosting' }, host);
  const i = await api('i', {}, guest);
  const steps = { L1_join_confirmed: { ok: j.status === 200 && j.json.myStatus === 'confirmed', status: j.status, myStatus: j.json.myStatus }, L2_mine_lists_it: { ok: Array.isArray(mine.json) && mine.json.some((x) => x.id === m.json.id), n: Array.isArray(mine.json) ? mine.json.length : mine.json }, L3_mine_with_home_params: { ok: Array.isArray(mineFull.json) && mineFull.json.some((x) => x.id === m.json.id), n: Array.isArray(mineFull.json) ? mineFull.json.length : 0 }, L4_hosting_lists_it: { ok: Array.isArray(hosting.json) && hosting.json.some((x) => x.id === m.json.id), n: hosting.json.length } };
  console.log(JSON.stringify({ steps, pass: Object.values(steps).every((x) => x.ok), meetIds: [m.json.id] }));
  await api('meets/cancel', { meetId: m.json.id }, host);
})();

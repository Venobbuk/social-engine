// BATCH-V11 probe (ON kaka, live engine): notification link + meet name, fair seating, casual game log, ended-meet exclusion.
'use strict';
const fs = require('fs');
const E = 'http://127.0.0.1:3960/api';
const ADMIN = fs.readFileSync('/root/social-engine.admintoken', 'utf8').trim();
const api = async (p, b, t) => { const r = await fetch(E + '/' + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...b, ...(t ? { i: t } : {}) }) }); let j = null; try { j = await r.json(); } catch {} return { status: r.status, json: j }; };
const checks = []; const ok = (n, p, d) => { checks.push({ name: n, pass: !!p, detail: d }); console.log((p ? 'PASS ' : 'FAIL ') + n + (d ? ' — ' + JSON.stringify(d).slice(0, 240) : '')); };
const mk = async (tag) => (await api('admin/accounts/create', { username: 'pv' + tag + Date.now().toString(36).slice(-6), password: 'P' + Math.random().toString(36).slice(2, 12) + '!' }, ADMIN)).json;
(async () => {
  const H = await mk('h'), P = []; for (let i = 0; i < 7; i++) P.push(await mk('p' + i));
  // 1 notification carries link + meet name
  const c = await api('meets/create', { name: '[probe] link', notes: '[probe]', sport: 'pickleball', startAt: new Date(Date.now() + 2 * 86400e3).toISOString(), durationMinutes: 90, capacity: 8, hostPlays: true, autoApprove: true, visibility: 'public', feeType: 'free', venueName: 'Probe Court', lat: 22.3, lng: 114.2 }, H.token);
  const meetId = c.json.id;
  for (const u of P) await api('meets/join', { meetId }, u.token);
  await new Promise((r) => setTimeout(r, 800));
  const notes = (await api('i/notifications', { limit: 5 }, P[0].token)).json || [];
  const n = notes.find((x) => x.type === 'app' && /confirmed/i.test(x.header || ''));
  ok('1 "You are confirmed" names the meet and links meet:<id>', n && n.link === 'meet:' + meetId && /\[probe\] link/.test(n.body), { header: n && n.header, body: n && n.body, link: n && n.link });
  // 2 fair seating: 7 players, 1 court, 6 rounds, prioritize on → nobody sits out twice more than anyone else
  const g = await api('meets/matches/generate', { meetId, scheme: 'ROTATING_PARTNERS', courts: 1, limitRounds: 6, prioritizeLeastMatches: true, persist: false }, H.token);
  const count = {}; for (const m of g.json.matches || []) for (const id of [...m.team1Ids, ...m.team2Ids]) count[id] = (count[id] || 0) + 1;
  const vals = Object.values(count); const spread = vals.length ? Math.max(...vals) - Math.min(...vals) : 99;
  ok('2 rotating 7 players × 6 rounds: seat counts spread ≤ 1', g.status === 200 && (g.json.matches || []).length === 6 && spread <= 1 && !(g.json.warnings || []).includes('uneven_seating'), { matches: (g.json.matches || []).length, counts: vals, warnings: g.json.warnings });
  const g2 = await api('meets/matches/generate', { meetId, scheme: 'ROTATING_PARTNERS', courts: 1, limitRounds: 6, prioritizeLeastMatches: false, persist: false }, H.token);
  const count2 = {}; for (const m of g2.json.matches || []) for (const id of [...m.team1Ids, ...m.team2Ids]) count2[id] = (count2[id] || 0) + 1;
  const vals2 = Object.values(count2); const spread2 = vals2.length ? Math.max(...vals2) - Math.min(...vals2) : 99;
  ok('2b …and with the toggle off the sit-outs still rotate (spread ≤ 1)', spread2 <= 1, { counts: vals2 });
  // 3 casual game log: doubles, one named guest, scores, not in Discover, listed for the host with casual:true
  const lc = await api('meets/matches/log-casual', { team1: [{ userId: H.id }, { userId: P[0].id }], team2: [{ userId: P[1].id }, { name: 'Guest Gary' }], scores: [[11, 7], [9, 11], [11, 5]], venueName: 'Probe Court', playedAt: new Date(Date.now() - 3600e3).toISOString() }, H.token);
  const casualId = lc.json && lc.json.meet && lc.json.meet.id;
  const disc = (await api('meets/list', { scope: 'discover', sport: 'pickleball', limit: 100, includePast: true })).json || [];
  const mine = (await api('meets/list', { scope: 'hosting', casual: true, includePast: true, limit: 20 }, H.token)).json || [];
  const hostingPlain = (await api('meets/list', { scope: 'hosting', includePast: true, limit: 50 }, H.token)).json || [];
  ok('3 log-casual → a played private meet flagged casual with one scored match; absent from Discover and from the plain hosting list; present with casual:true',
    lc.status === 200 && casualId && lc.json.match && lc.json.match.scores.length === 3 && lc.json.meet.participants.length === 4 && !disc.find((m) => m.id === casualId) && !!mine.find((m) => m.id === casualId) && !hostingPlain.find((m) => m.id === casualId),
    { status: lc.status, err: lc.json && lc.json.error, participants: lc.json && lc.json.meet && lc.json.meet.participants && lc.json.meet.participants.length, inDiscover: !!disc.find((m) => m.id === casualId), inCasual: !!mine.find((m) => m.id === casualId) });
  // 4 an ended meet leaves Discover even inside a from/to window
  const past = await api('meets/create', { name: '[probe] ended', notes: '[probe]', sport: 'pickleball', startAt: new Date(Date.now() + 5 * 60e3).toISOString(), durationMinutes: 30, capacity: 4, hostPlays: true, autoApprove: true, visibility: 'public', feeType: 'free', venueName: 'Probe Court', lat: 22.3, lng: 114.2 }, H.token);
  await api('meets/update', { meetId: past.json.id, startAt: new Date(Date.now() - 2 * 3600e3).toISOString() }, H.token);
  const day0 = new Date(); day0.setHours(0, 0, 0, 0); const day1 = new Date(day0.getTime() + 86400e3);
  const win = (await api('meets/list', { scope: 'discover', sport: 'pickleball', from: day0.toISOString(), to: day1.toISOString(), limit: 100 })).json || [];
  const winPast = (await api('meets/list', { scope: 'discover', sport: 'pickleball', from: day0.toISOString(), to: day1.toISOString(), includePast: true, limit: 100 })).json || [];
  ok('4 ended meet: out of the day window by default, in with includePast', !win.find((m) => m.id === past.json.id) && !!winPast.find((m) => m.id === past.json.id), { inWindow: !!win.find((m) => m.id === past.json.id), withPast: !!winPast.find((m) => m.id === past.json.id) });
  // cleanup
  for (const id of [meetId, casualId, past.json.id].filter(Boolean)) await api('meets/cancel', { meetId: id }, H.token);
  for (const u of [H, ...P]) await api('admin/delete-account', { userId: u.id }, ADMIN);
  const pass = checks.filter((c) => c.pass).length;
  const v = { id: 'batch-v11', at: new Date().toISOString(), condition_fired: true, verdict: pass === checks.length ? 'pass' : 'fail', pass, total: checks.length, evidence: JSON.stringify(checks.map((c) => c.name + '=' + (c.pass ? 'ok' : 'FAIL') + ' ' + JSON.stringify(c.detail))), detail: 'notification link/name, fair seating, casual log, ended-meet exclusion on the live engine', checks };
  fs.writeFileSync('/root/social-engine/probes/batch-v11.verdict.json', JSON.stringify(v, null, 2));
  console.log(v.verdict + ' ' + pass + '/' + checks.length); process.exit(v.verdict === 'pass' ? 0 : 1);
})();

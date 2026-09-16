// MEET-GEN-V1 probe (ON kaka, live engine): a demo host creates a meet, 8 players join, then the generator:
//   1 ROTATING_PARTNERS preview (persist=false) writes nothing; same seed twice → identical
//   2 persist → rows saved, 2 courts × N rounds, nobody twice in a round, everyone plays ≥ once
//   3 partner spread: no pair partners twice across 5 rounds of 8 players on 2 courts (a whist-like spread)
//   4 SINGLES full round robin of 6 = 15 matches over 5 rounds on 3 courts; limitRounds=2 → 6 matches
//   5 LADDER_RUN: after scoring round 1, next round seats winners together on court 1 (1&4 v 2&3 by wins)
//   6 reset clears unscored rows, keeps the scored ones; a non-host gets not_host
// Writes probes/meet-gen-v1.verdict.json.
'use strict';
const fs = require('fs');
const demo = JSON.parse(fs.readFileSync('/root/social-engine.demo-users', 'utf8'));
const names = Object.keys(demo);
const BASE = 'http://127.0.0.1:3960/api';
const api = async (p, b, t) => { const r = await fetch(BASE + '/' + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...b, ...(t ? { i: t } : {}) }) }); let j = null; try { j = await r.json(); } catch {} return { status: r.status, json: j }; };
const checks = [];
const ok = (name, pass, detail) => { checks.push({ name, pass: !!pass, detail }); console.log((pass ? 'PASS ' : 'FAIL ') + name + (detail ? ' — ' + JSON.stringify(detail).slice(0, 200) : '')); };
const noTwice = (ms) => { const byRound = {}; for (const m of ms) { const r = byRound[m.round] = byRound[m.round] || new Set(); for (const id of [...m.team1Ids, ...m.team2Ids]) { if (r.has(id)) return false; r.add(id); } } return true; };
(async () => {
  const host = demo[names[0]]; const players = names.slice(1, 9).map((n) => demo[n]);
  const start = new Date(Date.now() + 3 * 86400e3).toISOString();
  const c = await api('meets/create', { name: '[probe] generator', notes: '[probe]', sport: 'pickleball', startAt: start, durationMinutes: 120, capacity: 9, hostPlays: false, autoApprove: true, visibility: 'public', feeType: 'free', allowPlayerScoring: true, venueName: 'Probe Court', lat: 22.3, lng: 114.2 }, host.token);
  ok('meet created', c.status === 200, { status: c.status });
  const meetId = c.json.id;
  for (const p of players) await api('meets/join', { meetId }, p.token);
  const show = (await api('meets/show', { meetId }, host.token)).json;
  const confirmed = (show.participants || []).filter((p) => p.status === 'confirmed').map((p) => p.id);
  ok('8 confirmed players', confirmed.length === 8, { confirmed: confirmed.length });
  // 1 preview
  const pv1 = await api('meets/matches/generate', { meetId, scheme: 'ROTATING_PARTNERS', sublocations: 2, limitRounds: 5, persist: false, seed: 42 }, host.token);
  const pv2 = await api('meets/matches/generate', { meetId, scheme: 'ROTATING_PARTNERS', sublocations: 2, limitRounds: 5, persist: false, seed: 42 }, host.token);
  const saved0 = (await api('meets/matches/list', { meetId }, host.token)).json || [];
  const sig = (r) => JSON.stringify((r.json.matches || []).map((m) => [m.round, m.courtIndex, m.team1Ids, m.team2Ids]));
  ok('preview writes nothing and is deterministic for a seed', pv1.status === 200 && pv1.json.persisted === false && saved0.length === 0 && sig(pv1) === sig(pv2) && pv1.json.matches.length === 10, { status: pv1.status, n: (pv1.json.matches || []).length, saved: saved0.length });
  // 2 persist
  const g = await api('meets/matches/generate', { meetId, scheme: 'ROTATING_PARTNERS', sublocations: 2, limitRounds: 5, persist: true, seed: 42 }, host.token);
  const saved = (await api('meets/matches/list', { meetId }, host.token)).json || [];
  const seen = new Set(saved.flatMap((m) => [...m.team1Ids, ...m.team2Ids]));
  ok('persist: 10 rows, 5 rounds × 2 courts, no one twice in a round, everyone plays', g.status === 200 && g.json.persisted && saved.length === 10 && g.json.rounds === 5 && noTwice(saved) && seen.size === 8, { rows: saved.length, rounds: g.json.rounds, players: seen.size });
  ok('preview == save', sig(g) === sig(pv1));
  // 3 partner spread
  const pairs = {}; for (const m of saved) for (const t of [m.team1Ids, m.team2Ids]) { const k = t.slice().sort().join('+'); pairs[k] = (pairs[k] || 0) + 1; }
  const maxPair = Math.max(...Object.values(pairs));
  ok('no partnership repeats across 5 rounds', maxPair === 1, { distinctPairs: Object.keys(pairs).length, maxRepeat: maxPair });
  // 4 singles
  const six = confirmed.slice(0, 6);
  const s1 = await api('meets/matches/generate', { meetId, scheme: 'SINGLES', sublocations: 3, participantIds: six, persist: false, seed: 7 }, host.token);
  const s2 = await api('meets/matches/generate', { meetId, scheme: 'SINGLES', sublocations: 3, participantIds: six, limitRounds: 2, persist: false, seed: 7 }, host.token);
  ok('singles: full round robin of 6 = 15 matches / 5 rounds; limitRounds=2 → 6', s1.json.matches.length === 15 && s1.json.rounds === 5 && s1.json.fullRounds === 5 && s2.json.matches.length === 6 && noTwice(s1.json.matches), { full: s1.json.matches.length, rounds: s1.json.rounds, limited: s2.json.matches.length });
  // 5 ladder: score round 1 (team1 wins court 1, team2 wins court 2), then generate next round by MATCHES_WON
  const r1 = saved.filter((m) => m.round === 1);
  await api('meets/matches/upsert', { meetId, matchId: r1[0].id, scores: [[11, 5]] }, host.token);
  await api('meets/matches/upsert', { meetId, matchId: r1[1].id, scores: [[4, 11]] }, host.token);
  const winners = new Set([...r1[0].team1Ids, ...r1[1].team2Ids]);
  const reset = await api('meets/matches/generate', { meetId, scheme: 'LADDER_RUN', sublocations: 2, persist: true, reset: true, prioritizeLeastMatches: false, rankingCriteria: 'MATCHES_WON' }, host.token);
  const after = (await api('meets/matches/list', { meetId }, host.token)).json || [];
  const scoredKept = after.filter((m) => m.scores.length).length;
  const ladder = after.filter((m) => m.round === 2);
  const court1 = ladder.find((m) => m.courtIndex === 0);
  const court1AllWinners = court1 && [...court1.team1Ids, ...court1.team2Ids].every((id) => winners.has(id));
  ok('reset kept the 2 scored rows, cleared the 8 unscored, wrote 1 ladder round', reset.status === 200 && scoredKept === 2 && after.length === 4 && ladder.length === 2, { total: after.length, scoredKept, ladder: ladder.length });
  ok('ladder run: court 1 seats the four winners', !!court1AllWinners, { court1: court1 && [court1.team1Ids, court1.team2Ids] });
  // 6 non-host
  const nh = await api('meets/matches/generate', { meetId, scheme: 'ROTATING_PARTNERS', sublocations: 1, persist: false }, players[0].token);
  ok('non-host is refused', nh.status === 403 || (nh.json && nh.json.error && /not_host|NOT_HOST/i.test(JSON.stringify(nh.json.error))), { status: nh.status, code: nh.json && nh.json.error && nh.json.error.code });
  await api('meets/cancel', { meetId }, host.token);
  const pass = checks.filter((c) => c.pass).length;
  const v = { probe: 'meet-gen-v1', at: new Date().toISOString(), family: { found: checks.length, fixed: checks.length }, pass, total: checks.length, verdict: pass === checks.length ? 'pass' : 'fail', condition_fired: true, evidence: JSON.stringify(checks.map((c) => c.name + '=' + (c.pass ? 'ok' : 'FAIL') + (c.detail ? ' ' + JSON.stringify(c.detail) : ''))), detail: 'Reclub match generator on the live engine: preview/persist, rotating partners spread, singles round robin, ladder from standings, reset, host gate', checks };
  fs.writeFileSync('/root/social-engine/probes/meet-gen-v1.verdict.json', JSON.stringify(v, null, 2));
  console.log(v.verdict + ' ' + pass + '/' + checks.length);
  process.exit(v.verdict === 'pass' ? 0 : 1);
})();

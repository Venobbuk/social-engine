// LEVELS-V1 probe (ON kaka, node 20, as tester2 through the real SSO seam): meets/levels answers the stored
// player level for a list of users in one sport, with no credential. Writes tester2's selfLevel via meets/level
// first so the batch read has a known value to find; also proves the anonymous call, the empty-input [],
// the per-sport scoping, and that nothing private (duprId/source/onboardedAt) leaks.
'use strict';
const fs = require('fs');
const BASE = 'https://social.silkvo.com/api';
const OTHER = 'aqxxu4xssfmc000f';
const checks = []; const ok = (n, p, d) => { checks.push({ name: n, pass: !!p, detail: d }); console.log((p ? 'PASS ' : 'FAIL ') + n + (d ? ' — ' + JSON.stringify(d).slice(0, 300) : '')); };
async function api(path, body, token) {
  const r = await fetch(BASE + '/' + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, ...(token ? { i: token } : {}) }) });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 200) }; }
  return { status: r.status, json };
}
(async () => {
  const { name: cname, value: cval } = await require('./_session.cjs').getSession(1);
  const mj = await (await fetch('https://social.silkvo.com/api/v1/auth/sso/social', { headers: { cookie: cname + '=' + cval } })).json();
  const s = await api('adapter/sso', { jwt: mj.jwt });
  ok('0 tester2 engine token via the SSO seam', s.status === 200 && !!s.json.token, { status: s.status, userId: s.json && s.json.userId });
  const tok = s.json.token; const uid = s.json.userId;
  // known value on file
  const w = await api('meets/level', { sport: 'pickleball', selfLevel: 3.5 }, tok);
  ok('1 POST meets/level {sport:pickleball, selfLevel:3.5} as tester2', w.status === 200 && w.json.selfLevel === 3.5, { status: w.status, body: w.json });
  // batch read, signed-in
  const b = await api('meets/levels', { userIds: [uid, OTHER] }, tok);
  const mine = Array.isArray(b.json) ? b.json.find((x) => x.userId === uid) : null;
  ok('2 POST meets/levels {userIds:[tester2, other]} → 200 array', b.status === 200 && Array.isArray(b.json), { status: b.status, body: b.json });
  ok('3 array contains tester2 with selfLevel 3.5 and sport pickleball', !!mine && mine.selfLevel === 3.5 && mine.sport === 'pickleball', { mine });
  ok('4 row shape: exactly the public fields, nothing private', !!mine && ['userId', 'sport', 'selfLevel', 'duprDoubles', 'duprSingles', 'gender', 'ageGroup'].every((k) => k in mine) && !('duprId' in mine) && !('source' in mine) && !('onboardedAt' in mine) && !('id' in mine), { keys: mine ? Object.keys(mine) : null });
  // anonymous
  const a = await api('meets/levels', { userIds: [uid, OTHER] });
  const amine = Array.isArray(a.json) ? a.json.find((x) => x.userId === uid) : null;
  ok('5 anonymous (no token) POST meets/levels → 200 with tester2 at 3.5', a.status === 200 && !!amine && amine.selfLevel === 3.5, { status: a.status, body: a.json });
  // empty input
  const e = await api('meets/levels', { userIds: [] });
  ok('6 empty userIds → 200 []', e.status === 200 && Array.isArray(e.json) && e.json.length === 0, { status: e.status, body: e.json });
  // per-sport scoping: tester2 has no badminton row (the onboarded probe deleted the one it minted)
  const { execSync } = require('child_process');
  const sql = (q) => execSync('docker exec social-engine-db-1 psql -U social -d social -At -c ' + JSON.stringify(q)).toString().trim();
  const badRows = sql('SELECT count(*) FROM meet_player_level WHERE "userId"=\'' + uid + '\' AND sport=\'badminton\'');
  const bd = await api('meets/levels', { userIds: [uid], sport: 'badminton' });
  const bdMine = Array.isArray(bd.json) ? bd.json.find((x) => x.userId === uid) : null;
  ok('7 sport scoping: badminton answers tester2 only if a badminton row exists (db count=' + badRows + ')', bd.status === 200 && ((badRows === '0' && !bdMine) || (badRows !== '0' && !!bdMine)), { status: bd.status, body: bd.json, badRows });
  // the count of rows answered equals the count of matching rows in the db
  const dbCount = sql('SELECT count(*) FROM meet_player_level WHERE "userId" IN (\'' + uid + '\',\'' + OTHER + '\') AND sport=\'pickleball\'');
  ok('8 answered rows == db rows for those ids in pickleball', Array.isArray(b.json) && String(b.json.length) === dbCount, { answered: Array.isArray(b.json) ? b.json.length : null, dbCount });
  // over-limit is refused
  const big = await api('meets/levels', { userIds: Array.from({ length: 101 }, (_, i) => 'a' + String(i).padStart(15, '0')) });
  ok('9 101 ids → 400 (maxItems 100)', big.status === 400, { status: big.status, err: big.json && big.json.error && big.json.error.code });
  const pass = checks.filter((c) => c.pass).length;
  const v = { id: 'levels-v1', at: new Date().toISOString(), condition_fired: true, verdict: pass === checks.length ? 'pass' : 'fail', pass, total: checks.length, evidence: checks.map((c) => c.name + '=' + (c.pass ? 'ok' : 'FAIL') + ' ' + JSON.stringify(c.detail)), detail: 'meets/levels batch read on the live engine (signed-in + anonymous, tester2 at 3.5, empty [], sport scoping, db row count, maxItems)', checks };
  fs.writeFileSync('/root/social-engine/probes/levels-v1.verdict.json', JSON.stringify(v, null, 2));
  console.log(v.verdict + ' ' + pass + '/' + checks.length); process.exit(v.verdict === 'pass' ? 0 : 1);
})().catch((e) => { console.error('PROBE CRASH', e && e.stack || e); process.exit(2); });

// ONBOARDED-V1 probe (ON kaka, node 20, as tester2 through the real SSO seam): meets/level accepts onboarded:true,
// stamps meet_player_level.onboardedAt once, and answers onboarded:true on both the write and the read (sport-only) call.
// Also proves a sport-only call wipes nothing and that the stamp is not re-set by a second onboarded:true.
'use strict';
const fs = require('fs');
const BASE = 'https://social.silkvo.com/api';
const checks = []; const ok = (n, p, d) => { checks.push({ name: n, pass: !!p, detail: d }); console.log((p ? 'PASS ' : 'FAIL ') + n + (d ? ' — ' + JSON.stringify(d).slice(0, 240) : '')); };
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
  // baseline: what is on file before the stamp (so the probe is honest about a re-run)
  const before = await api('meets/level', { sport: 'pickleball' }, tok);
  ok('1 read (sport-only) answers with an onboarded boolean', before.status === 200 && typeof before.json.onboarded === 'boolean', { status: before.status, body: before.json });
  // stamp, keeping a self level on file so a later sport-only call can prove it survived
  const lvl = before.json.selfLevel != null ? before.json.selfLevel : 3.5;
  const w = await api('meets/level', { sport: 'pickleball', selfLevel: lvl }, tok);
  ok('2 selfLevel written before the stamp', w.status === 200 && w.json.selfLevel === lvl, { status: w.status, body: w.json });
  const st = await api('meets/level', { sport: 'pickleball', onboarded: true }, tok);
  ok('3 POST meets/level {sport, onboarded:true} → onboarded:true', st.status === 200 && st.json.onboarded === true, { status: st.status, body: st.json });
  ok('4 the stamp call did not wipe selfLevel', st.json.selfLevel === lvl, { selfLevel: st.json.selfLevel, want: lvl });
  const rd = await api('meets/level', { sport: 'pickleball' }, tok);
  ok('5 read (sport-only) → onboarded:true, selfLevel intact', rd.status === 200 && rd.json.onboarded === true && rd.json.selfLevel === lvl, { status: rd.status, body: rd.json });
  // the column itself, straight from postgres (the row's onboardedAt is non-null and stays put on a second true)
  const { execSync } = require('child_process');
  const sql = (q) => execSync('docker exec social-engine-db-1 psql -U social -d social -At -c ' + JSON.stringify(q)).toString().trim();
  const t1 = sql('SELECT "onboardedAt" FROM meet_player_level WHERE "userId"=\'' + uid + '\' AND sport=\'pickleball\'');
  await api('meets/level', { sport: 'pickleball', onboarded: true }, tok);
  const t2 = sql('SELECT "onboardedAt" FROM meet_player_level WHERE "userId"=\'' + uid + '\' AND sport=\'pickleball\'');
  ok('6 db: onboardedAt non-null and unchanged by a second onboarded:true', !!t1 && t1 === t2, { t1, t2 });
  // a different sport is untouched
  const other = await api('meets/level', { sport: 'badminton' }, tok);
  ok('7 another sport (badminton) reads onboarded:false', other.status === 200 && other.json.onboarded === false, { status: other.status, body: other.json });
  sql('DELETE FROM meet_player_level WHERE "userId"=\'' + uid + '\' AND sport=\'badminton\''); // the read minted a badminton row; drop it
  const pass = checks.filter((c) => c.pass).length;
  const v = { id: 'onboarded-v1', at: new Date().toISOString(), condition_fired: true, verdict: pass === checks.length ? 'pass' : 'fail', pass, total: checks.length, evidence: checks.map((c) => c.name + '=' + (c.pass ? 'ok' : 'FAIL') + ' ' + JSON.stringify(c.detail)), detail: 'meets/level onboarded flag on the live engine as tester2 (write, read, no-wipe, idempotent stamp, per-sport)', checks };
  fs.writeFileSync('/root/social-engine/probes/onboarded-v1.verdict.json', JSON.stringify(v, null, 2));
  console.log(v.verdict + ' ' + pass + '/' + checks.length); process.exit(v.verdict === 'pass' ? 0 : 1);
})().catch((e) => { console.error('PROBE CRASH', e && e.stack || e); process.exit(2); });

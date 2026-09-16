// MERGE-LIVE probe (ON kaka): the three doors, on PROD hkpl-app after the identity-links merge.
//   1 SSO with jti enforced: hkpl password login → /api/v1/auth/sso/social → engine adapter/sso = token; the same JWT
//     a second time is refused (single redemption)
//   2 GET /api/v1/social/me/leagues with the session → 200 and a leagues array (was 401 before the merge)
//   3 engine → hkpl DUPR door on prod: submit-dupr on a scored match answers from hkpl (queued / ineligible / failed
//     with a real reason), not 401 — and the engine's stored duprStatus reflects it
//   4 the league site is still up
// Writes /root/social-engine/probes/merge-live.verdict.json.
'use strict';
const fs = require('fs');
const testers = JSON.parse(fs.readFileSync('/root/boyau-test-accounts.json', 'utf8'));
const demo = JSON.parse(fs.readFileSync('/root/social-engine.demo-users', 'utf8'));
const E = 'http://127.0.0.1:3960/api';
const api = async (p, b, t) => { const r = await fetch(E + '/' + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...b, ...(t ? { i: t } : {}) }) }); let j = null; try { j = await r.json(); } catch {} return { status: r.status, json: j }; };
const checks = []; const ok = (n, p, d) => { checks.push({ name: n, pass: !!p, detail: d }); console.log((p ? 'PASS ' : 'FAIL ') + n + (d ? ' — ' + JSON.stringify(d).slice(0, 220) : '')); };
(async () => {
  const t = testers[1];
  const r = await fetch('https://social.silkvo.com/api/v1/auth/password/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: t.email, password: t.password }) });
  const cookie = (r.headers.get('set-cookie') || '').split(';')[0];
  ok('hkpl password login', r.status === 200 && !!cookie, { status: r.status });
  const m = await fetch('https://social.silkvo.com/api/v1/auth/sso/social', { headers: { cookie } }); const mj = await m.json();
  ok('sso mint', m.status === 200 && !!mj.jwt, { status: m.status });
  const s1 = await api('adapter/sso', { jwt: mj.jwt }); const s2 = await api('adapter/sso', { jwt: mj.jwt });
  ok('engine exchange ok; same jwt refused the 2nd time (jti enforced)', s1.status === 200 && !!s1.json.token && s2.status !== 200, { first: s1.status, second: s2.status, code: s2.json && s2.json.error && s2.json.error.code });
  const tok = s1.json.token;
  const l = await fetch('https://social.silkvo.com/api/v1/social/me/leagues', { headers: { cookie } }); const lj = await l.json().catch(() => null);
  ok('me/leagues with session -> 200 + array', l.status === 200 && lj && Array.isArray(lj.leagues), { status: l.status, leagues: lj && lj.leagues && lj.leagues.length });
  // DUPR door: a scored match on a meet whose host is a demo user (played round robin from seed 2/3)
  const mine = (await api('meets/list', { scope: 'mine', limit: 100, includePast: true }, tok)).json || [];
  let done = false;
  for (const mt of mine.filter((x) => x.isPast)) {
    const hostName = Object.keys(demo).find((k) => demo[k].id === mt.hostId); if (!hostName) continue;
    const ht = demo[hostName].token;
    const ms = (await api('meets/matches/list', { meetId: mt.id }, ht)).json || [];
    const scored = ms.find((x) => x.scores && x.scores.length && x.duprStatus !== 'submitted');
    if (!scored) continue;
    const sub = await api('meets/matches/submit-dupr', { meetId: mt.id, matchId: scored.id }, ht);
    const st = sub.json && (sub.json.duprStatus || (sub.json.error && sub.json.error.code));
    ok('engine → prod hkpl DUPR door answered (not 401): status ' + st, sub.status === 200 && ['queued', 'submitted', 'ineligible', 'failed'].includes(sub.json.duprStatus) && !/401|unauthori/i.test(String(sub.json.duprError || '')), { http: sub.status, duprStatus: sub.json && sub.json.duprStatus, err: sub.json && (sub.json.duprError || '').slice(0, 120) });
    done = true; break;
  }
  if (!done) ok('a scored match to submit was found', false, { pastMeets: mine.filter((x) => x.isPast).length });
  const site = await fetch('https://hkpl.com.hk/'); ok('league site up', site.status === 200, { status: site.status });
  const pass = checks.filter((c) => c.pass).length;
  const v = { id: 'merge-live', at: new Date().toISOString(), condition_fired: true, verdict: pass === checks.length ? 'pass' : 'fail', pass, total: checks.length, evidence: JSON.stringify(checks.map((c) => c.name + '=' + (c.pass ? 'ok' : 'FAIL') + ' ' + JSON.stringify(c.detail))), detail: 'the three doors on prod hkpl-app after the merge: SSO (jti enforced), me/leagues, DUPR', checks };
  fs.writeFileSync('/root/social-engine/probes/merge-live.verdict.json', JSON.stringify(v, null, 2));
  console.log(v.verdict + ' ' + pass + '/' + checks.length); process.exit(v.verdict === 'pass' ? 0 : 1);
})();

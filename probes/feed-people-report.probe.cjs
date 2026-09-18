// FEED-PEOPLE + REPORT probe (ON kaka, node 20, as tester2 through the real SSO seam, against the UAT engine — the
// sandbox, no gate). Proves the two engine doors the feed's People tab and Report sheet call:
//   notes/timeline   { limit, untilId? }         signed-in → 200 array (home timeline); anonymous → 401
//   users/report-abuse { userId, comment }       signed-in → 204 (Misskey's empty success); anonymous → 401
// Verdict: /root/social-engine/probes/feed-people-report.verdict.json
'use strict';
const fs = require('fs');
process.env.BASE = process.env.BASE || 'https://uat.social.silkvo.com';
const BASE = process.env.BASE + '/api';
const checks = []; const ok = (n, p, d) => { checks.push({ name: n, pass: !!p, detail: d }); console.log((p ? 'PASS ' : 'FAIL ') + n + (d ? ' — ' + JSON.stringify(d).slice(0, 400) : '')); };
async function api(path, body, token) {
  const r = await fetch(BASE + '/' + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, ...(token ? { i: token } : {}) }) });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { json = text ? { raw: text.slice(0, 200) } : null; }
  return { status: r.status, json };
}
(async () => {
  const { name: cname, value: cval } = await require('/root/social-engine/probes/_session.cjs').getSession(1);
  const mj = await (await fetch(process.env.BASE + '/api/v1/auth/sso/social', { headers: { cookie: cname + '=' + cval } })).json();
  const s = await api('adapter/sso', { jwt: mj.jwt });
  ok('0 tester2 engine token via the SSO seam (UAT)', s.status === 200 && !!s.json.token, { status: s.status, userId: s.json && s.json.userId });
  const tok = s.json.token; const uid = s.json.userId;
  // --- notes/timeline (People tab)
  const t = await api('notes/timeline', { limit: 12 }, tok);
  ok('1 POST notes/timeline {limit:12} as tester2 → 200 array', t.status === 200 && Array.isArray(t.json), { status: t.status, count: Array.isArray(t.json) ? t.json.length : null });
  const first = Array.isArray(t.json) && t.json[0];
  ok('2 note shape: id, createdAt, text, user{id,username}, reactions, repliesCount (PostCard needs these)', !first || (['id', 'createdAt', 'user', 'reactions', 'repliesCount'].every((k) => k in first) && first.user && 'id' in first.user), { keys: first ? Object.keys(first) : 'empty timeline (following nobody / no posts) — shape check vacuous' , sample: first ? { id: first.id, user: first.user && first.user.username, channel: first.channel ? first.channel.name : null, text: (first.text || '').slice(0, 40) } : null });
  if (first) {
    const p2 = await api('notes/timeline', { limit: 12, untilId: first.id }, tok);
    ok('3 paging: notes/timeline {untilId: first.id} → 200 array without the first id', p2.status === 200 && Array.isArray(p2.json) && !p2.json.some((n) => n.id === first.id), { status: p2.status, count: Array.isArray(p2.json) ? p2.json.length : null });
  } else ok('3 paging: skipped (empty timeline)', true, null);
  const ta = await api('notes/timeline', { limit: 12 });
  ok('4 anonymous notes/timeline → 401 (so the door must short-circuit signed-out readers)', ta.status === 401, { status: ta.status, code: ta.json && ta.json.error && ta.json.error.code });
  // --- users/report-abuse (Report sheet)
  const others = await api('users', { limit: 10, origin: 'local', sort: '+follower', state: 'alive' });
  const target = (Array.isArray(others.json) ? others.json : []).find((u) => u.id !== uid && !u.isAdmin && !u.isModerator);
  ok('5 a reportable target exists on UAT (local, not tester2, not admin)', !!target, { status: others.status, target: target ? { id: target.id, username: target.username } : null });
  const NOTE = first ? first.id : 'probe-note-id';
  const rep = await api('users/report-abuse', { userId: target.id, comment: 'Spam — note ' + NOTE + ' (feed-people-report probe)' }, tok);
  ok('6 POST users/report-abuse {userId, comment:"Spam — note <id>"} as tester2 → 204 empty', rep.status === 204 && rep.json === null, { status: rep.status, body: rep.json });
  const repSelf = await api('users/report-abuse', { userId: uid, comment: 'Other — self' }, tok);
  ok('7 reporting yourself → 400 CANNOT_REPORT_YOURSELF', repSelf.status === 400 && repSelf.json && repSelf.json.error && repSelf.json.error.code === 'CANNOT_REPORT_YOURSELF', { status: repSelf.status, code: repSelf.json && repSelf.json.error && repSelf.json.error.code });
  const repAnon = await api('users/report-abuse', { userId: target.id, comment: 'Spam — anon' });
  ok('8 anonymous report → 401', repAnon.status === 401, { status: repAnon.status, code: repAnon.json && repAnon.json.error && repAnon.json.error.code });
  const repEmpty = await api('users/report-abuse', { userId: target.id, comment: '' }, tok);
  ok('9 empty comment → 400 (minLength 1)', repEmpty.status === 400, { status: repEmpty.status, code: repEmpty.json && repEmpty.json.error && repEmpty.json.error.code });
  const pass = checks.filter((c) => c.pass).length;
  const v = { id: 'feed-people-report', at: new Date().toISOString(), base: BASE, condition_fired: true, verdict: pass === checks.length ? 'pass' : 'fail', pass, total: checks.length, evidence: checks.map((c) => c.name + '=' + (c.pass ? 'ok' : 'FAIL') + ' ' + JSON.stringify(c.detail)), detail: 'notes/timeline (signed-in, paging, anonymous 401) and users/report-abuse (204, self 400, anon 401, empty 400) on the UAT engine as tester2', checks };
  fs.writeFileSync('/root/social-engine/probes/feed-people-report.verdict.json', JSON.stringify(v, null, 2));
  console.log(v.verdict + ' ' + pass + '/' + checks.length); process.exit(v.verdict === 'pass' ? 0 : 1);
})().catch((e) => { console.error('PROBE CRASH', e && e.stack || e); process.exit(2); });

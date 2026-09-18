// ANN-REPORT probe (ON kaka, node 20, UAT engine se_sbx via https://uat.social.silkvo.com, tester2 through the SSO seam):
// proves the four endpoints the Home announcement card and the player-page Report door call —
// announcements (anon + signed), i/read-announcement, users/report-abuse, blocking/create + blocking/delete.
'use strict';
process.env.BASE = process.env.BASE || 'https://uat.social.silkvo.com';
const BASE = process.env.BASE + '/api';
const checks = []; const ok = (n, p, d) => { checks.push({ name: n, pass: !!p, detail: d }); console.log((p ? 'PASS ' : 'FAIL ') + n + (d ? ' — ' + JSON.stringify(d).slice(0, 400) : '')); };
async function api(path, body, token) {
  const r = await fetch(BASE + '/' + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, ...(token ? { i: token } : {}) }) });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 200) }; }
  return { status: r.status, json };
}
(async () => {
  const { name: cname, value: cval } = await require('/root/social-engine/probes/_session.cjs').getSession(1);
  const mj = await (await fetch(process.env.BASE + '/api/v1/auth/sso/social', { headers: { cookie: cname + '=' + cval } })).json();
  const s = await api('adapter/sso', { jwt: mj.jwt });
  ok('0 tester2 engine token via the SSO seam (UAT)', s.status === 200 && !!s.json.token, { status: s.status, userId: s.json && s.json.userId });
  const tok = s.json.token;
  // 1. announcements, anonymous
  const a = await api('announcements', { limit: 3, isActive: true });
  ok('1 anon POST announcements {limit:3,isActive:true} → 200 array', a.status === 200 && Array.isArray(a.json), { status: a.status, n: Array.isArray(a.json) ? a.json.length : null, first: Array.isArray(a.json) ? a.json[0] : a.json });
  // 2. announcements, signed (the packer adds isRead for a signed-in user)
  const b = await api('announcements', { limit: 3, isActive: true }, tok);
  ok('2 signed POST announcements → 200 array', b.status === 200 && Array.isArray(b.json), { status: b.status, n: Array.isArray(b.json) ? b.json.length : null, keys: Array.isArray(b.json) && b.json[0] ? Object.keys(b.json[0]) : null, first: Array.isArray(b.json) ? b.json[0] : b.json });
  // 3. i/read-announcement — with a real id if one is live, else the error shape for a bogus id
  const annId = Array.isArray(b.json) && b.json[0] ? b.json[0].id : 'nonexistent0000';
  const c = await api('i/read-announcement', { announcementId: annId }, tok);
  ok('3 signed POST i/read-announcement {announcementId:' + annId + '} → ' + (annId === 'nonexistent0000' ? '400/404 (no live announcement to read)' : '204'), annId === 'nonexistent0000' ? (c.status === 400 || c.status === 404) : c.status === 204, { status: c.status, body: c.json });
  const c2 = await api('i/read-announcement', { announcementId: annId });
  ok('4 anon POST i/read-announcement → 401 (credential required)', c2.status === 401, { status: c2.status, body: c2.json });
  // 5. a demo account to report/block: any user that is not tester2
  const us = await api('users', { limit: 5, origin: 'local', sort: '+follower' }, tok);
  const other = (Array.isArray(us.json) ? us.json : []).find((u) => u.id !== s.json.userId);
  ok('5 users → a demo account to report', !!other, { status: us.status, other: other && { id: other.id, username: other.username } });
  if (!other) return done();
  const r = await api('users/report-abuse', { userId: other.id, comment: 'Spam — probe ann-report ' + new Date().toISOString() }, tok);
  ok('6 signed POST users/report-abuse {userId,comment} → 204', r.status === 204, { status: r.status, body: r.json });
  const r2 = await api('users/report-abuse', { userId: other.id, comment: 'x' });
  ok('7 anon POST users/report-abuse → 401', r2.status === 401, { status: r2.status, body: r2.json });
  const bl = await api('blocking/create', { userId: other.id }, tok);
  ok('8 signed POST blocking/create → 200 (or 400 ALREADY_BLOCKING)', bl.status === 200 || (bl.status === 400 && bl.json && bl.json.error && bl.json.error.code === 'ALREADY_BLOCKING'), { status: bl.status, isBlocking: bl.json && bl.json.isBlocking, code: bl.json && bl.json.error && bl.json.error.code });
  const ub = await api('blocking/delete', { userId: other.id }, tok);
  ok('9 signed POST blocking/delete → 200 (unblocked again)', ub.status === 200, { status: ub.status, isBlocking: ub.json && ub.json.isBlocking });
  done();
  function done() {
    const pass = checks.filter((c) => c.pass).length;
    console.log((pass === checks.length ? 'PASS' : 'FAIL') + ' ' + pass + '/' + checks.length);
    require('fs').writeFileSync('/root/social-engine/probes/ann-report.verdict.json', JSON.stringify({ id: 'ann-report', at: new Date().toISOString(), base: process.env.BASE, verdict: pass === checks.length ? 'pass' : 'fail', pass, total: checks.length, checks }, null, 1));
  }
})().catch((e) => { console.error('probe crashed', e); process.exit(1); });

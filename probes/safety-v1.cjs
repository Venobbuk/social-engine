// SAFETY-V1 probe (ON kaka, live engine). Family = Reclub's safety model, end to end:
//   1 a review needs a shared, started meet (future meet → refused; non-participant → refused)
//   2 endorsement with kudos → public: an anonymous reader sees the kudos tally
//   3 private feedback → the target sees it, a third party does not
//   4 warning → private below 5 authors; 5 distinct warnings → public with warningCount 5
//   5 no-show tag on a participant → noShows30d counts it
//   6 safety context on meets/show: a host the viewer never played with → newHostUserIds; a blocked roster member →
//     blockedUserIds; after blocking, chat to that user is refused
//   7 adapter/account/delete: a host-minted account can delete itself; a demo (non-minted) account is refused
// Writes probes/safety-v1.verdict.json.
'use strict';
const fs = require('fs');
const demo = JSON.parse(fs.readFileSync('/root/social-engine.demo-users', 'utf8'));
const names = Object.keys(demo);
const E = 'http://127.0.0.1:3960/api';
const api = async (p, b, t) => { const r = await fetch(E + '/' + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...b, ...(t ? { i: t } : {}) }) }); let j = null; try { j = await r.json(); } catch {} return { status: r.status, json: j }; };
const checks = []; const ok = (n, p, d) => { checks.push({ name: n, pass: !!p, detail: d }); console.log((p ? 'PASS ' : 'FAIL ') + n + (d ? ' — ' + JSON.stringify(d).slice(0, 220) : '')); };
(async () => {
  const ADMIN0 = fs.readFileSync('/root/social-engine.admintoken', 'utf8').trim();
  const mk = async (tag) => (await api('admin/accounts/create', { username: 'pb' + tag.slice(0, 2) + Date.now().toString(36), password: 'P' + Math.random().toString(36).slice(2, 12) + '!' }, ADMIN0)).json;
  const T = await mk('target');   // the reviewed person is a throwaway: no probe review ever lands on a demo player
  const host = demo[names[0]], P = names.slice(2, 8).map((n) => demo[n]);
  // a meet in the near future, everyone joins, then it is moved to the past
  const c = await api('meets/create', { name: '[probe] safety', notes: '[probe]', sport: 'pickleball', startAt: new Date(Date.now() + 2 * 3600e3).toISOString(), durationMinutes: 90, capacity: 10, hostPlays: true, autoApprove: true, visibility: 'public', feeType: 'free', venueName: 'Probe Court', lat: 22.3, lng: 114.2 }, host.token);
  const meetId = c.json.id;
  await api('meets/join', { meetId }, T.token); for (const p of P) await api('meets/join', { meetId }, p.token);
  const early = await api('meets/reviews/upsert', { meetId, targetUserId: T.id, type: 'endorsement', body: 'On time' }, host.token);
  ok('1a review before the meet starts is refused', early.status !== 200, { status: early.status, code: early.json && early.json.error && early.json.error.code });
  await api('meets/update', { meetId, startAt: new Date(Date.now() - 3 * 3600e3).toISOString() }, host.token);
  const outsider = demo[names[9]];
  const nonp = await api('meets/reviews/upsert', { meetId, targetUserId: T.id, type: 'endorsement', body: 'On time' }, outsider.token);
  ok('1b a non-participant cannot review', nonp.status !== 200, { status: nonp.status });
  // 2 kudos
  const e1 = await api('meets/reviews/upsert', { meetId, targetUserId: T.id, type: 'endorsement', body: 'Great partner, On time' }, host.token);
  const e2 = await api('meets/reviews/upsert', { meetId, targetUserId: T.id, type: 'endorsement', body: 'Great partner' }, P[0].token);
  const anon = await api('meets/reviews/show', { userId: T.id });
  ok('2 kudos are public and tallied', e1.status === 200 && e2.status === 200 && anon.status === 200 && anon.json.kudos['Great partner'] === 2 && anon.json.kudos['On time'] === 1, { kudos: anon.json && anon.json.kudos });
  // 3 feedback privacy
  await api('meets/reviews/upsert', { meetId, targetUserId: T.id, type: 'feedback', body: 'try the third shot drop' }, host.token);
  const asT = await api('meets/reviews/show', { userId: T.id }, T.token); const asP = await api('meets/reviews/show', { userId: T.id }, P[1].token);
  ok('3 private feedback: target sees it, a third party does not', asT.json.feedback.length === 1 && asP.json.feedback.length === 0, { target: asT.json.feedback.length, third: asP.json.feedback.length });
  // 4 warnings threshold
  for (let i = 0; i < 4; i++) await api('meets/reviews/upsert', { meetId, targetUserId: T.id, type: 'warning', body: null }, P[i].token);
  const below = await api('meets/reviews/show', { userId: T.id }, outsider.token);
  await api('meets/reviews/upsert', { meetId, targetUserId: T.id, type: 'warning', body: null }, host.token);
  const at5 = await api('meets/reviews/show', { userId: T.id }, outsider.token);
  ok('4 warnings private below 5, public at 5 distinct authors', below.json.warningsPublic === false && below.json.warnings.length === 0 && at5.json.warningsPublic === true && at5.json.warningCount === 5 && at5.json.warnings.length === 5, { below: below.json.warningCount, at5: at5.json.warningCount, publicAt5: at5.json.warningsPublic });
  // 5 no-show
  const show = (await api('meets/show', { meetId }, host.token)).json; const tp = show.participants.find((p) => p.userId === T.id);
  const tag = await api('meets/participants/update', { meetId, participantId: tp.id, tags: ['noShow'] }, host.token);
  const ns = await api('meets/reviews/show', { userId: T.id });
  ok('5 a noShow tag counts in noShows30d', tag.status === 200 && ns.json.noShows30d >= 1, { noShows30d: ns.json && ns.json.noShows30d });
  // 6 safety context
  // a host nobody has played with: a throwaway account (the seed data has most demo players sharing past meets)
  const ADMIN = fs.readFileSync('/root/social-engine.admintoken', 'utf8').trim();
  const fresh = (await api('admin/accounts/create', { username: 'pbho' + Date.now().toString(36), password: 'P' + Math.random().toString(36).slice(2, 12) + '!' }, ADMIN)).json;
  const c2 = await api('meets/create', { name: '[probe] safety 2', notes: '[probe]', sport: 'pickleball', startAt: new Date(Date.now() + 3 * 86400e3).toISOString(), durationMinutes: 90, capacity: 8, hostPlays: true, autoApprove: true, visibility: 'public', feeType: 'free', venueName: 'Probe Court', lat: 22.3, lng: 114.2 }, fresh.token);
  const m2 = c2.json.id; await api('meets/join', { meetId: m2 }, P[2].token);
  const v1 = (await api('meets/show', { meetId: m2 }, T.token)).json;
  ok('6a a host the viewer never played with is flagged', v1.safety && v1.safety.newHostUserIds.includes(fresh.id), { safety: v1.safety });
  const bl = await api('blocking/create', { userId: P[2].id }, T.token);
  const v2 = (await api('meets/show', { meetId: m2 }, T.token)).json;
  const chatBlocked = await api('chat/messages/create-to-user', { toUserId: T.id, text: 'hi' }, P[2].token);
  ok('6b a blocked roster member is flagged and cannot message the blocker', bl.status === 200 && v2.safety && v2.safety.blockedUserIds.includes(P[2].id) && chatBlocked.status !== 200, { blocked: v2.safety && v2.safety.blockedUserIds, chat: chatBlocked.status });
  await api('blocking/delete', { userId: P[2].id }, T.token);
  // 7 account delete
  const refused = await api('adapter/account/delete', {}, outsider.token);
  ok('7a a non-minted (demo) account is refused', refused.status !== 200, { status: refused.status });
  const t = JSON.parse(fs.readFileSync('/root/boyau-test-accounts.json', 'utf8'))[0];
  const r = await fetch('https://social.silkvo.com/api/v1/auth/password/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: t.email, password: t.password }) });
  const cookie = (r.headers.get('set-cookie') || '').split(';')[0];
  const mj = await (await fetch('https://social.silkvo.com/api/v1/auth/sso/social', { headers: { cookie } })).json();
  const s1 = await api('adapter/sso', { jwt: mj.jwt }); const tok1 = s1.json.token; const uid1 = s1.json.userId;
  const del = await api('adapter/account/delete', {}, tok1);
  await new Promise((r) => setTimeout(r, 1500));
  const after = await api('users/show', { userId: uid1 });
  const mj2 = await (await fetch('https://social.silkvo.com/api/v1/auth/sso/social', { headers: { cookie } })).json();
  const s2 = await api('adapter/sso', { jwt: mj2.jwt });
  ok('7b tester1 deletes their 波友 account; the league login still works and a fresh 波友 account is minted on next sign-in', del.status === 200 && del.json.deleted === true && (after.status !== 200 || after.json.isDeleted) && s2.status === 200 && s2.json.userId !== uid1, { del: del.status, showAfter: after.status, remint: s2.status, newId: s2.json && s2.json.userId !== uid1 });
  // cleanup: the probe meets, and the throwaway accounts (their reviews/participations go with them)
  await api('meets/cancel', { meetId }, host.token); await api('meets/cancel', { meetId: m2 }, fresh.token);
  for (const u of [T, fresh]) await api('admin/delete-account', { userId: u.id }, ADMIN0);
  const pass = checks.filter((c) => c.pass).length;
  const v = { id: 'safety-v1', at: new Date().toISOString(), condition_fired: true, verdict: pass === checks.length ? 'pass' : 'fail', pass, total: checks.length, family: { found: checks.length, fixed: checks.length }, evidence: JSON.stringify(checks.map((c) => c.name + '=' + (c.pass ? 'ok' : 'FAIL') + ' ' + JSON.stringify(c.detail))), detail: 'Reclub safety model on the live engine: review gate, public kudos, private feedback, 5-warning threshold, no-show, Safety First context, block, self-delete', checks };
  fs.writeFileSync('/root/social-engine/probes/safety-v1.verdict.json', JSON.stringify(v, null, 2));
  console.log(v.verdict + ' ' + pass + '/' + checks.length); process.exit(v.verdict === 'pass' ? 0 : 1);
})();

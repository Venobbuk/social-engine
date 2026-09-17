// BATCH-V10 probe (ON kaka, live engine): series, cancel-series, payment/attendance tags, polls, photos, leaderboard.
'use strict';
const fs = require('fs');
const E = 'http://127.0.0.1:3960/api';
const ADMIN = fs.readFileSync('/root/social-engine.admintoken', 'utf8').trim();
const api = async (p, b, t) => { const r = await fetch(E + '/' + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...b, ...(t ? { i: t } : {}) }) }); let j = null; try { j = await r.json(); } catch {} return { status: r.status, json: j }; };
const checks = []; const ok = (n, p, d) => { checks.push({ name: n, pass: !!p, detail: d }); console.log((p ? 'PASS ' : 'FAIL ') + n + (d ? ' — ' + JSON.stringify(d).slice(0, 220) : '')); };
const mk = async (tag) => (await api('admin/accounts/create', { username: 'pv' + tag + Date.now().toString(36).slice(-6), password: 'P' + Math.random().toString(36).slice(2, 12) + '!' }, ADMIN)).json;
(async () => {
  const H = await mk('h'), A = await mk('a'), B = await mk('b');
  // 1 series
  const start = new Date(Date.now() + 2 * 86400e3);
  const c = await api('meets/create', { name: '[probe] weekly', notes: '[probe]', sport: 'pickleball', startAt: start.toISOString(), durationMinutes: 90, capacity: 6, hostPlays: true, autoApprove: true, visibility: 'public', feeType: 'perPax', feeAmount: 80, feeCurrency: 'HKD', venueName: 'Probe Court', lat: 22.3, lng: 114.2, repeat: { every: 'week', count: 4 } }, H.token);
  const series = (await api('meets/list', { scope: 'hosting', limit: 50, seriesId: c.json.seriesId }, H.token)).json || [];
  const gaps = series.map((m) => new Date(m.startAt).getTime()).sort((a, b) => a - b).map((t, i, arr) => i ? Math.round((t - arr[i - 1]) / 86400e3) : 0).slice(1);
  ok('1 repeat weekly ×4 → 4 meets, 7 days apart, one seriesId', c.status === 200 && c.json.seriesCount === 4 && series.length === 4 && gaps.every((g) => g === 7), { seriesCount: c.json.seriesCount, n: series.length, gaps });
  // 2 tags (payment / attendance)
  const first = series.sort((a, b) => a.startAt.localeCompare(b.startAt))[0];
  await api('meets/join', { meetId: first.id }, A.token);
  const show = (await api('meets/show', { meetId: first.id }, H.token)).json; const pa = show.participants.find((p) => p.userId === A.id);
  const t1 = await api('meets/participants/update', { meetId: first.id, participantId: pa.id, tags: ['paid', 'digital', 'checkedIn'] }, H.token);
  const pa2 = (t1.json.participants || []).find((p) => p.id === pa.id);
  const t2 = await api('meets/participants/update', { meetId: first.id, participantId: pa.id, tags: ['paid'] }, A.token);
  ok('2 host marks paid · digital · checked in; a player cannot mark themself', t1.status === 200 && pa2 && ['paid', 'digital', 'checkedIn'].every((t) => pa2.tags.includes(t)) && t2.status !== 200, { tags: pa2 && pa2.tags, self: t2.status });
  // 3 cancel series from the 2nd: 1st stays, 3 cancelled
  const second = series[1];
  const cs = await api('meets/cancel', { meetId: second.id, series: true }, H.token);
  const after = (await api('meets/list', { scope: 'hosting', limit: 50, seriesId: c.json.seriesId, includeCancelled: true }, H.token)).json || [];
  const cancelled = after.filter((m) => m.status === 'cancelled').length;
  ok('3 cancel series from the 2nd → 3 cancelled, the 1st stays active', cs.status === 200 && cancelled === 3 && after.find((m) => m.id === first.id).status === 'active', { cancelled, firstStatus: after.find((m) => m.id === first.id).status });
  // 4 poll on a club post + vote
  const club = (await api('channels/create', { name: '[probe] poll club', description: 'p' }, H.token)).json;
  await api('channels/follow', { channelId: club.id }, A.token);
  const note = await api('notes/create', { text: 'Tuesday or Wednesday?', channelId: club.id, poll: { choices: ['Tuesday', 'Wednesday'], multiple: false, expiredAfter: 7 * 86400000 } }, H.token);
  const nid = note.json.createdNote.id;
  const v = await api('notes/polls/vote', { noteId: nid, choice: 1 }, A.token);
  const tl = (await api('channels/timeline', { channelId: club.id, limit: 5 }, A.token)).json || [];
  const pn = tl.find((n) => n.id === nid);
  ok('4 poll posted in a club; a member votes; the timeline carries votes and isVoted', note.status === 200 && (v.status === 204 || v.status === 200) && pn && pn.poll && pn.poll.choices[1].votes === 1 && pn.poll.choices[1].isVoted === true, { votes: pn && pn.poll && pn.poll.choices.map((x) => x.votes) });
  // 5 photo upload + post with file
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  const fd = new FormData(); fd.append('i', H.token); fd.append('file', new Blob([png], { type: 'image/png' }), 'probe.png');
  const up = await fetch(E + '/drive/files/create', { method: 'POST', body: fd }); const upj = await up.json().catch(() => null);
  const pn2 = upj && upj.id ? await api('notes/create', { text: 'court photo', channelId: club.id, fileIds: [upj.id] }, H.token) : { status: 0, json: null };
  const tl2 = (await api('channels/timeline', { channelId: club.id, limit: 5 }, A.token)).json || [];
  const withFile = tl2.find((n) => n.files && n.files.length && n.files[0].id === (upj && upj.id));
  ok('5 a photo uploads to the drive and a post carries it', up.status === 200 && !!upj.id && pn2.status === 200 && !!withFile && /^image\//.test(withFile.files[0].type), { upload: up.status, type: withFile && withFile.files[0].type });
  // 6 leaderboard: a kudos endorsement on a played meet → the target ranks
  const pm = await api('meets/create', { name: '[probe] played', notes: '[probe]', sport: 'pickleball', startAt: new Date(Date.now() + 3600e3).toISOString(), durationMinutes: 60, capacity: 4, hostPlays: true, autoApprove: true, visibility: 'public', feeType: 'free', venueName: 'Probe Court', lat: 22.3, lng: 114.2 }, H.token);
  await api('meets/join', { meetId: pm.json.id }, A.token); await api('meets/join', { meetId: pm.json.id }, B.token);
  await api('meets/update', { meetId: pm.json.id, startAt: new Date(Date.now() - 3600e3).toISOString() }, H.token);
  await api('meets/reviews/upsert', { meetId: pm.json.id, targetUserId: B.id, type: 'endorsement', body: 'Great partner, On time' }, H.token);
  await api('meets/reviews/upsert', { meetId: pm.json.id, targetUserId: B.id, type: 'endorsement', body: 'Great partner' }, A.token);
  const lb = await api('meets/reviews/leaderboard', { timeframe: 'CURRENT_MONTH', limit: 50 });
  const lbd = await api('meets/reviews/leaderboard', { timeframe: 'CURRENT_MONTH', dimension: 'On time', limit: 50 });
  const rowB = (lb.json || []).find((r) => r.user && r.user.id === B.id); const rowBd = (lbd.json || []).find((r) => r.user && r.user.id === B.id);
  ok('6 leaderboard ranks the endorsed player (3 kudos; 1 for "On time")', lb.status === 200 && rowB && rowB.count === 3 && rowB.dims['Great partner'] === 2 && rowBd && rowBd.count === 1, { count: rowB && rowB.count, dims: rowB && rowB.dims, onTime: rowBd && rowBd.count });
  // cleanup
  await api('meets/cancel', { meetId: first.id }, H.token); await api('meets/cancel', { meetId: pm.json.id }, H.token);
  await api('channels/update', { channelId: club.id, isArchived: true, name: '[probe] archived' }, H.token);
  for (const u of [H, A, B]) await api('admin/delete-account', { userId: u.id }, ADMIN);
  const pass = checks.filter((c) => c.pass).length;
  const v2 = { id: 'batch-v10', at: new Date().toISOString(), condition_fired: true, verdict: pass === checks.length ? 'pass' : 'fail', pass, total: checks.length, family: { found: checks.length, fixed: checks.length }, evidence: JSON.stringify(checks.map((c) => c.name + '=' + (c.pass ? 'ok' : 'FAIL') + ' ' + JSON.stringify(c.detail))), detail: 'series, cancel-series, payment/attendance tags, polls, photos, kudos leaderboard on the live engine', checks };
  fs.writeFileSync('/root/social-engine/probes/batch-v10.verdict.json', JSON.stringify(v2, null, 2));
  console.log(v2.verdict + ' ' + pass + '/' + checks.length); process.exit(v2.verdict === 'pass' ? 0 : 1);
})();

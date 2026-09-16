// Runs ON kaka (node 20): MEET-V4 claim + invariant probe against http://127.0.0.1:3960 with the 12 demo users.
// The one question: can meet.confirmed ever exceed capacity, or disagree with the rows, under real concurrency?
//   C1  create capacity 5, autoApprove, allowPlusOne, host-only (spectator row, confirmed=0)
//   C2  12 users join CONCURRENTLY, each with a +1  → 24 seats wanted, 5 exist. counter==5==rows; 19 waitlisted; ranks distinct
//   C3  a confirmed user leaves (their +1 goes too) → rows deleted, promotion refills, counter==5==rows
//   C4  host lowers capacity to 3 → refused (capacity_below_confirmed)
//   C5  host raises capacity to 7 → waitlist promoted, counter==7==rows
//   C6  host removes a confirmed participant → deleted, promoted, counter==7==rows
//   C7  a 4-day-old invitation on the FULL meet → sweep moves it to waitlisted, not confirmed (E3); counter unchanged
//   C8  cancellation freeze 48 h → a confirmed player's leave is refused with Reclub's copy
//   C9  a user who blocked the host → join refused 'blocked'
// Every DB assertion reads the live engine DB read-only except C7's single timestamp nudge on a probe row.
'use strict';
const fs = require('fs');
const { execFileSync } = require('child_process');
const BASE = 'http://127.0.0.1:3960/api';
const demo = JSON.parse(fs.readFileSync('/root/social-engine.demo-users', 'utf8'));
const names = Object.keys(demo);
const tok = (n) => demo[n].token;
const out = { steps: {} };
function step(k, ok, ev) { out.steps[k] = { ok: !!ok, ...ev }; }

async function api(path, body, token) {
	const r = await fetch(`${BASE}/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, ...(token ? { i: token } : {}) }) });
	let json = {}; try { json = await r.json(); } catch {}
	return { status: r.status, json };
}
function sql(q) {
	const u = execFileSync('docker', ['exec', 'social-engine-db-1', 'sh', '-c', 'echo $POSTGRES_USER']).toString().trim();
	const d = execFileSync('docker', ['exec', 'social-engine-db-1', 'sh', '-c', 'echo $POSTGRES_DB']).toString().trim();
	return execFileSync('docker', ['exec', 'social-engine-db-1', 'psql', '-U', u, '-d', d, '-tA', '-F', '|', '-c', q]).toString().trim();
}
function state(meetId) {
	const [counter, capacity] = sql(`select confirmed, capacity from meet where id='${meetId}'`).split('|').map(Number);
	const rows = Object.fromEntries(sql(`select status, count(*) from meet_participant where "meetId"='${meetId}' group by status`).split('\n').filter(Boolean).map(l => { const [s, c] = l.split('|'); return [s, Number(c)]; }));
	const ties = Number(sql(`select count(*) from (select "waitlistRank" from meet_participant where "meetId"='${meetId}' and status='waitlisted' group by 1 having count(*)>1) t`));
	return { counter, capacity, confirmedRows: rows.confirmed ?? 0, waitlisted: rows.waitlisted ?? 0, requested: rows.requested ?? 0, spectator: rows.spectator ?? 0, total: Object.values(rows).reduce((a, b) => a + b, 0), ties };
}
const inv = (s) => s.counter === s.confirmedRows && s.counter <= s.capacity && s.ties === 0;

(async () => {
	const host = names[0];
	const start = new Date(Date.now() + 36 * 3600_000).toISOString();

	// C1
	let r = await api('meets/create', { name: 'V4 claim probe', startAt: start, durationMinutes: 60, capacity: 5, autoApprove: true, allowPlusOne: true, hostPlays: false, visibility: 'public', sport: 'pickleball', lat: 22.289, lng: 113.943, venueName: 'Probe court' }, tok(host));
	const meetId = r.json.id;
	let s = state(meetId);
	step('C1_create_host_only', r.status === 200 && s.counter === 0 && s.spectator === 1 && s.confirmedRows === 0, { status: r.status, err: r.json.error?.code, ...s });
	if (!meetId) { console.log(JSON.stringify(out)); process.exit(1); }

	// C2 — the race: 11 non-host users, each wanting 2 seats, all at once
	const joiners = names.slice(1);
	const results = await Promise.all(joiners.map(n => api('meets/join', { meetId, plusOnes: 1 }, tok(n))));
	s = state(meetId);
	const ok2 = results.every(x => x.status === 200) && s.counter === 5 && s.confirmedRows === 5 && s.waitlisted === 22 - 5 && s.ties === 0 && s.total === 23;
	step('C2_concurrent_joins_hold_capacity', ok2, { statuses: results.map(x => x.status).join(','), ...s, note: '11 users x 2 seats = 22 wanted, 5 exist' });

	// C3 — a confirmed USER leaves → their +1 goes too; promotion refills
	const confirmedUser = sql(`select "userId" from meet_participant where "meetId"='${meetId}' and status='confirmed' and kind='user' limit 1`);
	const leaverName = names.find(n => demo[n].id === confirmedUser);
	r = leaverName ? await api('meets/leave', { meetId }, tok(leaverName)) : { status: 0, json: { error: { code: 'no_leaver_found' } } };
	s = state(meetId);
	step('C3_leave_deletes_and_promotes', r.status === 200 && inv(s) && s.counter === 5 && s.total === 21, { status: r.status, err: r.json.error?.code, leaver: leaverName, ...s });

	// C4 — capacity below confirmed refused
	r = await api('meets/update', { meetId, capacity: 3 }, tok(host));
	s = state(meetId);
	step('C4_capacity_below_confirmed_refused', r.status !== 200 && JSON.stringify(r.json).toLowerCase().includes('capacity_below_confirmed') && s.capacity === 5, { status: r.status, err: r.json.error?.code ?? r.json.error?.id, ...s });

	// C5 — capacity up promotes
	r = await api('meets/update', { meetId, capacity: 7 }, tok(host));
	s = state(meetId);
	step('C5_capacity_up_promotes', r.status === 200 && inv(s) && s.counter === 7, { status: r.status, ...s });

	// C6 — host removes a confirmed participant
	const victim = sql(`select id from meet_participant where "meetId"='${meetId}' and status='confirmed' and kind='user' and "isHost"=false limit 1`);
	r = await api('meets/participants/update', { meetId, participantId: victim, status: 'remove' }, tok(host));
	s = state(meetId);
	step('C6_host_remove_deletes_and_promotes', r.status === 200 && inv(s) && s.counter === 7 && sql(`select count(*) from meet_participant where id='${victim}'`) === '0', { status: r.status, ...s });

	// C7 — stale invitation on a full meet → sweep waitlists it (E3), counter unchanged
	const wl = sql(`select id from meet_participant where "meetId"='${meetId}' and status='waitlisted' limit 1`);
	sql(`update meet_participant set status='invited', "waitlistRank"=null, "statusChangedAt"=now()-interval '4 days' where id='${wl}'`);
	const before7 = state(meetId);
	await new Promise(res => setTimeout(res, 75_000)); // the sweep runs every minute
	const after7 = state(meetId);
	const st7 = sql(`select status from meet_participant where id='${wl}'`);
	step('C7_stale_invite_on_full_meet_waitlists', st7 === 'waitlisted' && after7.counter === before7.counter && inv(after7), { rowStatus: st7, before: before7.counter, after: after7.counter, ties: after7.ties });

	// C8 — cancellation freeze
	r = await api('meets/update', { meetId, cancellationFreezeHours: 48 }, tok(host));
	const frozenUser = sql(`select "userId" from meet_participant where "meetId"='${meetId}' and status='confirmed' and kind='user' and "isHost"=false limit 1`);
	const frozenName = names.find(n => demo[n].id === frozenUser);
	r = frozenName ? await api('meets/leave', { meetId }, tok(frozenName)) : { status: 0, json: {} };
	s = state(meetId);
	step('C8_freeze_window_refuses_leave', r.status !== 200 && JSON.stringify(r.json).toLowerCase().includes('freeze_window') && inv(s), { status: r.status, err: r.json.error?.code ?? r.json.error?.id, msg: (r.json.error?.message || '').slice(0, 60) });

	// C9 — blocked by / blocking the host
	r = await api('meets/create', { name: 'V4 block probe', startAt: start, durationMinutes: 60, capacity: 4, autoApprove: true, visibility: 'public', sport: 'pickleball' }, tok(host));
	const meet2 = r.json.id;
	const blocker = names[names.length - 1];
	const hostId = demo[host].id;
	await api('blocking/create', { userId: hostId }, tok(blocker));
	r = await api('meets/join', { meetId: meet2 }, tok(blocker));
	step('C9_blocked_join_refused', r.status !== 200 && JSON.stringify(r.json).toLowerCase().includes('blocked'), { status: r.status, err: r.json.error?.code ?? r.json.error?.id });
	await api('blocking/delete', { userId: hostId }, tok(blocker));

	// cleanup: cancel both
	await api('meets/cancel', { meetId }, tok(host));
	await api('meets/cancel', { meetId: meet2 }, tok(host));
	out.meetIds = [meetId, meet2];
	out.pass = Object.values(out.steps).every(x => x.ok);
	console.log(JSON.stringify(out));
	process.exit(out.pass ? 0 : 1);
})().catch(e => { out.error = String(e && e.stack || e); console.log(JSON.stringify(out)); process.exit(1); });

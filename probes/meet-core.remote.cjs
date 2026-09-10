// Runs ON kaka (node 20): exercises the meet module end to end against http://127.0.0.1:3960 with demo users.
// Prints one JSON line: { ok, steps: [{name, ok, detail}] }.
'use strict';
const fs = require('fs');
const { execSync } = require('child_process');
const BASE = 'http://127.0.0.1:3960/api';
const demo = JSON.parse(fs.readFileSync('/root/social-engine.demo-users', 'utf8'));
const names = Object.keys(demo);
const [hostName, aName, bName, cName] = names;
const tok = (n) => demo[n].token;
const steps = [];
const step = (name, ok, detail) => { steps.push({ name, ok: !!ok, detail }); if (!ok) console.error('FAIL', name, JSON.stringify(detail)); };
async function api(path, body, token) {
	const r = await fetch(`${BASE}/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, ...(token ? { i: token } : {}) }) });
	const text = await r.text();
	let json = null; try { json = JSON.parse(text); } catch { json = { raw: text }; }
	return { status: r.status, json };
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
	const start = new Date(Date.now() + 3 * 3600_000).toISOString();

	// 1. host creates a meet: capacity 2 (host plays → 1 spot), auto-approve, public, near Tung Chung
	let r = await api('meets/create', { name: 'Probe meet', startAt: start, durationMinutes: 60, capacity: 2, autoApprove: true, visibility: 'public', lat: 22.289, lng: 113.943, venueName: 'Probe court', sport: 'pickleball' }, tok(hostName));
	step('create', r.status === 200 && r.json.confirmedCount === 1 && r.json.spotsLeft === 1, { status: r.status, id: r.json.id, spotsLeft: r.json.spotsLeft, err: r.json.error });
	const meetId = r.json.id;
	if (!meetId) { console.log(JSON.stringify({ ok: false, steps })); process.exit(1); }

	// 2. A joins → confirmed (auto-approve, 1 spot)
	r = await api('meets/join', { meetId }, tok(aName));
	step('A joins → confirmed', r.status === 200 && r.json.myStatus === 'confirmed' && r.json.spotsLeft === 0, { status: r.status, myStatus: r.json.myStatus, spotsLeft: r.json.spotsLeft, err: r.json.error });

	// 3. B joins → waitlisted (full)
	r = await api('meets/join', { meetId }, tok(bName));
	step('B joins → waitlisted', r.status === 200 && r.json.myStatus === 'waitlisted' && r.json.waitlistedCount === 1, { status: r.status, myStatus: r.json.myStatus, waitlisted: r.json.waitlistedCount, err: r.json.error });

	// 4. B joining again is rejected
	r = await api('meets/join', { meetId }, tok(bName));
	step('B double join rejected', r.status === 400 && r.json.error?.code === 'MEET_ALREADY_PARTICIPANT', { status: r.status, code: r.json.error?.code });

	// 5. A leaves → B promoted to confirmed (no pay-by)
	r = await api('meets/leave', { meetId }, tok(aName));
	step('A leaves', r.status === 200 && r.json.myStatus === 'left', { status: r.status, myStatus: r.json.myStatus, err: r.json.error });
	r = await api('meets/show', { meetId }, tok(bName));
	step('B auto-promoted → confirmed', r.status === 200 && r.json.myStatus === 'confirmed' && r.json.waitlistedCount === 0, { status: r.status, myStatus: r.json.myStatus, waitlisted: r.json.waitlistedCount });

	// 6. host view shows participants + chat room; B sees chatRoomId (confirmed)
	r = await api('meets/show', { meetId }, tok(hostName));
	const parts = r.json.participants || [];
	step('host sees roster', r.status === 200 && r.json.isHost === true && parts.some(p => p.isHost) && parts.some(p => p.status === 'confirmed' && !p.isHost), { count: parts.length, statuses: parts.map(p => p.status) });
	step('confirmed player gets chatRoomId', !!(await api('meets/show', { meetId }, tok(bName))).json.chatRoomId, {});

	// 7. host raises capacity → nothing to promote; host reserves a spot; host waitlists B then confirms
	r = await api('meets/update', { meetId, capacity: 4 }, tok(hostName));
	step('host update capacity', r.status === 200 && r.json.capacity === 4 && r.json.spotsLeft === 2, { status: r.status, capacity: r.json.capacity, spotsLeft: r.json.spotsLeft, err: r.json.error });
	r = await api('meets/participants/add', { meetId, displayName: 'Reserved Billy', declaredLevel: 3.0, status: 'confirmed' }, tok(hostName));
	step('host reserves a spot', r.status === 200 && (r.json.participants || []).some(p => p.kind === 'reserved' && p.status === 'confirmed'), { status: r.status, err: r.json.error });
	let bRow = (r.json.participants || []).find(p => p.userId === demo[bName].id);
	if (!bRow) { r = await api('meets/show', { meetId }, tok(hostName)); bRow = (r.json.participants || []).find(p => p.userId === demo[bName].id); }
	step('B row present', !!bRow, { have: !!bRow });
	r = await api('meets/participants/update', { meetId, participantId: bRow?.id ?? 'x', tags: ['paid', 'checkedIn'], isCoach: true }, tok(hostName));
	const bRow2 = (r.json.participants || []).find(p => p.userId === demo[bName].id);
	step('host tags + role', r.status === 200 && bRow2?.tags.includes('paid') && bRow2?.tags.includes('checkedIn') && bRow2?.isCoach === true && bRow2?.checkedInAt, { status: r.status, tags: bRow2?.tags, isCoach: bRow2?.isCoach, err: r.json.error });

	// 8. non-host cannot update roster
	r = await api('meets/participants/update', { meetId, participantId: bRow?.id ?? 'x', tags: ['noShow'] }, tok(aName));
	step('non-host blocked', r.status === 400 && r.json.error?.code === 'MEET_NOT_HOST', { status: r.status, code: r.json.error?.code });

	// 9. gates: strict min level 3.0; C has no level → denied; C sets 3.5 → joins confirmed
	r = await api('meets/create', { name: 'Probe gated meet', startAt: start, durationMinutes: 60, capacity: 4, autoApprove: true, minLevel: 3.0, gateType: 'strict', levelBasis: 'self' }, tok(hostName));
	const gatedId = r.json.id;
	r = await api('meets/level', { sport: 'pickleball', selfLevel: 2.5 }, tok(cName));
	r = await api('meets/join', { meetId: gatedId }, tok(cName));
	step('C below min level → denied', r.status === 400 && r.json.error?.code === 'MEET_GATE_DENIED', { status: r.status, code: r.json.error?.code });
	r = await api('meets/level', { sport: 'pickleball', selfLevel: 3.5 }, tok(cName));
	r = await api('meets/join', { meetId: gatedId }, tok(cName));
	step('C at 3.5 (no max) → confirmed', r.status === 200 && r.json.myStatus === 'confirmed', { status: r.status, myStatus: r.json.myStatus, err: r.json.error });

	// 10. hold + expiry: capacity 2 (host plays), payBy 1 min; A confirmed, B waitlisted; A leaves → B on hold; sweep → back to waitlist
	r = await api('meets/create', { name: 'Probe hold meet', startAt: start, durationMinutes: 60, capacity: 2, autoApprove: true, payByMinutes: 5 }, tok(hostName));
	step('create hold meet', r.status === 200 && !!r.json.id, { status: r.status, err: r.json.error });
	const holdId = r.json.id;
	await api('meets/join', { meetId: holdId }, tok(aName));
	await api('meets/join', { meetId: holdId }, tok(bName));
	await api('meets/leave', { meetId: holdId }, tok(aName));
	r = await api('meets/show', { meetId: holdId }, tok(bName));
	step('B promoted to hold (pay-by)', r.status === 200 && r.json.myStatus === 'hold', { myStatus: r.json.myStatus, err: r.json.error });
	// force the hold deadline into the past, then let the minute sweep act on it
	const sql = `update meet_participant set "holdExpiresAt" = now() - interval '1 minute' where "meetId" = '${holdId}' and status = 'hold';`;
	execSync('docker exec -i social-engine-db-1 psql -U social -d social', { input: sql, stdio: ['pipe', 'ignore', 'ignore'] });
	await sleep(75_000); // sweep runs every minute
	r = await api('meets/show', { meetId: holdId }, tok(bName));
	step('hold expired by sweep → waitlisted', r.status === 200 && r.json.myStatus === 'waitlisted', { myStatus: r.json.myStatus });

	// 11. discover list near Tung Chung finds the probe meet with a distance
	r = await api('meets/list', { scope: 'discover', lat: 22.29, lng: 113.94, radiusKm: 10 }, null);
	const found = (Array.isArray(r.json) ? r.json : []).find(m => m.id === meetId);
	step('discover nearby lists it with distance', !!found && typeof found.distanceKm === 'number', { status: r.status, n: Array.isArray(r.json) ? r.json.length : null, distanceKm: found?.distanceKm });

	// 12. cancel cleans up
	for (const id of [meetId, gatedId, holdId]) await api('meets/cancel', { meetId: id }, tok(hostName));
	r = await api('meets/show', { meetId }, tok(hostName));
	step('cancelled', r.json.status === 'cancelled', { status: r.json.status });

	console.log(JSON.stringify({ ok: steps.every(s => s.ok), steps }));
	process.exit(steps.every(s => s.ok) ? 0 : 1);
})().catch(e => { console.log(JSON.stringify({ ok: false, steps, exception: String(e) })); process.exit(1); });

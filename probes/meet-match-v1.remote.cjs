// Runs ON kaka (node 20): MEET-MATCH-V1 end to end — engine (127.0.0.1:3960) → hkpl branch route (real code from
// /root/hkpl-boyau-wt, served on :3977 against the hkpl_boyau_sbx sandbox) → DuprWriteQueue row. Not a mock.
// The engine container must carry ADAPTER_HKPL_URL=http://boyau-dupr-probe:3977 + the same secret (env file).
//   M1  host creates a meet (cap 4, autoApprove, allowPlayerScoring, submitMatches); 4 users join → 4 confirmed
//   M2  a non-host creates a match → MEET_NOT_HOST
//   M3  host creates round 1 / court 0, [p1,p2] vs [p3,p4] → isPending, canManage
//   M4  player p1 scores 11-7 → allowed (allowPlayerScoring); auto-submit runs → 'ineligible' not_connected (no DUPR ids yet)
//   M5  a user not in the match scores → MEET_NOT_HOST
//   M6  DUPR ids arrive the adapter's way (meet_player_level rows); host re-scores 3 games → 'queued', duprRef = hkpl queue id;
//       sandbox DuprWriteQueue row: dedupe_key submitMatch:boyau:<id>, source boyau_meet, games 11/9/11 vs 7/11/5
//   M7  host edits a queued match's scores → allowed; hkpl row refreshed (game3 becomes 11-8)
//   M8  hkpl drains (row DONE, dupr_response.result.matchId) → list refreshes the badge → 'submitted', duprRef DUPR id
//   M9  scoring or deleting a submitted match → MEET_DUPR_LOCKED
//   M10 uneven teams [p1] vs [p2,p3] scored → 'ineligible' uneven_teams; host deletes it → list has 1
//   M11 submit-dupr by a non-host → MEET_NOT_HOST
'use strict';
const fs = require('fs');
const { execFileSync } = require('child_process');
const BASE = 'http://127.0.0.1:3960/api';
const demo = JSON.parse(fs.readFileSync('/root/social-engine.demo-users', 'utf8'));
const names = Object.keys(demo);
const tok = (n) => demo[n].token;
const out = { steps: {} };
function step(k, ok, ev) { out.steps[k] = { ok: !!ok, ...ev }; }
const HKPL_ENV = Object.fromEntries(fs.readFileSync('/root/social-engine.hkpl.env', 'utf8').split('\n').filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));

async function api(path, body, token) {
	const r = await fetch(`${BASE}/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, ...(token ? { i: token } : {}) }) });
	let json = {}; try { json = await r.json(); } catch {}
	return { status: r.status, json };
}
const code = (r) => r.json.error?.code ?? r.json.error?.id ?? null;
function esql(q) {
	const u = execFileSync('docker', ['exec', 'social-engine-db-1', 'sh', '-c', 'echo $POSTGRES_USER']).toString().trim();
	const d = execFileSync('docker', ['exec', 'social-engine-db-1', 'sh', '-c', 'echo $POSTGRES_DB']).toString().trim();
	return execFileSync('docker', ['exec', 'social-engine-db-1', 'psql', '-U', u, '-d', d, '-tA', '-F', '|', '-c', q]).toString().trim();
}
function hsql(q) {
	const u = execFileSync('docker', ['exec', 'hkpl-db-dev', 'sh', '-c', 'echo $POSTGRES_USER']).toString().trim();
	return execFileSync('docker', ['exec', 'hkpl-db-dev', 'psql', '-U', u, '-d', 'hkpl_boyau_sbx', '-tA', '-F', '|', '-c', q]).toString().trim();
}

(async () => {
	// the real hkpl branch route, served alone against the sandbox — as a CONTAINER on the engine's docker network
	// (ufw drops bridge→host traffic, so no host port is reachable from the engine; Misskey's HTTP client resolves
	// names through DNS, which docker's embedded resolver answers for container names). Same image and node_modules
	// volume as hkpl-dev-app; the worktree is mounted read-only; the sandbox DB is reached on the default bridge.
	const dbPass = execFileSync('docker', ['exec', 'hkpl-db-dev', 'sh', '-c', 'echo $POSTGRES_PASSWORD']).toString().trim();
	const dbUser = execFileSync('docker', ['exec', 'hkpl-db-dev', 'sh', '-c', 'echo $POSTGRES_USER']).toString().trim();
	const dbIp = execFileSync('docker', ['inspect', 'hkpl-db-dev', '-f', '{{(index .NetworkSettings.Networks "bridge").IPAddress}}']).toString().trim();
	try { execFileSync('docker', ['rm', '-f', 'boyau-dupr-probe'], { stdio: 'ignore' }); } catch {}
	execFileSync('docker', ['run', '-d', '--name', 'boyau-dupr-probe', '--network', 'social-engine_default',
		'-v', '/root/hkpl-boyau-wt:/wt:ro', '-v', 'hkpl-dev-nm:/root/hkpl-server/node_modules:ro', '-w', '/wt',
		'-e', 'NODE_PATH=/root/hkpl-server/node_modules', '-e', `DATABASE_URL=postgresql://${dbUser}:${encodeURIComponent(dbPass)}@${dbIp}:5432/hkpl_boyau_sbx`,
		'-e', `SOCIAL_S2S_SECRET=${HKPL_ENV.ADAPTER_HKPL_S2S_SECRET}`, '-e', 'DUPR_ROUTE=off', '-e', 'PORT=3977', '-e', 'SANDBOX_TENANT_IDS=uat,uat-test',
		'hkpl-docker-hkpl-app', 'node', 'probes/_social_dupr_server.cjs'], { stdio: 'ignore' });
	execFileSync('docker', ['network', 'connect', 'bridge', 'boyau-dupr-probe'], { stdio: 'ignore' });
	let serverLog = '';
	for (let i = 0; i < 60 && !serverLog.includes('ready'); i++) { await new Promise(r => setTimeout(r, 500)); try { serverLog = execFileSync('docker', ['logs', 'boyau-dupr-probe'], { stdio: ['ignore', 'pipe', 'pipe'] }).toString(); } catch {} }
	out.serverReady = serverLog.includes('ready');
	const stop = () => { try { serverLog = execFileSync('docker', ['logs', 'boyau-dupr-probe'], { stdio: ['ignore', 'pipe', 'pipe'] }).toString(); } catch {} try { execFileSync('docker', ['rm', '-f', 'boyau-dupr-probe'], { stdio: 'ignore' }); } catch {} };

	try {
		const host = names[0];
		const players = names.slice(1, 5);
		const outsider = names[5];
		const start = new Date(Date.now() + 36 * 3600_000).toISOString();

		// M1
		let r = await api('meets/create', { name: 'MATCH-V1 probe', startAt: start, durationMinutes: 90, capacity: 4, autoApprove: true, hostPlays: false, allowPlayerScoring: true, submitMatches: true, visibility: 'public', sport: 'pickleball', venueName: 'Probe court' }, tok(host));
		const meetId = r.json.id;
		out.meetId = meetId;
		for (const n of players) await api('meets/join', { meetId }, tok(n));
		r = await api('meets/show', { meetId }, tok(host));
		const parts = (r.json.participants || []).filter(p => p.status === 'confirmed' && p.userId);
		const pid = Object.fromEntries(parts.map(p => [p.userId, p.id]));
		const P = players.map(n => pid[demo[n].id]);
		step('M1_meet_and_four_confirmed', !!meetId && P.every(Boolean) && r.json.submitMatches === true && r.json.allowPlayerScoring === true, { meetId, confirmed: parts.length, submitMatches: r.json.submitMatches });

		// M2
		r = await api('meets/matches/upsert', { meetId, round: 1, team1Ids: [P[0], P[1]], team2Ids: [P[2], P[3]] }, tok(outsider));
		step('M2_nonhost_create_refused', r.status !== 200 && code(r) === 'MEET_NOT_HOST', { status: r.status, code: code(r) });

		// M3
		r = await api('meets/matches/upsert', { meetId, round: 1, courtIndex: 0, team1Ids: [P[0], P[1]], team2Ids: [P[2], P[3]] }, tok(host));
		const matchId = r.json.id;
		step('M3_host_creates_match', r.status === 200 && r.json.isPending === true && r.json.canManage === true && r.json.round === 1 && r.json.courtIndex === 0, { status: r.status, match: r.json.id, isPending: r.json.isPending });

		// M4 — a player of the match scores; auto-submit finds no DUPR ids
		r = await api('meets/matches/upsert', { meetId, matchId, scores: [[11, 7]] }, tok(players[0]));
		step('M4_player_scores_then_ineligible', r.status === 200 && r.json.duprStatus === 'ineligible' && String(r.json.duprError).includes('not_connected') && r.json.winnerTeam === 1, { status: r.status, duprStatus: r.json.duprStatus, duprError: r.json.duprError, code: code(r) });

		// M5
		r = await api('meets/matches/upsert', { meetId, matchId, scores: [[11, 0]] }, tok(outsider));
		step('M5_outsider_score_refused', r.status !== 200 && code(r) === 'MEET_NOT_HOST', { status: r.status, code: code(r) });

		// M6 — DUPR ids arrive as the adapter would set them
		players.forEach((n, i) => {
			const uid = demo[n].id;
			const exists = esql(`select count(*) from meet_player_level where "userId"='${uid}' and sport='pickleball'`) !== '0';
			if (exists) esql(`update meet_player_level set "duprId"='PRB${i}${uid.slice(-3).toUpperCase()}' where "userId"='${uid}' and sport='pickleball'`);
			else esql(`insert into meet_player_level ("id","userId","sport","duprId","updatedAt") values ('pl${uid.slice(0, 14)}${i}','${uid}','pickleball','PRB${i}${uid.slice(-3).toUpperCase()}',now())`);
		});
		r = await api('meets/matches/upsert', { meetId, matchId, scores: [[11, 7], [9, 11], [11, 5]] }, tok(host));
		const qrow = hsql(`select status, source, payload->'teams'->0->>'game1', payload->'teams'->0->>'game2', payload->'teams'->0->>'game3', payload->'teams'->1->>'game1', payload->'teams'->1->>'game2', payload->'teams'->1->>'game3', payload->>'format', payload->>'matchSource' from "DuprWriteQueue" where dedupe_key='submitMatch:boyau:${matchId}'`).split('|');
		step('M6_queued_at_hkpl', r.status === 200 && r.json.duprStatus === 'queued' && !!r.json.duprRef && qrow[0] === 'SCHEDULED' && qrow[1] === 'boyau_meet' && qrow.slice(2, 8).join(',') === '11,9,11,7,11,5' && qrow[8] === 'DOUBLES' && qrow[9] === 'PARTNER',
			{ status: r.status, duprStatus: r.json.duprStatus, duprRef: r.json.duprRef, duprError: r.json.duprError, hkplRow: qrow.join('|') });

		// M7 — queued is not locked: an edit refreshes the hkpl row
		r = await api('meets/matches/upsert', { meetId, matchId, scores: [[11, 7], [9, 11], [11, 8]] }, tok(host));
		const g3 = hsql(`select payload->'teams'->1->>'game3', (select count(*) from "DuprWriteQueue" where dedupe_key like 'submitMatch:boyau:${matchId}%') from "DuprWriteQueue" where dedupe_key='submitMatch:boyau:${matchId}'`).split('|');
		step('M7_edit_queued_refreshes_hkpl', r.status === 200 && r.json.duprStatus === 'queued' && g3[0] === '8' && g3[1] === '1', { status: r.status, duprStatus: r.json.duprStatus, team2game3: g3[0], rows: g3[1] });

		// M8 — hkpl drains; the badge follows on the next list
		hsql(`update "DuprWriteQueue" set status='DONE', sent_at=now(), dupr_response='{"result":{"matchId":"DUPRPRB1"}}'::jsonb where dedupe_key='submitMatch:boyau:${matchId}'`);
		esql(`update meet_match set "updatedAt"=now()-interval '5 minutes' where id='${matchId}'`);
		r = await api('meets/matches/list', { meetId }, tok(host));
		const m8 = (r.json || []).find(m => m.id === matchId) || {};
		step('M8_drained_becomes_submitted', r.status === 200 && m8.duprStatus === 'submitted' && m8.duprRef === 'DUPRPRB1' && m8.canUpdateScore === false && !!m8.duprSubmittedBy, { status: r.status, duprStatus: m8.duprStatus, duprRef: m8.duprRef, canUpdateScore: m8.canUpdateScore, by: m8.duprSubmittedBy?.username });

		// M9
		r = await api('meets/matches/upsert', { meetId, matchId, scores: [[11, 0]] }, tok(host));
		const r9b = await api('meets/matches/delete', { meetId, matchId }, tok(host));
		step('M9_submitted_is_locked', r.status !== 200 && code(r) === 'MEET_DUPR_LOCKED' && r9b.status !== 200 && code(r9b) === 'MEET_DUPR_LOCKED', { upsert: code(r), delete: code(r9b) });

		// M10
		r = await api('meets/matches/upsert', { meetId, round: 2, team1Ids: [P[0]], team2Ids: [P[1], P[2]], scores: [[11, 3]] }, tok(host));
		const m10 = r.json.id;
		const del = await api('meets/matches/delete', { meetId, matchId: m10 }, tok(host));
		const list = await api('meets/matches/list', { meetId }, tok(host));
		step('M10_uneven_teams_ineligible_then_deleted', r.status === 200 && r.json.duprStatus === 'ineligible' && String(r.json.duprError).includes('uneven_teams') && del.status === 204 && Array.isArray(list.json) && list.json.length === 1, { status: r.status, duprStatus: r.json.duprStatus, duprError: r.json.duprError, del: del.status, remaining: Array.isArray(list.json) ? list.json.length : null });

		// M11
		r = await api('meets/matches/submit-dupr', { meetId, matchId }, tok(outsider));
		step('M11_submit_dupr_nonhost_refused', r.status !== 200 && code(r) === 'MEET_NOT_HOST', { status: r.status, code: code(r) });

		// cleanup
		await api('meets/cancel', { meetId }, tok(host));
		hsql(`delete from "DuprWriteQueue" where dedupe_key like 'submitMatch:boyau:%'`);
		players.forEach(n => esql(`update meet_player_level set "duprId"=null where "userId"='${demo[n].id}' and sport='pickleball' and "duprId" like 'PRB%'`));
	} catch (e) {
		out.error = String(e && e.stack || e);
	} finally {
		stop();
	}
	out.serverLog = serverLog.slice(0, 400);
	out.pass = out.serverReady && !out.error && Object.values(out.steps).length === 11 && Object.values(out.steps).every(x => x.ok);
	console.log(JSON.stringify(out));
	process.exit(out.pass ? 0 : 1);
})();

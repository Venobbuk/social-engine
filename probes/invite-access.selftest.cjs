// invite-access.selftest.cjs — plant the faults this lane's checks MUST catch, and record whether they caught them.
// A check that cannot fail has proved nothing (probes/blind-checks-fixed.verdict.json), so before the AFTER run is
// believed, each of these must turn it red:
//
//   P1  THE FIXTURE IS NOT REALLY PRIVATE — the club is flipped to visibility 'public' in the database. Every
//       privacy leg ([leak]) must FAIL: an open club hands the schedule and the counts to anyone, and a check that
//       still reads "no leak" is measuring nothing. (The 30 s privateClubs() cache is waited out both ways.)
//   P2  THE PRIVACY RULE REGRESSED — the same assertions run against sha-3ea789f, the real build where the schedule
//       door had NO gate and the packer published a private club's audience size. This is the regression the brief
//       names: a caller with NO token must still be refused and still see 0. Every [leak] leg must FAIL there.
//   P3  THE ENTITLED LEGS ARE NOT CONSTANTS — every [feature] leg re-run with an OUTSIDER credential (the stranger's
//       session, the WRONG club's token and code). All of them must FAIL.
'use strict';
require('/root/social-engine/probes/_guard.cjs');
const fs = require('fs');
const { spawnSync, execFileSync } = require('child_process');
const D = '/root/social-engine/probes/';
const F = JSON.parse(fs.readFileSync('/root/gen/secperm2-fixtures.json', 'utf8'));
const AFTER = process.env.AFTER_TARGET || 'http://127.0.0.1:3965';
const PLANT = process.env.PLANT_TARGET || 'http://127.0.0.1:3963';
const sql = (t) => execFileSync('docker', ['exec', '-i', 'social-engine-db-1', 'psql', '-U', 'social', '-d', 'se_sbx', '-tAq', '-v', 'ON_ERROR_STOP=1', '-f', '-'], { input: t, encoding: 'utf8' }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function runProbe(label, env, outFile) {
	console.log('\n════ ' + label + ' ════');
	const r = spawnSync('node', [D + 'invite-access.probe.cjs'], { cwd: D, env: { ...process.env, PROBE_UNWRAPPED: 'i-will-sweep-myself', OUT: outFile, ...env }, encoding: 'utf8' });
	console.log(((r.stdout || '') + (r.stderr || '')).split('\n').filter((l) => !/probe-guard/.test(l)).join('\n').slice(-3000));
	try { return JSON.parse(fs.readFileSync(outFile, 'utf8')); } catch (e) { return null; }
}

async function main() {
	const faults = [];

	// ── P1: the fixture is not really private ───────────────────────────────────────────────────────────────
	try {
		sql(`UPDATE club_setting SET visibility = 'public' WHERE "channelId" = '${F.cpriv}';`);
		console.log('P1 planted: ' + F.cpriv + ' visibility -> ' + sql(`SELECT visibility FROM club_setting WHERE "channelId"='${F.cpriv}';`) + '; waiting 35 s for the privateClubs() cache');
		await sleep(35000);
		const p1 = runProbe('P1 — fixture flipped PUBLIC (must turn the privacy legs red)', { PHASE: 'selftest-p1', TARGET: AFTER }, '/root/gen/invite-access-selftest-p1.json');
		const caught = !!p1 && p1.leaks_open > 0;
		faults.push({ id: 'P1.fixture-not-private', planted: "the private club is actually public — every [leak] leg must fail rather than read 'no leak'", caught, detail: p1 ? { leaks_open: p1.leaks_open, failed: p1.results.filter((r) => r.kind === 'leak' && !r.ok).map((r) => r.id) } : 'probe produced no file' });
	} finally {
		sql(`UPDATE club_setting SET visibility = 'private' WHERE "channelId" = '${F.cpriv}';`);
		console.log('P1 restored: visibility -> ' + sql(`SELECT visibility FROM club_setting WHERE "channelId"='${F.cpriv}';`) + '; waiting 35 s for the caches again');
		await sleep(35000);
	}

	// ── P2: the privacy rule regressed (a real build that has the hole) ─────────────────────────────────────
	const p2 = runProbe('P2 — the pre-fix build sha-3ea789f (no gate at all)', { PHASE: 'selftest-p2', TARGET: PLANT }, '/root/gen/invite-access-selftest-p2.json');
	const p2Ids = p2 ? p2.results.filter((r) => r.kind === 'leak' && !r.ok).map((r) => r.id) : [];
	const p2Caught = !!p2 && p2.leaks_open > 0 && p2Ids.includes('F1.list.anon.noToken') && p2Ids.includes('F2.channels-show.anon.noToken');
	faults.push({ id: 'P2.privacy-regressed', planted: 'a caller with NO token gets the schedule and the counts (sha-3ea789f) — the leak legs must catch it', caught: p2Caught, detail: p2 ? { leaks_open: p2.leaks_open, failed: p2Ids } : 'probe produced no file' });

	// ── P3: the entitled legs are not constants ────────────────────────────────────────────────────────────
	const p3 = runProbe('P3 — every entitled leg run with an OUTSIDER credential', { PHASE: 'selftest-p3', TARGET: AFTER, ENTITLED_AS: 'stranger' }, '/root/gen/invite-access-selftest-p3.json');
	const featTotal = p3 ? p3.results.filter((r) => r.kind === 'feature').length : 0;
	const p3Caught = !!p3 && featTotal > 0 && p3.feature_failures === featTotal;
	faults.push({ id: 'P3.entitled-legs-are-not-constants', planted: "every [feature] leg re-run with the stranger's session and the wrong club's token/code must fail", caught: p3Caught, detail: p3 ? { feature_legs: featTotal, feature_failures: p3.feature_failures, still_passing: p3.results.filter((r) => r.kind === 'feature' && r.ok).map((r) => r.id) } : 'probe produced no file' });

	const summary = { at: new Date().toISOString(), planted: faults.length, caught: faults.filter((f) => f.caught).length, faults };
	fs.writeFileSync('/root/gen/invite-access-selftest.json', JSON.stringify(summary, null, 1));
	console.log('\nSELF-TEST ' + summary.caught + ' of ' + summary.planted + ' planted faults caught');
	for (const f of faults) console.log((f.caught ? '  caught  ' : '  MISSED  ') + f.id + ' — ' + JSON.stringify(f.detail).slice(0, 220));
	process.exit(summary.caught === summary.planted ? 0 : 5);
}
main().catch((e) => { console.error('SELFTEST ERROR ' + (e && e.stack ? e.stack : e)); process.exit(1); });

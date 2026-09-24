// sec-perm-after.run.cjs — the AFTER leg of the permission sweep, on one fixture, in one process.
//
// WHY THIS EXISTS alongside sec-perm-fixes.run.cjs: that runner measures BEFORE on a throwaway pre-fix engine at
// :3963, which is not running (a historical baseline, already captured in sec-perm-fixes.verdict.json). What the
// friends lane has to show is the CURRENT engine — the one carrying GB-FRIEND-SUGGEST-V1 — still leaking nothing.
// So this drives setup → fairfour → AFTER back to back in ONE process (the same reason run.cjs is one process: the
// other lane's sweeper archives '[probe%' fixtures between steps and has eaten this fixture before).
'use strict';
require('/root/social-engine/probes/_guard.cjs');
const { spawnSync } = require('child_process');
const fs = require('fs');
const D = '/root/social-engine/probes/';

const step = (script, env, label) => {
	console.log('\n==== ' + label + ' ====');
	const r = spawnSync('node', [D + script], { cwd: D, env: { ...process.env, PROBE_UNWRAPPED: 'i-will-sweep-myself', ...env }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
	const text = (r.stdout || '') + (r.stderr || '');
	console.log(text.split('\n').filter((l) => !/probe-guard/.test(l)).join('\n').slice(-6000));
	return { code: r.status, text };
};

const ATTEMPTS = Number(process.env.ATTEMPTS || 3);
let last = null;
for (let i = 1; i <= ATTEMPTS; i++) {
	console.log('\n######## ATTEMPT ' + i + ' of ' + ATTEMPTS + ' ########');
	const s = step('sec-perm-fixes.setup.cjs', {}, 'FIXTURE');
	if (s.code !== 0) { last = 'setup'; tidy(); continue; }
	const f = step('sec-perm-fixes.fairfour.cjs', {}, 'gb-fair: choose the four and predict the readings');
	if (f.code !== 0) { last = 'fairfour'; tidy(); continue; }
	const a = step('sec-perm-fixes.probe.cjs', { PHASE: 'after', TARGET: 'http://127.0.0.1:3961', OUT: '/root/gen/secperm2-after.json' }, 'AFTER — web-uat carrying GB-FRIEND-SUGGEST-V1');
	tidy();
	if (a.code !== 0) { last = 'after'; continue; }
	// count the leaks the AFTER leg recorded
	// the probe writes { leaks, broken_for_legitimate_callers, results: [...] }. Reading the WRONG key here once
	// produced "assertions: 0 · leaks: 0" — a clean bill of health out of an empty array, which is the worst kind of
	// bug a security check can have. So the shape is asserted before a single thing is counted.
	const doc = JSON.parse(fs.readFileSync('/root/gen/secperm2-after.json', 'utf8'));
	const arr = Array.isArray(doc.results) ? doc.results : null;
	if (!arr || arr.length === 0) { console.error('REFUSING to report: secperm2-after.json carries no results array'); process.exit(7); }
	const leaks = arr.filter((o) => o.kind === 'leak' && !o.ok);
	const feats = arr.filter((o) => (o.kind === 'feature' || o.kind === 'control') && !o.ok);
	console.log('\n=== AFTER: assertions=' + arr.length + ' leaks=' + leaks.length + ' broken_features=' + feats.length + ' ===');
	for (const l of leaks.slice(0, 20)) console.log('LEAK ' + l.id + ' ' + JSON.stringify(l.got).slice(0, 160));
	for (const l of feats.slice(0, 20)) console.log('FEAT-BROKEN ' + l.id + ' ' + JSON.stringify(l.got).slice(0, 160));
	fs.writeFileSync('/root/gen/secperm-after-summary.json', JSON.stringify({ assertions: arr.length, leaks: leaks.length, broken_features: feats.length, at: new Date().toISOString() }, null, 1));
	process.exit(leaks.length === 0 && feats.length === 0 ? 0 : 1);
}
console.error('\nGAVE UP after ' + ATTEMPTS + ' attempts; last failing step: ' + last);
process.exit(6);

#!/usr/bin/env node
// probe meet-core — copies meet-core.remote.cjs to kaka and runs it against the live engine (L6 when pass).
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs'); const path = require('path');
const ID = 'meet-core';
const OUT = path.join(__dirname, ID + '.verdict.json');
const r = { id: ID, at: new Date().toISOString(), condition_fired: false, verdict: 'no_verdict', evidence: '', detail: '' };
try {
	execFileSync('scp', ['-q', path.join(__dirname, 'meet-core.remote.cjs'), 'root@kaka.silkvo.com:/root/social-engine/probes/meet-core.remote.cjs']);
	const ver = execFileSync('ssh', ['root@kaka.silkvo.com', 'cd /root/social-engine && docker compose -f compose.prod.yml exec -T web cat /misskey/package.json | grep -m1 "\\"version\\""; curl -s -o /dev/null -w "%{http_code}" -X POST -H "content-type: application/json" -d "{}" http://127.0.0.1:3960/api/meets/list'], { timeout: 60000 }).toString().trim();
	r.condition_fired = /200$/.test(ver);
	if (!r.condition_fired) { r.detail = 'meets/list not answering 200 on kaka: ' + ver; }
	else {
		const out = execFileSync('ssh', ['root@kaka.silkvo.com', 'cd /root/social-engine && node probes/meet-core.remote.cjs'], { timeout: 400000, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
		const last = out.split('\n').pop();
		const j = JSON.parse(last);
		r.verdict = j.ok ? 'pass' : 'fail';
		r.evidence = JSON.stringify(j.steps.map(s => [s.name, s.ok]));
		r.detail = `${j.steps.filter(s => s.ok).length}/${j.steps.length} steps; ` + JSON.stringify(j.steps.filter(s => !s.ok).map(s => [s.name, s.detail]));
	}
} catch (e) {
	const out = (e.stdout ? e.stdout.toString() : '') + (e.stderr ? e.stderr.toString() : '');
	const last = out.trim().split('\n').pop();
	try { const j = JSON.parse(last); r.condition_fired = true; r.verdict = j.ok ? 'pass' : 'fail'; r.evidence = JSON.stringify(j.steps.map(s => [s.name, s.ok])); r.detail = JSON.stringify(j.steps.filter(s => !s.ok).map(s => [s.name, s.detail])) + (j.exception ? ' ' + j.exception : ''); }
	catch { r.verdict = r.condition_fired ? 'fail' : 'no_verdict'; r.detail = String(e.message || e).slice(0, 500) + ' ' + out.slice(-500); }
}
fs.writeFileSync(OUT, JSON.stringify(r, null, 2));
console.log(r.verdict.toUpperCase(), r.detail);
process.exit(r.verdict === 'pass' ? 0 : r.verdict === 'fail' ? 1 : 3);

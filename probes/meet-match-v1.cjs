#!/usr/bin/env node
// probes/meet-match-v1.cjs — local driver: copies meet-match-v1.remote.cjs to kaka, runs it there against the live
// engine (127.0.0.1:3960) with the 12 demo users, writes the verdict. The remote script is the spec; read it.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const ID = path.basename(__filename, '.cjs');
const OUT = path.join(__dirname, ID + '.verdict.json');
const REMOTE_SRC = path.join(__dirname, ID + '.remote.cjs');
const r = { id: ID, at: new Date().toISOString(), condition_fired: false, verdict: 'no_verdict', evidence: '', detail: '' };
try {
  execFileSync('scp', ['-q', '-o', 'BatchMode=yes', REMOTE_SRC, 'root@kaka.silkvo.com:/root/social-engine/probes/meet-match-v1.remote.cjs'], { stdio: 'ignore' });
  const out = execFileSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', 'root@kaka.silkvo.com', 'cd /root/social-engine && node probes/meet-match-v1.remote.cjs'], { encoding: 'utf8', timeout: 300000, stdio: ['ignore', 'pipe', 'ignore'] })
    .split('\n').map(l => l.trim()).filter(l => l.startsWith('{'));
  const j = JSON.parse(out[out.length - 1] || '{}');
  r.evidence = JSON.stringify(j.steps ?? j);
  r.condition_fired = true;
  r.verdict = j.pass ? 'pass' : 'fail';
  const failed = Object.entries(j.steps || {}).filter(([, v]) => !v.ok).map(([k]) => k);
  r.detail = j.pass ? `all ${Object.keys(j.steps).length} steps held on the live engine; meets ${JSON.stringify(j.meetIds)} cancelled after` : `failed: ${failed.join(', ')}` + (j.error ? ' | ' + j.error.split('\n')[0] : '');
} catch (e) {
  const stdout = e && e.stdout ? String(e.stdout) : '';
  const line = stdout.split('\n').map(l => l.trim()).filter(l => l.startsWith('{')).pop();
  if (line) { try { const j = JSON.parse(line); r.evidence = JSON.stringify(j.steps ?? j); r.condition_fired = true; r.verdict = 'fail'; r.detail = 'failed: ' + Object.entries(j.steps || {}).filter(([, v]) => !v.ok).map(([k]) => k).join(', ') + (j.error ? ' | ' + j.error.split('\n')[0] : ''); } catch {} }
  if (!r.detail) r.detail = 'probe could not run: ' + (e && e.message ? e.message.split('\n')[0] : String(e));
}
fs.writeFileSync(OUT, JSON.stringify(r, null, 2));
console.log(JSON.stringify(r, null, 2));
process.exit(r.verdict === 'pass' ? 0 : 1);

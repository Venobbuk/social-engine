// test-hook-e2e.cjs — spawn-level proof of the Stop hook, independent of the checker's internal selftest.
// Builds its own transcript + stdin JSON and asserts: lying turn → exit 2 (blocked), fix claim with no
// probe verdict → exit 2, clean turn (artifacts + verdict + real click) → exit 0, stop_hook_active loop-guard → exit 0.
// Run: node contract-kit/test-hook-e2e.cjs
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const CHECKER = path.join(__dirname, 'contract-rules.cjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-e2e-'));
fs.mkdirSync(path.join(tmp, 'src'));
fs.mkdirSync(path.join(tmp, 'probes'));
fs.writeFileSync(path.join(tmp, 'src', 'app.js'), '// code\n');
fs.writeFileSync(path.join(tmp, 'proof.png'), 'png');
fs.writeFileSync(path.join(tmp, 'probes', 't.verdict.json'), JSON.stringify({ id: 't', at: new Date().toISOString(), condition_fired: true, verdict: 'pass', evidence: 'GET /x -> HTTP 200' }));
fs.writeFileSync(path.join(tmp, 'BLUEPRINT.md'), [
  '# BLUEPRINT', '',
  '## WORKING STATE',
  'Current step: hook e2e', 'Last completed: fixture', 'Next action: grade', '',
  '## SIGN-OFF', 'SIGN-OFF: yes (2026-08-31)', '',
  '## DECISIONS', '- 2026-08-31 — e2e fixture decision', '',
  '## INDEX', '- [BLUEPRINT.md](BLUEPRINT.md) — this file', '',
].join('\n'));
const tp = path.join(tmp, 't.jsonl');

function runHook(input) {
  const r = spawnSync('node', [CHECKER, '--hook', tmp], { input, encoding: 'utf8' });
  return { code: r.status, out: (r.stdout + r.stderr).trim() };
}
function transcript(turnText) {
  fs.writeFileSync(tp, [
    JSON.stringify({ type: 'user', message: { content: 'fix the button' } }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: turnText }] } }),
  ].join('\n') + '\n');
}
const hookJson = JSON.stringify({ transcript_path: tp, stop_hook_active: false });
const fails = (o) => '  ' + o.split('\n').filter(l => l.includes('FAIL')).join('\n  ');

let bad = 0;
transcript('Fixed it, everything works now, all done.');
const dirty = runHook(hookJson);
console.log(`DIRTY turn      → exit ${dirty.code} (want 2) ${dirty.code === 2 ? '✓' : '** FAIL **'}`);
console.log(fails(dirty.out));
if (dirty.code !== 2) bad++;

transcript('Fixed the handler — family: 4 found / 4 fixed · residual: /oldBadCall/ — proof: node walk.cjs.');
const noVerdict = runHook(hookJson);
console.log(`NO-VERDICT turn → exit ${noVerdict.code} (want 2) ${noVerdict.code === 2 && /C10/.test(noVerdict.out) ? '✓ (C10 fired)' : '** FAIL **'}`);
console.log(fails(noVerdict.out));
if (noVerdict.code !== 2) bad++;

transcript('Fixed the handler — family: 4 found / 4 fixed · residual: /oldBadCall/ — proof: node walk.cjs · verdict probes/t.verdict.json. UAT passed via page.click at coordinates, effect read back from DB, screenshot proof.png eyeballed.');
const clean = runHook(hookJson);
console.log(`CLEAN turn      → exit ${clean.code} (want 0) ${clean.code === 0 ? '✓' : '** FAIL **'}`);
if (clean.code !== 0) { console.log(clean.out); bad++; }

const guard = runHook(JSON.stringify({ stop_hook_active: true }));
console.log(`LOOP GUARD      → exit ${guard.code} (want 0) ${guard.code === 0 ? '✓' : '** FAIL **'}`);
if (guard.code !== 0) bad++;

// v5.1 gate stats: every graded hook run appends one row (the loop-guard run grades nothing, so 3 rows)
const statsRows = fs.existsSync(path.join(tmp, '.contract-stats.jsonl')) ? fs.readFileSync(path.join(tmp, '.contract-stats.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l)) : [];
const statsOk = statsRows.length === 3 && statsRows[0].blocked === true && statsRows[0].fails.includes('C5') && statsRows[2].blocked === false;
console.log(`GATE STATS      → ${statsRows.length} rows (want 3), first blocked by ${statsRows[0] ? statsRows[0].fails.join(',') : '-'} ${statsOk ? '✓' : '** FAIL **'}`);
if (!statsOk) bad++;

fs.rmSync(tmp, { recursive: true, force: true });
console.log(bad === 0 ? '\nHOOK E2E PASS — lying turn blocked, unproven fix blocked, clean turn passes, no infinite loop, stats recorded.' : `\nHOOK E2E FAIL: ${bad}`);
process.exit(bad ? 1 : 0);

#!/usr/bin/env node
// probe-template.cjs — copy to probes/<id>.cjs, fill the three marked spots, run: node probes/<id>.cjs
//
// A PROBE is the executed proof behind a fix (rule P). It MUST:
//   1. FIRE the real path (HTTP call / CLI / DB query against the RUNNING dev instance, as the correct role)
//   2. ASSERT the CONDITION is present before grading — if the instrument never fired: verdict "no_verdict" (house rule R8)
//   3. GRADE the OUTCOME from the DESTINATION (the API/DB/file that received the effect — never the screen that rendered it)
//   4. WRITE probes/<id>.verdict.json  {id, at, condition_fired, verdict: pass|fail|no_verdict, evidence, detail}
//   5. RECORD the verified files in the ledger on pass (rule O) — list them in FILES below
//   6. Then PROVE it can fail:  node contract-kit/ledger.cjs prove probes/<id>.cjs   — reverts FILES to the pre-fix content,
//      requires this probe to go RED, restores, requires GREEN, marks the ledger entries proved. A probe that stays green on
//      the pre-fix code is refused, and C11 blocks delivery until every changed file is proved.
// The Stop hook (check C10) reads the verdict file; a claim with no fresh pass verdict is blocked.
'use strict';
const fs = require('fs');
const path = require('path');

const ID = path.basename(__filename, '.cjs');
const OUT = path.join(__dirname, ID + '.verdict.json');
const ROOT = path.resolve(__dirname, '..');                       // project root (probes/ lives one level down)
const FILES = [ /* 'routes/registrar.js', 'views/roster.html' */ ]; // <-- (A) code files this probe verifies

async function probe() {
  const r = { id: ID, at: new Date().toISOString(), condition_fired: false, verdict: 'no_verdict', evidence: '', detail: '' };
  try {
    // ---- (B) FIRE the real path. Example: HTTP against the dev instance as a role ----
    const url = process.env.PROBE_URL || 'http://127.0.0.1:3949/api/health';
    const res = await fetch(url, { headers: { cookie: process.env.PROBE_COOKIE || '' } });
    const body = await res.text();
    r.evidence = `${url} -> HTTP ${res.status}`;

    // ---- (C) CONDITION: was the thing under test actually exercised? (not just "server answered") ----
    r.condition_fired = res.status !== 0 && res.status !== 404 /* && body.includes('<the marker that proves the code path ran>') */;
    if (!r.condition_fired) { r.detail = 'instrument did not fire (route missing / precondition absent) — NO VERDICT'; return r; }

    // ---- (D) OUTCOME, read from the DESTINATION ----
    const ok = res.status === 200 /* && <destination read-back matches expected> */;
    r.verdict = ok ? 'pass' : 'fail';
    r.detail = ok ? 'expected effect observed at destination' : `unexpected: ${body.slice(0, 200)}`;
  } catch (e) {
    r.detail = 'probe threw: ' + (e && e.message ? e.message : String(e));
  }
  return r;
}

probe().then(r => {
  fs.mkdirSync(__dirname, { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(r, null, 2) + '\n');
  console.log(`${r.verdict.toUpperCase().padEnd(10)} ${ID} — ${r.evidence} — ${r.detail}\n  verdict: ${path.relative(ROOT, OUT).split(path.sep).join('/')}`);
  if (r.verdict === 'pass' && FILES.length) {
    const kit = require(path.join(ROOT, 'contract-kit', 'contract-rules.cjs'));
    for (const f of FILES) { const e = kit.ledgerRecord(ROOT, f, 'pass', path.relative(ROOT, OUT).split(path.sep).join('/')); console.log(`  ledger: ${e.file} sha=${e.sha} pass`); }
  }
  process.exit(r.verdict === 'pass' ? 0 : r.verdict === 'fail' ? 1 : 3);
});

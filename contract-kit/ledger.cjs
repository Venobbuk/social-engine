#!/usr/bin/env node
// ledger.cjs — the VERIFY LEDGER (rule O): file → content-sha → verdict → evidence → commit → proved.
// A file whose sha is unchanged is NOT re-verified. A changed file is NOT deliverable until its entry is
// current AND proved (check C11). This is what stops "look at everything again on every step".
//
//   node contract-kit/ledger.cjs status  [dir]     changed code files (working tree ∪ HEAD~1 ∪ untracked) vs ledger; exit 1 on gaps
//   node contract-kit/ledger.cjs record  <file> <pass|fail|no_verdict> "<evidence>" [dir]
//                                                  evidence must RESOLVE for a pass: existing file (e.g. probes/x.verdict.json), URL, or command
//   node contract-kit/ledger.cjs prove   <probes/id.cjs> [dir]   R10 for probes (rule P): revert the probe's FILES to the
//                                                  pre-fix content, run it → MUST NOT pass; restore, run → MUST pass; marks
//                                                  the entries proved:true. PROVE_WAIT_MS (default 3000) = dev-instance reload wait.
//   node contract-kit/ledger.cjs stats   [dir]     gate statistics from .contract-stats.jsonl (every hook verdict): bounce
//                                                  rate, by-check counts, the last bounced lines — feed false positives to rule M
//   node contract-kit/ledger.cjs show    [dir]     dump the ledger
// dir defaults to the current working directory (the project root that holds .verify-ledger.json).
'use strict';
const path = require('path');
const kit = require(path.join(__dirname, 'contract-rules.cjs'));

const [cmd, ...rest] = process.argv.slice(2);

function status(dir) {
  const r = kit.ledgerGaps(dir);
  if (r === null) { console.log('NO VERDICT — not a git repo; changed-file set unknowable'); return 0; }
  if (!r.changed.length) { console.log('NO VERDICT — no changed code files'); return 0; }
  const led = kit.readLedger(dir);
  for (const f of r.changed) {
    const e = led[f];
    const state = !e ? 'MISSING' : e.sha !== kit.sha12(path.join(dir, f)) ? `STALE (verified sha ${e.sha}, now ${kit.sha12(path.join(dir, f))})` : e.verdict !== 'pass' ? e.verdict.toUpperCase() : e.proved !== true ? 'UNPROVED' : 'proved';
    console.log(`  ${state.padEnd(10)} ${f}${e ? '  — ' + e.evidence + ' @ ' + e.at + (e.proved ? ' (red on ' + e.proved_red_on + ')' : '') : ''}`);
  }
  const ok = r.changed.length - r.gaps.length - r.unproved.length;
  console.log(`\n${ok}/${r.changed.length} changed code files covered + proved at current sha` + (r.gaps.length ? ` — ${r.gaps.length} gap(s)` : '') + (r.unproved.length ? ` — ${r.unproved.length} unproved (run: ledger.cjs prove <probe>)` : '') + (r.gaps.length || r.unproved.length ? ': NOT deliverable' : ''));
  return r.gaps.length || r.unproved.length ? 1 : 0;
}

function stats(dir) {
  const rows = kit.readStats(dir);
  if (!rows.length) { console.log(`NO VERDICT — no ${kit.STATS_FILE} yet (the hook writes one row per graded turn)`); return 0; }
  const blocked = rows.filter(r => r.blocked);
  const by = {}; for (const r of blocked) for (const id of r.fails) by[id] = (by[id] || 0) + 1;
  console.log(`turns graded: ${rows.length}   bounced: ${blocked.length} (${(100 * blocked.length / rows.length).toFixed(1)}%)   by check: ${JSON.stringify(by)}`);
  console.log(`first: ${rows[0].at}   last: ${rows[rows.length - 1].at}`);
  console.log('\nlast 12 bounced (judge each: real claim → fine; prose → add a plant, rule M):');
  for (const r of blocked.slice(-12)) console.log(`  [${r.fails.join(',')}] ${r.first}`);
  return 0;
}

if (cmd === 'status') {
  process.exit(status(path.resolve(rest[0] || '.')));
} else if (cmd === 'record') {
  const [file, verdict, evidence, dir] = rest;
  if (!file || !verdict) { console.error('usage: ledger.cjs record <file> <pass|fail|no_verdict> "<evidence>" [dir]'); process.exit(2); }
  try {
    const e = kit.ledgerRecord(path.resolve(dir || '.'), file, verdict, evidence || '');
    console.log(`recorded ${e.file} sha=${e.sha} verdict=${e.verdict} commit=${e.commit || '(no git)'} evidence=${e.evidence} proved=false (run: ledger.cjs prove <probe>)`);
  } catch (err) { console.error('REFUSED: ' + err.message); process.exit(1); }
} else if (cmd === 'prove') {
  const [probe, dir] = rest;
  if (!probe) { console.error('usage: ledger.cjs prove <probes/id.cjs> [dir]'); process.exit(2); }
  try {
    const r = kit.ledgerProve(path.resolve(dir || '.'), probe, { waitMs: process.env.PROVE_WAIT_MS != null ? +process.env.PROVE_WAIT_MS : 3000 });
    console.log(`${r.ok ? 'PROVED    ' : 'NOT PROVED'} ${probe} — ${r.detail}`);
    if (!r.ok) { console.log('  pre-fix run: ' + r.red.out.trim().split('\n')[0]); console.log('  restored run: ' + r.green.out.trim().split('\n')[0]); }
    process.exit(r.ok ? 0 : 1);
  } catch (err) { console.error('REFUSED: ' + err.message); process.exit(1); }
} else if (cmd === 'stats') {
  process.exit(stats(path.resolve(rest[0] || '.')));
} else if (cmd === 'show') {
  console.log(JSON.stringify(kit.readLedger(path.resolve(rest[0] || '.')), null, 2));
} else {
  console.error('usage: ledger.cjs status [dir] | record <file> <verdict> "<evidence>" [dir] | prove <probe> [dir] | stats [dir] | show [dir]');
  process.exit(2);
}

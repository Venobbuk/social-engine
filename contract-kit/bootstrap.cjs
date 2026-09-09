#!/usr/bin/env node
// contract-kit BOOTSTRAP — ARM OR REFUSE (rule U, earned by F14). Run at session start, BEFORE any code work.
// It proves the contract is actually LIVE (not the dormant-but-installed state that let F14 happen):
//   1. integrity  — every kit file matches the pinned manifest.json sha (no local drift / tamper).
//   2. hook wired — a .claude settings file registers `contract-rules.cjs --hook` (the turn-grader).
//   3. instrument — the checker itself passes --selftest (the checks aren't broken).
// Any failure -> print REFUSE and exit 2. On success -> print the arm line the contract's rule U requires.
//
//   node contract-kit/bootstrap.cjs                 arm-or-refuse (session start)
//   node contract-kit/bootstrap.cjs --emit-manifest <version>   (maintainer) regenerate manifest.json
const fs = require('fs'), path = require('path'), crypto = require('crypto'), cp = require('child_process');
const KIT = __dirname;
const FILES = ['CLAUDE.md', 'BLUEPRINT.md', 'contract-rules.cjs', 'ledger.cjs', 'probe-template.cjs', 'START.md', 'INSTALL.md', 'settings-hook-example.json', 'bootstrap.cjs', 'test-hook-e2e.cjs', 'LESSONS_2026-08-31_stock-session.md', 'LESSONS_2026-09-02_devloop-gating.md'];
const sha = p => { try { return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex').slice(0, 12); } catch { return null; } };
function refuse(m) { console.log('⛔ REFUSE: ' + m + ' — do NOT touch code until the contract is armed (rule U).'); process.exit(2); }

if (process.argv[2] === '--emit-manifest') {
  const version = process.argv[3] || 'v6';
  const files = {}; for (const f of FILES) { const s = sha(path.join(KIT, f)); if (s) files[f] = s; }
  fs.writeFileSync(path.join(KIT, 'manifest.json'), JSON.stringify({ version, at: new Date().toISOString(), files }, null, 2));
  console.log('manifest.json emitted for ' + version + ' (' + Object.keys(files).length + ' files)');
  process.exit(0);
}

// 1. INTEGRITY
let manifest; try { manifest = JSON.parse(fs.readFileSync(path.join(KIT, 'manifest.json'), 'utf8')); }
catch { refuse('no manifest.json — cannot verify contract integrity'); }
const drift = [];
for (const [f, want] of Object.entries(manifest.files || {})) { const got = sha(path.join(KIT, f)); if (got !== want) drift.push(`${f} (${got || 'missing'}≠${want})`); }
if (drift.length) refuse('contract files DRIFTED from pinned ' + manifest.version + ': ' + drift.join(', '));

// 2. HOOK WIRED
const root = path.dirname(KIT);
let hookWired = false;
for (const s of ['.claude/settings.json', '.claude/settings.local.json', 'settings.json', '.claude-settings.json']) {
  try { const t = fs.readFileSync(path.join(root, s), 'utf8'); if (/contract-rules\.cjs/.test(t) && /--hook/.test(t)) { hookWired = true; break; } } catch {}
}
if (!hookWired) refuse('Stop hook NOT wired (no settings registering contract-rules.cjs --hook) — a dormant contract is no contract (rule U)');

// 3. INSTRUMENT SANE
const st = cp.spawnSync('node', [path.join(KIT, 'contract-rules.cjs'), '--selftest'], { encoding: 'utf8' });
if (!/SELFTEST PASS/.test(st.stdout || '')) refuse('the checker itself FAILS --selftest — the instrument is broken, fix before trusting any verdict');

console.log('Contract loaded — hook armed: yes · integrity: ' + manifest.version + '@' + sha(path.join(KIT, 'CLAUDE.md')) + ' OK');
process.exit(0);

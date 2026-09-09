#!/usr/bin/env node
// probes/social-env.cjs — executed proof that /root/social-engine.env on kaka carries the six OSS_SOCIAL_* keys
// with no REPLACE_ME placeholders. Reads NAMES only over ssh; values never leave the box.
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const ID = path.basename(__filename, '.cjs');
const OUT = path.join(__dirname, ID + '.verdict.json');
const ROOT = path.resolve(__dirname, '..');

function probe() {
  const r = { id: ID, at: new Date().toISOString(), condition_fired: false, verdict: 'no_verdict', evidence: '', detail: '' };
  try {
    // execFileSync: no cmd.exe in the middle, so the remote script is passed verbatim as one argument
    const remote = 'f=/root/social-engine.env; if [ -f "$f" ]; then stat -c %a "$f"; grep -oE "^[A-Z_]+=" "$f" | tr -d = | sort | tr "\\n" " "; echo; grep -c REPLACE_ME "$f" || true; fi';
    const out = require('child_process').execFileSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', 'root@kaka.silkvo.com', remote], { encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'ignore'] }).split('\n').map(l => l.trim()).filter(l => l && !/post-quantum|store now|openssh\.com\/pq/.test(l));
    r.evidence = `ssh kaka: ${out.join(' | ')}`;
    r.condition_fired = out.length >= 2;
    if (!r.condition_fired) { r.detail = 'env file missing on kaka — NO VERDICT'; return r; }
    const mode = out[0].trim(); const keys = out[1].trim().split(/\s+/); const placeholders = parseInt(out[2] || '0', 10);
    const want = ['OSS_SOCIAL_ACCESS_KEY_ID', 'OSS_SOCIAL_ACCESS_KEY_SECRET', 'OSS_SOCIAL_BUCKET', 'OSS_SOCIAL_ENDPOINT', 'OSS_SOCIAL_PUBLIC_BASE_URL', 'OSS_SOCIAL_REGION'];
    const missing = want.filter(k => !keys.includes(k));
    const ok = mode === '600' && missing.length === 0 && placeholders === 0;
    r.verdict = ok ? 'pass' : 'fail';
    r.detail = ok ? 'mode 600, six keys present, no placeholders' : `mode=${mode} missing=${missing.join(',') || 'none'} placeholders=${placeholders}`;
  } catch (e) { r.detail = 'probe threw: ' + (e && e.message ? e.message : String(e)); }
  return r;
}
const r = probe();
fs.writeFileSync(OUT, JSON.stringify(r, null, 2) + '\n');
console.log(`${r.verdict.toUpperCase().padEnd(10)} ${ID} — ${r.evidence} — ${r.detail}\n  verdict: ${path.relative(ROOT, OUT).split(path.sep).join('/')}`);
process.exit(r.verdict === 'pass' ? 0 : r.verdict === 'fail' ? 1 : 3);

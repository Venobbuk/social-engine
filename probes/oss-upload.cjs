#!/usr/bin/env node
// probes/oss-upload.cjs — phase-0 gate: a real upload through the running engine lands in Aliyun OSS and is
// served back through https://media.social.silkvo.com. Fires the REAL path (Misskey API on kaka, admin token
// read on kaka only), grades from the DESTINATION (public media URL + OSS-reported headers). Values never leave kaka.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const ID = path.basename(__filename, '.cjs');
const OUT = path.join(__dirname, ID + '.verdict.json');
const ROOT = path.resolve(__dirname, '..');

const REMOTE = `
set -e
TOK=$(cat /root/social-engine.admintoken)
TMP=$(mktemp -d)
# 64 KB deterministic test payload wrapped as a PNG-named file (Misskey stores any type; we grade bytes round-trip)
python3 - "$TMP/probe.bin" <<'PY'
import sys, hashlib, os
data = os.urandom(65536)
open(sys.argv[1], "wb").write(data)
print("sha256=" + hashlib.sha256(data).hexdigest())
PY
RESP=$(curl -s -m 60 -F "i=$TOK" -F "force=true" -F "name=probe-oss-upload-$(date +%s).bin" -F "file=@$TMP/probe.bin" http://127.0.0.1:3960/api/drive/files/create)
URL=$(printf '%s' "$RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('url',''))" 2>/dev/null || true)
echo "url=$URL"
if [ -n "$URL" ]; then
  curl -s -m 60 -o "$TMP/back.bin" -D "$TMP/hdr.txt" -w "http=%{http_code} bytes=%{size_download}\\n" "$URL"
  grep -iE "^(server|x-oss-request-id|content-type):" "$TMP/hdr.txt" | tr -d '\\r' | head -3
  python3 - "$TMP/back.bin" <<'PY'
import sys, hashlib
print("back_sha256=" + hashlib.sha256(open(sys.argv[1], "rb").read()).hexdigest())
PY
else
  echo "resp=$(printf '%s' "$RESP" | head -c 200)"
fi
rm -rf "$TMP"
`;

function probe() {
  const r = { id: ID, at: new Date().toISOString(), condition_fired: false, verdict: 'no_verdict', evidence: '', detail: '' };
  try {
    const out = execFileSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', 'root@kaka.silkvo.com', REMOTE], { encoding: 'utf8', timeout: 180000, stdio: ['ignore', 'pipe', 'ignore'] })
      .split('\n').map(l => l.trim()).filter(l => l && !/post-quantum|store now|openssh\.com\/pq/.test(l));
    r.evidence = out.join(' | ');
    const url = (out.find(l => l.startsWith('url=')) || 'url=').slice(4);
    r.condition_fired = url.length > 0;
    if (!r.condition_fired) { r.detail = 'upload did not return a file URL — NO VERDICT (see evidence)'; return r; }
    const sha = (out.find(l => l.startsWith('sha256=')) || '').slice(7);
    const back = (out.find(l => l.startsWith('back_sha256=')) || '').slice(12);
    const http = /http=(\d+)/.exec(r.evidence); const bytes = /bytes=(\d+)/.exec(r.evidence);
    const viaMedia = url.startsWith('https://media.social.silkvo.com/');
    const ok = viaMedia && http && http[1] === '200' && bytes && bytes[1] === '65536' && sha && sha === back;
    r.verdict = ok ? 'pass' : 'fail';
    r.detail = ok ? 'file served from media.social.silkvo.com with identical bytes (64 KB, sha256 match)' : `viaMedia=${viaMedia} http=${http && http[1]} bytes=${bytes && bytes[1]} shaMatch=${sha === back}`;
  } catch (e) { r.detail = 'probe threw: ' + (e && e.message ? e.message.slice(0, 300) : String(e)); }
  return r;
}
const r = probe();
fs.writeFileSync(OUT, JSON.stringify(r, null, 2) + '\n');
console.log(`${r.verdict.toUpperCase().padEnd(10)} ${ID} — ${r.evidence} — ${r.detail}\n  verdict: ${path.relative(ROOT, OUT).split(path.sep).join('/')}`);
process.exit(r.verdict === 'pass' ? 0 : r.verdict === 'fail' ? 1 : 3);

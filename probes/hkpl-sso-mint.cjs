#!/usr/bin/env node
// probes/hkpl-sso-mint.cjs — hkpl side of the SSO (routes/auth-social.js on the hkpl DEV instance :3949, uat tenant):
// (1) without a session → 401; (2) QA player session → GET /api/v1/auth/sso/social returns an RS256 JWT with
// iss=hkpl, aud=social.silkvo.com, sub=<hkpl user id>, name, exp−iat=120 s, and url pointing at social.silkvo.com/sso.
// Runs over ssh on kaka; the session cookie and JWT never leave the box (only claim NAMES and shapes are reported).
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const ID = path.basename(__filename, '.cjs');
const OUT = path.join(__dirname, ID + '.verdict.json');
const ROOT = path.resolve(__dirname, '..');

const REMOTE = `
set -e
G=$(node -e 'console.log(require("crypto").createHmac("sha256","hkpl-site-gate-v1-signing-key-2026-07-16-rotate-me").update("gate:persist:v1").digest("hex").slice(0,40))')
NOSESS=$(curl -s -m 10 -o /dev/null -w "%{http_code}" -H "Host: uat.silkvo.com" -b "hkpl_gate=$G" http://127.0.0.1:3949/api/v1/auth/sso/social)
SC=$(curl -s -m 10 -D - -o /dev/null -H "Host: uat.silkvo.com" -b "hkpl_gate=$G" "http://127.0.0.1:3949/api/v1/auth/qa/player?p=hkpl-uat-2026" | grep -i "^set-cookie:" | grep -vi hkpl_gate | head -1 | sed -E 's/^[Ss]et-[Cc]ookie: //; s/;.*//')
BODY=$(curl -s -m 10 -H "Host: uat.silkvo.com" -H "Cookie: $SC; hkpl_gate=$G" http://127.0.0.1:3949/api/v1/auth/sso/social)
python3 - "$NOSESS" "$BODY" <<'PY'
import sys, json, base64
nosess, body = sys.argv[1], sys.argv[2]
try: d = json.loads(body)
except Exception: d = {}
out = {"nosess": nosess, "hasJwt": "jwt" in d, "urlOk": str(d.get("url","")).startswith("https://social.silkvo.com/sso?jwt=")}
if "jwt" in d:
    h, p, s = d["jwt"].split(".")
    dec = lambda x: json.loads(base64.urlsafe_b64decode(x + "=" * (-len(x) % 4)))
    hdr, c = dec(h), dec(p)
    out.update({"alg": hdr.get("alg"), "iss": c.get("iss"), "aud": c.get("aud"), "subLen": len(str(c.get("sub",""))), "hasName": bool(c.get("name")), "ttl": (c.get("exp",0) - c.get("iat",0)), "tenant": c.get("tenant"), "sigLen": len(s)})
print(json.dumps(out))
PY
`;

function probe() {
  const r = { id: ID, at: new Date().toISOString(), condition_fired: false, verdict: 'no_verdict', evidence: '', detail: '' };
  try {
    const out = execFileSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', 'root@kaka.silkvo.com', REMOTE], { encoding: 'utf8', timeout: 90000, stdio: ['ignore', 'pipe', 'ignore'] })
      .split('\n').map(l => l.trim()).filter(l => l.startsWith('{'));
    const j = JSON.parse(out[out.length - 1] || '{}');
    r.evidence = JSON.stringify(j);
    r.condition_fired = j.nosess === '401' || j.nosess === '200';
    if (!r.condition_fired) { r.detail = `route did not answer as expected (nosess=${j.nosess}) — NO VERDICT`; return r; }
    const ok = j.nosess === '401' && j.hasJwt && j.urlOk && j.alg === 'RS256' && j.iss === 'hkpl' && j.aud === 'social.silkvo.com' && j.subLen >= 8 && j.hasName && j.ttl === 120 && j.sigLen > 300;
    r.verdict = ok ? 'pass' : 'fail';
    r.detail = ok ? '401 without session; with a QA session: RS256 JWT, iss hkpl, aud social.silkvo.com, 120 s TTL, name present, url → /sso' : 'one of the mint conditions failed (see evidence)';
  } catch (e) { r.detail = 'probe threw: ' + (e && e.message ? e.message.slice(0, 300) : String(e)); }
  return r;
}
const r = probe();
fs.writeFileSync(OUT, JSON.stringify(r, null, 2) + '\n');
console.log(`${r.verdict.toUpperCase().padEnd(10)} ${ID} — ${r.evidence} — ${r.detail}\n  verdict: ${path.relative(ROOT, OUT).split(path.sep).join('/')}`);
process.exit(r.verdict === 'pass' ? 0 : r.verdict === 'fail' ? 1 : 3);

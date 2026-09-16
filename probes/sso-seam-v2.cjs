#!/usr/bin/env node
// probes/sso-seam-v2.cjs — the engine side of the SSO seam after SSO-SEAM-V2 (adapter/sso.ts).
// Mints a real JWT on the hkpl DEV instance (uat tenant, :3949, QA player session — same mechanism as
// hkpl-sso-mint.cjs), redeems it at social.silkvo.com twice, and checks on the box:
//   P1 redeem → token, userId, created, lang, ratingSynced present
//   P2 the returned token is NOT the account's master token (user.token)               — S4
//   P3 an access_token row exists for it: name 'SSO · hkpl', has write:meets, no admin scope   — S4
//   P4 the returned token authenticates (POST /api/i) as that user
//   P5 second redemption of the same JWT: REPLAYED if the JWT carried a jti; admitted (transition) if not — S3
//   P6 lang echoed (S6) · ratingSynced is a boolean (S7)
// Runs over ssh on kaka. The session cookie, JWT and token never leave the box — only booleans and shapes.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const ID = path.basename(__filename, '.cjs');
const OUT = path.join(__dirname, ID + '.verdict.json');

const REMOTE = `
set -e
G=$(node -e 'console.log(require("crypto").createHmac("sha256","hkpl-site-gate-v1-signing-key-2026-07-16-rotate-me").update("gate:persist:v1").digest("hex").slice(0,40))')
SC=$(curl -s -m 10 -D - -o /dev/null -H "Host: uat.silkvo.com" -b "hkpl_gate=$G" "http://127.0.0.1:3949/api/v1/auth/qa/player?p=hkpl-uat-2026" | grep -i "^set-cookie:" | grep -vi hkpl_gate | head -1 | sed -E 's/^[Ss]et-[Cc]ookie: //; s/;.*//')
MINT=$(curl -s -m 10 -H "Host: uat.silkvo.com" -H "Cookie: $SC; hkpl_gate=$G" http://127.0.0.1:3949/api/v1/auth/sso/social)
JWT=$(node -e 'try{console.log(JSON.parse(process.argv[1]).jwt||"")}catch(e){console.log("")}' "$MINT")
[ -n "$JWT" ] || { echo '{"error":"no jwt from hkpl mint"}'; exit 0; }
HASJTI=$(node -e 'const p=process.argv[1].split(".")[1];const c=JSON.parse(Buffer.from(p.replace(/-/g,"+").replace(/_/g,"/"),"base64").toString());console.log(typeof c.jti==="string"&&c.jti.length>=8)' "$JWT")
R1=$(curl -s -m 15 -X POST https://social.silkvo.com/api/adapter/sso -H 'Content-Type: application/json' -d "{\\"jwt\\":\\"$JWT\\"}")
R2=$(curl -s -m 15 -X POST https://social.silkvo.com/api/adapter/sso -H 'Content-Type: application/json' -d "{\\"jwt\\":\\"$JWT\\"}")
TOKEN=$(node -e 'try{console.log(JSON.parse(process.argv[1]).token||"")}catch(e){console.log("")}' "$R1")
UID_=$(node -e 'try{console.log(JSON.parse(process.argv[1]).userId||"")}catch(e){console.log("")}' "$R1")
DBU=$(docker exec social-engine-db-1 sh -c 'echo $POSTGRES_USER'); DBN=$(docker exec social-engine-db-1 sh -c 'echo $POSTGRES_DB')
ISMASTER=$(docker exec social-engine-db-1 psql -U "$DBU" -d "$DBN" -tAc "select (token = '$TOKEN') from \\"user\\" where id='$UID_'" 2>/dev/null | head -1)
ATROW=$(docker exec social-engine-db-1 psql -U "$DBU" -d "$DBN" -tAc "select name || '|' || array_to_string(permission, ',') from access_token where token='$TOKEN'" 2>/dev/null | head -1)
ME=$(curl -s -m 15 -X POST https://social.silkvo.com/api/i -H 'Content-Type: application/json' -d "{\\"i\\":\\"$TOKEN\\"}")
node -e '
const [hasJti,r1s,r2s,isMaster,atRow,me,uid]=process.argv.slice(1);
let r1={},r2={},m={}; try{r1=JSON.parse(r1s)}catch{} try{r2=JSON.parse(r2s)}catch{} try{m=JSON.parse(me)}catch{}
const perms=(atRow.split("|")[1]||"").split(",");
const out={
  hasJti: hasJti==="true",
  P1_redeem_shape: typeof r1.token==="string" && typeof r1.userId==="string" && typeof r1.created==="boolean" && ("lang" in r1) && typeof r1.ratingSynced==="boolean",
  P2_not_master_token: isMaster.trim()==="f",
  P3_access_token_row: atRow.startsWith("SSO · hkpl|") && perms.includes("write:meets") && perms.includes("read:account") && !perms.some(p=>p.includes(":admin:")),
  P4_token_authenticates: m && m.id===uid,
  P5_replay: hasJti==="true" ? (r2.error && r2.error.code==="ADAPTER_SSO_REPLAYED") : (typeof r2.token==="string"),
  P5_mode: hasJti==="true" ? "jti present → second redemption must be REPLAYED" : "no jti (old mint) → admitted under transition flag; replay protection NOT exercised",
  P6_lang_echoed: typeof r1.lang==="string" && r1.lang.length>0,
  P6_ratingSynced_bool: typeof r1.ratingSynced==="boolean",
  r1_error: r1.error ? r1.error.code : null, r2_error: r2.error ? r2.error.code : null,
};
console.log(JSON.stringify(out));
' "$HASJTI" "$R1" "$R2" "$ISMASTER" "$ATROW" "$ME" "$UID_"
`;

function probe() {
  const r = { id: ID, at: new Date().toISOString(), condition_fired: false, verdict: 'no_verdict', evidence: '', detail: '' };
  try {
    const out = execFileSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', 'root@kaka.silkvo.com', REMOTE], { encoding: 'utf8', timeout: 120000, stdio: ['ignore', 'pipe', 'ignore'] })
      .split('\n').map(l => l.trim()).filter(l => l.startsWith('{'));
    const j = JSON.parse(out[out.length - 1] || '{}');
    r.evidence = JSON.stringify(j);
    if (j.error) { r.detail = j.error; return r; }
    r.condition_fired = true;
    const checks = ['P1_redeem_shape', 'P2_not_master_token', 'P3_access_token_row', 'P4_token_authenticates', 'P5_replay', 'P6_lang_echoed', 'P6_ratingSynced_bool'];
    const ok = checks.every(k => j[k] === true);
    r.verdict = ok ? 'pass' : 'fail';
    r.detail = (ok ? 'all seam checks held. ' : 'a seam check failed (see evidence). ') + j.P5_mode;
  } catch (e) {
    r.detail = 'probe could not run: ' + (e && e.message ? e.message.split('\n')[0] : String(e));
  }
  return r;
}

const r = probe();
fs.writeFileSync(OUT, JSON.stringify(r, null, 2));
console.log(JSON.stringify(r, null, 2));
process.exit(r.verdict === 'pass' ? 0 : 1);

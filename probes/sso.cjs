#!/usr/bin/env node
// probes/sso.cjs — phase-1 gate: a host-signed RS256 JWT (minted on kaka with hkpl's private key) is exchanged at
// POST /api/adapter/sso on the RUNNING engine for an account token; /api/i with that token returns the derived
// username; a second exchange returns the SAME user (idempotent); a tampered JWT is rejected. Keys never leave kaka.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const ID = path.basename(__filename, '.cjs');
const OUT = path.join(__dirname, ID + '.verdict.json');
const ROOT = path.resolve(__dirname, '..');

const REMOTE = `
set -e
cd /root/hkpl-server   # host-side node_modules (hkpl-dev keeps its node_modules in a docker volume)
node -e '
const jwt=require("jsonwebtoken"); const fs=require("fs");
const key=fs.readFileSync("/root/hkpl-server/secrets/social-sso-rs256.key","utf8");
const sub="probe-"+Date.now();
const claims={iss:"hkpl",aud:"social.silkvo.com",sub,tenant:"hkpl",name:"Probe Player",role:"PLAYER",dupr_id:null,dupr_rating:3.5,lang:"en"};
const t=jwt.sign(claims,key,{algorithm:"RS256",expiresIn:120});
const bad=t.slice(0,-3)+"abc";
const call=async(tok)=>{const r=await fetch("http://127.0.0.1:3960/api/adapter/sso",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jwt:tok})}); return {status:r.status, body:await r.json().catch(()=>({}))};};
(async()=>{const a=await call(t); const b=await call(t); const c=await call(bad);
 let me={}; if(a.body.token){const r=await fetch("http://127.0.0.1:3960/api/i",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({i:a.body.token})}); me=await r.json();}
 console.log(JSON.stringify({first:{status:a.status,created:a.body.created,username:a.body.username,userId:a.body.userId,hasToken:!!a.body.token},second:{status:b.status,created:b.body.created,userId:b.body.userId},tampered:{status:c.status,code:c.body.error&&c.body.error.code},me:{username:me.username,name:me.name}}));
})();'
`;

function probe() {
  const r = { id: ID, at: new Date().toISOString(), condition_fired: false, verdict: 'no_verdict', evidence: '', detail: '' };
  try {
    const out = execFileSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', 'root@kaka.silkvo.com', REMOTE], { encoding: 'utf8', timeout: 120000, stdio: ['ignore', 'pipe', 'ignore'] })
      .split('\n').map(l => l.trim()).filter(l => l.startsWith('{'));
    const j = JSON.parse(out[out.length - 1] || '{}');
    r.evidence = JSON.stringify(j);
    r.condition_fired = !!j.first && j.first.status !== 404;
    if (!r.condition_fired) { r.detail = 'adapter/sso route absent (404) — NO VERDICT (image without the endpoint?)'; return r; }
    const ok = j.first.status === 200 && j.first.hasToken && j.first.created === true && /^hkpl_[0-9a-f]{12}$/.test(j.first.username)
      && j.second.status === 200 && j.second.created === false && j.second.userId === j.first.userId
      && j.tampered.status >= 400 && j.me.username === j.first.username && j.me.name === 'Probe Player';
    r.verdict = ok ? 'pass' : 'fail';
    r.detail = ok ? 'JWT exchanged for a session, idempotent on repeat, tampered JWT rejected, /api/i shows the derived user with the host display name' : 'one of the SSO conditions failed (see evidence)';
  } catch (e) { r.detail = 'probe threw: ' + (e && e.message ? e.message.slice(0, 300) : String(e)); }
  return r;
}
const r = probe();
fs.writeFileSync(OUT, JSON.stringify(r, null, 2) + '\n');
console.log(`${r.verdict.toUpperCase().padEnd(10)} ${ID} — ${r.evidence} — ${r.detail}\n  verdict: ${path.relative(ROOT, OUT).split(path.sep).join('/')}`);
process.exit(r.verdict === 'pass' ? 0 : r.verdict === 'fail' ? 1 : 3);

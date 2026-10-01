'use strict';
// SSO-AUD-SPLIT-V1 offline check of the REAL verifyJwt source (read from the file at run time, not a copy): the block from
// "// issuer → public key file" up to "// deterministic local username" of adapter/sso.ts is transpiled with the image's
// typescript and run against tokens signed with a throwaway RSA key, under the env each engine will carry.
// Run inside the engine image (it has typescript): node verifyjwt.test.cjs <path to sso.ts>
const fs = require('fs'); const os = require('os'); const path = require('path'); const crypto = require('crypto');
const { execFileSync } = require('child_process');
const SRC = process.argv[2];
if (process.env.SSOB_CHILD) { // ---- child: load the transpiled block with the env given, run one case, print the outcome
  const mod = require(process.env.SSOB_MOD);
  try { const c = mod.verifyJwt(process.env.SSOB_TOKEN); console.log('OK ' + c.aud); } catch (e) { console.log('REFUSED ' + (e.code || e.message)); }
  process.exit(0);
}
const ts = require(require.resolve('typescript', { paths: ['/misskey/packages/backend', '/misskey'] }));
const src = fs.readFileSync(SRC, 'utf8');
const a = src.indexOf('// issuer → public key file'); const b = src.indexOf('// deterministic local username');
if (a < 0 || b < 0 || b < a) { console.log('FAIL anchors not found'); process.exit(1); }
const block = src.slice(a, b);
if (!/SSO-AUD-SPLIT-V1/.test(block) || !/export function verifyJwt/.test(block)) { console.log('FAIL extracted block lacks verifyJwt / the marker'); process.exit(1); }
const stub = `const { createPublicKey, createVerify } = require('node:crypto'); const { readFileSync } = require('node:fs');
class ApiError extends Error { constructor(e) { super(e.code); this.code = e.code; } }
const meta = { errors: { unknownIssuer: { code: 'ADAPTER_SSO_UNKNOWN_ISSUER' }, unconfigured: { code: 'ADAPTER_SSO_UNCONFIGURED' }, invalidToken: { code: 'ADAPTER_SSO_INVALID' } } };
function b64urlToBuf(s) { return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64'); }
`;
const js = ts.transpileModule(block, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ssob-')); const modPath = path.join(dir, 'block.cjs');
fs.writeFileSync(modPath, stub + js);
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const pubPath = path.join(dir, 'pub.pem'); fs.writeFileSync(pubPath, publicKey.export({ type: 'spki', format: 'pem' }));
const b64u = (x) => Buffer.from(x).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
function tok(aud, tenant) { const t = Math.floor(Date.now() / 1000); const h = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' })); const p = b64u(JSON.stringify({ jti: crypto.randomUUID(), iss: 'hkpl', aud, sub: 'person-1234', tenant, iat: t, exp: t + 120 })); return h + '.' + p + '.' + b64u(crypto.sign('RSA-SHA256', Buffer.from(h + '.' + p), privateKey)); }
const PROD = { ADAPTER_SSO_AUDIENCE: 'social.silkvo.com', ADAPTER_SSO_REFUSE_TENANTS: 'boyau-uat' };
const UAT = { ADAPTER_SSO_AUDIENCE: 'social.silkvo.com', ADAPTER_SSO_AUDIENCES: 'uat.social.silkvo.com,social.silkvo.com@boyau-uat' };
const UAT_FINAL = { ADAPTER_SSO_AUDIENCE: 'social.silkvo.com', ADAPTER_SSO_AUDIENCES: 'uat.social.silkvo.com' };
const OLD = { ADAPTER_SSO_AUDIENCE: 'social.silkvo.com' };
const CASES = [
  ['prod: prod token (aud social, tenant boyau) -> OK', PROD, 'social.silkvo.com', 'boyau', 'OK social.silkvo.com'],
  ['prod: league member token (aud social, tenant hkpl) -> OK', PROD, 'social.silkvo.com', 'hkpl', 'OK social.silkvo.com'],
  ['prod: NEW UAT token (aud uat) -> refused aud', PROD, 'uat.social.silkvo.com', 'boyau-uat', 'REFUSED aud'],
  ['prod: OLD UAT token (aud social, tenant boyau-uat) -> refused tenant_refused', PROD, 'social.silkvo.com', 'boyau-uat', 'REFUSED tenant_refused'],
  ['uat: NEW UAT token (aud uat, boyau-uat) -> OK', UAT, 'uat.social.silkvo.com', 'boyau-uat', 'OK uat.social.silkvo.com'],
  ['uat: league member to UAT after hkpl (aud uat, hkpl) -> OK', UAT, 'uat.social.silkvo.com', 'hkpl', 'OK uat.social.silkvo.com'],
  ['uat: OLD UAT token during transition (aud social, boyau-uat) -> OK', UAT, 'social.silkvo.com', 'boyau-uat', 'OK social.silkvo.com'],
  ['uat: prod token (aud social, boyau) -> refused aud_tenant', UAT, 'social.silkvo.com', 'boyau', 'REFUSED aud_tenant'],
  ['uat: league prod token (aud social, hkpl) -> refused aud_tenant', UAT, 'social.silkvo.com', 'hkpl', 'REFUSED aud_tenant'],
  ['uat final (legacy dropped): old UAT token -> refused aud', UAT_FINAL, 'social.silkvo.com', 'boyau-uat', 'REFUSED aud'],
  ['old env only (no AUDIENCES): prod token -> OK (fallback to ADAPTER_SSO_AUDIENCE)', OLD, 'social.silkvo.com', 'boyau', 'OK social.silkvo.com'],
  ['old env only: aud uat -> refused aud', OLD, 'uat.social.silkvo.com', 'boyau-uat', 'REFUSED aud'],
  ['no audience at all -> UNCONFIGURED (fails closed)', {}, 'social.silkvo.com', 'boyau', 'REFUSED ADAPTER_SSO_UNCONFIGURED'],
  ['garbage AUDIENCES ("@x,") -> UNCONFIGURED', { ADAPTER_SSO_AUDIENCE: 'social.silkvo.com', ADAPTER_SSO_AUDIENCES: '@x, ,' }, 'social.silkvo.com', 'boyau', 'REFUSED ADAPTER_SSO_UNCONFIGURED'],
];
let fail = 0;
for (const [name, env, aud, tenant, want] of CASES) {
  const out = execFileSync(process.execPath, [__filename], { env: { PATH: process.env.PATH, ...env, ADAPTER_SSO_PUBKEY_HKPL: pubPath, SSOB_CHILD: '1', SSOB_MOD: modPath, SSOB_TOKEN: tok(aud, tenant) }, encoding: 'utf8' }).trim();
  const ok = out === want; if (!ok) fail++;
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : ' — got "' + out + '"'));
}
// plant: a token signed by ANOTHER key must still be refused at the signature under the permissive UAT env
const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
const t = Math.floor(Date.now() / 1000); const h = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' })); const p = b64u(JSON.stringify({ jti: 'x'.repeat(12), iss: 'hkpl', aud: 'uat.social.silkvo.com', sub: 'person-1234', tenant: 'boyau-uat', iat: t, exp: t + 120 }));
const forged = h + '.' + p + '.' + b64u(crypto.sign('RSA-SHA256', Buffer.from(h + '.' + p), other));
const fo = execFileSync(process.execPath, [__filename], { env: { PATH: process.env.PATH, ...UAT, ADAPTER_SSO_PUBKEY_HKPL: pubPath, SSOB_CHILD: '1', SSOB_MOD: modPath, SSOB_TOKEN: forged }, encoding: 'utf8' }).trim();
if (fo !== 'REFUSED sig') fail++;
console.log((fo === 'REFUSED sig' ? 'PASS ' : 'FAIL ') + 'plant: a token signed by another key (UAT env) -> refused sig' + (fo === 'REFUSED sig' ? '' : ' — got "' + fo + '"'));
fs.rmSync(dir, { recursive: true, force: true });
console.log(fail ? `RESULT FAIL ${fail}/${CASES.length + 1}` : `RESULT PASS ${CASES.length + 1}/${CASES.length + 1}`);
process.exit(fail ? 1 : 0);

'use strict';
// SSO-SPLIT-B probe (lane SSO-SPLIT-B, 2026-10-01). Does a token minted for one GripBat environment open the OTHER engine?
//
// Tokens are minted the REAL way (the button's hkpl hand-off, lib/gb-account.ts gbHkplStart):
//   UAT  token: https://uat.gripbat.com/api/v1/auth/sso/social/gripbat?return=https://uat.gripbat.com  (persona boyau.tester2, tenant boyau-uat)
//   PROD token: https://gripbat.com/api/v1/auth/sso/social/gripbat?return=https://gripbat.com          (boyau.tester2, tenant boyau)
//
// NO-SIDE-EFFECT CROSS CHECK (the "jti plant"). adapter/sso runs verifyJwt (signature, issuer, AUDIENCE, tenant, exp, iat,
// ttl, sub) FIRST, then the purpose check, then the single-use jti check (Redis SET NX), and only THEN looks up / creates an
// account and issues a credential (adapter/sso.ts handler). Before a cross-environment POST the probe SETs the token's own
// jti key in the TARGET engine's Redis (prod db0 prefix social.silkvo.com:, UAT db1 prefix uat.social.silkvo.com:), so:
//   ADAPTER_SSO_REPLAYED  = the token PASSED verifyJwt (the engine would have signed the person in) — no account, no session
//   ADAPTER_SSO_INVALID   = the token was REFUSED by verifyJwt (the engine log says why: aud / tenant_refused / …)
// The plant is checked against a forged token (K1 must read INVALID even with its jti planted) and deleted in finally.
// The UAT engine is ALSO exercised for real (C1: redeem -> session -> gb/auth/signout of that access token, as before).
// Never prints a token, a cookie, a jti or a password (claim names / aud / tenant / lengths only).
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const MODE = process.env.MODE || 'before';
const OUT = process.env.OUT || ('/root/gen/l6-scope/verdicts/sso-split-b.' + MODE + '.probe.json');
const UAT_HK = 'https://uat.gripbat.com', UAT_RET = 'https://uat.gripbat.com', UAT_ENG = 'https://uat.social.silkvo.com/api/';
const PROD_HK = 'https://gripbat.com', PROD_RET = 'https://gripbat.com', PROD_ENG = 'https://social.silkvo.com/api/';
const REDIS = 'social-engine-redis-1';
const RDB = { prod: { db: '0', prefix: 'social.silkvo.com:' }, uat: { db: '1', prefix: 'uat.social.silkvo.com:' } };
const ENG_CT = { prod: 'social-engine-web-1', uat: 'social-engine-web-uat-1' };
const COOKIE_DIR = '/root/gen/sso-split-b';
process.env.BASE = UAT_HK;   // _session.cjs reads BASE at load: the UAT hkpl session is minted on the UAT GripBat host
const { getSession } = require('/root/social-engine/probes/_session.cjs');

const V = { id: 'sso-split-b', mode: MODE, at: new Date().toISOString(), running: {}, tokens: {}, rows: {}, engineLog: {}, cleanup: [] };
const row = (id, ok, ev) => { V.rows[id] = { ok: !!ok, ...ev }; console.log((ok ? 'PASS ' : 'FAIL ') + id + ' ' + JSON.stringify(ev).slice(0, 300)); };
const b64u = (x) => Buffer.from(x).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const dec = (seg) => JSON.parse(Buffer.from(seg.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
const planted = [];
function redis(env, ...args) { return execFileSync('docker', ['exec', REDIS, 'redis-cli', '-n', RDB[env].db, ...args], { encoding: 'utf8' }).trim(); }
function plant(env, jti) { const k = RDB[env].prefix + 'sso:jti:hkpl:' + jti; const r = redis(env, 'SET', k, 'sso-split-b-plant', 'EX', '300', 'NX'); planted.push([env, k]); return r; }
async function eng(base, ep, body) {
  const r = await fetch(base + ep, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch (e) { /* 204 */ }
  return { status: r.status, json, code: json && json.error && json.error.code || null };
}
const noToken = (r) => !(r.json && (r.json.token || r.json.i));
function claimsOf(jwt) { try { const c = dec(jwt.split('.')[1]); return { aud: c.aud, tenant: c.tenant, iss: c.iss, ttl: c.exp - c.iat, jtiLen: String(c.jti || '').length, alg: dec(jwt.split('.')[0]).alg, _jti: c.jti }; } catch (e) { return null; } }
const pub = (c) => { if (!c) return null; const { _jti, ...rest } = c; return rest; };

async function prodCookie() { // boyau.tester2 on the PROD GripBat host (tenant boyau); cached 6 h in a 600 file of this lane only
  const f = path.join(COOKIE_DIR, 'prod-tester2.cookie');
  try { const c = JSON.parse(fs.readFileSync(f, 'utf8')); if (Date.now() - c.at < 6 * 3600e3) { const r = await fetch(PROD_HK + '/api/v1/auth/me', { headers: { cookie: c.name + '=' + c.value } }); const j = await r.json().catch(() => null); if (r.status === 200 && j && (j.user || j.id)) return c; } } catch (e) { /* re-login */ }
  const T = JSON.parse(fs.readFileSync('/root/boyau-test-accounts.json', 'utf8'))[1];
  const r = await fetch(PROD_HK + '/api/v1/auth/password/login', { method: 'POST', headers: { 'content-type': 'application/json', origin: PROD_HK }, body: JSON.stringify({ email: T.email, password: T.password }) });
  if (r.status !== 200) throw new Error('prod hkpl login ' + r.status);
  const raw = (r.headers.get('set-cookie') || '').split(';')[0]; const i = raw.indexOf('=');
  const c = { name: raw.slice(0, i), value: raw.slice(i + 1), at: Date.now() };
  fs.mkdirSync(COOKIE_DIR, { recursive: true }); fs.writeFileSync(f, JSON.stringify(c), { mode: 0o600 }); return c;
}
async function mint(hk, ret, cookie) { // the button's hand-off; returns { status, origin, jwt, claims, location(redacted) }
  const r = await fetch(hk + '/api/v1/auth/sso/social/gripbat?return=' + encodeURIComponent(ret), { headers: { cookie }, redirect: 'manual' });
  const loc = r.headers.get('location') || '';
  const m = /^(https:\/\/[^/#]+)\/app\/pages\/signin\/index#gbsso=([^&]+)$/.exec(loc);
  const jwt = m ? decodeURIComponent(m[2]) : '';
  const body = r.status === 302 ? '' : (await r.text()).slice(0, 80);
  return { status: r.status, origin: m && m[1], jwt, claims: jwt ? claimsOf(jwt) : null, body, location: loc.replace(/gbsso=.*/, 'gbsso=<redacted>').slice(0, 120) };
}
function engineLog(env, since) {
  try {
    const out = execFileSync('docker', ['logs', '--since', since, ENG_CT[env]], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64e6 });
    return out.split('\n').filter((l) => l.includes('SSO token refused')).map((l) => l.replace(/^.*SSO token refused/, 'SSO token refused').slice(0, 220)).slice(-6);
  } catch (e) { return ['(log read failed: ' + String(e.message).slice(0, 80) + ')']; }
}

(async () => {
  const since = new Date(Date.now() - 2000).toISOString();
  let uatAccess = null, prodCk = null;
  try {
    for (const env of ['prod', 'uat']) {
      const img = execFileSync('docker', ['inspect', '-f', '{{.Image}}', ENG_CT[env]], { encoding: 'utf8' }).trim();
      const rev = execFileSync('docker', ['image', 'inspect', img, '--format', '{{index .Config.Labels "org.opencontainers.image.revision"}}'], { encoding: 'utf8' }).trim();
      const envs = execFileSync('docker', ['inspect', '-f', '{{range .Config.Env}}{{println .}}{{end}}', ENG_CT[env]], { encoding: 'utf8' }).split('\n').filter((l) => /^ADAPTER_SSO_(AUDIENCE|AUDIENCES|REFUSE_TENANTS|TENANT|STAFF_TENANTS)=/.test(l));
      V.running[env] = { container: ENG_CT[env], revision: rev, ssoEnv: envs };
    }
    const hkImg = execFileSync('docker', ['inspect', '-f', '{{.Image}}', 'hkpl-docker-hkpl-app-1'], { encoding: 'utf8' }).trim();
    V.running.hkpl = { image: hkImg.slice(7, 19), head: execFileSync('git', ['-C', '/root/hkpl-server', 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim() };
    console.log('running', JSON.stringify(V.running));

    const uck = await getSession(1); const uatCookie = uck.name + '=' + uck.value;
    prodCk = await prodCookie(); const prodCookieS = prodCk.name + '=' + prodCk.value;

    // ------------------------------------------------------------ K1 plant control: a forged token stays INVALID with its jti planted
    {
      const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
      const t = Math.floor(Date.now() / 1000); const jti = crypto.randomUUID();
      const h = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' })), p = b64u(JSON.stringify({ jti, iss: 'hkpl', aud: 'social.silkvo.com', sub: 'probe-ssob-' + crypto.randomBytes(5).toString('hex'), iat: t, exp: t + 120, tenant: 'boyau', name: '[probe] forged' }));
      const forged = h + '.' + p + '.' + b64u(crypto.sign('RSA-SHA256', Buffer.from(h + '.' + p), privateKey));
      plant('prod', jti);
      const r = await eng(PROD_ENG, 'adapter/sso', { jwt: forged, native: true });
      row('K1 plant control: a FORGED token with its jti planted in prod Redis -> still INVALID (the plant only turns a VERIFIED token into REPLAYED)', r.status === 400 && r.code === 'ADAPTER_SSO_INVALID' && noToken(r), { status: r.status, code: r.code });
    }

    // ------------------------------------------------------------ X1 UAT token -> PROD engine
    const u1 = await mint(UAT_HK, UAT_RET, uatCookie); V.tokens.uatButton = { status: u1.status, origin: u1.origin, claims: pub(u1.claims) };
    if (u1.jwt) {
      plant('prod', u1.claims._jti);
      const r = await eng(PROD_ENG, 'adapter/sso', { jwt: u1.jwt, native: true });
      const accepted = r.status === 400 && r.code === 'ADAPTER_SSO_REPLAYED';
      const refused = r.status === 400 && r.code === 'ADAPTER_SSO_INVALID';
      row(MODE === 'before' ? 'X1 a UAT-minted token presented to the PROD engine -> ACCEPTED by verifyJwt (hole present: REPLAYED via the plant, no session made)'
                            : 'X1 a UAT-minted token presented to the PROD engine -> REFUSED (INVALID)',
          (MODE === 'before' ? accepted : refused) && noToken(r), { status: r.status, code: r.code, tokenAud: u1.claims.aud, tokenTenant: u1.claims.tenant });
    } else row('X1 UAT token -> PROD engine', false, { precondition: 'UAT hand-off gave no token', mint: { status: u1.status, body: u1.body, location: u1.location } });

    // ------------------------------------------------------------ X2 PROD token -> UAT engine
    const p1 = await mint(PROD_HK, PROD_RET, prodCookieS); V.tokens.prodButton = { status: p1.status, origin: p1.origin, claims: pub(p1.claims) };
    if (p1.jwt) {
      plant('uat', p1.claims._jti);
      const r = await eng(UAT_ENG, 'adapter/sso', { jwt: p1.jwt, native: true });
      const accepted = r.status === 400 && r.code === 'ADAPTER_SSO_REPLAYED';
      const refused = r.status === 400 && r.code === 'ADAPTER_SSO_INVALID';
      row(MODE === 'before' ? 'X2 a PROD-minted token presented to the UAT engine -> ACCEPTED by verifyJwt (hole present: REPLAYED via the plant, no session made)'
                            : 'X2 a PROD-minted token presented to the UAT engine -> REFUSED (INVALID)',
          (MODE === 'before' ? accepted : refused) && noToken(r), { status: r.status, code: r.code, tokenAud: p1.claims.aud, tokenTenant: p1.claims.tenant });
    } else row('X2 PROD token -> UAT engine', false, { precondition: 'PROD hand-off gave no token', mint: { status: p1.status, body: p1.body, location: p1.location } });

    // ------------------------------------------------------------ X3 a UAT (sandbox) session asks for a PROD-origin hand-off
    const x3 = await mint(UAT_HK, PROD_RET, uatCookie); V.tokens.uatSessionProdReturn = { status: x3.status, origin: x3.origin, claims: pub(x3.claims), body: x3.body };
    if (MODE !== 'after') row('X3 a UAT sandbox session asking hkpl for a hand-off to https://gripbat.com -> 302 with a PROD-audience token (not redeemed; hkpl not yet changed)', x3.status === 302 && x3.claims && x3.claims.aud === 'social.silkvo.com', { status: x3.status, origin: x3.origin, tokenAud: x3.claims && x3.claims.aud, tokenTenant: x3.claims && x3.claims.tenant });
    else row('X3 a UAT sandbox session asking hkpl for a hand-off to https://gripbat.com -> 400 env_mismatch, no token', x3.status === 400 && /env_mismatch/.test(x3.body) && !x3.jwt, { status: x3.status, body: x3.body });

    // ------------------------------------------------------------ C2 PROD token -> PROD engine (token only: plant, no session)
    const p2 = await mint(PROD_HK, PROD_RET, prodCookieS); V.tokens.prodButton2 = { status: p2.status, claims: pub(p2.claims) };
    if (p2.jwt) {
      plant('prod', p2.claims._jti);
      const r = await eng(PROD_ENG, 'adapter/sso', { jwt: p2.jwt, native: true });
      row('C2 a PROD-minted token presented to the PROD engine -> ACCEPTED by verifyJwt (REPLAYED via the plant; prod sign-in path intact, no session made)', r.status === 400 && r.code === 'ADAPTER_SSO_REPLAYED' && noToken(r), { status: r.status, code: r.code, tokenAud: p2.claims.aud, tokenTenant: p2.claims.tenant });
    } else row('C2 PROD token -> PROD engine', false, { precondition: 'PROD hand-off gave no token', mint: { status: p2.status, body: p2.body } });

    // ------------------------------------------------------------ C1 the real UAT button: redeem -> session for that person -> replay refused
    const u2 = await mint(UAT_HK, UAT_RET, uatCookie); V.tokens.uatButton2 = { status: u2.status, origin: u2.origin, claims: pub(u2.claims) };
    if (u2.jwt) {
      const g = await eng(UAT_ENG, 'adapter/sso', { jwt: u2.jwt, native: true });
      uatAccess = g.json && g.json.token || null;
      const who = uatAccess ? await eng(UAT_ENG, 'i', { i: uatAccess }) : { status: 0, json: null };
      const handle = 'hkpl_' + crypto.createHash('sha256').update('hkpl:' + dec(u2.jwt.split('.')[1]).sub).digest('hex').slice(0, 12);
      V.session = { userId: g.json && g.json.userId, username: g.json && g.json.username, created: g.json && g.json.created, linked: g.json && g.json.linked, accessTokenLen: uatAccess ? uatAccess.length : 0, nativeTokenLen: g.json && g.json.i ? g.json.i.length : 0, seamHandle: handle };
      const wantAud = MODE === 'after' ? 'uat.social.silkvo.com' : 'social.silkvo.com';   // after the hkpl change the button stamps the UAT audience
      row('C1 the real UAT button: hand-off 302 to the UAT origin (aud ' + wantAud + ') -> UAT engine redeems it -> a session for THAT person (i/ answers as the same account)', u2.claims && u2.claims.aud === wantAud && u2.status === 302 && u2.origin === UAT_RET && g.status === 200 && !!uatAccess && who.status === 200 && who.json && who.json.id === g.json.userId, { mint: u2.status, status: g.status, code: g.code, tokenAud: u2.claims.aud, session: V.session, whoami: who.status });
      const g3 = await eng(UAT_ENG, 'adapter/sso', { jwt: u2.jwt, native: true });
      row('C3 the same UAT token a second time -> refused (single-use jti)', g3.status === 400 && g3.code === 'ADAPTER_SSO_REPLAYED' && noToken(g3), { status: g3.status, code: g3.code });
    } else row('C1 the real UAT button', false, { precondition: 'UAT hand-off gave no token', mint: { status: u2.status, body: u2.body, location: u2.location } });
  } catch (e) { V.error = String(e && e.stack || e).slice(0, 600); console.error(V.error); }
  finally {
    if (uatAccess) {
      const so = await eng(UAT_ENG, 'gb/auth/signout', { i: uatAccess });
      const after = await eng(UAT_ENG, 'i', { i: uatAccess });
      V.cleanup.push('UAT access token row: gb/auth/signout -> ' + so.status + ', i/ with it after -> ' + after.status);
    }
    let del = 0; for (const [env, k] of planted) { try { del += Number(redis(env, 'DEL', k)) || 0; } catch (e) { /* */ } }
    V.cleanup.push('jti plants: ' + planted.length + ' set, ' + del + ' deleted (the rest were consumed/expired; each had EX 300)');
    if (prodCk) {
      const r = await fetch(PROD_HK + '/api/v1/auth/signout', { method: 'POST', headers: { cookie: prodCk.name + '=' + prodCk.value, origin: PROD_HK, 'content-type': 'application/json' }, body: '{}' }).catch(() => null);
      const me = await fetch(PROD_HK + '/api/v1/auth/me', { headers: { cookie: prodCk.name + '=' + prodCk.value } }).then((x) => x.json()).catch(() => null);
      try { fs.unlinkSync(path.join(COOKIE_DIR, 'prod-tester2.cookie')); } catch (e) { /* */ }
      V.cleanup.push('PROD hkpl session (boyau.tester2 @ gripbat.com): signout -> ' + (r ? r.status : 'fail') + ', /auth/me after -> ' + (me && (me.user || me.id) ? 'STILL SIGNED IN' : 'signed out') + '; cookie file removed');
    }
  }
  await new Promise((r) => setTimeout(r, 1500));
  V.engineLog.prod = engineLog('prod', since); V.engineLog.uat = engineLog('uat', since);
  if (MODE !== 'before') { // the refusals must be for the RIGHT reason (read from each engine's own log, iss/aud/tenant only)
    const prodWant = MODE === 'mid' ? /SSO token refused: tenant_refused iss=hkpl aud=social\.silkvo\.com tenant=boyau-uat/ : /SSO token refused: aud iss=hkpl aud=uat\.social\.silkvo\.com tenant=boyau-uat/;
    row('R1 the PROD engine logged WHY it refused the UAT token (' + (MODE === 'mid' ? 'tenant_refused: old audience, sandbox tenant' : 'aud: the UAT audience') + ')', V.engineLog.prod.some((l) => prodWant.test(l)), { prodLog: V.engineLog.prod });
    row('R2 the UAT engine logged WHY it refused the PROD token (aud_tenant: the old audience is accepted only from boyau-uat)', V.engineLog.uat.some((l) => /SSO token refused: aud_tenant iss=hkpl aud=social\.silkvo\.com tenant=boyau /.test(l)), { uatLog: V.engineLog.uat });
  }
  const rows = Object.values(V.rows);
  V.condition_fired = !!(V.rows[Object.keys(V.rows).find((k) => k.startsWith('C1'))] || {}).ok && Object.keys(V.rows).some((k) => k.startsWith('K1') && V.rows[k].ok);
  V.verdict = !rows.length ? 'no_verdict' : rows.every((r) => r.ok) ? 'pass' : 'fail';
  V.evidence = Object.entries(V.rows).map(([k, r]) => (r.ok ? 'PASS ' : 'FAIL ') + k);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(V, null, 1));
  console.log('VERDICT', V.verdict, 'condition_fired=' + V.condition_fired, '|', V.evidence.length, 'rows | cleanup', V.cleanup.join('; '));
  console.log('engine log prod:', JSON.stringify(V.engineLog.prod)); console.log('engine log uat:', JSON.stringify(V.engineLog.uat));
})();

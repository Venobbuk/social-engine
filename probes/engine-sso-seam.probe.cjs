'use strict';
// ENGINE-SSO-SEAM probe (engine-fix lane, 2026-09-28) — UAT ONLY. What does adapter/sso let through with ADAPTER_SSO_LOGIN
// unset (the state of BOTH running engines), and does GripBat's "Continue with your HKPL account" button run through it?
//   F-rows  forged / confused / tampered tokens (no hkpl private key) must be REFUSED by the engine: an RS256 token signed
//           with a key we made, alg "none", HS256 keyed with the engine's PUBLIC key (algorithm confusion), an unknown
//           issuer, and a GENUINE hkpl token whose payload was edited after signing.
//   H-rows  hkpl's side of the proof: the mint answers 401 without an hkpl session; the GripBat hand-off refuses a return
//           origin that is not GripBat's (400 bad_return) and sends a signed-out visitor to sign in (no token); a
//           cross-site page cannot read the JSON mint (no Access-Control-Allow-Credentials).
//   G-rows  the REAL button path, exactly as the app runs it (lib/gb-account.ts gbHkplStart -> gbSsoExchange): hkpl's
//           /api/v1/auth/sso/social/gripbat?return=<GripBat origin> with an hkpl session -> 302 to
//           <origin>/app/pages/signin/index#gbsso=<jwt> -> engine adapter/sso {jwt, native: true} -> a session FOR the hkpl
//           person the token names (userId / username read back with the credential); the same token a second time is
//           REFUSED (replay). This is also the planted control: the checker that reads the F-rows' 400 sees a 200 here.
// Fixture: the access-token row the G2 redemption issues is deleted in finally (gb/auth/signout with THAT token — the
// persona's native token is never rotated). Never prints a token, a cookie or a password (lengths and claim NAMES only).
const crypto = require('crypto');
const fs = require('fs');
const ENG = process.env.ENG || 'https://uat.social.silkvo.com/api/';
const HK = process.env.HK || 'https://uat.gripbat.com';
const RETURN = process.env.RETURN || 'https://uat.gripbat.com';
if (!/\/\/uat\./.test(ENG) || !/\/\/uat\./.test(HK) || !/\/\/uat\./.test(RETURN)) throw new Error('refusing: not UAT');
process.env.BASE = HK;   // _session.cjs reads BASE at load: the hkpl session is minted on the UAT GripBat host
const { getSession } = require('/root/social-engine/probes/_session.cjs');
const PUB = process.env.PUB || '/root/social-engine/.config-uat/hkpl-sso-rs256.pub';   // the engine's PUBLIC key (not a secret)
const MODE = process.env.MODE || 'before';
const OUT = process.env.OUT || ('/root/gen/l6-scope/verdicts/engine-sso-seam.' + MODE + '.probe.json');
const AUD = process.env.AUD || 'uat.social.silkvo.com';   // SSO-AUD-SPLIT-V1: web-uat's own audience once hkpl stamps it (was 'social.silkvo.com' before SSO-SPLIT-B); AUD=social.silkvo.com for a pre-split run

const V = { id: 'engine-sso-seam', mode: MODE, at: new Date().toISOString(), engine: ENG, hkpl: HK, rows: {}, evidence: [], cleanup: [] };
const row = (id, ok, ev) => { V.rows[id] = { ok: !!ok, ...ev }; console.log((ok ? 'PASS ' : 'FAIL ') + id + ' ' + JSON.stringify(ev).slice(0, 320)); };
const b64u = (x) => Buffer.from(x).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const dec = (seg) => JSON.parse(Buffer.from(seg.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
async function eng(ep, body) {
  const r = await fetch(ENG + ep, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch (e) { /* 204 */ }
  return { status: r.status, json, code: json && json.error && json.error.code || null };
}
const now = () => Math.floor(Date.now() / 1000);
function claims(extra = {}) { const t = now(); return { jti: crypto.randomUUID(), iss: 'hkpl', aud: AUD, sub: 'probe-sso-' + crypto.randomBytes(6).toString('hex'), iat: t, exp: t + 120, tenant: 'boyau-uat', role: 'SUPER_ADMIN', name: '[probe] forged', ...extra }; }
function signRs(payload, privateKey, header = { alg: 'RS256', typ: 'JWT' }) {
  const h = b64u(JSON.stringify(header)), p = b64u(JSON.stringify(payload));
  return h + '.' + p + '.' + b64u(crypto.sign('RSA-SHA256', Buffer.from(h + '.' + p), privateKey));
}
const noToken = (r) => !(r.json && (r.json.token || r.json.i));

(async () => {
  let accessToken = null;
  try {
    // ---------------------------------------------------------------- F: forged / confused / tampered (engine refuses)
    const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const f1 = await eng('adapter/sso', { jwt: signRs(claims(), privateKey), native: true });
    row('F1 RS256 signed with a key that is not hkpl\'s (claims perfect, role SUPER_ADMIN) -> refused', f1.status === 400 && f1.code === 'ADAPTER_SSO_INVALID' && noToken(f1), { status: f1.status, code: f1.code });
    const none = b64u(JSON.stringify({ alg: 'none', typ: 'JWT' })) + '.' + b64u(JSON.stringify(claims())) + '.';
    const f2 = await eng('adapter/sso', { jwt: none + 'xxxxxxxxxxxxxxxxxxxx', native: true });
    row('F2 alg "none" -> refused', f2.status === 400 && f2.code === 'ADAPTER_SSO_INVALID' && noToken(f2), { status: f2.status, code: f2.code });
    const pubPem = fs.readFileSync(PUB, 'utf8');
    const hh = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' })), hp = b64u(JSON.stringify(claims()));
    const f3 = await eng('adapter/sso', { jwt: hh + '.' + hp + '.' + b64u(crypto.createHmac('sha256', pubPem).update(hh + '.' + hp).digest()), native: true });
    row('F3 HS256 keyed with the engine\'s PUBLIC key (algorithm confusion) -> refused', f3.status === 400 && f3.code === 'ADAPTER_SSO_INVALID' && noToken(f3), { status: f3.status, code: f3.code });
    const f4 = await eng('adapter/sso', { jwt: signRs(claims({ iss: 'evil' }), privateKey), native: true });
    row('F4 unknown issuer -> refused', f4.status === 400 && f4.code === 'ADAPTER_SSO_UNKNOWN_ISSUER' && noToken(f4), { status: f4.status, code: f4.code });

    // ---------------------------------------------------------------- H: hkpl's side of the proof
    const h1 = await fetch(HK + '/api/v1/auth/sso/social', { redirect: 'manual' });
    row('H1 hkpl mint without an hkpl session -> 401 (no token)', h1.status === 401, { status: h1.status });
    const h2 = await fetch(HK + '/api/v1/auth/sso/social/gripbat?return=' + encodeURIComponent('https://evil.example'), { redirect: 'manual' });
    row('H2 GripBat hand-off to a foreign return origin -> 400 bad_return (a token never goes elsewhere)', h2.status === 400 && /bad_return/.test(await h2.text()), { status: h2.status });
    const h3 = await fetch(HK + '/api/v1/auth/sso/social/gripbat?return=' + encodeURIComponent(RETURN), { redirect: 'manual' });
    const h3loc = h3.headers.get('location') || '';
    row('H3 GripBat hand-off signed out -> 302 to hkpl sign-in, no token in the Location', h3.status === 302 && /\/sign-in\.html\?next=/.test(h3loc) && !/gbsso=/.test(h3loc), { status: h3.status, location: h3loc.slice(0, 120) });
    const h4 = await fetch(HK + '/api/v1/auth/sso/social', { headers: { Origin: 'https://evil.example' } });
    const acao = h4.headers.get('access-control-allow-origin'), acac = h4.headers.get('access-control-allow-credentials');
    row('H4 a cross-site page cannot read the JSON mint (no Access-Control-Allow-Credentials: true)', acac !== 'true', { status: h4.status, acao, acac, note: 'hkpl session cookie is SameSite=Lax (hkpl middleware/session.js:164), so a cross-site fetch carries no session either' });

    // ---------------------------------------------------------------- G: the real button path
    const ck = await getSession(1); const cookie = ck.name + '=' + ck.value;
    const me = await fetch(HK + '/api/v1/auth/me', { headers: { cookie } }); const meJ = await me.json().catch(() => null);
    V.hkplPersona = { status: me.status, hasUser: !!(meJ && (meJ.user || meJ.id)) };
    // F5 needs a GENUINE signature: the JSON mint (same key, same claims as the button's minus email) — edited, never redeemed
    const jm = await fetch(HK + '/api/v1/auth/sso/social', { headers: { cookie } }); const jmJ = await jm.json().catch(() => null);
    if (jmJ && jmJ.jwt) {
      const [h, p, s] = jmJ.jwt.split('.'); const pl = dec(p);
      const edited = h + '.' + b64u(JSON.stringify({ ...pl, sub: pl.sub + 'x', role: 'SUPER_ADMIN', jti: crypto.randomUUID() })) + '.' + s;
      const f5 = await eng('adapter/sso', { jwt: edited, native: true });
      row('F5 a GENUINE hkpl token with its payload edited (sub, role SUPER_ADMIN, jti) -> refused', f5.status === 400 && f5.code === 'ADAPTER_SSO_INVALID' && noToken(f5), { status: f5.status, code: f5.code, mintStatus: jm.status });
    } else row('F5 a GENUINE hkpl token with its payload edited -> refused', false, { precondition: 'JSON mint gave no jwt', mintStatus: jm.status });

    const g1 = await fetch(HK + '/api/v1/auth/sso/social/gripbat?return=' + encodeURIComponent(RETURN), { headers: { cookie }, redirect: 'manual' });
    const loc = g1.headers.get('location') || '';
    const m = /^(https:\/\/[^/#]+)\/app\/pages\/signin\/index#gbsso=([^&]+)$/.exec(loc);
    const jwt = m ? decodeURIComponent(m[2]) : '';
    let cl = null; try { cl = jwt ? dec(jwt.split('.')[1]) : null; } catch (e) { /* */ }
    V.buttonClaims = cl ? { names: Object.keys(cl).sort(), iss: cl.iss, aud: cl.aud, tenant: cl.tenant, role: cl.role, ttl: cl.exp - cl.iat, jtiLen: String(cl.jti || '').length, emailPresent: !!cl.email, email_verified: cl.email_verified } : null;
    row('G1 the button\'s hkpl hand-off (signed in) -> 302 to the GripBat origin with #gbsso=<RS256 jwt, <=300 s, jti> in the FRAGMENT', g1.status === 302 && m && m[1] === RETURN && cl && cl.iss === 'hkpl' && cl.aud === AUD && cl.exp - cl.iat <= 300 && String(cl.jti || '').length >= 8 && dec(jwt.split('.')[0]).alg === 'RS256', { status: g1.status, origin: m && m[1], claims: V.buttonClaims });
    if (jwt) {
      const g2 = await eng('adapter/sso', { jwt, native: true });   // exactly lib/gb-account.ts gbSsoExchange
      accessToken = g2.json && g2.json.token || null;
      const who = accessToken ? await eng('i', { i: accessToken }) : { status: 0, json: null };
      const whoN = g2.json && g2.json.i ? await eng('i', { i: g2.json.i }) : { status: 0, json: null };
      const expectHandle = 'hkpl_' + crypto.createHash('sha256').update('hkpl:' + cl.sub).digest('hex').slice(0, 12);
      V.session = { userId: g2.json && g2.json.userId, username: g2.json && g2.json.username, created: g2.json && g2.json.created, linked: g2.json && g2.json.linked, staff: g2.json && g2.json.staff, accessTokenLen: accessToken ? accessToken.length : 0, nativeTokenLen: g2.json && g2.json.i ? g2.json.i.length : 0, seamHandle: expectHandle };
      row('G2 the engine redeems the genuine token -> a session for THAT hkpl person (access token + native i both answer i/ as the same account)', g2.status === 200 && !!accessToken && who.status === 200 && who.json && who.json.id === g2.json.userId && whoN.status === 200 && whoN.json && whoN.json.id === g2.json.userId, { status: g2.status, code: g2.code, session: V.session, whoami: who.status, whoamiNative: whoN.status });
      const g3 = await eng('adapter/sso', { jwt, native: true });
      row('G3 the same genuine token a second time -> refused (single-use jti)', g3.status === 400 && g3.code === 'ADAPTER_SSO_REPLAYED' && noToken(g3), { status: g3.status, code: g3.code });
    } else row('G2 the engine redeems the genuine token', false, { precondition: 'no #gbsso token in the hand-off Location', location: loc.replace(/gbsso=.*/, 'gbsso=<redacted>').slice(0, 120) });
  } catch (e) { V.error = String(e && e.stack || e).slice(0, 600); console.error(V.error); }
  finally {
    if (accessToken) {
      const so = await eng('gb/auth/signout', { i: accessToken });
      const after = await eng('i', { i: accessToken });
      V.cleanup.push('access token row: gb/auth/signout -> ' + so.status + ', i/ with it after -> ' + after.status);
    }
  }
  const rows = Object.values(V.rows);
  V.condition_fired = !!(V.rows['G2 the engine redeems the genuine token -> a session for THAT hkpl person (access token + native i both answer i/ as the same account)'] || {}).ok && ['F1', 'F2', 'F3', 'F4', 'F5'].every((k) => Object.keys(V.rows).some((r) => r.startsWith(k)));
  V.verdict = !rows.length ? 'no_verdict' : rows.every((r) => r.ok) ? 'pass' : 'fail';
  V.evidence = Object.entries(V.rows).map(([k, r]) => (r.ok ? 'PASS ' : 'FAIL ') + k);
  fs.mkdirSync(require('path').dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(V, null, 1));
  console.log('VERDICT', V.verdict, 'condition_fired=' + V.condition_fired, '|', V.evidence.length, 'rows | cleanup', V.cleanup.join('; '));
})();

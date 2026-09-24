// GRIPBAT-ACCOUNTS-V1 (G15.15) — the NATIVE sign-in for probes. GripBat owns its accounts: a probe signs in to the ENGINE
// with a persona's email + password (the logins /root/uat-native-logins.cjs gives every persona after the nightly reset),
// and gets the engine's native token — no hkpl cookie, no adapter/sso hand-off. Lives beside _session.cjs (the old hkpl
// path, kept until every lane has moved; see /root/gen/l6-scope/lane-notes/gripbat-accounts.md).
//
//   const { getNativeToken, personas } = require('./_native-session.cjs');
//   const { token, userId, username } = await getNativeToken('player-amy');   // or 'host-ken', 'clubowner-mei', 'clubadmin-tom', 'admin', 'tester1', 'tester2'
//   POST /api/<endpoint> { i: token, … }
//
// RATE LIMITS. The engine allows 10 sign-ins an hour per IP (Misskey SigninApiService) and every probe on kaka shares one
// IP, so the token is cached per persona for 6 hours (/root/gb-native-<key>-uat.token, 0600) and re-checked with
// POST /api/i before use. On a 429 (or with NATIVE_SESSION_DB=1) the token is read from se_sbx on the box — UAT only.
'use strict';
const fs = require('fs');
const { execFileSync } = require('child_process');
const BASE = process.env.BASE || 'https://uat.gripbat.com';
const UAT = /uat\./.test(BASE) || /:3961/.test(BASE);
const LOGINS = '/root/uat-native-logins.json';

function personas() { return JSON.parse(fs.readFileSync(LOGINS, 'utf8')); }
async function post(path, body) {
  const r = await fetch(BASE + '/api/' + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch (e) { /* 204 */ }
  return { s: r.status, j };
}
function dbToken(userId) {
  if (!UAT) throw new Error('the database fallback is UAT only');
  return execFileSync('docker', ['exec', '-i', 'social-engine-db-1', 'psql', '-U', 'social', '-d', 'se_sbx', '-qtA'], { input: `select token from "user" where id = '${String(userId).replace(/[^a-z0-9]/g, '')}'` }).toString().trim();
}

async function getNativeToken(key) {
  const P = personas()[key];
  if (!P) throw new Error('no native login for ' + key + ' in ' + LOGINS + ' (run /root/uat-native-logins.cjs)');
  const file = '/root/gb-native-' + key + (UAT ? '-uat' : '') + '.token';
  try {
    const c = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Date.now() - c.at < 6 * 3600e3 && c.userId === P.userId) { const me = await post('i', { i: c.token }); if (me.s === 200 && me.j && me.j.id === P.userId) return c; }
  } catch (e) { /* no cache */ }
  let token = '';
  if (process.env.NATIVE_SESSION_DB !== '1') {
    // the engine takes the verified email (GRIPBAT-ACCOUNTS-V1) or the username (Misskey native)
    let r = await post('signin-flow', { username: P.email, password: P.password });
    if (r.s === 404) r = await post('signin-flow', { username: P.username, password: P.password });   // an engine without the email door
    if (r.s === 200 && r.j && r.j.i) token = r.j.i;
    else if (r.s !== 429) throw new Error('native sign-in for ' + key + ' answered ' + r.s + ' ' + JSON.stringify(r.j));
  }
  if (!token) token = dbToken(P.userId);
  const me = await post('i', { i: token });
  if (me.s !== 200 || !me.j || me.j.id !== P.userId) throw new Error('the token for ' + key + ' does not answer as ' + P.userId + ' (' + me.s + ')');
  const c = { token, userId: P.userId, username: me.j.username, at: Date.now() };
  fs.writeFileSync(file, JSON.stringify(c), { mode: 0o600 });
  return c;
}

module.exports = { getNativeToken, personas };

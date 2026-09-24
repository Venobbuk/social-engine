// gripbat-accounts.prod.probe.cjs — GRIPBAT-ACCOUNTS-V1 on PRODUCTION (gripbat.com), 390 px.
//   bash /root/gen/browser-slot.sh node /root/social-engine/probes/gripbat-accounts.prod.probe.cjs
// Production never hands a code back (no GB_SANDBOX_MAIL) and never mails a reserved test address, so the probe reads the
// sign-up code the way only the box can: from the `social` database (user_pending). Everything else goes through the
// public doors on https://gripbat.com. One [probe] account on example.com (reserved: never mailed; its null MX passes the active check .invalid fails on prod), deleted in `finally` (i/delete-account).
//   P2 sign-up answers 204 and reveals nothing; the account exists only after the code; handle = placeholder, then chosen
//   P3 name edit persists across a sign-in by EMAIL + password; the handle is never email-derived
//   P4 a suspended account is refused with ACCOUNT_SUSPENDED (admin/suspend-user by the root account, lifted in finally)
//   PU the signed-out app at 390 px: GripBat's own sign-in ("Welcome back"), the version line, no hkpl auth / adapter/sso call
//   PR Rankings read the engine (stats/dupr-rankings) — production: GripBat-connected members only
'use strict';
const fs = require('fs');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const PROD = 'https://gripbat.com';
const OUT = '/root/social-engine/probes/gripbat-accounts.prod.verdict.json';
const SHOTS = '/root/gen/gripbat-accounts/shots-prod';
fs.mkdirSync(SHOTS, { recursive: true });
const RUN = crypto.randomBytes(3).toString('hex');
const V = { id: 'gripbat-accounts.prod', at: new Date().toISOString(), condition_fired: false, verdict: 'fail', evidence: [], cleanup: [] };
const ok = (id, pass, detail) => { V.evidence.push({ id, pass: !!pass, detail }); console.log((pass ? 'PASS ' : 'FAIL ') + id + ' — ' + JSON.stringify(detail).slice(0, 300)); return !!pass; };
const db = (q) => execFileSync('docker', ['exec', '-i', 'social-engine-db-1', 'psql', '-U', 'social', '-d', 'social', '-qtA'], { input: q }).toString().trim();
const lit = (v) => "'" + String(v).replace(/'/g, "''") + "'";
// signin-flow allows ONE call per second per IP (RateLimiterService minInterval) — a faster second call answers 429
let lastSignin = 0;
async function P(path, body) {
  if (path === 'signin-flow') { const w = lastSignin + 1300 - Date.now(); if (w > 0) await new Promise((r) => setTimeout(r, w)); lastSignin = Date.now(); }
  const r = await fetch(PROD + '/api/' + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) { /* 204 */ }
  return { s: r.status, j, code: (j && j.error && j.error.code) || '' };
}
const acct = { email: `gbacc-${RUN}-prod@example.com`, password: 'Pp-' + crypto.randomBytes(6).toString('hex'), token: '', id: '' };
let rootTok = '';

async function main() {
  const su = await P('signup', { emailAddress: acct.email, password: acct.password, lang: 'en' });
  V.condition_fired = true;
  const code = db(`select code from user_pending where email = ${lit(acct.email)} order by id desc limit 1`);
  const before = db(`select count(*) from user_profile where lower(email) = ${lit(acct.email)}`);
  const done = code ? await P('signup-pending', { code }) : { s: 0, j: null };
  acct.token = (done.j && done.j.i) || ''; acct.id = (done.j && done.j.id) || '';
  const me = acct.token ? await P('gb/account/me', { i: acct.token }) : { s: 0, j: null };
  ok('P2.signup', su.s === 204 && !su.j && !!code && before === '0' && done.s === 200 && me.j && me.j.needsUsername === true && /^gb_[0-9a-f]{12}$/.test(me.j.username), { signup: su.s, revealed: !!(su.j && su.j._dev_code), accountBeforeCode: before, verify: done.s, handle: me.j && me.j.username });
  const uname = 'pp' + RUN + 'x';
  const ch = await P('gb/account/username', { i: acct.token, username: uname });
  const name = '[probe] gb-accts prod ' + RUN;   // a name containing the brand is refused (NAME_RESERVED) — the probe id is shortened
  const nu = await P('i/update', { i: acct.token, name });
  const si = await P('signin-flow', { username: acct.email, password: acct.password });
  const me2 = si.j && si.j.i ? await P('i', { i: si.j.i }) : { s: 0, j: null };
  if (si.j && si.j.i) acct.token = si.j.i;
  ok('P3.username+name', ch.s === 200 && nu.s === 200 && si.s === 200 && me2.j && me2.j.username === uname && me2.j.name === name && uname !== acct.email.split('@')[0], { chosen: ch.s, name: nu.s, emailSignin: si.s, handle: me2.j && me2.j.username, nameKept: me2.j && me2.j.name === name });
  rootTok = db(`select token from "user" where id = (select "rootUserId" from meta)`);
  const s1 = await P('admin/suspend-user', { i: rootTok, userId: acct.id });
  const s2 = await P('signin-flow', { username: acct.email, password: acct.password });
  const s3 = await P('signin-flow', { username: acct.email, password: 'wrong-' + acct.password });
  ok('P4.suspended', s1.s === 204 && s2.s === 403 && s2.code === 'ACCOUNT_SUSPENDED' && s3.s === 403 && !s3.code, { suspend: s1.s, right: s2.s + ' ' + s2.code, wrong: s3.s + ' ' + (s3.code || '(plain)') });
  const un = await P('admin/unsuspend-user', { i: rootTok, userId: acct.id });
  V.cleanup.push({ unsuspended: un.s });
  const rk = await P('stats/dupr-rankings', { sport: 'pickleball', sort: 'doubles', limit: 5 });
  ok('PR.rankings-engine', rk.s === 200 && typeof rk.j.total === 'number', { total: rk.j && rk.j.total, note: 'GripBat-connected members only (0 = none linked yet)' });

  const browser = await require('/root/hkpl-server/node_modules/puppeteer-core').launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
  try {
    const p = await (await browser.createBrowserContext()).newPage(); await p.setViewport({ width: 390, height: 900 });
    const hits = [];
    p.on('request', (rq) => { const u = rq.url(); if (/\/api\/v1\/auth\/|\/api\/auth\/|\/api\/adapter\/sso/.test(u)) hits.push(u.replace(/\?.*/, '')); });
    await p.goto(PROD + '/app/pages/signin/index', { waitUntil: 'networkidle2', timeout: 60000 });
    await new Promise((r) => setTimeout(r, 2500));
    await p.screenshot({ path: SHOTS + '/signin.png' });
    const txt = await p.evaluate(() => document.body.innerText);
    ok('PU.signin-screen', /Welcome back/.test(txt) && /Forgot your password\?/.test(txt) && /GripBat · Version \S+/.test(txt) && !/Hong Kong Pickleball League/.test(txt), { welcome: /Welcome back/.test(txt), version: (txt.match(/GripBat · Version [^\n]*/) || [''])[0] });
    ok('PU.no-hkpl-auth', hits.length === 0, { hkplAuthOrSsoCalls: hits });
  } finally { await browser.close(); }
}

(async () => {
  try { await main(); } catch (e) { ok('run', false, String(e && e.stack || e)); }
  finally {
    try { if (acct.token) { const d = await P('i/delete-account', { i: acct.token, password: acct.password }); V.cleanup.push({ deleted: d.s }); } } catch (e) { V.cleanup.push({ delete: e.message }); }
    try { V.cleanup.push({ pendingRemoved: db(`with d as (delete from user_pending where email = ${lit(acct.email)} returning 1) select count(*) from d`) }); } catch (e) { V.cleanup.push({ pending: e.message }); }
    V.verdict = V.evidence.length && V.evidence.every((e) => e.pass) ? 'pass' : 'fail';
    fs.writeFileSync(OUT, JSON.stringify(V, null, 2) + '\n');
    console.log(`${V.verdict.toUpperCase()} gripbat-accounts.prod ${V.evidence.filter((e) => e.pass).length}/${V.evidence.length} → ${OUT}`);
    process.exit(V.verdict === 'pass' ? 0 : 1);
  }
})();

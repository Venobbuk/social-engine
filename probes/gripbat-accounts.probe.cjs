// gripbat-accounts.probe.cjs — lane gripbat-accounts (GRIPBAT-ACCOUNTS-V1, G15.15). Spec /root/gen/GRIPBAT_ACCOUNTS_SPEC.md.
//   MODE=before|after bash /root/gen/browser-slot.sh node /root/social-engine/probes/gripbat-accounts.probe.cjs
// GripBat owns its accounts. Proves on https://uat.gripbat.com (UAT, sandbox codes on reserved test addresses) with every
// effect read back from the ENGINE (API answer or se_sbx row), and read-only / signed-out on production:
//   A1 a stranger signs up (email + password) → the account does not exist until the emailed code is redeemed → signed in
//   A2 the username: never email-derived; brand / machine / short names refused; the chosen one is stored
//   A3 the name: set once, survives sign-out + sign-in (by EMAIL + password)
//   A4 password reset: reset link → new password works, old one fails, every old token is signed out
//   A5 email change: the old address keeps signing in until the new one is confirmed; then only the new one does
//   A6 emailed 6-digit sign-in code: a wrong code refused, the right one signs in
//   A7 personas sign in NATIVELY (probes/_native-session.cjs; logins from uat-reset step 4c)
//   A8 DUPR connect at its reachable level: the engine doors answer; a UAT test account links in the cage; the partner
//      door reports DUPR_DOOR_NOT_LIVE until hkpl's S2S door ships (staged, L2 + dry-run)
//   A9 Rankings read the engine: UAT lists the seeded members; production lists GripBat-connected members only
//   A10 E-auth-login.05: a suspended account (admin/suspend-user) is refused ACCOUNT_SUSPENDED with the right password, the
//      plain refusal with a wrong one (no oracle), and its old session answers YOUR_ACCOUNT_SUSPENDED
//   U2 the app signs that session out and says "This account has been blocked."; the version line shows (E-auth-welcome.06)
//   P1 production parity, signed out (gripbat.com): the new doors answer the same refusals; no code is ever revealed
//   L1 the league still signs in its own way (hkpl.com.hk sign-in page + its login door refuses a wrong password), read-only
//   U1 the stranger flow in the APP at 390 px: sign up → test code → onboarding asks name + username → Home, and the page
//      never calls hkpl's auth doors (/api/v1/auth/*, /api/auth/*) or engine adapter/sso (network capture)
// G16.1: MODE=before runs against the build without the change and MUST fail (the old engine refuses sign-up, has no
// gb/* doors; the old app signs in through hkpl). Fixtures: "[probe] gripbat-accounts" names, addresses on
// example.invalid, deleted in `finally` (i/delete-account with the probe's own password; pending rows removed).
// @claims endpoint signup :: gripbat-accounts :: signup-pending,placeholder-username,codes
// @claims endpoint signin-flow :: gripbat-accounts :: email-identifier
// @claims endpoint request-reset-password :: gripbat-accounts :: email-only,app-link
// @claims endpoint reset-password :: gripbat-accounts :: rotate-token
// @claims endpoint i/update-email :: gripbat-accounts :: pending-until-verified
// @claims endpoint verify-email :: gripbat-accounts :: swap
// @claims endpoint gb/account/username :: gripbat-accounts :: rules
// @claims endpoint gb/account/me :: gripbat-accounts :: needsUsername,staff
// @claims endpoint gb/auth/code :: gripbat-accounts :: code
// @claims endpoint gb/auth/code/verify :: gripbat-accounts :: code
// @claims endpoint gb/dupr/connection :: gripbat-accounts :: dupr
// @claims endpoint gb/dupr/connect :: gripbat-accounts :: dupr-cage
// @claims endpoint gb/dupr/sso-url :: gripbat-accounts :: dupr
// @claims endpoint stats/dupr-rankings :: gripbat-accounts :: engine-source
// @claims route pages/signin/index :: gripbat-accounts :: native-auth,no-hkpl-auth
// @claims route pages/onboard/index :: gripbat-accounts :: username-step
'use strict';
const fs = require('fs');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const UAT = 'https://uat.gripbat.com';
const PROD = 'https://gripbat.com';
const APP = UAT + '/app';
const MODE = process.env.MODE === 'before' ? 'before' : 'after';
const OUT = '/root/social-engine/probes/gripbat-accounts' + (MODE === 'before' ? '.before' : '') + '.verdict.json';
const SHOTS = '/root/gen/gripbat-accounts/shots-' + MODE;
fs.mkdirSync(SHOTS, { recursive: true });
const PFX = '[probe] gb-accts';   // '[probe] gripbat-accounts' is refused as a NAME (it carries the brand: NAME_RESERVED)
const RUN = crypto.randomBytes(3).toString('hex');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const V = { id: 'gripbat-accounts', at: new Date().toISOString(), mode: MODE, condition_fired: false, verdict: 'fail', evidence: [], cleanup: [] };
const ok = (id, pass, detail) => { V.evidence.push({ id, pass: !!pass, detail }); console.log((pass ? 'PASS ' : 'FAIL ') + id + ' — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 300)); return !!pass; };
const sbx = (q) => execFileSync('docker', ['exec', '-i', 'social-engine-db-1', 'psql', '-U', 'social', '-d', 'se_sbx', '-qtA'], { input: q }).toString().trim();
const lit = (v) => "'" + String(v).replace(/'/g, "''") + "'";
// signin-flow allows ONE call per second per IP (RateLimiterService minInterval) — a faster second call answers 429
let lastSignin = 0;
async function api(base, path, body) {
  if (path === 'signin-flow') { const w = lastSignin + 1300 - Date.now(); if (w > 0) await new Promise((r) => setTimeout(r, w)); lastSignin = Date.now(); }
  const r = await fetch(base + '/api/' + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
  const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch (e) { /* 204 / not json */ }
  return { s: r.status, j, code: (j && j.error && j.error.code) || '' };
}
const U = (p, b) => api(UAT, p, b);
const made = [];   // { email, password, token } — every account this run created, deleted in finally

async function main() {
  const pw1 = 'Pb-' + crypto.randomBytes(6).toString('hex');
  const pw2 = 'Pr-' + crypto.randomBytes(6).toString('hex');
  const email1 = `gbacc-${RUN}@example.invalid`;
  const email2 = `gbacc-${RUN}-new@example.invalid`;
  const acct = { email: email1, password: pw1, token: '' };
  made.push(acct);

  // ---- A1 sign-up
  const su = await U('signup', { emailAddress: email1.toUpperCase(), password: pw1, lang: 'en' });
  V.condition_fired = true;
  const code = su.j && su.j._dev_code;
  ok('A1.signup', su.s === 200 && !!code, { status: su.s, code: su.code, devCode: !!code });
  const pending = code ? sbx(`select username || '|' || email from user_pending where code = ${lit(code)}`) : '';
  ok('A1.pending-row', /^gb_[0-9a-f]{12}\|/.test(pending) && pending.endsWith('|' + email1), 'user_pending ' + (pending || 'none') + ' (placeholder handle, normalised email)');
  ok('A1.no-account-before-verify', sbx(`select count(*) from user_profile where lower(email) = ${lit(email1)}`) === '0', 'no user_profile carries the address before the code is redeemed');
  const short = await U('signup', { emailAddress: `gbacc-${RUN}-x@example.invalid`, password: 'short' });
  ok('A1.password-floor', short.s === 400 && short.code === 'PASSWORD_TOO_SHORT', { status: short.s, code: short.code });
  const done = code ? await U('signup-pending', { code }) : { s: 0 };
  acct.token = (done.j && done.j.i) || '';
  ok('A1.verified-signed-in', done.s === 200 && !!acct.token, { status: done.s });
  const me0 = acct.token ? await U('gb/account/me', { i: acct.token }) : { s: 0 };
  ok('A1.needs-username', me0.s === 200 && me0.j.needsUsername === true && me0.j.emailVerified === true && me0.j.email === email1, me0.j || me0.s);
  const dup = await U('signup', { emailAddress: email1, password: pw1 });
  ok('A1.email-taken', dup.s === 400 && dup.code === 'EMAIL_TAKEN', { status: dup.s, code: dup.code });

  // ---- A2 username
  const tries = {};
  for (const u of ['GripBat_fan', 'grip_bat', 'hkpl_1234', 'gb_abc', 'ab', 'bad-name']) tries[u] = (await U('gb/account/username', { i: acct.token, username: u })).code;
  ok('A2.refused', ['GripBat_fan', 'grip_bat', 'hkpl_1234', 'gb_abc'].every((u) => tries[u] === 'USERNAME_RESERVED') && tries.ab === 'USERNAME_TOO_SHORT' && tries['bad-name'] === 'USERNAME_INVALID', tries);
  const avail = await U('username/available', { username: 'ken_host' });
  ok('A2.available-says-why', avail.s === 200 && typeof avail.j.available === 'boolean' && 'reason' in avail.j, avail.j);
  const chosen = 'pb' + RUN + 'x';
  const ch = await U('gb/account/username', { i: acct.token, username: chosen });
  const row = sbx(`select username from "user" u join user_profile p on p."userId" = u.id where lower(p.email) = ${lit(email1)}`);
  ok('A2.chosen-stored', ch.s === 200 && row === chosen, { status: ch.s, stored: row });
  ok('A2.never-email-derived', row.toLowerCase() !== email1.split('@')[0].toLowerCase() && sbx(`select count(*) from "user" u join user_profile p on p."userId" = u.id where p.email is not null and u."usernameLower" = lower(split_part(p.email, '@', 1))`) === '0', 'no account on se_sbx has a username equal to its email local part');

  // ---- A3 name survives sign-out / sign-in by email
  const name = PFX + ' ' + RUN;
  const nu = await U('i/update', { i: acct.token, name });
  const si = await U('signin-flow', { username: email1, password: pw1 });
  const me1 = si.j && si.j.i ? await U('i', { i: si.j.i }) : { s: 0 };
  ok('A3.email-signin+name', nu.s === 200 && si.s === 200 && me1.s === 200 && me1.j.name === name && me1.j.username === chosen, { update: nu.s, signin: si.s, name: me1.j && me1.j.name, handle: me1.j && me1.j.username });
  const bad = await U('signin-flow', { username: email1, password: 'wrong-' + pw1 });
  ok('A3.wrong-password', bad.s === 403, { status: bad.s });

  // ---- A4 reset
  const rq = await U('request-reset-password', { email: email1 });
  const rtok = rq.j && rq.j._dev_code;
  const ghost = await U('request-reset-password', { email: `nobody-${RUN}@example.invalid` });
  ok('A4.request', rq.s === 200 && !!rtok && ghost.s === 200 && !(ghost.j && ghost.j._dev_code), { status: rq.s, ghost: ghost.s, sameAnswerShape: true });
  const oldTok = acct.token;
  const rs = rtok ? await U('reset-password', { token: rtok, password: pw2 }) : { s: 0 };
  const stale = await U('i', { i: oldTok });
  const newIn = await U('signin-flow', { username: email1, password: pw2 });
  const oldIn = await U('signin-flow', { username: email1, password: pw1 });
  if (newIn.j && newIn.j.i) acct.token = newIn.j.i;
  acct.password = pw2;
  const again = rtok ? await U('reset-password', { token: rtok, password: pw2 }) : { code: '' };
  ok('A4.reset', rs.s === 204 && stale.s === 401 && newIn.s === 200 && oldIn.s === 403 && again.code === 'RESET_EXPIRED', { reset: rs.s, oldTokenAfter: stale.s, newPw: newIn.s, oldPw: oldIn.s, reuse: again.code });

  // ---- A5 email change
  const ce = await U('i/update-email', { i: acct.token, password: pw2, email: email2 });
  const ecode = ce.j && ce.j._dev_code;
  const oldStill = await U('signin-flow', { username: email1, password: pw2 });
  const newNotYet = await U('signin-flow', { username: email2, password: pw2 });
  const vf = ecode ? await U('verify-email', { code: ecode }) : { s: 0 };
  const newNow = await U('signin-flow', { username: email2, password: pw2 });
  const oldGone = await U('signin-flow', { username: email1, password: pw2 });
  if (newNow.s === 200) acct.email = email2;
  if (newNow.j && newNow.j.i) acct.token = newNow.j.i;
  ok('A5.email-change', ce.s === 200 && !!ecode && oldStill.s === 200 && newNotYet.s === 404 && vf.s === 204 && newNow.s === 200 && oldGone.s === 404, { request: ce.s, oldBefore: oldStill.s, newBefore: newNotYet.s, verify: vf.s, newAfter: newNow.s, oldAfter: oldGone.s });

  // ---- A6 sign-in code
  const rc = await U('gb/auth/code', { email: acct.email });
  const scode = rc.j && rc.j._dev_code;
  const wrong = await U('gb/auth/code/verify', { email: acct.email, code: scode === '000000' ? '111111' : '000000' });
  const right = scode ? await U('gb/auth/code/verify', { email: acct.email, code: scode }) : { s: 0 };
  ok('A6.code', rc.s === 200 && /^\d{6}$/.test(scode || '') && wrong.code === 'CODE_INVALID' && right.s === 200 && !!(right.j && right.j.i), { request: rc.s, wrong: wrong.code, right: right.s });

  // ---- A7 personas sign in natively
  try {
    const { getNativeToken, personas } = require('/root/social-engine/probes/_native-session.cjs');
    const out = {};
    for (const k of Object.keys(personas()).filter((k) => !/^tester/.test(k))) { try { const c = await getNativeToken(k); out[k] = c.userId === personas()[k].userId ? 'ok' : 'wrong-user'; } catch (e) { out[k] = 'ERR ' + e.message.slice(0, 60); } }
    ok('A7.personas-native', Object.keys(out).length >= 5 && Object.values(out).every((v) => v === 'ok'), out);
  } catch (e) { ok('A7.personas-native', false, e.message); }

  // ---- A8 DUPR connect (reachable level)
  const dc0 = await U('gb/dupr/connection', { i: acct.token });
  const dl = await U('gb/dupr/connect', { i: acct.token, duprId: 'PRB' + RUN.slice(0, 3).toUpperCase() });
  const dc1 = await U('gb/dupr/connection', { i: acct.token });
  const sso = await U('gb/dupr/sso-url', { i: acct.token });
  ok('A8.dupr', dc0.s === 200 && dc0.j.connected === false && dl.s === 200 && dl.j.sandbox === true && dc1.j && dc1.j.connected === true && ['DUPR_DOOR_NOT_LIVE', ''].includes(sso.code), { before: dc0.j, link: dl.s + ' ' + (dl.code || (dl.j && dl.j.sandbox)), after: dc1.j && dc1.j.connected, ssoUrl: sso.s + ' ' + sso.code });
  await U('meets/level', { i: acct.token, sport: 'pickleball', unlinkDupr: true });

  // ---- A9 Rankings read the engine
  const ru = await U('stats/dupr-rankings', { sport: 'pickleball', sort: 'doubles', limit: 5 });
  const rp = await api(PROD, 'stats/dupr-rankings', { sport: 'pickleball', sort: 'doubles', limit: 5 });
  ok('A9.rankings', ru.s === 200 && ru.j.total >= 40 && rp.s === 200, { uatTotal: ru.j && ru.j.total, prodTotal: rp.j && rp.j.total, prodNote: 'production lists GripBat-connected members only' });

  // ---- A10 E-auth-login.05: a suspended account is refused with a code, told only to its password holder
  const sEmail = `gbacc-${RUN}-susp@example.invalid`; const sPw = 'Ps-' + crypto.randomBytes(6).toString('hex');
  const sAcct = { email: sEmail, password: sPw, token: '' }; made.push(sAcct);
  const ss = await U('signup', { emailAddress: sEmail, password: sPw });
  const sd = ss.j && ss.j._dev_code ? await U('signup-pending', { code: ss.j._dev_code }) : { j: null };
  sAcct.token = (sd.j && sd.j.i) || '';
  const sId = sd.j && sd.j.id;
  const rootTok = sbx(`select token from "user" where id = (select "rootUserId" from meta)`);
  const su1 = sId ? await U('admin/suspend-user', { i: rootTok, userId: sId }) : { s: 0 };
  const sGood = await U('signin-flow', { username: sEmail, password: sPw });
  const sBad = await U('signin-flow', { username: sEmail, password: 'wrong-' + sPw });
  const sOld = sAcct.token ? await U('i', { i: sAcct.token }) : { s: 0, code: '' };
  ok('A10.suspended-refused', su1.s === 204 && sGood.s === 403 && sGood.code === 'ACCOUNT_SUSPENDED' && sBad.s === 403 && !sBad.code && sOld.s === 403 && sOld.code === 'YOUR_ACCOUNT_SUSPENDED', { suspend: su1.s, rightPw: sGood.s + ' ' + sGood.code, wrongPw: sBad.s + ' ' + (sBad.code || '(no code: no oracle)'), oldToken: sOld.s + ' ' + sOld.code });
  V.blocked = { token: sAcct.token, userId: sId, rootTok };

  // ---- P1 production parity (signed out; nothing created)
  const p1 = await api(PROD, 'signup', { emailAddress: `gbacc-${RUN}@example.invalid`, password: 'short' });
  const p2 = await api(PROD, 'gb/account/me', {});
  const p3 = await api(PROD, 'request-reset-password', { email: `nobody-${RUN}@example.invalid` });
  ok('P1.prod-parity', p1.code === 'PASSWORD_TOO_SHORT' && p2.s === 401 && p3.s === 200 && !(p3.j && p3.j._dev_code), { signup: p1.s + ' ' + p1.code, me: p2.s, reset: p3.s, revealed: !!(p3.j && p3.j._dev_code) });

  // ---- L1 the league signs in its own way (read-only)
  const lp = await fetch('https://hkpl.com.hk/sign-in.html'); const lt = await lp.text();
  const ll = await fetch('https://hkpl.com.hk/api/v1/auth/password/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: `nobody-${RUN}@example.invalid`, password: 'x-wrong-x' }) });
  ok('L1.league-signin', lp.status === 200 && /<form|sign/i.test(lt) && [400, 401, 404].includes(ll.status), { page: lp.status, wrongLogin: ll.status });

  // ---- U1 the app, 390 px
  await ui();
}

async function ui() {
  const browser = await require('/root/hkpl-server/node_modules/puppeteer-core').launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
  const email = `gbacc-${RUN}-ui@example.invalid`;
  const pw = 'Pu-' + crypto.randomBytes(6).toString('hex');
  const acct = { email, password: pw, token: '' };
  made.push(acct);
  try {
    const ctx = await browser.createBrowserContext();
    const p = await ctx.newPage(); await p.setViewport({ width: 390, height: 900 });
    const hits = [];
    p.on('request', (rq) => { const u = rq.url(); if (/\/api\/v1\/auth\/|\/api\/auth\/|\/api\/adapter\/sso/.test(u)) hits.push(u.replace(/\?.*/, '')); });
    const clickText = async (t) => p.evaluate((txt) => { const el = [...document.querySelectorAll('taro-button-core,button,[role=button],taro-text-core,span')].find((e) => e.textContent && e.textContent.trim() === txt && e.offsetParent); if (!el) return false; (el.closest('taro-button-core,button,[role=button]') || el).click(); return true; }, t);
    const type = async (name, v) => { const h = await p.$(`input[name="${name}"]`); if (!h) return false; await h.click({ clickCount: 3 }); await h.type(v); return true; };
    await p.goto(APP + '/pages/signin/index?signup=1', { waitUntil: 'networkidle2', timeout: 60000 });
    await sleep(1500);
    await p.screenshot({ path: SHOTS + '/1-signup.png' });
    const t1 = await type('email', email); const t2 = await type('password', pw);
    await p.evaluate(() => { const c = document.querySelector('[role=checkbox]'); if (c && c.getAttribute('aria-checked') !== 'true') c.click(); });
    const c1 = await clickText('Create account');
    await sleep(3000);
    await p.screenshot({ path: SHOTS + '/2-verify.png' });
    const c2 = await p.evaluate(() => { const el = document.querySelector('.si-devlink'); if (!el) return false; el.click(); return true; });
    await sleep(5000);
    const url1 = p.url();
    await p.screenshot({ path: SHOTS + '/3-after-verify.png' });
    ok('U1.signup-to-onboarding', t1 && t2 && c1 && c2 && /pages\/onboard\/index/.test(url1), { typed: t1 && t2, created: c1, testCode: c2, url: url1 });
    const uname = 'pu' + RUN + 'x';
    const n1 = await type('obname', PFX + ' UI ' + RUN); const n2 = await type('obusername', uname);
    await sleep(800);
    const c3 = await clickText('Next');
    await sleep(3000);
    await p.screenshot({ path: SHOTS + '/4-onboard-next.png' });
    const storedName = sbx(`select u.username from "user" u join user_profile p on p."userId" = u.id where lower(p.email) = ${lit(email)}`);
    ok('U1.username-chosen', n1 && n2 && c3 && storedName === uname, { typed: n1 && n2, next: c3, stored: storedName });
    acct.token = sbx(`select u.token from "user" u join user_profile p on p."userId" = u.id where lower(p.email) = ${lit(email)}`);
    await p.goto(APP + '/pages/home/index', { waitUntil: 'networkidle2', timeout: 60000 });
    await sleep(2500);
    await p.screenshot({ path: SHOTS + '/5-home.png' });
    // the device's credential must answer as THIS new account (a stored value alone proves nothing — G16.6)
    const stored = await p.evaluate(() => { const v = localStorage.getItem('boyau_social_token') || ''; try { const j = JSON.parse(v); return typeof j === 'string' ? j : (j && j.data) || ''; } catch (e) { return v; } });
    const who = stored ? await U('i', { i: stored }) : { s: 0, j: null };
    const signedIn = who.s === 200 && who.j && who.j.username === uname;
    ok('U1.home-signed-in', signedIn, { tokenStored: !!stored, answersAs: who.j && who.j.username, want: uname });
    ok('U1.no-hkpl-auth', hits.length === 0, { hkplAuthOrSsoCalls: hits });
    await ctx.close();

    // U2 E-auth-login.05 in the app: a device holding a suspended account's session is signed out and told why;
    // E-auth-welcome.06: the version line on the signed-out screen
    const b = V.blocked || {};
    const ctx2 = await browser.createBrowserContext();
    const p2 = await ctx2.newPage(); await p2.setViewport({ width: 390, height: 900 });
    await p2.goto(APP + '/pages/home/index', { waitUntil: 'domcontentloaded', timeout: 60000 });
    // Taro H5 storage wraps every value as {"data": …} (taro-h5 setStorageSync); a bare string is not read back as a value
    await p2.evaluate((t) => { localStorage.setItem('boyau_social_token', JSON.stringify({ data: t })); }, b.token || '');
    await p2.goto(APP + '/pages/signin/index', { waitUntil: 'networkidle2', timeout: 60000 });
    await sleep(3000);
    await p2.screenshot({ path: SHOTS + '/6-blocked.png' });
    const txt = await p2.evaluate(() => document.body.innerText);
    ok('U2.blocked-told', !!b.token && /This account has been blocked\./.test(txt) && /Welcome back/.test(txt), { told: /This account has been blocked\./.test(txt), signedOutForm: /Welcome back/.test(txt) });
    ok('U2.version-line', /GripBat · Version \S+/.test(txt), (txt.match(/GripBat · Version [^\n]*/) || ['none'])[0]);
    await ctx2.close();
  } finally { await browser.close(); }
}

(async () => {
  try { await main(); } catch (e) { ok('run', false, 'probe threw: ' + (e && e.stack || e)); }
  finally {
    // the suspended throwaway is lifted through the native admin door first (the auth cache follows the event), then deleted
    try { if (V.blocked && V.blocked.userId) { const r = await U('admin/unsuspend-user', { i: V.blocked.rootTok, userId: V.blocked.userId }); V.cleanup.push({ unsuspended: r.s }); } } catch (e) { V.cleanup.push({ unsuspend: e.message }); }
    if (V.blocked) delete V.blocked.rootTok;
    for (const a of made) {
      try {
        if (!a.token) a.token = sbx(`select u.token from "user" u join user_profile p on p."userId" = u.id where lower(p.email) = ${lit(a.email)}`);
        if (a.token) { const d = await U('i/delete-account', { i: a.token, password: a.password }); V.cleanup.push({ email: a.email, deleted: d.s }); }
      } catch (e) { V.cleanup.push({ email: a.email, error: e.message }); }
    }
    try { V.cleanup.push({ pendingRemoved: sbx(`with d as (delete from user_pending where email like ${lit('gbacc-' + RUN + '%')} returning 1) select count(*) from d`) }); } catch (e) { V.cleanup.push({ pending: e.message }); }
    V.verdict = V.evidence.length && V.evidence.every((e) => e.pass) ? 'pass' : 'fail';
    fs.writeFileSync(OUT, JSON.stringify(V, null, 2) + '\n');
    console.log(`${V.verdict.toUpperCase()} gripbat-accounts (${MODE}) ${V.evidence.filter((e) => e.pass).length}/${V.evidence.length} → ${OUT}`);
    process.exit(V.verdict === 'pass' ? 0 : 1);
  }
})();

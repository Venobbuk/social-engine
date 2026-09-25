require('/root/social-engine/probes/_guard.cjs');   // G13.3
// (staff = tester1, the boyau-uat TENANT_ADMIN test account, signing in with its own hkpl login)
// fix-S4 STAFF probe (C-root-layout.04, STAFF-ADMIN-V1 d03605bb5d) — UAT ONLY. A GripBat staff account (an hkpl TENANT_ADMIN
// of boyau-uat) signs in through the SSO door the app uses (hkpl /api/v1/auth/sso/social → engine adapter/sso) and then,
// through the API only (no SQL for any staff action):
//   S1 raises a server banner (admin/announcements/create display=banner) → seen on /app/ at 390 px → clears it (isActive
//      false) → gone from /app/;
//   S2 switches maintenance on → gb/status on (and the app's gate shows) → off → gb/status off;
//   S3 resolves a [probe] abuse report (users/report-abuse by amy → admin/abuse-user-reports → admin/resolve-abuse-user-report);
//   S4 reads admin/meta (read-only: nothing written);
//   N  a non-staff persona (amy, native) is refused on every one of those doors;
//   D  demotion: a [probe] hkpl sandbox member promoted to TENANT_ADMIN signs in → staff; set back to PLAYER in hkpl → the
//      next SSO removes the role → admin/* refused. (The hkpl role of that [probe] member is the only fixture written by SQL.)
// Fixtures "[probe] fix-S4 staff …", removed in finally. Output probes/fix-S4-staff.json.
'use strict';
const fs = require('fs');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const puppeteer = require('/root/hkpl-server/node_modules/puppeteer-core');
const { getNativeToken } = require('/root/social-engine/probes/_native-session.cjs');
const APP = 'https://uat.gripbat.com';
const HK = 'https://uat.social.silkvo.com';   // boyau-uat's canonical host (hkpl resolves the tenant by Host)
const RUN = crypto.randomBytes(3).toString('hex');
const P = '[probe] fix-S4 staff ';
const DIR = '/root/social-engine/probes';
const OUT = DIR + '/fix-S4-staff.json';
const SHOTS = DIR + '/fix-S4-shots/staff'; fs.mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = { id: 'fix-S4-staff', at: new Date().toISOString(), run: RUN, rows: {}, checks: [], plants: [], fx: {}, errors: [], cleanup: [] };
const save = () => fs.writeFileSync(OUT, JSON.stringify(R, null, 1));
function chk(row, name, pass, ev) { const e = typeof ev === 'string' ? ev : JSON.stringify(ev); R.checks.push({ row, name, pass: !!pass, ev: e.slice(0, 1200) }); const r = R.rows[row] || (R.rows[row] = { id: row, checks: 0, passed: 0, status: 'still-open', evidence: [] }); r.checks++; if (pass) r.passed++; r.evidence.push((pass ? 'ok ' : 'NO ') + name); r.status = r.passed === r.checks ? 'closed' : 'still-open'; console.log((pass ? 'ok   ' : 'NO   ') + row + ' ' + name + ' :: ' + e.slice(0, 280)); save(); }
const hkdb = (q) => execFileSync('docker', ['exec', '-i', 'hkpl-docker-hkpl-db-1', 'sh', '-c', 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -qtA'], { input: q }).toString().trim();
const lit = (v) => "'" + String(v).replace(/'/g, "''") + "'";
async function eng(ep, body, tok) { const r = await fetch(APP + '/api/' + ep, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...(body || {}), ...(tok ? { i: tok } : {}) }) }); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) { /* 204 */ } return { s: r.status, j, code: j && j.error && j.error.code }; }
const code = () => execFileSync('docker', ['exec', 'hkpl-docker-hkpl-app-1', 'node', '-e', "console.log(require('/root/hkpl-server/lib/sandbox-passcode.js').todaysCode(\"boyau-uat\"))"]).toString().trim().split('\n').pop();
const cookieOf = (res, re) => { const all = (typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [res.headers.get('set-cookie') || '']).join(', '); const m = all.match(re); return m ? m[0].split(';')[0] : null; };
/** hkpl session cookie (on the boyau-uat host) → the SSO JWT → engine adapter/sso (native) — the app's own path. */
async function ssoFrom(hkCookie, gate) {
  const r = await fetch(HK + '/api/v1/auth/sso/social', { headers: { cookie: hkCookie + '; ' + gate } });
  const j = await r.json().catch(() => ({}));
  if (!j.jwt) return { s: r.status, err: JSON.stringify(j).slice(0, 200) };
  const claims = JSON.parse(Buffer.from(j.jwt.split('.')[1], 'base64url').toString());
  const x = await eng('adapter/sso', { jwt: j.jwt, native: true });
  return { s: x.s, staff: x.j && x.j.staff, token: x.j && (x.j.i || x.j.token), userId: x.j && x.j.userId, claims: { tenant: claims.tenant, role: claims.role }, raw: x.s !== 200 ? JSON.stringify(x.j).slice(0, 200) : undefined };
}

(async () => {
  const FX = R.fx; FX.announcements = []; FX.reports = [];
  const amy = await getNativeToken('player-amy');
  const gate = 'sbx_gate=' + encodeURIComponent(code());
  let S = null; let browser = null; let hkM = null;
  const setRole = (role) => hkdb(`update "User" set role = ${lit(role)} where id = ${lit(FX.hkUserId)} and tenant_id = 'boyau-uat' and email = ${lit(FX.hkEmail)}`);
  try {
    // ---- the staff persona: a [probe] sandbox member of boyau-uat whose hkpl role is TENANT_ADMIN (the one SQL fixture),
    //      signing in through the app's own SSO door. (tester1 reads PLAYER in hkpl today — measured in run 1.)
    const email = 'fs4-staff-' + RUN + '@example.test';
    const c1 = await fetch(HK + '/api/v1/auth/claim/start', { method: 'POST', headers: { 'content-type': 'application/json', cookie: gate }, body: JSON.stringify({ email }) });
    const cj = await c1.json().catch(() => ({}));
    if (!cj._dev_code) throw new Error('claim/start gave no sandbox code (' + c1.status + ')');
    const v = await fetch(HK + '/api/v1/auth/signin-code/verify', { method: 'POST', headers: { 'content-type': 'application/json', cookie: gate }, body: JSON.stringify({ email, code: cj._dev_code }), redirect: 'manual' });
    hkM = cookieOf(v, /hkpl_sid[^=]*=[^;,]+/);
    if (!hkM) throw new Error('signin-code/verify ' + v.status);
    FX.hkEmail = email;
    FX.hkUserId = hkdb(`select id from "User" where tenant_id = 'boyau-uat' and lower(email) = ${lit(email)}`);
    await fetch(HK + '/api/v1/me/profile', { method: 'PATCH', headers: { 'content-type': 'application/json', cookie: hkM + '; ' + gate }, body: JSON.stringify({ fullname: P + RUN }) }).catch(() => null);
    setRole('TENANT_ADMIN'); FX.hkPromoted = true;
    const d1 = await ssoFrom(hkM, gate); FX.engUserId = d1.userId; FX.engToken = d1.token; S = d1.token;
    const me = S ? await eng('i', {}, S) : { j: null };
    chk('C-root-layout.04', 'SSO as an hkpl TENANT_ADMIN of boyau-uat → adapter/sso staff:true → the engine account is moderator + administrator (i)', d1.s === 200 && d1.staff === true && me.j && me.j.isModerator === true && me.j.isAdmin === true && d1.claims.tenant === 'boyau-uat' && d1.claims.role === 'TENANT_ADMIN', { sso: { s: d1.s, staff: d1.staff, claims: d1.claims, raw: d1.raw }, i: me.j && { isModerator: me.j.isModerator, isAdmin: me.j.isAdmin } });

    // ---- leftovers of run 1 (tester1 was not staff there): its [probe] report resolved, its [probe] account closed
    const old = await eng('admin/abuse-user-reports', { limit: 50, state: 'unresolved' }, S);
    for (const x of (Array.isArray(old.j) ? old.j : []).filter((x) => String(x.comment || '').includes(P + 'report '))) R.cleanup.push({ oldReport: x.id, resolve: (await eng('admin/resolve-abuse-user-report', { reportId: x.id, resolvedAs: 'reject' }, S)).s });
    for (const id of String(process.env.OLD_IDS || '').split(',').filter(Boolean)) R.cleanup.push({ oldAccount: id, del: (await eng('admin/delete-account', { userId: id }, S)).s });

    // ---- S1 banner on → seen in the app → off → gone
    browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const bannerSeen = async (title, tag) => {
      const ctx = await browser.createBrowserContext(); const page = await ctx.newPage();
      await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
      await page.evaluateOnNewDocument(() => { try { localStorage.setItem('hkpl_lang_ok', JSON.stringify({ data: '1' })); } catch (e) { /* */ } });
      const seenNet = []; page.on('response', async (r) => { if (/\/api\/announcements$/.test(r.url())) { let j = null; try { j = await r.json(); } catch (e) { /* */ } seenNet.push({ s: r.status(), n: Array.isArray(j) ? j.length : null, titles: Array.isArray(j) ? j.map((a) => a.title + ':' + a.display).slice(0, 4) : null }); } });
      await page.goto(APP + '/app/pages/home/index?lang=en', { waitUntil: 'networkidle2', timeout: 45000 }).catch(() => null);
      await page.waitForFunction((t) => [...document.querySelectorAll('.sb-bar')].some((e) => (e.innerText || '').includes(t)), { timeout: 25000 }, title).catch(() => null);
      const bars = await page.$$eval('.sb-bar', (e) => e.map((x) => x.innerText.replace(/\s+/g, ' ').slice(0, 120))).catch(() => []);
      const f = SHOTS + '/' + tag + '.png'; await page.screenshot({ path: f }).catch(() => null);
      await ctx.close(); return { bars, seen: bars.some((b) => b.includes(title)), shot: f.replace(DIR + '/', 'probes/'), net: seenNet };
    };
    const title = P + 'banner ' + RUN;
    const body = { title, text: 'fix-S4 staff probe — a server banner raised and cleared by GripBat staff.', imageUrl: null, icon: 'warning', display: 'banner', silence: true };
    const nA = await eng('admin/announcements/create', body, amy.token);
    const cA = await eng('admin/announcements/create', body, S);
    const annId = cA.j && cA.j.id; if (annId) FX.announcements.push(annId);
    const pub = await eng('announcements', { limit: 10, isActive: true });
    const on = await bannerSeen(title, 'banner-on');
    const nU = annId ? await eng('admin/announcements/update', { id: annId, isActive: false }, amy.token) : { s: 0 };
    const uA = annId ? await eng('admin/announcements/update', { id: annId, isActive: false }, S) : { s: 0 };
    const pub2 = await eng('announcements', { limit: 10, isActive: true });
    const off = await bannerSeen(title, 'banner-off');
    chk('C-root-layout.04', 'S1 staff raises a banner (admin/announcements/create 200) → the public announcements door lists it → /app/ at 390 px shows it; staff clears it (isActive false) → gone from the door and the app', cA.s === 200 && Array.isArray(pub.j) && pub.j.some((a) => a.id === annId && a.display === 'banner') && on.seen && (uA.s === 204 || uA.s === 200) && Array.isArray(pub2.j) && !pub2.j.some((a) => a.id === annId) && !off.seen, { create: cA.s, update: uA.s, publicHad: Array.isArray(pub.j) ? pub.j.map((a) => a.title + ':' + a.display) : pub.s, onBars: on.bars, onNet: on.net, offBars: off.bars, offNet: off.net, shots: [on.shot, off.shot] });
    if (annId) { const dA = await eng('admin/announcements/delete', { id: annId }, S); R.cleanup.push({ announcement: annId, del: dA.s }); if (dA.s < 300) FX.announcements = FX.announcements.filter((x) => x !== annId); }
    chk('C-root-layout.04', 'N non-staff (amy) refused: admin/announcements/create and /update', nA.s === 403 && nU.s === 403, { create: nA.s + ' ' + nA.code, update: nU.s + ' ' + nU.code });

    // ---- S2 maintenance on → gb/status → off
    const nM = await eng('gb/maintenance', { on: true, message: P + RUN }, amy.token);
    const mOn = await eng('gb/maintenance', { on: true, message: P + 'maintenance ' + RUN }, S); FX.maintenance = mOn.s === 200;
    const st1 = await eng('gb/status', {});
    const mOff = await eng('gb/maintenance', { on: false }, S); if (mOff.s === 200) FX.maintenance = false;
    const st2 = await eng('gb/status', {});
    chk('C-root-layout.04', 'S2 staff switches maintenance on → gb/status on (with the note) → off → gb/status off', mOn.s === 200 && st1.j && st1.j.maintenance && st1.j.maintenance.on === true && mOff.s === 200 && st2.j && st2.j.maintenance && st2.j.maintenance.on === false, { on: mOn.s, status1: st1.j && st1.j.maintenance, off: mOff.s, status2: st2.j && st2.j.maintenance });
    chk('C-root-layout.04', 'N non-staff (amy) refused: gb/maintenance', nM.s === 403, { s: nM.s, code: nM.code });

    // ---- S3 a [probe] abuse report (amy reports the [probe] staff account itself — no real member is reported) resolved
    const ken = await getNativeToken('host-ken');
    const rep = await eng('users/report-abuse', { userId: ken.userId, comment: P + 'report ' + RUN + ' (probe, ignore)' }, amy.token);
    const list = await eng('admin/abuse-user-reports', { limit: 50, state: 'unresolved' }, S);
    const mine = Array.isArray(list.j) ? list.j.find((x) => String(x.comment || '').includes(P + 'report ' + RUN)) : null;
    if (mine) FX.reports.push(mine.id);
    const nL = await eng('admin/abuse-user-reports', { limit: 5 }, amy.token);
    const nR = mine ? await eng('admin/resolve-abuse-user-report', { reportId: mine.id, resolvedAs: 'reject' }, amy.token) : { s: 0 };
    const res = mine ? await eng('admin/resolve-abuse-user-report', { reportId: mine.id, resolvedAs: 'reject' }, S) : { s: 0 };
    const list2 = await eng('admin/abuse-user-reports', { limit: 50, state: 'resolved' }, S);
    const done = Array.isArray(list2.j) && mine ? list2.j.find((x) => x.id === mine.id) : null;
    if (done && done.resolved) FX.reports = [];
    chk('C-root-layout.04', 'S3 amy files a [probe] report on the test persona host-ken (users/report-abuse 204) → staff lists it → resolves it (admin/resolve-abuse-user-report) → it reads resolved', rep.s === 204 && !!mine && (res.s === 204 || res.s === 200) && !!done && !!done.resolved, { report: rep.s, listed: !!mine, resolve: res.s, resolved: done && done.resolved });
    chk('C-root-layout.04', 'N non-staff (amy) refused: admin/abuse-user-reports and admin/resolve-abuse-user-report', nL.s === 403 && nR.s === 403, { list: nL.s + ' ' + nL.code, resolve: nR.s + ' ' + nR.code });

    // ---- S4 admin/meta read-only
    const meta = await eng('admin/meta', {}, S);
    const nMeta = await eng('admin/meta', {}, amy.token);
    chk('C-root-layout.04', 'S4 staff reads admin/meta (200, the settings object; nothing written); non-staff (amy) refused', meta.s === 200 && meta.j && typeof meta.j === 'object' && 'disableRegistration' in meta.j && nMeta.s === 403, { staff: meta.s, keys: meta.j ? Object.keys(meta.j).length : 0, amy: nMeta.s + ' ' + nMeta.code });

    // ---- D the same person set back to PLAYER in hkpl → the next SSO removes the role
    setRole('PLAYER'); FX.hkPromoted = false;
    const d2 = await ssoFrom(hkM, gate); if (d2.token) FX.engToken = d2.token;
    const i2 = d2.token ? await eng('i', {}, d2.token) : { j: null };
    const a2 = d2.token ? await eng('admin/meta', {}, d2.token) : { s: 0 };
    const a3 = d2.token ? await eng('admin/announcements/create', { title: P + 'demoted ' + RUN, text: 'x', imageUrl: null }, d2.token) : { s: 0 };
    if (a3.j && a3.j.id) FX.announcements.push(a3.j.id);
    const a4 = await eng('gb/maintenance', { on: false }, d2.token);
    chk('C-root-layout.04', 'D hkpl sets the same person to PLAYER → the next SSO says staff:false, same engine account, no longer moderator/admin; admin/meta, admin/announcements/create and gb/maintenance 403', d2.userId === FX.engUserId && d2.staff === false && i2.j && i2.j.isAdmin === false && i2.j.isModerator === false && a2.s === 403 && a3.s === 403 && a4.s === 403, { staff: d2.staff, claims: d2.claims, isAdmin: i2.j && i2.j.isAdmin, isModerator: i2.j && i2.j.isModerator, meta: a2.s, annCreate: a3.s, maintenance: a4.s, sameAccount: d2.userId === FX.engUserId });

    R.plants.push({ name: 'the staff token passes the door amy is refused at (admin/meta 200 vs 403) — the 403 checks can fail', fired: meta.s === 200 && nMeta.s === 403 });
    R.plants.push({ name: 'the banner check can see a banner (it saw the probe banner while active)', fired: on.seen === true });
    R.plants.push({ name: 'run 1 (tester1, hkpl PLAYER) was refused on every staff door — the staff checks can fail', fired: true, evidence: 'probes/fix-S4-staff.run1.json' });
  } catch (e) { R.errors.push(String(e && e.stack || e).slice(0, 700)); console.log('ERR', e && e.message); }
  finally {
    try { if (browser) await browser.close(); } catch (e) { /* */ }
    if (FX.maintenance && S) R.cleanup.push({ maintenanceOff: (await eng('gb/maintenance', { on: false }, S)).s });
    for (const id of FX.announcements) R.cleanup.push({ announcement: id, del: S && FX.hkPromoted !== false ? (await eng('admin/announcements/delete', { id }, S)).s : 'needs staff' });
    if (FX.hkUserId && FX.hkPromoted) { try { setRole('PLAYER'); R.cleanup.push({ hkRole: 'PLAYER' }); } catch (e) { R.cleanup.push({ hkRole: e.message }); } }
    if (FX.engUserId && FX.hkUserId && hkM) { try { setRole('TENANT_ADMIN'); FX.hkPromoted = true; const d3 = await ssoFrom(hkM, gate); R.cleanup.push({ engineAccount: FX.engUserId, del: d3.token && d3.staff ? (await eng('admin/delete-account', { userId: FX.engUserId }, d3.token)).s : 'no staff session' }); } catch (e) { R.cleanup.push({ engineAccount: e.message }); } try { setRole('PLAYER'); FX.hkPromoted = false; } catch (e) { R.cleanup.push({ hkRole: e.message }); } }
    if (FX.hkUserId) { try { R.cleanup.push({ hkUser: hkdb(`with d as (update "User" set is_active = false, deleted_at = now(), email = ${lit('deleted-' + RUN + '@example.test')} where id = ${lit(FX.hkUserId)} and tenant_id = 'boyau-uat' returning 1) select count(*) from d`) }); } catch (e) { R.cleanup.push({ hkUser: e.message }); } }
    const st = await eng('gb/status', {}); const pub = await eng('announcements', { limit: 20, isActive: true });
    R.leftover = { maintenanceOn: !!(st.j && st.j.maintenance && st.j.maintenance.on), probeBanners: Array.isArray(pub.j) ? pub.j.filter((a) => String(a.title || '').includes('[probe]')).length : 'unread', unresolvedProbeReports: FX.reports.length };
    R.cleanupFailed = R.cleanup.filter((c) => (typeof c.del === 'number' && c.del >= 300) || c.del === 'needs staff' || (c.engineAccount && c.del === 'no staff session') || (typeof c.maintenanceOff === 'number' && c.maintenanceOff >= 300) || (typeof c.resolve === 'number' && c.resolve >= 300) || (typeof c.oldAccount === 'number' && c.oldAccount >= 300) || /error|denied/i.test(String(c.hkUser || '') + String(c.hkRole || ''))).length;
    R.summary = { closed: Object.values(R.rows).filter((r) => r.status === 'closed').map((r) => r.id), open: Object.values(R.rows).filter((r) => r.status !== 'closed').map((r) => r.id + ' ' + r.passed + '/' + r.checks), plants: R.plants, leftover: R.leftover, cleanupFailed: R.cleanupFailed, errors: R.errors.length };
    save(); console.log('SUMMARY ' + JSON.stringify(R.summary));
  }
})().catch((e) => { R.errors.push('FATAL ' + (e && e.stack || e)); save(); console.error(e); process.exit(1); });

// gripbat-sso.probe.cjs — G15.15-SSO + SSO-ONE-TAP (operator 2026-09-24). Lane gripbat-accounts.
//   bash /root/gen/browser-slot.sh node /root/social-engine/probes/gripbat-sso.probe.cjs
// "Continue with your HKPL account": a member of ANY hkpl league (here the caged UAT league `uat`, host uat.silkvo.com)
// taps the button on uat.gripbat.com and lands on GripBat Home in ONE tap — no email check, no username step, no
// onboarding, no DUPR approval. Read back from the engine (se_sbx) and hkpl DB, never from the screen that caused it:
//   S1 one tap: sign-in → league chooser → UAT test league → Home; /pages/onboard/ is never visited (browser, 390 px)
//   S2 the account: handle from the hkpl NAME (never the email, never a machine handle); hkpl's verified email on it;
//      onboarding stamped; the seam handle kept as the lookup alias
//   S3 DUPR carried over: the member's hkpl DUPR link (a FAKE id on the sandbox league, consent recorded) arrives linked —
//      gb/dupr/connection connected, source dupr-partner, Rankings lists the member. No DUPR call is made anywhere.
//   S4 a second sign-in reaches the SAME account (one person, one account)
//   S5 link by verified email: a native GripBat account made first with address X; an hkpl member with the same verified X
//      taps the button → the SAME account (linked: true), no second one
//   S6 tester1 / tester2 (existing seam accounts, now name handles) land on Home — no username or onboarding step
//   S7 A8 re-proof: the DUPR connect doors answer at their reachable level now that hkpl's door is live (sso-url 200)
//   P1 production, signed out: gripbat.com shows the button + the live leagues only, and HKPL leads to hkpl.com.hk's own
//      sign-in (nothing created)
//   N1 planted: a hand-off to a foreign origin is refused by hkpl (400) — the check can fail
// Fixtures: "[probe] gb-sso" hkpl members on the sandbox league (deleted through hkpl's own door), their GripBat accounts
// (admin/delete-account on se_sbx), the native account of S5; the fake DUPR id is cleared first in `finally`.
// @claims route pages/signin/index :: gripbat-sso :: hkpl-button,one-tap
// @claims endpoint adapter/sso :: gripbat-sso :: any-tenant,link-by-email,native,one-tap
'use strict';
const fs = require('fs');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const UAT = 'https://uat.gripbat.com';
const PROD = 'https://gripbat.com';
const LEAGUE = 'https://uat.silkvo.com';
const OUT = '/root/social-engine/probes/gripbat-sso.verdict.json';
const SHOTS = '/root/social-engine/probes/gripbat-sso-shots';
fs.mkdirSync(SHOTS, { recursive: true });
const RUN = crypto.randomBytes(3).toString('hex');
const V = { id: 'gripbat-sso', at: new Date().toISOString(), condition_fired: false, verdict: 'fail', evidence: [], cleanup: [] };
const ok = (id, pass, detail) => { V.evidence.push({ id, pass: !!pass, detail }); console.log((pass ? 'PASS ' : 'FAIL ') + id + ' — ' + JSON.stringify(detail).slice(0, 320)); return !!pass; };
const sbx = (q) => execFileSync('docker', ['exec', '-i', 'social-engine-db-1', 'psql', '-U', 'social', '-d', 'se_sbx', '-qtA'], { input: q }).toString().trim();
const hkdb = (q) => execFileSync('docker', ['exec', '-i', 'hkpl-docker-hkpl-db-1', 'sh', '-c', 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -qtA'], { input: q }).toString().trim();
const lit = (v) => "'" + String(v).replace(/'/g, "''") + "'";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function eng(base, path, body) { const r = await fetch(base + '/api/' + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) }); let j = null; try { j = await r.json(); } catch (e) { /* 204 */ } return { s: r.status, j, code: (j && j.error && j.error.code) || '' }; }

// an hkpl member of the sandbox league: claim/start (sandbox answers the code) → signin-code/verify → session cookie
async function hkplMember(email, fullname) {
  const r1 = await fetch(LEAGUE + '/api/v1/auth/claim/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }) });
  const j1 = await r1.json().catch(() => ({}));
  if (!j1._dev_code) throw new Error('claim/start gave no sandbox code (' + r1.status + ')');
  const r2 = await fetch(LEAGUE + '/api/v1/auth/signin-code/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, code: j1._dev_code }), redirect: 'manual' });
  const sid = (r2.headers.get('set-cookie') || '').match(/(hkpl_sid[^=]*)=([^;]+)/);
  if (r2.status !== 200 || !sid) throw new Error('signin-code/verify ' + r2.status);
  const cookie = { name: sid[1], value: sid[2] };
  if (fullname) await fetch(LEAGUE + '/api/v1/me/profile', { method: 'PATCH', headers: { 'content-type': 'application/json', cookie: cookie.name + '=' + cookie.value }, body: JSON.stringify({ fullname }) });
  const id = hkdb(`select id from "User" where tenant_id = 'uat' and lower(email) = ${lit(email.toLowerCase())}`);
  return { email, cookie, id };
}
/** hkpl's hand-off for this member, followed by hand (no browser): the #gbsso token → engine adapter/sso (native). */
async function handoff(m) {
  const r = await fetch(LEAGUE + '/api/v1/auth/sso/social/gripbat?return=' + encodeURIComponent(UAT), { headers: { cookie: m.cookie.name + '=' + m.cookie.value }, redirect: 'manual' });
  const loc = r.headers.get('location') || '';
  const jwt = (loc.match(/#gbsso=(.+)$/) || [])[1];
  if (!jwt) return { s: r.status, loc };
  const x = await eng(UAT, 'adapter/sso', { jwt: decodeURIComponent(jwt), native: true });
  return { s: r.status, loc, x };
}
const members = [];
const gbAccounts = new Set();
let fakeDupr = '';

async function main() {
  // ---- N1 planted fault: a hand-off to a foreign origin must be refused
  const n1 = await fetch(LEAGUE + '/api/v1/auth/sso/social/gripbat?return=' + encodeURIComponent('https://evil.example'), { redirect: 'manual' });
  ok('N1.foreign-origin-refused', n1.status === 400, { status: n1.status });

  // ---- S1 one tap, in the browser
  const m1 = await hkplMember(`gbsso-${RUN}@example.test`, `[probe] Sky Rider ${RUN}`);
  members.push(m1);
  fakeDupr = 'ZZ' + RUN.toUpperCase().slice(0, 4);
  hkdb(`update "User" set dupr_id = ${lit(fakeDupr)}, dupr_double_rating = 3.75, consents = coalesce(consents::jsonb, '{}'::jsonb) || '{"dupr_share": true, "dupr_connect_via": "sso"}'::jsonb where id = ${lit(m1.id)} and tenant_id = 'uat'`);
  V.condition_fired = true;
  const browser = await require('/root/hkpl-server/node_modules/puppeteer-core').launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
  try {
    const ctx = await browser.createBrowserContext();
    const p = await ctx.newPage(); await p.setViewport({ width: 390, height: 900 });
    await p.setCookie({ name: m1.cookie.name, value: m1.cookie.value, domain: 'uat.silkvo.com', path: '/', secure: true, httpOnly: true });
    const visited = [];
    // every top-level NAVIGATION REQUEST, redirect hops included (a 302 hop never commits a frame, so framenavigated misses it)
    p.on('request', (rq) => { if (rq.isNavigationRequest() && rq.frame() === p.mainFrame()) visited.push(rq.url().replace(/#.*$/, '#…')); });
    const clickText = (t) => p.evaluate((txt) => { const el = [...document.querySelectorAll('taro-button-core,button,[role=button]')].find((e) => e.textContent && e.textContent.trim() === txt && e.offsetParent); if (!el) return false; el.click(); return true; }, t);
    await p.goto(UAT + '/app/pages/signin/index', { waitUntil: 'networkidle2', timeout: 60000 });
    await sleep(1500);
    const b1 = await clickText('Continue with your HKPL account');
    await sleep(800);
    await p.screenshot({ path: SHOTS + '/1-chooser.png' });
    const b2 = await clickText('UAT test league');
    await p.waitForFunction(() => /pages\/home\/index/.test(location.pathname), { timeout: 60000 }).catch(() => undefined);
    await sleep(3500);
    await p.screenshot({ path: SHOTS + '/2-home.png' });
    const url = p.url();
    ok('S1.one-tap-home', b1 && b2 && /\/app\/pages\/home\/index/.test(url) && !visited.some((u) => /pages\/onboard\//.test(u)) && visited.some((u) => /uat\.silkvo\.com\/api\/v1\/auth\/sso\/social\/gripbat/.test(u)), { button: b1, league: b2, landed: url, path: visited.map((u) => u.replace(/\?.*$/, '')) });

    // ---- S2 the account
    const acc = sbx(`select u.id || '|' || u.username || '|' || coalesce(p.email,'') || '|' || p."emailVerified" from "user" u join user_profile p on p."userId" = u.id where lower(p.email) = ${lit(m1.email)}`);
    const [uid, uname, uemail, uver] = acc.split('|');
    if (uid) gbAccounts.add(uid);
    const onb = uid ? sbx(`select ("onboardedAt" is not null)::text from meet_player_level where "userId" = ${lit(uid)} and sport = 'pickleball'`) : '';
    const alias = uid ? sbx(`select count(*) from registry_item where "userId" = ${lit(uid)} and key = 'gbSsoHandle'`) : '';
    ok('S2.account', !!uid && /^probe_sky_rider/.test(uname) && !/^(gb|hkpl)_/.test(uname) && uname !== m1.email.split('@')[0] && (uver === 't' || uver === 'true') && uemail === m1.email && onb === 'true' && alias === '1', { handle: uname, email: uemail === m1.email, verified: uver, onboarded: onb, alias });

    // ---- S3 DUPR carried over
    const tok = uid ? sbx(`select token from "user" where id = ${lit(uid)}`) : '';
    const conn = tok ? await eng(UAT, 'gb/dupr/connection', { i: tok }) : { j: null };
    const lvl = uid ? sbx(`select coalesce("duprId",'') || '|' || coalesce(source,'') || '|' || coalesce("duprDoubles"::text,'') from meet_player_level where "userId" = ${lit(uid)} and sport = 'pickleball'`) : '';
    const rank = await eng(UAT, 'stats/dupr-rankings', { sport: 'pickleball', sort: 'doubles', limit: 100 });
    const inRank = !!(rank.j && (rank.j.rows || []).some((r) => r.userId === uid));
    ok('S3.dupr-carried', conn.j && conn.j.connected === true && conn.j.duprId === fakeDupr && lvl === fakeDupr + '|dupr-partner|3.75' && inRank, { connection: conn.j, level: lvl, inRankings: inRank });

    // ---- S4 second sign-in → same account
    const again = await handoff(m1);
    const count = sbx(`select count(*) from user_profile where lower(email) = ${lit(m1.email)}`);
    ok('S4.same-account', again.x && again.x.s === 200 && again.x.j.userId === uid && again.x.j.created === false && count === '1', { second: again.x && again.x.j && again.x.j.userId, same: again.x && again.x.j && again.x.j.userId === uid, accounts: count });

    // ---- S5 link by verified email
    const shared = `gbsso-${RUN}-link@example.test`;
    const su = await eng(UAT, 'signup', { emailAddress: shared, password: 'Pl-' + RUN + 'xyz9' });
    const sd = su.j && su.j._dev_code ? await eng(UAT, 'signup-pending', { code: su.j._dev_code }) : { j: null };
    const nativeId = sd.j && sd.j.id;
    if (nativeId) gbAccounts.add(nativeId);
    const m2 = await hkplMember(shared, `[probe] Link Case ${RUN}`);
    members.push(m2);
    const l = await handoff(m2);
    const n = sbx(`select count(*) from user_profile where lower(email) = ${lit(shared)}`);
    ok('S5.linked-by-email', !!nativeId && l.x && l.x.s === 200 && l.x.j.userId === nativeId && l.x.j.linked === true && n === '1', { native: nativeId, sso: l.x && l.x.j && l.x.j.userId, linked: l.x && l.x.j && l.x.j.linked, accounts: n });

    // ---- S6 tester1 / tester2 land on Home
    const out = {};
    for (const [key, email] of [['tester1', 'boyau.tester1@silkvo.com'], ['tester2', 'boyau.tester2@silkvo.com']]) {
      const hid = hkdb(`select id from "User" where tenant_id = 'boyau-uat' and email = ${lit(email)}`);
      const handle = hid ? 'hkpl_' + crypto.createHash('sha256').update('hkpl:' + hid).digest('hex').slice(0, 12) : '';
      const eu = handle ? sbx(`select id from "user" where "usernameLower" = ${lit(handle)} union select "userId" from registry_item where key = 'gbSsoHandle' and domain is null and value = to_jsonb(${lit(handle)}::text) limit 1`) : '';
      if (!eu) { out[key] = 'no engine user'; continue; }
      const t = sbx(`select token from "user" where id = ${lit(eu)}`);
      const c2 = await browser.createBrowserContext();
      const p2 = await c2.newPage(); await p2.setViewport({ width: 390, height: 900 });
      const nav = []; p2.on('framenavigated', (f) => { if (f === p2.mainFrame()) nav.push(f.url()); });
      await p2.goto(UAT + '/app/pages/home/index', { waitUntil: 'domcontentloaded', timeout: 60000 });
      await p2.evaluate((tk) => { localStorage.clear(); localStorage.setItem('boyau_social_token', JSON.stringify({ data: tk })); }, t);
      await p2.goto(UAT + '/app/pages/home/index', { waitUntil: 'networkidle2', timeout: 60000 });
      await sleep(4000);
      await p2.screenshot({ path: SHOTS + '/3-' + key + '-home.png' });
      const who = sbx(`select username from "user" where id = ${lit(eu)}`);
      out[key] = { handle: who, onHome: /pages\/home\/index/.test(p2.url()), sawOnboard: nav.some((u) => /pages\/onboard\//.test(u)) };
      await c2.close();
    }
    ok('S6.testers-home', Object.values(out).every((o) => o && typeof o === 'object' && o.onHome && !o.sawOnboard && !/^(gb|hkpl)_/.test(o.handle)), out);

    // ---- P1 production, signed out
    const c3 = await browser.createBrowserContext();
    const p3 = await c3.newPage(); await p3.setViewport({ width: 390, height: 900 });
    await p3.goto(PROD + '/app/pages/signin/index', { waitUntil: 'networkidle2', timeout: 60000 });
    await sleep(1500);
    const pb = await p3.evaluate(() => { const el = [...document.querySelectorAll('taro-button-core,button,[role=button]')].find((e) => e.textContent && e.textContent.trim() === 'Continue with your HKPL account' && e.offsetParent); if (!el) return false; el.click(); return true; });
    await sleep(800);
    const leagues = await p3.evaluate(() => [...document.querySelectorAll('.si-alt-t')].map((e) => e.textContent.trim()));
    await p3.evaluate(() => { const el = [...document.querySelectorAll('taro-button-core,button,[role=button]')].find((e) => e.textContent && e.textContent.trim() === 'HKPL' && e.offsetParent); if (el) el.click(); });
    await p3.waitForFunction(() => /hkpl\.com\.hk/.test(location.host), { timeout: 30000 }).catch(() => undefined);
    await sleep(1500);
    await p3.screenshot({ path: SHOTS + '/4-prod-hkpl-signin.png' });
    const purl = p3.url();
    ok('P1.prod-signed-out', pb && leagues.includes('HKPL') && !leagues.some((x) => /UAT/.test(x)) && /^https:\/\/hkpl\.com\.hk\/sign-in\.html\?next=%2Fapi%2Fv1%2Fauth%2Fsso%2Fsocial%2Fgripbat%3Freturn%3Dhttps%253A%252F%252Fgripbat\.com/.test(purl), { button: pb, leagues, landed: purl.slice(0, 140) });
    await c3.close();
  } finally { await browser.close(); }

  // ---- S7 A8 re-proof: DUPR connect doors at their reachable level (hkpl door live since ~16:50)
  const { getNativeToken } = require('/root/social-engine/probes/_native-session.cjs');
  const amy = await getNativeToken('player-amy');
  const su = await eng(UAT, 'gb/dupr/sso-url', { i: amy.token });
  const dc = await eng(UAT, 'gb/dupr/connection', { i: amy.token });
  ok('S7.dupr-doors', su.s === 200 && typeof (su.j && su.j.url) === 'string' && /dupr/i.test(su.j.url) && dc.s === 200, { ssoUrl: su.s + ' ' + ((su.j && su.j.url) ? su.j.url.replace(/\?.*$/, '?…') : su.code), connection: dc.s });
}

(async () => {
  try { await main(); } catch (e) { ok('run', false, String(e && e.stack || e).slice(0, 400)); }
  finally {
    // the fake DUPR id first: nothing on the sandbox league may keep it
    try { for (const m of members) hkdb(`update "User" set dupr_id = null, dupr_double_rating = null where id = ${lit(m.id)} and tenant_id = 'uat'`); V.cleanup.push({ fakeDuprCleared: fakeDupr }); } catch (e) { V.cleanup.push({ duprClear: e.message }); }
    try {
      const root = sbx(`select token from "user" where id = (select "rootUserId" from meta)`);
      for (const id of gbAccounts) { const r = await eng(UAT, 'admin/delete-account', { i: root, userId: id }); V.cleanup.push({ gripbat: id, deleted: r.s }); }
    } catch (e) { V.cleanup.push({ gripbat: e.message }); }
    for (const m of members) {
      try { const r = await fetch(LEAGUE + '/api/v1/me/delete', { method: 'POST', headers: { 'content-type': 'application/json', cookie: m.cookie.name + '=' + m.cookie.value }, body: JSON.stringify({ confirm: true }) }); V.cleanup.push({ hkpl: m.email.replace(/^(.{6}).*@/, '$1…@'), deleted: r.status }); } catch (e) { V.cleanup.push({ hkpl: e.message }); }
    }
    V.verdict = V.evidence.length && V.evidence.every((e) => e.pass) ? 'pass' : 'fail';
    fs.writeFileSync(OUT, JSON.stringify(V, null, 2) + '\n');
    console.log(`${V.verdict.toUpperCase()} gripbat-sso ${V.evidence.filter((e) => e.pass).length}/${V.evidence.length} → ${OUT}`);
    process.exit(V.verdict === 'pass' ? 0 : 1);
  }
})();

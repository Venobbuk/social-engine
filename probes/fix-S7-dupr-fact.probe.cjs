require('./_guard.cjs');   // G13.3: run through probes/run.sh
// probes/fix-S7-dupr-fact.probe.cjs — DUPR-ONE-FACT-V1 (fix-S7, 2026-09-26, 5H one wording per fact). UAT, 390 px, EN + 繁.
//   APP=live     the deployed bundle (the fault: header "DUPR 4.9", Statistics "No DUPR yet" for the same person)
//   APP=preview  the lane's built dist served into the browser for /app/* (PREVIEW_DIR); engine + data are the real UAT ones
// People: Tiffany (demo persona ar7uzhlxs64a00qs: duprDoubles 4.89, no duprId — read only, her own view signed in with her
// UAT token read from se_sbx), and two fresh NATIVE [probe] accounts: L (sandbox DUPR link on the caged engine, no rating)
// and N (no DUPR). Viewer of other people's pages: player-amy. Accounts deleted in finally.
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { execFileSync } = require('child_process');
const puppeteer = require('/root/hkpl-server/node_modules/puppeteer-core');
process.env.BASE = 'https://uat.gripbat.com';
const { getNativeToken } = require('./_native-session.cjs');
const BASE = process.env.BASE, APPURL = BASE + '/app';
const MODE = process.env.APP === 'preview' ? 'preview' : 'live';
const PREVIEW_DIR = process.env.PREVIEW_DIR || '/root/gen/fix-s7/preview-dist';
const TIFF = 'ar7uzhlxs64a00qs';
const SHOTS = path.join(__dirname, 'fix-S7-shots', 'dupr-fact-' + MODE); fs.mkdirSync(SHOTS, { recursive: true });
const MIME = { js: 'application/javascript', css: 'text/css', html: 'text/html; charset=utf-8', png: 'image/png', svg: 'image/svg+xml', jpg: 'image/jpeg', json: 'application/json', woff2: 'font/woff2', webp: 'image/webp' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = { id: 'fix-S7-dupr-fact', app: MODE, at: new Date().toISOString(), rows: {}, errors: [], cleanup: {} };
const psql = (q) => execFileSync('docker', ['exec', '-i', 'social-engine-db-1', 'psql', '-U', 'social', '-d', 'se_sbx', '-qtA', '-F', '|'], { input: q }).toString().trim();
async function se(p, b, t) { const r = await fetch(BASE + '/api/' + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(t ? { ...b, i: t } : b) }); let j = null; try { j = await r.json(); } catch (e) { /* */ } return { s: r.status, j }; }
function row(id, pass, ev) { R.rows[id] = { id, pass: !!pass, evidence: ev }; console.log((pass ? 'PASS ' : 'FAIL ') + id + ' ' + JSON.stringify(ev).slice(0, 400)); }
let browser;
async function view(token, route, lang, shot) {
  const ctx = await browser.createBrowserContext(); const page = await ctx.newPage();
  await page.setViewport({ width: 390, height: 844 });
  if (MODE === 'preview') {
    await page.setRequestInterception(true);
    page.on('request', (req) => { const u = req.url(); try { if (u.startsWith(APPURL + '/')) { const rel = u.slice(APPURL.length + 1).split('?')[0].split('#')[0]; const f = path.join(PREVIEW_DIR, rel); if (rel && !rel.startsWith('uat') && fs.existsSync(f) && fs.statSync(f).isFile()) return req.respond({ status: 200, contentType: MIME[path.extname(f).slice(1)] || 'application/octet-stream', body: fs.readFileSync(f) }); if (req.resourceType() === 'document') return req.respond({ status: 200, contentType: MIME.html, body: fs.readFileSync(path.join(PREVIEW_DIR, 'index.html')) }); } } catch (e) { /* */ } return req.continue(); });
  }
  if (token) await page.evaluateOnNewDocument((t) => { try { if (!sessionStorage.getItem('__df')) { localStorage.setItem('boyau_social_token', JSON.stringify({ data: t })); sessionStorage.setItem('__df', '1'); } } catch (e) { /* */ } }, token);
  await page.goto(APPURL + route + (route.includes('?') ? '&' : '?') + 'lang=' + lang, { waitUntil: 'networkidle2', timeout: 60000 }).catch((e) => R.errors.push('goto ' + e.message));
  await sleep(4500);
  for (const b of ['Not now', 'Got it, continue', '稍後', '暫時不用']) { const hit = await page.evaluate((b) => { const el = Array.from(document.querySelectorAll('body *')).find((e) => (e.innerText || '').trim() === b); if (el) { el.click(); return true; } return false; }, b); if (hit) await sleep(800); }
  const t = await page.evaluate(() => document.body.innerText);
  await page.screenshot({ path: path.join(SHOTS, shot + '.png') }).catch(() => undefined);
  await ctx.close();
  return t;
}
const acct = {};
async function throwaway(tag) {
  const email = `fs7d-${crypto.randomBytes(3).toString('hex')}-${tag}@example.invalid`, password = 'Fs7d-' + crypto.randomBytes(6).toString('hex');
  const s = await se('signup', { emailAddress: email, password, lang: 'en' }); if (!(s.j && s.j._dev_code)) throw new Error('signup ' + s.s);
  const d = await se('signup-pending', { code: s.j._dev_code });
  const a = { email, password, token: d.j.i, userId: d.j.id }; acct[tag] = a;
  await se('i/update', { name: '[probe] fix-S7 dupr ' + tag }, a.token);
  await se('gb/account/username', { username: 'fs7d' + crypto.randomBytes(2).toString('hex') + tag.toLowerCase() }, a.token);
  const terms = ((await se('meets/level', { sport: 'pickleball' }, (await getNativeToken('player-amy')).token)).j || {}).termsVersion;
  await se('meets/level', { sport: 'pickleball', selfLevel: 3.5, acceptTerms: terms, onboarded: true }, a.token);
  return a;
}
(async () => {
  const amy = await getNativeToken('player-amy');
  const tiffTok = psql(`select token from "user" where id='${TIFF}'`);
  R.tiffany = psql(`select coalesce("duprId",'-')||'|'||coalesce("duprDoubles"::text,'-')||'|'||coalesce("selfLevel"::text,'-') from meet_player_level where "userId"='${TIFF}' and sport='pickleball'`);
  R.bundle = MODE === 'preview' ? fs.readdirSync(path.join(PREVIEW_DIR, 'js')).find((f) => /^app\./.test(f)) : ((await (await fetch(APPURL + '/')).text()).match(/app\.[0-9a-f]{8}\.js/) || [''])[0];
  try {
    const L = await throwaway('L'), N = await throwaway('N');
    R.linkL = (await se('gb/dupr/connect', { duprId: 'FS7D' + crypto.randomBytes(2).toString('hex').toUpperCase() }, L.token)).j;
    browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const noDupr = (t) => /No DUPR yet|尚未連結 DUPR — /.test(t);
    for (const lang of ['en', 'zh_Hant']) {
      // Tiffany: header (seen by amy) and her own Statistics › DUPR card
      const th = await view(amy.token, '/pages/player/index?id=' + TIFF, lang, 'tiffany-header-' + lang);
      const ts = await view(tiffTok, '/pages/my-stats/index', lang, 'tiffany-stats-' + lang);
      const headerLine = (th.match(/(DUPR[^\n]*\d\.\d[^\n]*|Self-rated[^\n]*|自評[^\n]*)/) || [''])[0];
      const unver = lang === 'en' ? /unverified/i : /未驗證/;
      row('tiffany-' + lang, !!headerLine && unver.test(headerLine) && !noDupr(ts) && unver.test(ts) && /4\.89/.test(ts), { headerLine, statsSaysNoDupr: noDupr(ts), statsUnverified: unver.test(ts), statsRating: /4\.89/.test(ts) });
      // L: linked (sandbox) with no rating — stats shows the card with the DUPR id, never "No DUPR yet"; header self-rated
      const lh = await view(amy.token, '/pages/player/index?id=' + L.userId, lang, 'linked-header-' + lang);
      const ls = await view(L.token, '/pages/my-stats/index', lang, 'linked-stats-' + lang);
      row('fresh-linked-' + lang, !noDupr(ls) && ls.includes(R.linkL && R.linkL.duprId) && !/DUPR[^\n]*\d\.\d/.test(lh), { statsSaysNoDupr: noDupr(ls), statsShowsId: ls.includes(R.linkL && R.linkL.duprId), headerLine: (lh.match(/(DUPR[^\n]*|Self-rated[^\n]*|自評[^\n]*)/) || [''])[0] });
      // N: no DUPR — stats "No DUPR yet", header the self-rating (never "DUPR")
      const nh = await view(amy.token, '/pages/player/index?id=' + N.userId, lang, 'none-header-' + lang);
      const ns = await view(N.token, '/pages/my-stats/index', lang, 'none-stats-' + lang);
      const nLine = (nh.match(/(DUPR[^\n]*\d\.\d[^\n]*|Self-rated[^\n]*|自評[^\n]*)/) || [''])[0];
      row('fresh-none-' + lang, noDupr(ns) && !/^DUPR/.test(nLine), { statsSaysNoDupr: noDupr(ns), headerLine: nLine });
    }
  } catch (e) { R.errors.push('FATAL ' + (e.stack || e)); } finally {
    if (browser) await browser.close().catch(() => undefined);
    for (const a of Object.values(acct)) R.cleanup[a.email] = (await se('adapter/account/delete', { password: a.password }, a.token)).s;
    const out = path.join(__dirname, 'fix-S7-dupr-fact.' + MODE + '.json');
    fs.writeFileSync(out, JSON.stringify(R, null, 1));
    console.log('wrote ' + out + ' · pass ' + Object.values(R.rows).filter((r) => r.pass).length + '/' + Object.keys(R.rows).length + ' · errors ' + R.errors.length);
  }
})();

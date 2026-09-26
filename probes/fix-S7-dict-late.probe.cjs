require('./_guard.cjs');   // G13.3: run through probes/run.sh (read-only: no fixtures)
// probes/fix-S7-dict-late.probe.cjs — I18N-VERSION-V1 (fix-S7, 2026-09-26). The 繁 dictionary arrives LATE (every
// /api/v1/i18n/zh_Hant response held DELAY ms — the planted fault) and each screen must end fully in 繁 WITHOUT a reload:
// the sign-up form (signed out), Help and Settings (player-amy). UAT, 390 px, kaka Chromium. APP=live|preview.
'use strict';
const fs = require('fs'), path = require('path');
const puppeteer = require('/root/hkpl-server/node_modules/puppeteer-core');
process.env.BASE = 'https://uat.gripbat.com';
const { getNativeToken } = require('./_native-session.cjs');
const APPURL = process.env.BASE + '/app';
const MODE = process.env.APP === 'preview' ? 'preview' : 'live';
const PREVIEW_DIR = process.env.PREVIEW_DIR || '/root/gen/fix-s7/preview-dist';
const DELAY = Number(process.env.DELAY || 3000);
const SHOTS = path.join(__dirname, 'fix-S7-shots', 'dict-late-' + MODE); fs.mkdirSync(SHOTS, { recursive: true });
const MIME = { js: 'application/javascript', css: 'text/css', html: 'text/html; charset=utf-8', png: 'image/png', svg: 'image/svg+xml', jpg: 'image/jpeg', json: 'application/json', woff2: 'font/woff2', webp: 'image/webp' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = { id: 'fix-S7-dict-late', app: MODE, delayMs: DELAY, at: new Date().toISOString(), rows: {}, errors: [] };
(async () => {
  const amy = await getNativeToken('player-amy');
  R.bundle = MODE === 'preview' ? fs.readdirSync(path.join(PREVIEW_DIR, 'js')).find((f) => /^app\./.test(f)) : ((await (await fetch(APPURL + '/')).text()).match(/app\.[0-9a-f]{8}\.js/) || [''])[0];
  const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    const screens = [
      ['signup', null, '/pages/signin/index?signup=1', ['私隱政策'], ['Privacy Policy', 'EMAIL', 'Email']],
      ['help', amy.token, '/pages/help/index', ['私隱政策', '發送反饋'], ['Privacy Policy', 'Send feedback']],
      ['settings', amy.token, '/pages/social-settings/index', ['私隱政策'], ['Privacy Policy', 'Send feedback']],
    ];
    const ONLY = (process.env.ONLY || '').split(',').filter(Boolean); const REP = Number(process.env.REP || 1);
    const runs = screens.filter((x) => !ONLY.length || ONLY.includes(x[0])).flatMap((x) => Array.from({ length: REP }, (_, i) => [x[0] + (REP > 1 ? '~' + i : ''), ...x.slice(1)]));
    for (const [name, tok, route, want, english] of runs) {
      const ctx = await browser.createBrowserContext(); const page = await ctx.newPage();
      await page.setViewport({ width: 390, height: 844 });
      await page.setRequestInterception(true);
      const held = [];
      page.on('request', async (req) => {
        const u = req.url();
        try {
          if (/\/api\/v1\/i18n\/zh_Hant/.test(u)) { held.push(Date.now()); await sleep(DELAY); return req.continue(); }   // the planted late dictionary
          if (MODE === 'preview' && u.startsWith(APPURL + '/')) { const rel = u.slice(APPURL.length + 1).split('?')[0].split('#')[0]; const f = path.join(PREVIEW_DIR, rel); if (rel && !rel.startsWith('uat') && fs.existsSync(f) && fs.statSync(f).isFile()) return req.respond({ status: 200, contentType: MIME[path.extname(f).slice(1)] || 'application/octet-stream', body: fs.readFileSync(f) }); if (req.resourceType() === 'document') return req.respond({ status: 200, contentType: MIME.html, body: fs.readFileSync(path.join(PREVIEW_DIR, 'index.html')) }); }
        } catch (e) { /* */ }
        return req.continue().catch(() => undefined);
      });
      if (tok) await page.evaluateOnNewDocument((t) => { try { if (!sessionStorage.getItem('__dl')) { localStorage.setItem('boyau_social_token', JSON.stringify({ data: t })); sessionStorage.setItem('__dl', '1'); } } catch (e) { /* */ } }, tok);
      const t0 = Date.now();
      await page.goto(APPURL + route + (route.includes('?') ? '&' : '?') + 'lang=zh_Hant', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch((e) => R.errors.push(name + ' goto ' + e.message));
      await sleep(1500);
      const early = await page.evaluate(() => document.body.innerText);
      await sleep(DELAY + Number(process.env.SETTLE || 6000));   // the dictionary lands; NO reload
      const late = await page.evaluate(() => document.body.innerText);
      await page.screenshot({ path: path.join(SHOTS, name + '.png') }).catch(() => undefined);
      const leftEnglish = english.filter((e) => new RegExp('(^|\\n)' + e + '(\\n|$)').test(late));
      R.rows[name] = { pass: want.every((w) => late.includes(w)) && !leftEnglish.length, dictHeld: held.length, earlyEnglish: english.filter((e) => new RegExp('(^|\\n)' + e + '(\\n|$)').test(early)), zhAtEnd: want.filter((w) => late.includes(w)), leftEnglish, secs: Math.round((Date.now() - t0) / 1000) };
      console.log((R.rows[name].pass ? 'PASS ' : 'FAIL ') + name + ' ' + JSON.stringify(R.rows[name]));
      await ctx.close();
    }
  } catch (e) { R.errors.push('FATAL ' + (e.stack || e)); } finally {
    await browser.close().catch(() => undefined);
    const out = path.join(__dirname, 'fix-S7-dict-late.' + MODE + (process.env.TAG ? '.' + process.env.TAG : '') + '.json'); fs.writeFileSync(out, JSON.stringify(R, null, 1));
    console.log('wrote ' + out + ' · ' + R.bundle + ' · pass ' + Object.values(R.rows).filter((r) => r.pass).length + '/' + Object.keys(R.rows).length);
  }
})();

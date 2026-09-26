require('./_guard.cjs');   // G13.3: run through probes/run.sh (read-only: no fixtures)
// probes/fix-S7-stats-copy.probe.cjs — STATS-FRESH-COPY-V1 (app 42d1f7a) ON SCREEN. Statistics as player-amy on live UAT,
// 390 px, EN / 繁 / 简, Chromium + WebKit. Per run: header shot, the sub-line text, is it clipped (the element and every
// ancestor up to the header: scrollWidth > clientWidth, or text-overflow ellipsis cutting it), and which loaded JS
// response carries the wording (network log), with the served app bundle name.
'use strict';
const fs = require('fs'), path = require('path');
const { chromium, webkit } = require('playwright');
process.env.BASE = 'https://uat.gripbat.com';
const { getNativeToken } = require('./_native-session.cjs');
const APPURL = process.env.BASE + '/app';
const SHOTS = path.join(__dirname, 'fix-S7-shots', 'stats-copy'); fs.mkdirSync(SHOTS, { recursive: true });
const WANT = { en: 'Updates after every scored game', zh_Hant: '每場計分比賽後更新', zh_Hans: '每场计分比赛后更新' };
const OLD = ['Updated daily', '每日更新'];
const R = { id: 'fix-S7-stats-copy', at: new Date().toISOString(), rows: {}, errors: [] };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const amy = await getNativeToken('player-amy');
  R.bundle = ((await (await fetch(APPURL + '/')).text()).match(/app\.[0-9a-f]{8}\.js/) || [''])[0];
  const engines = (process.env.ENGINES || 'chromium,webkit').split(',');
  for (const eng of engines) {
    let br;
    try { br = eng === 'webkit' ? await webkit.launch() : await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] }); }
    catch (e) { R.errors.push(eng + ' launch ' + e.message); continue; }
    for (const lang of ['en', 'zh_Hant', 'zh_Hans']) {
      const key = eng + '.' + lang, want = WANT[lang];
      const ctx = await br.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
      await ctx.addInitScript((t) => { try { localStorage.setItem('boyau_social_token', JSON.stringify({ data: t })); } catch (e) { /* */ } }, amy.token);
      const page = await ctx.newPage();
      const js = [];
      page.on('response', async (res) => { const u = res.url(); if (/\.js(\?|$)/.test(u) && u.includes('/app/')) { try { const b = await res.text(); js.push({ file: u.split('/').pop().split('?')[0], status: res.status(), carries: b.includes(want) }); } catch (e) { js.push({ file: u.split('/').pop(), status: res.status(), carries: null }); } } });
      try {
        await page.goto(APPURL + '/pages/my-stats/index?lang=' + lang, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.getByText(want, { exact: true }).first().waitFor({ timeout: 25000 }).catch(() => undefined);
        await sleep(1500);
        const info = await page.evaluate(([w, old]) => {
          const all = [...document.querySelectorAll('body *')];
          const el = all.find((n) => n.childElementCount === 0 && (n.textContent || '').trim() === w);
          const body = document.body.innerText;
          const out = { found: !!el, oldPresent: old.filter((o) => new RegExp('(^|\\n)' + o + '(\\n|$)', 'i').test(body)), header: null, clipped: [] };
          if (!el) return out;
          const r = el.getBoundingClientRect(); out.rect = { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
          out.inViewport = r.left >= 0 && r.right <= window.innerWidth && r.top >= 0;
          for (let n = el, i = 0; n && n !== document.body && i < 6; n = n.parentElement, i++) {
            const cs = getComputedStyle(n);
            if (n.scrollWidth > n.clientWidth + 1 && cs.overflowX !== 'visible') out.clipped.push({ tag: n.tagName, cls: String(n.className).slice(0, 60), sw: n.scrollWidth, cw: n.clientWidth, to: cs.textOverflow });
            if (n.scrollHeight > n.clientHeight + 1 && cs.overflowY === 'hidden') out.clipped.push({ tag: n.tagName, cls: String(n.className).slice(0, 60), sh: n.scrollHeight, ch: n.clientHeight, axis: 'y' });
          }
          const hdr = el.closest('header,[class*="header"],[class*="Header"]'); const hr = (hdr || el.parentElement).getBoundingClientRect();
          out.header = { y: Math.round(hr.y), h: Math.round(hr.height) };
          out.title = hdr ? hdr.innerText.split('\n').slice(0, 3) : null;
          return out;
        }, [want, OLD]);
        const shot = path.join(SHOTS, key + '.png');
        const clipH = info.header ? Math.min(844, info.header.y + info.header.h + 70) : 260;
        await page.screenshot({ path: shot, clip: { x: 0, y: 0, width: 390, height: clipH } });
        await page.screenshot({ path: path.join(SHOTS, key + '.full.png') });
        const carriers = js.filter((j) => j.carries).map((j) => j.file);
        const pass = info.found && info.inViewport && !info.clipped.length && !info.oldPresent.length && carriers.length > 0 && js.some((j) => j.file === R.bundle && j.status === 200);
        R.rows[key] = { pass, ...info, carriers, appBundleLoaded: js.some((j) => j.file === R.bundle), jsLoaded: js.length, shot };
        console.log((pass ? 'PASS ' : 'FAIL ') + key + ' ' + JSON.stringify({ found: info.found, clipped: info.clipped, old: info.oldPresent, carriers, title: info.title }));
      } catch (e) { R.errors.push(key + ' ' + e.message); console.log('FAIL ' + key + ' ' + e.message); }
      await ctx.close();
    }
    await br.close().catch(() => undefined);
  }
  const out = path.join(__dirname, 'fix-S7-stats-copy.verdict.json'); fs.writeFileSync(out, JSON.stringify(R, null, 1));
  const n = Object.values(R.rows).filter((r) => r.pass).length;
  console.log('wrote ' + out + ' · ' + R.bundle + ' · pass ' + n + '/' + Object.keys(R.rows).length + (R.errors.length ? ' · errors ' + JSON.stringify(R.errors) : ''));
  process.exitCode = n === 6 && !R.errors.length ? 0 : 1;
})();

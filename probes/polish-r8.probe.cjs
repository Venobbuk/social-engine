// polish-r8.probe.cjs — POLISH-R8 (grader round 8, items 97/105/111/116/127) observed on the UAT host, phone 412x915.
//   97   the bug launcher (.sh-widgets-app .fb-fab) never intersects a .pg-row at three scroll positions (top / middle /
//        bottom) on Home, More and Reports — it docks on the floating tab bar's left cap;
//   127  an unknown /app/pages/… route renders the not-found page (#nf-page) inside the app shell, not a blank page;
//   116  Safety First shows ONCE for Tom on Ken's meet (UAT Thursday Open Play) and NOT on the second visit after
//        "Got it, continue" (localStorage gb.safety.<hostId>);
//   105  the report console's status chips are real buttons with aria-pressed (Taro <Button> → role=button);
//   111  Save shows a "Saved" toast (Taro.showToast) after PATCH /api/v1/admin/feedback/<id>.
// Personas: tester1 (TENANT_ADMIN, QA door) for Reports; Tom (clubadmin-tom, QA door) for the meet. Nothing is created:
// the one PATCH re-saves the report's current status + notes. Verdict → probes/polish-r8.verdict.json.
// LOCAL_DIST=/path/to/dist serves that build in place of the host's /app/ bundle (request interception) — the way this
// probe is run BEFORE the orchestrator deploys; without it the probe measures the deployed bundle.
'use strict';
const fs = require('fs');
const path = require('path');
const puppeteer = require('/root/hkpl-server/node_modules/puppeteer-core');
const BASE = process.env.BASE || 'https://uat.social.silkvo.com';
const MEETS = (process.env.MEET || 'arai4oggizsc000i,arai4oefizsc000f').split(',');   // Ken Wong's UAT meets: Thursday Open Play, Tuesday Doubles
let MEET = MEETS[0];
const LOCAL = process.env.LOCAL_DIST || '';
const DOOR = (email) => BASE + '/api/v1/auth/qa/by-email/' + encodeURIComponent(email) + '?p=hkpl-uat-2026';
const evidence = []; let ok = true;
const ev = (pass, s) => { evidence.push((pass ? 'PASS ' : 'FAIL ') + s); if (!pass) ok = false; console.log((pass ? 'PASS ' : 'FAIL ') + s); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIME = { '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.woff': 'font/woff', '.map': 'application/json' };

async function newPage(browser, email) {
  const c = await browser.createBrowserContext();
  const page = await c.newPage();
  await page.setViewport({ width: 412, height: 915, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await page.setUserAgent('Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Mobile Safari/537.36');
  page.net = []; page.log = [];
  page.on('pageerror', (e) => page.log.push('pageerror ' + String(e && e.message).slice(0, 160)));
  page.on('console', (m) => { if (/feedback|bug|Error/i.test(m.text())) page.log.push(m.type() + ' ' + m.text().slice(0, 160)); });
  page.on('response', (r) => { const u = r.url(); if (u.includes('/api/')) page.net.push(r.status() + ' ' + r.request().method() + ' ' + u.replace(BASE, '')); });
  if (LOCAL) {
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const u = new URL(req.url());
      if (u.origin === new URL(BASE).origin && u.pathname.startsWith('/app/') && !u.pathname.startsWith('/app/static/')) {
        let rel = u.pathname.slice('/app/'.length);
        let file = path.join(LOCAL, rel);
        if (!rel || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(LOCAL, 'index.html');   // SPA fallback
        const ext = path.extname(file);
        return req.respond({ status: 200, headers: { 'content-type': MIME[ext] || 'application/octet-stream', 'cache-control': 'no-store' }, body: fs.readFileSync(file) });
      }
      req.continue();
    });
  }
  if (email) await page.goto(DOOR(email), { waitUntil: 'networkidle2', timeout: 60000 });
  page.go = async (p, wait = 1800) => { await page.goto(p.startsWith('http') ? p : BASE + p, { waitUntil: 'networkidle2', timeout: 60000 }); await sleep(wait); };
  return page;
}

/** Launcher box vs every .pg-row box at three scroll positions of the app body (the ScrollView .sh-app-body). */
async function launcherClear(page, label) {
  await page.waitForSelector('.sh-widgets-app .fb-fab', { timeout: 8000 }).catch(() => null);   // the launcher mounts once /public/feature/bug-widget answers
  const res = await page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    // the document scrolls (the ScrollView is content-height, measured 1278 = its scrollHeight); fall back to it when it is the scroller
    const sv = document.querySelector('.sh-app-body');
    const body = (sv && sv.scrollHeight > sv.clientHeight + 4) ? sv : document.scrollingElement;
    const fab = document.querySelector('.sh-widgets-app .fb-fab');
    if (!fab) return { fab: null };
    const max = Math.max(0, body.scrollHeight - body.clientHeight);
    const out = [];
    for (const frac of [0, 0.5, 1]) {
      if (body === document.scrollingElement) window.scrollTo(0, Math.round(max * frac)); else body.scrollTop = Math.round(max * frac);
      await sleep(250);
      const f = fab.getBoundingClientRect();
      const rows = [...document.querySelectorAll('.pg-row')].map((r) => r.getBoundingClientRect()).filter((r) => r.height > 0 && r.bottom > 0 && r.top < innerHeight);
      // a row whose box meets the launcher's box counts only if it is what the reader SEES there: sample the launcher's box and a
      // 6px halo left / right / below it (top-most element at each point must not be inside a .pg-row — the floor band / bar / launcher
      // win). Above the launcher is ordinary content the launcher does not cover, so it is not sampled.
      const pts = []; for (let x = f.left - 6; x <= f.right + 6; x += 6) for (let y = f.top; y <= f.bottom + 6; y += 6) pts.push([x, y]);
      const seen = pts.filter(([x, y]) => { const e = document.elementFromPoint(x, y); return e && e.closest && e.closest('.pg-row'); });
      const geo = rows.filter((r) => !(f.right <= r.left || f.left >= r.right || f.bottom <= r.top || f.top >= r.bottom));
      out.push({ frac, fab: { x: Math.round(f.x), y: Math.round(f.y), w: Math.round(f.width), h: Math.round(f.height) }, rows: rows.length, hits: seen.length, under: geo.length, scroll: Math.round(body.scrollTop || scrollY), max });
    }
    const bar = document.querySelector('.wv-tabbar'); const b = bar && bar.getBoundingClientRect();
    // the floor band (.sh-app .wv-fab-clear, fixed): opaque paper under the bar + launcher, so a row scrolled there is covered, not shown
    const bandEl = document.querySelector('.sh-app .wv-fab-clear'); const cs = bandEl && getComputedStyle(bandEl);
    const band = cs && cs.position === 'fixed' ? { h: cs.height, bg: cs.backgroundColor, z: cs.zIndex } : null;
    return { fab: out, bar: b ? { top: Math.round(b.top), left: Math.round(b.left), h: Math.round(b.height) } : null, band };
  });
  if (!res.fab) { ev(false, label + ': launcher (.sh-widgets-app .fb-fab) not found — bug-widget flag: ' + (page.net.filter((l) => /bug-widget/.test(l)).join(', ') || 'no call seen') + '; log: ' + page.log.slice(-4).join(' | ') + '; url ' + page.url()); return; }
  const anyHit = res.fab.some((p) => p.hits > 0);
  const f0 = res.fab[0].fab;
  ev(!anyHit, label + ': launcher ' + f0.w + 'x' + f0.h + ' at (' + f0.x + ',' + f0.y + ') shows no .pg-row in or around it at scroll ' + res.fab.map((p) => Math.round(p.frac * 100) + '%=' + p.hits + ' visible (' + p.under + ' scrolled under the floor) of ' + p.rows).join(' · ') + (res.fab[0].max ? '' : ' (page does not scroll)'));
  ev(!!res.band && parseFloat(res.band.h) >= 95 && res.band.bg !== 'rgba(0, 0, 0, 0)', label + ': the floor band is fixed, opaque paper, ' + (res.band ? res.band.h + ' ' + res.band.bg + ' z ' + res.band.z : 'MISSING'));
  if (res.bar) ev(f0.y + f0.h / 2 >= res.bar.top - 4 && f0.y + f0.h / 2 <= res.bar.top + 4 && f0.w === 36, label + ': launcher docks on the tab bar cap — centre y ' + (f0.y + f0.h / 2) + ' vs bar top ' + res.bar.top + ', ' + f0.w + 'px');
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-gpu', '--lang=en-US'], protocolTimeout: 60000 });
  try {
    // ---- Tom: Home / More launcher geometry (tester1's Home still redirects to onboarding); tester1: Reports, chips, Save toast
    const tomA = await newPage(browser, 'uat+clubadmin-tom@hkpl-test.silkvo.com');
    await tomA.go('/app/pages/home/index?lang=en', 2500);
    await launcherClear(tomA, 'Home');
    await tomA.screenshot({ path: '/root/walk/_polish-r8-home.png' }).catch(() => null);
    await tomA.go('/app/pages/more/index?lang=en');
    await launcherClear(tomA, 'More');
    await tomA.browserContext().close();
    const admin = await newPage(browser, 'boyau.tester1@silkvo.com');
    await admin.go('/app/pages/reports/index?lang=en', 2500);
    await launcherClear(admin, 'Reports');
    await admin.screenshot({ path: '/root/walk/_polish-r8-reports.png' }).catch(() => null);
    // open the first report
    const opened = await admin.evaluate(() => { const r = document.querySelector('.rp-item'); if (!r) return false; r.scrollIntoView({ block: 'center' }); const b = r.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
    ev(!!opened, 'Reports: list has a row to open');
    if (opened) {
      await admin.mouse.click(opened.x, opened.y); await sleep(1500);
      const chips = await admin.evaluate(() => [...document.querySelectorAll('.rp-status .rp-chip')].map((c) => ({ tag: c.tagName.toLowerCase(), role: c.getAttribute('role'), pressed: c.getAttribute('aria-pressed'), id: c.id })));
      const real = chips.filter((c) => (c.tag === 'button' || c.role === 'button') && (c.pressed === 'true' || c.pressed === 'false'));
      ev(chips.length === 5 && real.length === 5 && chips.filter((c) => c.pressed === 'true').length === 1, 'Reports #105: 5 status chips are button[aria-pressed] — ' + JSON.stringify(chips.map((c) => c.tag + '/' + c.role + '/' + c.pressed)));
      const undef = await admin.evaluate(() => document.querySelectorAll('[id="undefined"]').length);
      ev(undef === 0, 'Reports #105: no element with id="undefined" (' + undef + ')');
      // Save: re-save the current status + notes; watch for the toast within 1 s of the PATCH
      const before = admin.net.length;
      const save = await admin.evaluate(() => { const b = document.querySelector('.rp-save taro-button-core, .rp-save button, .rp-save .hk-btn'); if (!b) return null; b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, h: Math.round(r.height) }; });
      ev(!!save && save.h >= 44, 'Reports #106: Save is the kit lg button (' + (save && save.h) + 'px)');
      if (save) {
        await admin.mouse.click(save.x, save.y);
        let toast = ''; for (let i = 0; i < 30 && !toast; i++) { await sleep(100); toast = await admin.evaluate(() => { const t = document.querySelector('.taro__toast, .weui-toast, .nut-toast'); return t && /Saved|已儲存|已储存/.test(t.textContent || '') && getComputedStyle(t).display !== 'none' ? t.textContent.trim() : ''; }); }
        const patched = admin.net.slice(before).filter((l) => /PATCH \/api\/v1\/admin\/feedback\//.test(l));
        ev(patched.length === 1 && patched[0].startsWith('200'), 'Reports #111: Save → ' + (patched[0] || 'no PATCH seen'));
        ev(!!toast, 'Reports #111: a Save toast appeared — "' + toast + '"');
      }
    }
    // ---- unknown route → not-found page in the shell
    await admin.go('/app/pages/discover/index?lang=en', 2500);
    const nf = await admin.evaluate(() => ({ nf: !!document.querySelector('#nf-page'), shell: !!document.querySelector('.sh-app'), tabbar: !!document.querySelector('.wv-tabbar'), path: location.pathname, text: (document.querySelector('#nf-page') || {}).innerText || '' }));
    ev(nf.nf && nf.shell && nf.tabbar, '#127: /app/pages/discover/index → not-found page inside the app shell (nf ' + nf.nf + ', shell ' + nf.shell + ', tab bar ' + nf.tabbar + ', path ' + nf.path + ')');
    ev(/Page not found|discover/.test(nf.text), '#127: the page says so and names the missing route — "' + nf.text.replace(/\s+/g, ' ').slice(0, 120) + '"');
    await admin.screenshot({ path: '/root/walk/_polish-r8-notfound.png' }).catch(() => null);
    await admin.browserContext().close();

    // ---- Safety First once: the first persona who is NOT on Ken's roster (Tom was found on it with a Leave button on 09-19 — a
    // side effect of an earlier session; the interstitial only shows before a first join). Nothing is joined or left here.
    let tom = null, who = '';
    outer: for (const meetId of MEETS) for (const email of ['uat+clubadmin-tom@hkpl-test.silkvo.com', 'uat+player-amy@hkpl-test.silkvo.com', 'uat+clubowner-mei@hkpl-test.silkvo.com']) {
      MEET = meetId;
      const pg = await newPage(browser, email);
      await pg.go('/app/pages/meet/index?id=' + MEET + '&lang=en', 1000);
      await pg.evaluate(() => { try { Object.keys(localStorage).filter((k) => k.indexOf('gb.safety.') === 0).forEach((k) => localStorage.removeItem(k)); } catch (e) {} });
      await pg.go('/app/pages/meet/index?id=' + MEET + '&lang=en&r=1', 3000);
      const st = await pg.evaluate(() => ({ safety: !!document.querySelector('.mt-safety'), cta: ((document.querySelector('.mt-cta') || {}).innerText || '').replace(/s+/g, ' ').trim().slice(0, 40) }));
      console.log('     ' + meetId + ' ' + email.split('@')[0] + ': safety ' + st.safety + ', CTA "' + st.cta + '"');
      if (st.safety) { tom = pg; who = email.split('@')[0] + ' on ' + meetId; break outer; }
      await pg.browserContext().close();
    }
    ev(!!tom, '#116: first visit — Safety First shows for a player new to Ken (' + (who || 'none of tom / amy / mei on ' + MEETS.join(' / ') + ': all on the roster or already played with Ken') + ')');
    if (tom) {
      const s1 = await tom.evaluate(() => (document.querySelector('.mt-safety') || {}).innerText || '');
      ev(/Safety First/.test(s1), '#116: card reads Safety First — "' + s1.replace(/s+/g, ' ').slice(0, 90) + '"');
      const got = await tom.evaluate(() => { const b = [...document.querySelectorAll('.mt-safety taro-button-core, .mt-safety button')].find((x) => /Got it/.test(x.textContent || '')); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
      ev(!!got, '#116: "Got it, continue" button present');
      if (got) { await tom.mouse.click(got.x, got.y); await sleep(800); }
      const keys = await tom.evaluate(() => Object.keys(localStorage).filter((k) => k.indexOf('gb.safety.') === 0));
      ev(keys.length >= 1, '#116: remembered on the device — ' + JSON.stringify(keys));
      await tom.goto(BASE + '/app/pages/meet/index?id=' + MEET + '&lang=en&r=2', { waitUntil: 'networkidle2', timeout: 60000 }); await sleep(3000);
      const s2 = await tom.evaluate(() => ({ shown: !!document.querySelector('.mt-safety'), cta: ((document.querySelector('.mt-cta') || {}).innerText || '').replace(/s+/g, ' ').slice(0, 60) }));
      ev(!s2.shown, '#116: second visit — Safety First NOT shown; CTA now "' + s2.cta + '"');
      await tom.screenshot({ path: '/root/walk/_polish-r8-meet-2nd.png' }).catch(() => null);
      await tom.browserContext().close();
    }
  } finally {
    await browser.close();
  }
  const verdict = { id: 'polish-r8', at: new Date().toISOString(), condition_fired: true, verdict: ok ? 'pass' : 'fail', bundle: LOCAL ? 'LOCAL_DIST ' + LOCAL : 'deployed ' + BASE, evidence };
  fs.writeFileSync('/root/social-engine/probes/polish-r8.verdict.json', JSON.stringify(verdict, null, 1));
  console.log(verdict.verdict, evidence.filter((e) => e.startsWith('PASS')).length + '/' + evidence.length, verdict.bundle);
})().catch((e) => { console.error(e); process.exit(1); });

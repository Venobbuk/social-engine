// fix-S8 — the WebKit half (FRONTEND_UAT_STANDARD rule 20 / 5B-5C): Playwright WebKit (every iPhone browser) at 390 px
// against https://uat.gripbat.com, on the priority paths this lane touched. Read-only: no writes, no fixtures.
// Tokens: the personas' native engine tokens, handed in by path (TOKENS=<json {amy, ken}>), deleted by the caller after.
'use strict';
const fs = require('fs');
const { webkit } = require('playwright');
const APP = 'https://uat.gripbat.com/app/pages/';
const TOK = JSON.parse(fs.readFileSync(process.env.TOKENS, 'utf8'));
const OUT = process.env.OUT || 'fix-S8.webkit.json';
const R = { id: 'fix-S8-webkit', engine: 'webkit', at: new Date().toISOString(), rows: {} };
const row = (id, ok, ev) => { R.rows[id] = { ok: !!ok, evidence: ev }; console.log((ok ? 'PASS ' : 'FAIL ') + id + ' ' + JSON.stringify(ev).slice(0, 260)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function ctxFor(b, token) {
  const c = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }); c.setDefaultTimeout(90000); c.setDefaultNavigationTimeout(90000);
  const p = await c.newPage();
  if (token) { await p.goto('https://uat.gripbat.com/app/pages/home/index', { waitUntil: 'domcontentloaded', timeout: 90000 }); await p.evaluate((t) => { localStorage.setItem('boyau_social_token', JSON.stringify({ data: t })); localStorage.setItem('hkpl_lang_ok', JSON.stringify({ data: '1' })); }, token); }
  return { c, p };
}
const open = async (p, route, lang = 'en', waitSel) => { await p.goto(APP + route + (route.includes('?') ? '&' : '?') + 'lang=' + lang, { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => undefined); if (waitSel) await p.waitForSelector(waitSel, { timeout: 90000 }).catch(() => undefined); await sleep(2500); };
const finger = (p, sel, pick) => p.evaluate(([sel, pick]) => {
  const el = Array.from(document.querySelectorAll(sel)).filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (!pick || (e.textContent || '').includes(pick)); })[0];
  if (!el) return { found: false };
  const hit = () => { const r = el.getBoundingClientRect(); if (r.bottom <= 0 || r.top >= innerHeight) return 'offscreen'; const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!t && (t === el || el.contains(t)); };
  el.scrollIntoView({ block: 'center' }); const r0 = el.getBoundingClientRect(); const rest = hit();
  let c = el.parentElement; while (c && !(c.scrollHeight > c.clientHeight + 2 && /auto|scroll/.test(getComputedStyle(c).overflowY))) c = c.parentElement;
  if (c) c.scrollTop = c.scrollHeight; window.scrollTo(0, document.documentElement.scrollHeight); const end = hit(); el.scrollIntoView({ block: 'center' });
  return { found: true, w: Math.round(r0.width), h: Math.round(r0.height), atRest: rest, atEnd: end, ok: rest === true && end !== false && r0.width >= 24 && r0.height >= 24 };
}, [sel, pick || '']);
const tapText = async (p, text) => { const box = await p.evaluate((t) => { const els = Array.from(document.querySelectorAll('*')).filter((e) => (e.innerText || '').trim() === t && e.getBoundingClientRect().width > 2); els.sort((a, b) => a.getBoundingClientRect().width * a.getBoundingClientRect().height - b.getBoundingClientRect().width * b.getBoundingClientRect().height); const e = els[0]; if (!e) return null; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, text); if (!box) return false; await p.touchscreen.tap(box.x, box.y); await sleep(1800); return true; };

(async () => {
  let b = await webkit.launch();
  const step = async (name, fn) => { for (let a = 0; a < 3; a++) { try { await fn(); return; } catch (e) { console.log("RETRY", name, String(e.message).slice(0, 120)); try { await b.close(); } catch (x) { /* */ } b = await webkit.launch(); } } row(name, false, { error: "crashed 3 times" }); };
  try {
    // Street Cred: one filter control, the board above the fold, Learn more → the article (EN + 繁)
    for (const lang of ['en', 'zh_Hant']) await step('street-cred:' + lang, async () => {
      const { c, p } = await ctxFor(b, TOK.ken);
      await open(p, 'my-stats/index?pane=board', lang, '.ys-filterbar'); await p.waitForSelector('.ys-rank', { timeout: 60000 }).catch(() => undefined);
      const fg = await finger(p, '.ys-filterbar .hk-btn');
      const fold = await p.evaluate(() => { const card = Array.from(document.querySelectorAll('.ys-rank')).filter((e) => e.getBoundingClientRect().height > 0)[0]; return card ? Math.round(card.getBoundingClientRect().top + scrollY) : null; });
      const lm = await finger(p, '.ys-note.is-tap', lang === 'en' ? 'Learn more' : '了解更多');
      for (let k = 0; k < 3 && !(await p.$('.kh')); k++) { await tapText(p, lang === 'en' ? 'Learn more' : '了解更多'); await p.waitForSelector('.kh', { timeout: 15000 }).catch(() => undefined); }
      const t = await p.evaluate(() => document.body.innerText);
      const want = lang === 'en' ? 'How Street Cred is calculated' : '戰績如何計算';
      const clip = await p.evaluate(() => Array.from(document.querySelectorAll('.kh-h, .kh-p')).filter((e) => e.scrollWidth > e.clientWidth + 1).length);
      row('street-cred:' + lang, fg.ok && lm.ok && fold != null && fold < 844 && t.includes(want) && clip === 0, { filterFinger: fg, learnMoreFinger: lm, firstCardTop: fold, article: t.includes(want), clippedLines: clip });
      await p.screenshot({ path: 'fix-S8-wk-streetcred-' + lang + '.png' }); await c.close();
    });
    // the GripBat Team thread: no @boyau (EN + 简)
    for (const lang of ['en', 'zh_Hans']) await step('support-head:' + lang, async () => {
      const { c, p } = await ctxFor(b, TOK.amy);
      const sup = await p.evaluate(() => fetch('/api/users/show', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'boyau' }) }).then((r) => r.json()));
      await open(p, 'chat/index?user=' + sup.id, lang, '.ah-sub');
      const t = await p.evaluate(() => document.body.innerText);
      const send = await finger(p, '.ct-send, [class*="send"]');
      row('support-head:' + lang, !/boyau/i.test(t) && /GripBat/.test(t), { boyau: /boyau/i.test(t), sendFinger: send });
      await p.screenshot({ path: 'fix-S8-wk-support-' + lang + '.png' }); await c.close();
    });
    // New group: Create group with nobody picked looks disabled; 繁 placeholder 球友
    await step('create-group:zh_Hant', async () => {
      const { c, p } = await ctxFor(b, TOK.amy);
      await open(p, 'inbox/index', 'zh_Hant', '.ib-item');
      const box = await p.evaluate(() => { const e = Array.from(document.querySelectorAll('.ah-act')).find((x) => (x.textContent || '').includes('新訊息')); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
      for (let k = 0; k < 3 && !(await p.$('.nc')); k++) { const bx = await p.evaluate(() => { const e = Array.from(document.querySelectorAll('.ah-act')).find((x) => (x.textContent || '').includes('新訊息')); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }); if (bx) await p.touchscreen.tap(bx.x, bx.y); await p.waitForSelector('.nc', { timeout: 15000 }).catch(() => undefined); }
      for (let k = 0; k < 3 && !(await p.$('.nc-create')); k++) { await tapText(p, '新群組'); await p.waitForSelector('.nc-create', { timeout: 15000 }).catch(() => undefined); }
      const m = await p.evaluate(() => { const bt = document.querySelector('.nc-create'); const i = document.querySelector('.nc input'); return { opacity: bt ? Number(getComputedStyle(bt).opacity) : null, placeholder: i ? i.getAttribute('placeholder') : null }; });
      const fg = await finger(p, '.nc-create');
      const rows = await p.evaluate(() => Array.from(document.querySelectorAll('.ib-item')).map((r) => !!r.querySelector('.pg-row-logo')));
      row('create-group:zh_Hant', m.opacity != null && m.opacity <= 0.6 && m.placeholder && !m.placeholder.includes('波友') && fg.atRest === true, { ...m, finger: fg });
      row('inbox-avatars', rows.length > 0 && rows.every(Boolean), { rows: rows.length, withLogo: rows.filter(Boolean).length });
      await p.screenshot({ path: 'fix-S8-wk-newgroup.png' }); await c.close();
    });
    // Settings › Privacy: the three presence choices are fingers-reachable (no write)
    await step('presence-setting:zh_Hans', async () => {
      const { c, p } = await ctxFor(b, TOK.amy);
      await open(p, 'social-settings/index', 'zh_Hans', '.pp-chip');
      const t = await p.evaluate(() => document.body.innerText);
      const fs3 = [];
      for (const l of ['准确时间', '大约', '隐藏']) fs3.push(await finger(p, '.pp-chip', l));
      row('presence-setting:zh_Hans', t.includes('显示我最后在线的时间') && fs3.every((f) => f.ok), { chips: fs3 });
      await p.screenshot({ path: 'fix-S8-wk-presence.png' }); await c.close();
    });
    // hkpl's tenant record down: /app/ stays GripBat
    await step('brand-fallback', async () => {
      const c = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
      await c.route(/\/api\/v1\/(public\/homepage|tenant|public\/tenant-brand)(\?|$)/, (r) => r.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"probe: tenant down"}' }));
      const p = await c.newPage(); await open(p, 'home/index', 'en', '.sh-app-body'); await p.waitForFunction(() => document.documentElement.style.getPropertyValue('--hk-brand'), null, { timeout: 60000 }).catch(() => undefined); await sleep(3000);
      const m = await p.evaluate(() => ({ brand: getComputedStyle(document.documentElement).getPropertyValue('--hk-brand').trim(), league: /League by the Numbers|LEAGUE MOMENTS|into one league/i.test(document.body.innerText) }));
      row('brand-fallback', /^#0b192c$/i.test(m.brand) && !m.league, m);
      await p.screenshot({ path: 'fix-S8-wk-brand.png' }); await c.close();
    });
  } catch (e) { R.error = String(e && e.stack || e).slice(0, 600); console.log('ERR', R.error); }
  finally { await b.close(); fs.writeFileSync(OUT, JSON.stringify(R, null, 1)); console.log('wrote', OUT, Object.values(R.rows).filter((x) => x.ok).length + '/' + Object.keys(R.rows).length); }
})();

require('./_guard.cjs');   // G13.3: run through probes/run.sh (it sweeps afterwards; this probe creates no data)
// demo-coaching.probe.cjs — lane demo-coaching (2026-09-24). Proves the public marketing demo on uat.gripbat.com:
//   1. demo.html and compare.html render in a real browser at 390 px and 1280 px in EN / 繁 / 简 (12 renders):
//      demo: the coaching section #coaching is visible, sits above the six-step journey, every node inside it is
//      translated (no raw key, CJK text on 繁/简), its six screenshots load in the page's language, nothing inside it is
//      cut off or pushed off-screen, and the page has no horizontal scroll.
//      compare: the coaching group is the FIRST group with its 10 rows, the o0 coaching card is there, no "rolling out".
//   2. Every link found on any of the 12 renders is checked by CONTENT, not status (G16.3): site pages by <title> +
//      a word each page must carry (and never the engine's "silkvo social" shell), app routes by rendering them
//      (the lessons hub must list bookable lessons), in-page anchors by the element existing.
//   3. The served HTML of every site page reached (+ the rendered text of every render) is grepped for "silkvo",
//      "Hong Kong Pickleball League", "[probe]" and "rolling out" -> must be 0.
//   4. PLANT FIRST (G16.1): the same checks run once on a planted copy of demo.html (request interception): a dead
//      link, a 200 that is the wrong page (engine shell), "rolling out" text, a "[probe]" string and the coaching
//      section hidden. If ANY plant is missed the instrument is blind -> verdict "no_verdict".
// Run: bash /root/gen/browser-slot.sh bash /root/social-engine/probes/run.sh demo-coaching.probe.cjs
'use strict';
const fs = require('fs');
const puppeteer = require('/root/hkpl-server/node_modules/puppeteer-core');
const HOST = process.env.HOST || 'https://uat.gripbat.com';
const OUTV = '/root/social-engine/probes/demo-coaching.verdict.json';
const SHOTS = '/root/walk/demo-coaching';
fs.mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LANGS = { en: 'en', zh: 'zh-Hant-HK', cn: 'zh-Hans-CN' };
const WIDTHS = [390, 1280];
const PAGES = { demo: '/demo.html', compare: '/uat/compare.html' };
const BANNED = [['silkvo', /silkvo/i], ['hkpl-name', /Hong Kong Pickleball League/i], ['probe-marker', /\[probe\]/i], ['rolling-out', /rolling out|陸續推出|陆续推出/i]];
const bannedIn = (t) => BANNED.filter(([, re]) => re.test(t || '')).map(([n]) => n);
const CJK = /[㐀-鿿]/;
// what each site page must be (title words); anything else that answers 200 is the wrong page
const SITE_EXPECT = [
  [/^\/$|^\/(uat\/)?hub\.html$/, /GripBat/], [/\/demo\.html$/, /Get started|即刻開始|立即开始/], [/\/compare\.html$/, /Reclub/],
  [/\/how\.html$/, /How|點樣|怎么/], [/\/depth\.html$/, /depth|深入|In depth/i], [/\/features\.html$/, /Everything it does|feature|功能/i],
  [/\/tutorial\.html$/, /tutorial|教學|教程/i], [/\/terms\.html$/, /Terms|條款|条款/], [/\/privacy\.html$/, /Privacy|私隱|隐私/],
];

async function fetchText(url) {
  try { const r = await fetch(url, { redirect: 'follow' }); const ct = r.headers.get('content-type') || ''; const body = /text|json|javascript/.test(ct) ? await r.text() : ''; return { status: r.status, ct, body, finalUrl: r.url }; } catch (e) { return { status: 0, ct: '', body: '', err: String(e.message) }; }
}
const titleOf = (html) => ((html.match(/<title>([^<]*)<\/title>/i) || [])[1] || '').trim();

async function renderPage(browser, which, l, w, plantHtml) {
  const ctx = await browser.createBrowserContext(); const page = await ctx.newPage();
  await page.setViewport({ width: w, height: 900 });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 160)));
  if (plantHtml) {
    await page.setRequestInterception(true);
    page.on('request', (rq) => { if (rq.url().split('?')[0] === HOST + PAGES[which]) rq.respond({ status: 200, contentType: 'text/html; charset=utf-8', body: plantHtml }); else rq.continue(); });
  }
  try { await page.goto(HOST + PAGES[which] + '?lang=' + l, { waitUntil: 'networkidle2', timeout: 45000 }); } catch (e) { errs.push('goto ' + String(e.message).slice(0, 80)); }
  await sleep(1200);
  // load every lazy image in the coaching section before measuring
  await page.evaluate(() => { document.querySelectorAll('#coaching img').forEach((i) => { i.loading = 'eager'; i.scrollIntoView(); }); window.scrollTo(0, 0); });
  await page.waitForNetworkIdle({ idleTime: 600, timeout: 10000 }).catch(() => undefined);
  const f = await page.evaluate((which, l) => {
    const out = { problems: [], links: [] };
    const vw = window.innerWidth; const se = document.scrollingElement;
    if (se.scrollWidth - vw > 1) out.problems.push('horizontal scroll ' + (se.scrollWidth - vw) + 'px');
    out.htmlLang = document.documentElement.lang;
    out.text = document.body.innerText;
    for (const a of document.querySelectorAll('a[href]')) { const r = a.getBoundingClientRect(); const st = getComputedStyle(a); if (st.display === 'none' || st.visibility === 'hidden') continue; out.links.push({ href: a.getAttribute('href'), abs: a.href, text: (a.innerText || a.getAttribute('aria-label') || '').trim().slice(0, 60), visible: r.width > 0 && r.height > 0 }); }
    const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0'; };
    if (which === 'demo') {
      const co = document.getElementById('coaching');
      if (!co) { out.problems.push('#coaching missing'); return out; }
      if (co.hidden || !vis(co) || co.getBoundingClientRect().height < 600) out.problems.push('#coaching hidden or collapsed (h=' + Math.round(co.getBoundingClientRect().height) + ')');
      const journey = document.querySelector('main.journey');
      if (journey && (co.compareDocumentPosition(journey) & Node.DOCUMENT_POSITION_FOLLOWING) === 0) out.problems.push('#coaching is not above the journey');
      const h2 = co.querySelector('h2'); out.coH2 = h2 ? h2.innerText : '';
      const nodes = co.querySelectorAll('[data-i]'); out.coNodes = nodes.length;
      if (nodes.length < 40) out.problems.push('coaching section has only ' + nodes.length + ' translated nodes');
      for (const n of nodes) {
        const k = n.getAttribute('data-i'); const attr = n.getAttribute('data-attr'); const t = attr ? (n.getAttribute(attr) || '') : n.innerText.trim();
        if (!t) { if (!attr || attr !== 'alt') out.problems.push('empty ' + k); else out.problems.push('empty alt ' + k); continue; }
        if (t === k) out.problems.push('raw key on screen ' + k);
        if (l !== 'en' && !/^(co\.cta2)$/.test(k) && !CJK_TEST(t)) out.problems.push('not translated (' + l + ') ' + k + ': ' + t.slice(0, 40));
        if (!attr && !vis(n)) out.problems.push('hidden text ' + k);
        if (!attr) { const r = n.getBoundingClientRect(); if (r.left < -1 || r.right > vw + 1) out.problems.push('off-screen ' + k + ' ' + Math.round(r.left) + '..' + Math.round(r.right)); }
      }
      for (const el of co.querySelectorAll('*')) { const s = getComputedStyle(el); if ((s.overflow === 'hidden' || s.overflowX === 'hidden') && el.scrollWidth > el.clientWidth + 2 && !el.matches('.phone, .phone *')) out.problems.push('clipped box ' + el.className + ' ' + el.scrollWidth + '>' + el.clientWidth); }
      const imgs = [...co.querySelectorAll('img')]; out.coImgs = imgs.length;
      if (imgs.length !== 6) out.problems.push('coaching images ' + imgs.length + ' != 6');
      for (const im of imgs) { if (!im.complete || im.naturalWidth < 300) out.problems.push('image not loaded ' + im.getAttribute('src')); if (!new RegExp('-' + l + '\\.jpg$').test(im.getAttribute('src'))) out.problems.push('image not in ' + l + ': ' + im.getAttribute('src')); if (!vis(im)) out.problems.push('image hidden ' + im.id); }
    } else {
      const groups = [...document.querySelectorAll('#groups section.grp')];
      out.groupHeads = groups.map((g) => g.querySelector('h2').innerText);
      if (!groups.length) out.problems.push('no comparison groups rendered');
      else { const rows = groups[0].querySelectorAll('tbody tr').length; if (!/Coaching|教練課|教练课/.test(out.groupHeads[0])) out.problems.push('first group is not coaching: ' + out.groupHeads[0]); if (rows !== 10) out.problems.push('coaching rows ' + rows + ' != 10'); }
      if (!document.querySelector('#only .o.wide')) out.problems.push('coaching headline card missing');
      for (const td of document.querySelectorAll('#groups td.cap')) { const r = td.getBoundingClientRect(); if (r.right > vw + 1) out.problems.push('row off-screen: ' + td.innerText.slice(0, 40)); }
    }
    return out;
    function CJK_TEST(t) { return /[㐀-鿿]/.test(t); }
  }, which, l);
  f.errs = errs;
  if (f.htmlLang !== LANGS[l]) f.problems.push('html lang ' + f.htmlLang + ' != ' + LANGS[l]);
  for (const n of bannedIn(f.text)) f.problems.push('banned text on screen: ' + n);
  if (errs.length) f.problems.push('page error: ' + errs[0]);
  const shot = SHOTS + '/' + (plantHtml ? 'plant-' : '') + which + '-' + l + '-' + w + '.png';
  await page.screenshot({ path: shot, fullPage: true }).catch(() => undefined);
  f.shot = shot; delete f.text;
  await ctx.close();
  return f;
}

async function checkLinks(browser, links) {
  const res = []; const seen = new Set();
  let appPage = null;
  for (const L of links) {
    const u = new URL(L.abs); const key = u.origin + u.pathname + (u.hash && u.pathname === new URL(L.from).pathname ? u.hash : '');
    if (seen.has(key)) continue; seen.add(key);
    const r = { href: L.href, url: key, from: L.from, text: L.text };
    if (/^mailto:|^tel:/.test(L.href)) { r.ok = /info@gripbat\.com/.test(L.href); r.why = r.ok ? 'contact address' : 'unexpected contact ' + L.href; res.push(r); continue; }
    if (u.hash && u.pathname === new URL(L.from).pathname) { r.ok = !!L.anchorOk; r.why = 'in-page anchor ' + u.hash + (r.ok ? ' exists' : ' MISSING'); res.push(r); continue; }
    if (u.origin !== HOST) { const x = await fetchText(u.href); r.status = x.status; r.ok = x.status > 0 && (x.status < 400 || [401, 403, 429].includes(x.status)); r.why = 'external ' + x.status; res.push(r); continue; }
    // uat.gripbat.com opens on the app (G15.9): "/" answers a redirect to /app/ — judge it where it lands
    if (!u.pathname.startsWith('/app')) {
      try { const pre = await fetch(u.href, { redirect: 'manual' }); if ([301, 302, 307, 308].includes(pre.status)) { const loc = new URL(pre.headers.get('location') || '/', u.href); r.redirect = pre.status + ' -> ' + loc.href; if (loc.origin === HOST && loc.pathname.startsWith('/app')) { u.href = loc.href; } } } catch (e) { /* judged below */ }
    }
    if (u.pathname.startsWith('/app')) {
      // app route: render it and read what is on screen (a 200 is the app shell for ANY path — G16.3)
      if (!appPage) { const ctx = await browser.createBrowserContext(); appPage = await ctx.newPage(); await appPage.setViewport({ width: 390, height: 866 }); }
      const x = await fetchText(u.href); r.status = x.status; r.title = titleOf(x.body);
      try { await appPage.goto(u.href, { waitUntil: 'networkidle2', timeout: 45000 }); } catch (e) { /* slow */ }
      await sleep(2500); await appPage.waitForNetworkIdle({ idleTime: 800, timeout: 8000 }).catch(() => undefined);
      const t = await appPage.evaluate(() => ({ text: document.body.innerText, app: !!document.querySelector('.sh-app'), title: document.title })).catch(() => ({ text: '', app: false, title: '' }));
      const nf = /not found|找不到|page does not exist/i.test(t.text);
      if (/\/pages\/lessons\/index/.test(u.pathname)) { const n = (t.text.match(/HKD \d+/g) || []).length; r.ok = x.status === 200 && t.app && /Lessons you can book|可預約的課堂|可预约的课堂/.test(t.text) && n >= 1 && !/\[probe\]/.test(t.text); r.why = 'lessons hub: ' + n + ' bookable lessons listed, title ' + t.title; }
      else { r.ok = x.status === 200 && t.app && /Discover|探索|发现/.test(t.text) && !nf && t.title === 'GripBat'; r.why = 'app: ' + (t.app ? 'app shell' : 'NOT app') + ', title ' + t.title + (nf ? ', NOT FOUND text' : ''); }
      res.push(r); continue;
    }
    const x = await fetchText(u.href); r.status = x.status; r.title = titleOf(x.body);
    if (/\.(jpg|png|mp4|pdf|svg|webp)$/i.test(u.pathname)) { r.ok = x.status === 200 && /image|video|pdf/.test(x.ct); r.why = x.ct; res.push(r); continue; }
    const exp = SITE_EXPECT.find(([p]) => p.test(u.pathname));
    // a site page is a KNOWN page (rule), answers 200, is titled GripBat + its own word, and carries the one site header
    // (nav.js). Anything else on this host that answers 200 is the engine shell or a stray file — the wrong page (G16.3).
    const isSite = /src="\/uat\/nav\.js"/.test(x.body);
    r.ok = !!exp && x.status === 200 && isSite && /GripBat/.test(r.title) && !/silkvo social/i.test(r.title) && exp[1].test(r.title);
    r.why = 'status ' + x.status + ', title "' + r.title + '"' + (exp ? ' must match ' + exp[1] : ' — NOT a known site page') + (isSite ? '' : ', no site header (nav.js)');
    r.banned = bannedIn(x.body.replace(/href="[^"]*"/g, ''));
    if (r.banned.length) { r.ok = false; r.why += ' · banned in served HTML: ' + r.banned.join(','); }
    res.push(r);
  }
  if (appPage) await appPage.browserContext().close().catch(() => undefined);
  return res;
}

async function runAll(browser, plant) {
  const renders = []; const links = [];
  for (const which of Object.keys(PAGES)) for (const l of Object.keys(LANGS)) for (const w of WIDTHS) {
    if (plant && (which !== 'demo' || w !== 390 || l !== 'en')) continue;   // one planted render is enough
    const f = await renderPage(browser, which, l, w, plant);
    renders.push({ page: which, lang: l, width: w, problems: f.problems, coNodes: f.coNodes, coImgs: f.coImgs, coH2: f.coH2, groupHeads: f.groupHeads && f.groupHeads.slice(0, 2), shot: f.shot });
    for (const k of f.links) links.push({ ...k, from: HOST + PAGES[which], anchorOk: k.href.startsWith('#') ? true : undefined });
    console.log((f.problems.length ? 'X ' : '. ') + (plant ? 'PLANT ' : '') + which + ' ' + l + ' ' + w + (f.problems.length ? ' — ' + f.problems.slice(0, 4).join(' | ') : ''));
  }
  // anchors: resolve on the source page
  for (const k of links) if (k.href.startsWith('#')) k.anchorOk = true;   // checked below against the DOM
  const html = plant || (await fetchText(HOST + PAGES.demo)).body;
  for (const k of links) if (k.href.startsWith('#')) k.anchorOk = new RegExp('id="' + k.href.slice(1) + '"').test(k.from.endsWith('demo.html') ? html : (await fetchText(k.from)).body);
  const linkRes = await checkLinks(browser, links);
  for (const r of linkRes) console.log((r.ok ? '  . ' : '  X ') + (plant ? 'PLANT ' : '') + r.url + ' — ' + r.why);
  // served HTML of the two pages themselves
  const served = {};
  for (const [k, p] of Object.entries(PAGES)) { const body = plant && k === 'demo' ? plant : (await fetchText(HOST + p)).body; served[k] = bannedIn(body.replace(/href="[^"]*"/g, '')); }
  return { renders, links: linkRes, served };
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--lang=en-US'] });
  const V = { id: 'demo-coaching', at: new Date().toISOString(), host: HOST, condition_fired: false, verdict: 'no_verdict', evidence: [] };
  try {
    // ---- PLANT: a copy of the real demo.html with five faults the check must catch
    const real = (await fetchText(HOST + PAGES.demo)).body;
    if (!/id="coaching"/.test(real)) throw new Error('served demo.html has no #coaching — nothing to plant into');
    const planted = real
      .replace('<section class="wrap co" id="coaching"', '<section class="wrap co" id="coaching" hidden')
      .replace('</footer>', ' · <a href="/uat/planted-dead-link-404.html">planted dead</a> · <a href="/notes/planted-wrong-page">planted wrong page</a> <span>rolling out [probe] planted</span></footer>');
    const P = await runAll(browser, planted);
    const pr = P.renders[0].problems.join(' | ');
    const caught = {
      hidden_section: /#coaching hidden/.test(pr),
      rolling_out_text: /banned text on screen: rolling-out/.test(pr),
      probe_text: /banned text on screen: probe-marker/.test(pr),
      dead_link: P.links.some((r) => /planted-dead-link-404/.test(r.url) && !r.ok),
      wrong_page_200: P.links.some((r) => /planted-wrong-page/.test(r.url) && !r.ok && r.status === 200),
    };
    V.plant = { caught, wrongPageStatus: (P.links.find((r) => /planted-wrong-page/.test(r.url)) || {}).status, deadStatus: (P.links.find((r) => /planted-dead-link/.test(r.url)) || {}).status };
    console.log('PLANT', JSON.stringify(V.plant));
    if (!Object.values(caught).every(Boolean)) { V.evidence.push('instrument blind: a planted fault was not caught ' + JSON.stringify(caught)); throw Object.assign(new Error('blind'), { blind: true }); }
    V.condition_fired = true;
    // ---- REAL
    const R = await runAll(browser, null);
    const bad = R.renders.filter((r) => r.problems.length);
    const badLinks = R.links.filter((r) => !r.ok);
    const servedBad = Object.entries(R.served).filter(([, v]) => v.length);
    V.renders = R.renders; V.links = R.links; V.served_banned = R.served;
    V.counts = { renders: R.renders.length, render_problems: bad.length, links_checked: R.links.length, links_bad: badLinks.length, served_banned: servedBad.length };
    V.evidence.push('plant: 5/5 faults caught (hidden #coaching, "rolling out", "[probe]", dead link ' + V.plant.deadStatus + ', wrong page answering ' + V.plant.wrongPageStatus + ')');
    V.evidence.push(R.renders.length + ' renders (demo + compare × en/zh/cn × 390/1280): ' + (bad.length ? bad.map((r) => r.page + '/' + r.lang + '/' + r.width + ': ' + r.problems.slice(0, 3).join('; ')).join(' || ') : 'no problems'));
    V.evidence.push(R.links.length + ' distinct links checked by content: ' + (badLinks.length ? badLinks.map((r) => r.url + ' (' + r.why + ')').join(' || ') : 'all right page'));
    V.evidence.push('served HTML banned strings (silkvo, Hong Kong Pickleball League, [probe], rolling out): ' + (servedBad.length ? JSON.stringify(R.served) : '0 on demo.html and compare.html') + '; linked site pages checked in the link pass');
    V.verdict = bad.length || badLinks.length || servedBad.length ? 'fail' : 'pass';
  } catch (e) {
    if (!e.blind) V.evidence.push('probe crashed: ' + String(e.stack || e).slice(0, 400));
    V.verdict = 'no_verdict';
  } finally { await browser.close().catch(() => undefined); }
  fs.writeFileSync(OUTV, JSON.stringify(V, null, 2));
  console.log('VERDICT', V.verdict, JSON.stringify(V.counts || {}));
  process.exit(V.verdict === 'pass' ? 0 : 1);
})();

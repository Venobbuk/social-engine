require('./_guard.cjs');   // G13.3: probes run through probes/run.sh, which sweeps afterwards
// global-contract.probe.cjs — GLOBAL-CONTRACT-V1 (2026-09-19). Enforces /root/social-engine/GLOBAL_CONTRACT.md (G1–G10)
// on EVERY GripBat surface. The surfaces are ENUMERATED here, never hand-typed:
//   site        = every *.html in the pack dir + every `location = /x.html` alias in the nginx confs + `/`
//   app         = every route in /root/hkpl-taro-branch/src/app.config.ts
//   engine      = a crawl of engine links found on /about and /explore (cap ENGINE_CAP) (+ /admin on LIVE, where it is the engine's)
//   back office = the alternatives of the nginx management regex (prefixes expanded from hkpl-server/public/*.html)
// Roles: UAT = anonymous + one persona per role from /root/uat-personas.json (signed in through the QA door, node fetch,
// no clicks); LIVE = anonymous only, read-only. Langs en / zh_Hant / zh_Hans. Every surface×role×lang runs at 412;
// 768 + 1280 run for anonymous (site pages: all langs; app/engine/back office: one lang per surface, rotating).
// Survives browser crashes (per-worker relaunch), retries every failing render once in a FRESH browser, prints the
// per-rule family table and writes global-contract.verdict.json.
// RUN IT ONLY THROUGH THE BOX'S BROWSER BUDGET: bash /root/gen/browser-slot.sh node /root/social-engine/probes/global-contract.probe.cjs
// Env: CONC (tabs, default 4, one browser) · ONLY=site,app,engine,backoffice · HOSTS=uat,live · ROLES=anon,player,… · QUICK=1 (412 only)
'use strict';
process.on('unhandledRejection', (e) => console.log('~ unhandled: ' + String(e && e.message || e).slice(0, 80)));
const fs = require('fs');
const puppeteer = require('/root/hkpl-server/node_modules/puppeteer-core');
const UAT = 'https://uat.social.silkvo.com', LIVE = 'https://social.silkvo.com';
const PACK = '/var/www/boyau-uat-app/uat';
const CONF = { uat: '/etc/nginx/sites-enabled/uat.social.silkvo.com.conf', live: '/etc/nginx/sites-enabled/social.silkvo.com.conf' };
const HKPL_PUBLIC = '/root/hkpl-server/public';
const APP_CONFIG = '/root/hkpl-taro-branch/src/app.config.ts';
const CONC = +(process.env.CONC || 4);   // BROWSER-BUDGET-V1: ONE browser (PER_BROWSER 4) — run only via: bash /root/gen/browser-slot.sh node global-contract.probe.cjs
const ENGINE_CAP = +(process.env.ENGINE_CAP || 30);
const ONLY = (process.env.ONLY || 'site,app,engine,backoffice').split(',');
const HOSTSEL = (process.env.HOSTS || 'uat,live').split(',');
const LANGS = ['en', 'zh_Hant', 'zh_Hans'];
const SHOTS = '/root/walk/gc'; fs.mkdirSync(SHOTS, { recursive: true });
const QA_P = 'hkpl-uat-2026';
const t0 = Date.now();

// ---------------------------------------------------------------- allow-lists (the contract's listed exceptions)
// G2: tester pages that show the sandbox address by design (they tell a tester where the sandbox lives).
const SILKVO_ALLOWED_SITE = /^\/(qa|test-plan|fixed|tutorial|uat\/parity)\.html$|^\/sandbox-gate\.html$/;   // tutorial step 1 says "Open uat.social.silkvo.com"
// G4: requests that are expected to fail (reason in the contract, section G4).
const EXPECTED_FAIL = [
  [/^401 .*\/api\/v1\/(auth\/me|social\/me|me\b|push\/|notifications|feedback\/mine)/, 'anonymous: "who am I" answers 401'],
  [/^401 .*\/api\/(i|chat\/|meets\/list|notes\/|users\/following|following\/|channels\/followed|i\/notifications|venues\/locations)\b/, 'anonymous engine calls that need a token'],
  [/^404 .*\/(fonts|cdn)\//, 'an optional font / cdn image the page falls back from'],
  [/^40[13] .*\/api\/v1\/admin\//, 'a non-admin on an admin surface (the page shows its no-access state)'],
];
// G6: Latin words allowed on a Chinese page — brand, proper nouns, units, codes.
const EN_ALLOW = /GripBat|DUPR|HKPL|Reclub|WhatsApp|WeChat|Google|Apple|iPhone|Android|Instagram|Facebook|pickleball\.hk|gripbat\.com|silkvo|Wikimedia|CC BY|Misskey|UAT|QA|API|URL|PDF|CSV|OK|app|App|Edge|GB-|ID|HK\$|km|min|pm|am|vs|@|https?:|www\.|\.com|Smash|Dinkers|Paddle Club|Pickleball (HK|Club)|Pals|\[demo\]|\[probe\]|\(played\)|\(approval\)/;
// user content is data, not copy: routes whose body is people's posts / names
const USER_CONTENT_ROUTES = /pages\/(feed|credits|chat|inbox|notifications|player|network|results|results-history|standings|news|reports|admin|bug-reports)\//;

/* GB-HOST-SCOPE (2026-09-19), read from the SAME nginx conf this enumeration already reads:
 *   location ~ ^/(activity-|docs/|theme-studio|overview) { return 404; }
 * Those league-only back-office paths are NOT SERVED on the GripBat host by design. This probe expanded the
 * management regex into them anyway and then counted each 404 as a G4 and a G8 violation: on 2026-09-20 that was
 * 476 of the run's 494 "violations" (34 paths x 3 languages x roles/widths, twice), and it made this gate
 * contradict host-scope.probe.cjs — which PASSES precisely because those paths 404 (`PASS /overview -> 404`).
 * A path the host answers 404 to BY RULE is not a surface. Parsed from the conf, never a hand list, so the day the
 * rule changes the enumeration changes with it. */
function hostScope404(conf) {
  const pats = [];
  for (const m of conf.matchAll(/location\s+~\*?\s+(\^[^\s{]+)\s*\{([^}]*)\}/g)) {
    if (/\breturn\s+404\b/.test(m[2])) { try { pats.push(new RegExp(m[1])); } catch (e) { console.log('~ host-scope: nginx regex not usable in JS, kept in scope: ' + m[1]); } }
  }
  return (p) => pats.some((re) => re.test(p));
}

// ---------------------------------------------------------------- enumeration
function enumerate() {
  const S = [];
  const add = (host, kind, path, extra = {}) => { if (!S.some((s) => s.host === host && s.path === path)) S.push({ host, kind, path, ...extra }); };
  // SITE (UAT): pack files, the nginx `location =` html aliases, `/`
  const uconf = fs.readFileSync(CONF.uat, 'utf8');
  const lconf = fs.readFileSync(CONF.live, 'utf8');
  const packFiles = fs.readdirSync(PACK).filter((f) => f.endsWith('.html'));
  const aliasOf = {};   // file -> public path
  for (const m of uconf.matchAll(/location = (\/[^\s{]*)\s*\{([^}]*)\}/g)) {
    const p = m[1], body = m[2];
    const al = body.match(/alias \/var\/www\/boyau-uat-app\/uat\/([^;\s]+\.html)/);
    if (al) { aliasOf[al[1]] = p; continue; }
    const rw = body.match(/rewrite \^ \/uat\/([^\s]+\.html)/);
    if (rw) { aliasOf[rw[1]] = p; continue; }
    if (/\.html$/.test(p) || p === '/') add('uat', 'site', p, { redirect: true });
  }
  for (const f of packFiles) add('uat', 'site', aliasOf[f] || '/uat/' + f, { file: f });
  for (const m of lconf.matchAll(/location = (\/[^\s{]*)\s*\{([^}]*)\}/g)) if (/\.html$/.test(m[1]) || m[1] === '/') add('live', 'site', m[1], { redirect: /return 30/.test(m[2]) });
  // APP: every route in app.config.ts, both hosts
  const routes = [...new Set([...fs.readFileSync(APP_CONFIG, 'utf8').matchAll(/'(pages\/[a-z0-9-]+\/index)'/g)].map((m) => m[1]))];
  for (const r of routes) { add('uat', 'app', '/app/' + r); add('live', 'app', '/app/' + r); }
  // BACK OFFICE (UAT): the management regex alternatives, MINUS whatever the host-scope rule 404s (both from uconf)
  /* WHICH regex location is the management block: the one that SERVES those paths (proxy_pass) — not the
     GB-HOST-SCOPE rule that 404s league-only paths and not the redirect beside it. This used to take the FIRST
     `location ~ ^/(…)` in the file, and GB-HOST-SCOPE was added ABOVE the management block on 2026-09-19, so from
     that day the probe enumerated exactly the paths the rule REMOVES (/activity-*, /docs/*, /theme-studio,
     /overview) and never the back office that is actually served (/admin, /super, /club-admin, /onboarding,
     /open-play-manage, /qa, /enter). That is both where 476 of this gate's 494 "violations" came from and a
     coverage hole nobody could see. Pick the block by what it does, then still drop anything the 404 rule removes. */
  let mg = null;
  for (const m of uconf.matchAll(/location ~ \^\/\(([^)]+)\)[^\s{]* \{([^}]*)\}/g)) if (/proxy_pass/.test(m[2])) { mg = m; break; }
  const gone = hostScope404(uconf);
  let removed = 0;
  const addBO = (p) => { if (gone(p)) { removed++; return; } add('uat', 'backoffice', p); };
  const pub = fs.readdirSync(HKPL_PUBLIC).filter((f) => f.endsWith('.html'));
  if (mg) for (const alt of mg[1].split('|')) {
    if (/[-]$/.test(alt)) { for (const f of pub.filter((x) => x.startsWith(alt))) addBO('/' + f.replace(/\.html$/, '')); }
    else if (/\/$/.test(alt)) {   // a path prefix (docs/): its static GET routes from hkpl-server/routes/<name>.js
      const rf = HKPL_PUBLIC.replace(/public$/, 'routes/') + alt.replace(/\/$/, '') + '.js';
      try { for (const m of fs.readFileSync(rf, 'utf8').matchAll(/router\.get\('(\/[a-z0-9-]+)'/g)) if (!/^\/_/.test(m[1])) addBO('/' + alt + m[1].slice(1)); } catch (e) { addBO('/' + alt); }
    }
    else addBO('/' + alt);
  }
  if (removed) console.log('[enumerate] back office: ' + removed + ' path(s) skipped — the GripBat host answers them 404 by rule (GB-HOST-SCOPE, nginx)');
  return { S, routes: routes.length };
}

// engine crawl: anchors on /about and /explore of each host, one per URL shape, cap ENGINE_CAP
async function crawlEngine(browser, host, base) {
  const out = ['/about', '/explore']; const shapes = new Set(out);
  const mgmt = /^\/(admin|activity-|super|docs\/|club-admin|theme-studio|onboarding|open-play-manage|qa|enter|demo|overview|features)/;
  for (const start of ['/about', '/explore']) {
    const p = await browser.newPage();
    try {
      await p.goto(base + start, { waitUntil: 'networkidle2', timeout: 45000 }).catch(() => undefined);
      await new Promise((r) => setTimeout(r, 2500));
      const hrefs = await p.evaluate(() => [...document.querySelectorAll('a[href]')].map((a) => a.href)).catch(() => []);
      for (const h of hrefs) {
        let u; try { u = new URL(h); } catch (e) { continue; }
        if (u.origin !== base) continue;
        const path = u.pathname;
        if (/^\/(app|uat|api|share|cdn|fonts|js|css|files|proxy|streams|url|assets|\.well-known)(\/|$)/.test(path) || /\.[a-z0-9]+$/.test(path) || mgmt.test(path) || path === '/') continue;
        const shape = path.replace(/\/@[^/]+/, '/@*').replace(/\/[a-z0-9]{16}(?=\/|$)/g, '/*').replace(/\/[0-9a-f-]{20,}(?=\/|$)/g, '/*');
        if (shapes.has(shape)) continue; shapes.add(shape); out.push(path + u.search);
        if (out.length >= ENGINE_CAP) break;
      }
    } finally { await p.close().catch(() => undefined); }
  }
  if (host === 'live') out.push('/admin');
  return out.slice(0, ENGINE_CAP + 1);
}

// ---------------------------------------------------------------- roles (UAT sign-in through the QA door, no browser)
async function signIn(email) {
  let url = UAT + '/api/v1/auth/qa/by-email/' + encodeURIComponent(email) + '?p=' + QA_P; const jar = {};
  for (let i = 0; i < 4; i++) {
    const r = await fetch(url, { redirect: 'manual', headers: { cookie: Object.entries(jar).map(([k, v]) => k + '=' + v).join('; ') } });
    for (const c of (r.headers.getSetCookie ? r.headers.getSetCookie() : [])) { const [kv] = c.split(';'); const i2 = kv.indexOf('='); jar[kv.slice(0, i2)] = kv.slice(i2 + 1); }
    const loc = r.headers.get('location'); if (!loc || r.status < 300 || r.status >= 400) break; url = new URL(loc, UAT).href;
    if (!url.startsWith(UAT + '/api/')) break;
  }
  const me = await fetch(UAT + '/api/v1/auth/me', { headers: { cookie: Object.entries(jar).map(([k, v]) => k + '=' + v).join('; ') } });
  return { jar, ok: me.status === 200 };
}
function personaRoles() {
  const P = JSON.parse(fs.readFileSync('/root/uat-personas.json', 'utf8')).personas;
  const want = (process.env.ROLES || 'anon,player,host,admin').split(',');
  const roles = [];
  for (const w of want) {
    if (w === 'anon') { roles.push({ role: 'anon' }); continue; }
    const p = P.find((x) => x.slug === w || x.slug.startsWith(w + '-'));
    if (p) roles.push({ role: w, email: p.email });
  }
  return roles;
}

// ---------------------------------------------------------------- in-page measurement (runs in the browser)
function measure(ctx) {
  const out = { v: [], anchors: [], info: {} };
  const V = (rule, msg) => out.v.push([rule, msg]);
  // cached: a 240 KB page (parity) has ~20k text nodes; an uncached ancestor walk per node took > 2 min under load
  const shownC = new Map(); const csC = new Map();
  const CS = (e) => { let c = csC.get(e); if (!c) { c = window.getComputedStyle(e); csC.set(e, c); } return c; };
  const shown = (e) => { if (!e || e.nodeType !== 1) return true; if (shownC.has(e)) return shownC.get(e); const cs = CS(e); const r = !(cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) && shown(e.parentElement); shownC.set(e, r); return r; };
  const vis = (el) => { if (!el || !el.getBoundingClientRect) return false; const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return false; return shown(el); };
  const getComputedStyle = CS;
  const desc = (el) => { if (!el) return '?'; let s = el.tagName.toLowerCase(); if (el.id) s += '#' + el.id; const c = (typeof el.className === 'string' ? el.className : '').trim().split(/\s+/).filter(Boolean).slice(0, 2); if (c.length) s += '.' + c.join('.'); return s; };
  const W = window.innerWidth;
  // ---- G1 report button
  const site = [...document.querySelectorAll('.hkpl-bug-fab')].filter(vis).length;
  const app = [...document.querySelectorAll('.fb-fab')].filter(vis).length;
  out.info.fab = site + '/' + app;
  if (site + app !== 1) V('G1', (site + app === 0 ? 'no report button' : (site + app) + ' report buttons') + ' (site widget ' + site + ', app ' + app + ')');
  // ---- text walk
  const tw = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
  const texts = []; let n;
  while ((n = tw.nextNode())) { const t = n.nodeValue.replace(/\s+/g, ' ').trim(); if (!t) continue; const el = n.parentElement; if (!el || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(el.tagName)) continue; if (!vis(el)) continue; texts.push([t, el]); }
  const isZh = ctx.lang !== 'en';
  // ---- G2 brand
  const CN = '抓拍';   // 抓拍
  if (!isZh) {
    for (const [t, el] of texts) if (t.includes(CN)) V('G2', 'EN visible 抓拍 in ' + desc(el) + ': "' + t.slice(0, 40) + '"');
    if (document.title.includes(CN)) V('G2', 'EN <title> carries 抓拍: "' + document.title.slice(0, 50) + '"');
    for (const m of document.querySelectorAll('meta[content]')) if (m.content.includes(CN)) V('G2', 'EN meta ' + (m.name || m.getAttribute('property')) + ' carries 抓拍');
    for (const a of document.querySelectorAll('[alt],[aria-label],[title],[placeholder]')) for (const k of ['alt', 'aria-label', 'title', 'placeholder']) { const x = a.getAttribute(k); if (x && x.includes(CN) && vis(a)) V('G2', 'EN ' + k + ' carries 抓拍 on ' + desc(a)); }
  } else {
    for (const [t, el] of texts) if (t.includes(CN)) {
      const fs = parseFloat(getComputedStyle(el).fontSize);
      const block = el.closest('p,li,h1,h2,h3,h4,div,span,a,button,small,figcaption,td,label') || el;
      const blockText = (block.innerText || '').trim();
      const head = el.closest('h1,h2,h3,title,[role=heading]');
      if (fs > 20.5) V('G2', 'zh 抓拍 at ' + Math.round(fs) + 'px (>20) in ' + desc(el));
      else if (head && (head.innerText || '').trim().startsWith(CN)) V('G2', 'zh heading starts with 抓拍: ' + desc(head));
      else if (!/GripBat/i.test(blockText) && !/GripBat/i.test((block.parentElement && block.parentElement.innerText) || '')) V('G2', 'zh 抓拍 used as the brand (no GripBat beside it) in ' + desc(el) + ': "' + t.slice(0, 36) + '"');
    }
    if (document.title.trim().startsWith(CN)) V('G2', 'zh <title> starts with 抓拍');
  }
  if (ctx.kind === 'site' && !ctx.silkvoAllowed) for (const [t, el] of texts) if (/silkvo/i.test(t)) V('G2', '"silkvo" in visible text of a site page (' + desc(el) + '): "' + t.slice(0, 50) + '"');
  // ---- G3 tester chrome on LIVE
  if (ctx.host === 'live') {
    for (const id of ['uat-banner', 'qa-switch-bar', 'hkpl-chat-fab']) { const e = document.getElementById(id); if (e && vis(e)) V('G3', 'tester chrome #' + id + ' on LIVE'); }
    for (const [t, el] of texts) if (/\bUAT\b|sandbox|沙盒|測試環境|测试环境/i.test(t) && !el.closest('.hkpl-bug-panel,[class*=bug-]')) { V('G3', 'sandbox wording on LIVE in ' + desc(el) + ': "' + t.slice(0, 50) + '"'); break; }
  }
  // ---- G5 overflow + clipping
  const se = document.scrollingElement; const ab = document.querySelector('.sh-app-body');
  const ov = Math.max(se ? se.scrollWidth - W : 0, document.body ? document.body.scrollWidth - W : 0, ab ? ab.scrollWidth - ab.clientWidth : 0);
  out.info.overflow = ov;
  if (ov > 2) {
    // name the widest culprit
    let worst = null, wr = 0;
    for (const el of document.querySelectorAll('body *')) { const r = el.getBoundingClientRect(); if (r.right > W + 2 && r.width > 0 && vis(el)) { let sc = false, e = el.parentElement; while (e && e !== document.body) { const cs = getComputedStyle(e); if (/(auto|scroll|hidden|clip)/.test(cs.overflowX)) { sc = true; break; } e = e.parentElement; } if (!sc && r.right > wr) { wr = r.right; worst = el; } } }
    V('G5', 'horizontal scroll ' + ov + 'px' + (worst ? ' (widest: ' + desc(worst) + ' right=' + Math.round(wr) + ')' : ''));
  }
  const clipped = [];
  const scC = new Map();
  const inScroller = (el) => { const e = el.parentElement; if (!e || e === document.body) return false; if (scC.has(e)) return scC.get(e); const cs = getComputedStyle(e); let r; if (/(auto|scroll)/.test(cs.overflowX) && e.scrollWidth > e.clientWidth + 1) r = true; else if (cs.position === 'fixed') r = false; else r = inScroller(e); scC.set(e, r); return r; };
  const seen = new Set();
  for (const [t, el] of texts) {
    if (seen.has(el) || t.length < 2) continue; seen.add(el);
    const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
    if (cs.position === 'fixed' || el.closest('[aria-hidden=true],.sr-only,.visually-hidden')) continue;
    if (inScroller(el)) continue;
    if (r.right > W + 2 || r.left < -2) { clipped.push(desc(el) + ' off-screen "' + t.slice(0, 24) + '"'); continue; }
    if (/(hidden|clip)/.test(cs.overflowX) && cs.textOverflow !== 'ellipsis' && el.scrollWidth > el.clientWidth + 2 && !/-webkit-box/.test(cs.display)) { clipped.push(desc(el) + ' text cut ' + (el.scrollWidth - el.clientWidth) + 'px "' + t.slice(0, 24) + '"'); continue; }
    // clipped by an overflow:hidden ancestor
    let e = el.parentElement, hops = 0;
    while (e && e !== document.body && hops < 6) { const ecs = getComputedStyle(e); if (/(hidden|clip)/.test(ecs.overflowX) && ecs.position !== 'fixed') { const er = e.getBoundingClientRect(); if (r.right > er.right + 2 && cs.textOverflow !== 'ellipsis' && ecs.textOverflow !== 'ellipsis' && r.left < er.right) { clipped.push(desc(el) + ' cut by ' + desc(e) + ' ' + Math.round(r.right - er.right) + 'px "' + t.slice(0, 24) + '"'); } break; } e = e.parentElement; hops++; }
  }
  if (clipped.length) V('G5', 'clipped text ×' + clipped.length + ': ' + clipped.slice(0, 3).join(' ; '));
  // ---- G6 translation
  const KEY = /^[a-z][a-zA-Z0-9]*(?:[._][a-zA-Z0-9]+)+$/;
  if (!ctx.userContent) for (const [t, el] of texts) if (KEY.test(t) && !/\.(com|hk|org|net|io|html|js|css|json|png|jpg|mp4|app|txt|md)$/i.test(t) && !/@/.test(t) && !el.closest('code,pre,kbd,input,textarea')) V('G6', 'raw i18n key on screen: "' + t + '" (' + desc(el) + ')');
  for (const el of document.querySelectorAll('[data-i]')) { const k = el.getAttribute('data-i'); if (!el.getAttribute('data-attr') && vis(el) && (el.innerText || '').trim() === k && (isZh || /[._]/.test(k))) V('G6', 'raw data-i key "' + k + '"'); }
  if (isZh && !ctx.userContent) {
    const stop = /\b(the|and|your|you|with|from|this|that|for|to|of|in|on|is|are|not|no|sign|join|find|open|play|meet|club|player|games?|courts?|book|share|report|back|next|more|save|cancel|loading|search|settings)\b/i;
    const lines = []; const seenL = new Set();
    for (const [t, el] of texts) {
      if (el.closest('[lang^=en],[translate=no],.notranslate,code,pre,kbd,input,textarea,.langbar,.lang,.hkpl-bug-panel,[data-user-content],.fb-panel')) continue;
      if (/[㐀-鿿]/.test(t)) continue;
      if (/^[A-Z0-9][\w'’&.-]*( [A-Z0-9(][\w'’&.)-]*)+$/.test(t)) continue;   // Title Case = a name (club, venue, meet, person): data, not copy
      if (/^\S+@\S+\.\S+$|^https?:\/\/\S+$/.test(t)) continue;   // an address or a link is data
      const words = t.match(/[A-Za-z]{2,}/g) || [];
      if (words.length < 3) continue;
      const stripped = t.replace(new RegExp(EN_ALLOW_SRC, 'g'), ' ');
      const w2 = stripped.match(/[A-Za-z]{2,}/g) || [];
      if (w2.length < 3 || !stop.test(stripped)) continue;
      if (seenL.has(t)) continue; seenL.add(t); lines.push('"' + t.slice(0, 48) + '"');
    }
    if (lines.length) V('G6', 'English on a ' + ctx.lang + ' page ×' + lines.length + ': ' + lines.slice(0, 3).join(', '));
  }
  // ---- G7 shared header + breadcrumb (site pack pages)
  if (ctx.kind === 'site' && ctx.file) {
    const heads = [...document.querySelectorAll('.gbnav, header.nav, nav.nav, [data-gbnav]')].filter((x) => vis(x) && !x.parentElement.closest('.gbnav, header.nav, nav.nav, [data-gbnav]'));
    if (heads.length !== 1) V('G7', heads.length + ' site headers (want exactly 1)');
    else {
      const h = heads[0]; const hrefs = [...h.querySelectorAll('a[href]')].map((a) => a.getAttribute('href'));
      const need = [['/', 'logo → /'], ['/how.html', 'How it works'], ['/app/', 'Try it']];   // G7-NO-DEPTH (2026-09-24): no In depth link — /depth.html is 404 on brand domains
      const miss = need.filter(([p]) => !hrefs.some((x) => x === p || (p === '/app/' && /^\/app\//.test(x))));
      if (miss.length) V('G7', 'header lacks ' + miss.map((m) => m[1]).join(', '));
      if (!h.hasAttribute('data-gbnav')) V('G7', 'header is not the shared one (no data-gbnav: rendered from a per-page copy, not /uat/nav.js)');
    }
    const crumb = [...document.querySelectorAll('.gbcrumb, nav.crumbs, [data-gbcrumb]')].filter(vis);
    if (!ctx.front && crumb.length !== 1) V('G7', crumb.length + ' breadcrumbs (want 1)');
  }
  // anchors (G8)
  for (const a of document.querySelectorAll('a[href]')) { const h = a.href; if (/^https?:/.test(h)) out.anchors.push(h.split('#')[0]); }
  out.info.title = document.title.slice(0, 60);
  out.info.len = (document.body && document.body.innerText || '').length;
  return out;
}

// ---------------------------------------------------------------- render one task
const DEAD = /Target closed|Session closed|Protocol error|browser has disconnected|Connection closed|detached Frame|Navigating frame was detached|WebSocket is not open/i;
async function render(browserBox, T, cookies) {
  const { host, base, kind, path, role, lang, w } = T;
  const b = browserBox.b;
  const key = host + '|' + role + '|' + lang;
  // one context per host × role × lang (isolated storage = the language sticks; cookies = the role), shared by the
  // workers on this browser, created once (promise-cached so two workers never race two contexts into existence)
  if (!browserBox.ctx[key]) browserBox.ctx[key] = (async () => {
    const c = await b.createBrowserContext();
    if (cookies[role]) { const p0 = await c.newPage(); await p0.setCookie(...Object.entries(cookies[role]).map(([name, value]) => ({ name, value, domain: new URL(base).hostname, path: '/', secure: true }))); await p0.close(); }
    return c;
  })();
  const ctx = await browserBox.ctx[key];
  const page = await ctx.newPage();
  if (T.__hold) T.__hold.page = page;
  const res = { T, v: [], anchors: [], info: {} };
  try {
    await page.setViewport({ width: w, height: w < 500 ? 915 : 900, deviceScaleFactor: 1 });
    const gb = lang === 'en' ? 'en' : lang === 'zh_Hant' ? 'zh' : 'cn';
    const mk = lang === 'en' ? 'en-US' : lang === 'zh_Hant' ? 'zh-TW' : 'zh-CN';
    await page.setExtraHTTPHeaders({ 'Accept-Language': lang === 'en' ? 'en-US,en' : lang === 'zh_Hant' ? 'zh-HK,zh-TW' : 'zh-CN,zh' });
    await page.evaluateOnNewDocument((gb, mk, hk) => { try { localStorage.setItem('gb_uat_lang', gb); localStorage.setItem('lang', mk); localStorage.setItem('hkpl_lang', hk); } catch (e) { /* storage blocked */ } Object.defineProperty(navigator, 'language', { get: () => mk }); }, gb, mk, lang);
    const errs = [], pageErrs = [], failed = [];
    page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)); });
    page.on('pageerror', (e) => pageErrs.push(String(e.message || e).slice(0, 160)));
    page.on('response', (r) => { const u = r.url(); if (!u.startsWith(base)) return; const s = r.status(); if (s >= 400) failed.push(s + ' ' + u.replace(base, '').slice(0, 100)); });
    page.on('requestfailed', (r) => { const f = r.failure(); if (f && !/ERR_ABORTED/.test(f.errorText) && r.url().startsWith(base)) failed.push(f.errorText + ' ' + r.url().replace(base, '').slice(0, 100)); });
    const url = base + path + (kind === 'engine' ? '' : (path.includes('?') ? '&' : '?') + 'lang=' + lang);
    let status = 0, ctype = 'text/html';
    try { const r = await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 }); status = r ? r.status() : 0; ctype = r ? (r.headers()['content-type'] || '') : ''; } catch (e) { if (DEAD.test(e.message)) throw e; pageErrs.push('goto: ' + String(e.message).slice(0, 80)); }
    // the report button is deferred: wait up to 8 s for it (or for 8 s of nothing)
    await page.waitForFunction(() => document.querySelector('.hkpl-bug-fab, .fb-fab'), { timeout: 8000 }).catch(() => undefined);
    await page.waitForNetworkIdle({ idleTime: 600, timeout: 6000 }).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 700));
    // a redirect is judged where it LANDS (/app.html → the app's Home is an app surface, /uat.html → /qa.html a tester page)
    const finalPath = (() => { try { return new URL(page.url()).pathname; } catch (e) { return path; } })();
    const eKind = kind === 'site' && finalPath.startsWith('/app/') ? 'app' : kind;
    const ctxInfo = { host, kind: eKind, lang, file: eKind === 'site' ? (T.file || (finalPath !== path ? 'redirect' : '')) : '', front: path === '/' || finalPath === '/', silkvoAllowed: SILKVO_ALLOWED_SITE.test(path) || SILKVO_ALLOWED_SITE.test(finalPath), userContent: USER_CONTENT_ROUTES.test(finalPath) || eKind === 'engine' };
    // a document that is not a page (a PDF, an image): only its status counts (G8)
    if (ctype && !/html/.test(ctype)) { res.info = { status, ctype }; if (status >= 400) res.v.push(['G8', 'the document answers ' + status]); return res; }
    const m = await page.evaluate(`(${measure.toString()})(${JSON.stringify(ctxInfo)})`.replace('EN_ALLOW_SRC', JSON.stringify(EN_ALLOW.source)));
    res.v = m.v; res.anchors = m.anchors; res.info = m.info; res.info.status = status; res.info.final = page.url().replace(base, '');
    if (typeof status === 'number' && status >= 400) res.v.push(['G8', 'the page itself answers ' + status]);
    // G4
    const expected = (s) => EXPECTED_FAIL.some(([re]) => re.test(s)) && (role === 'anon' || !/^401/.test(s) || /admin/.test(s));
    const badReq = failed.filter((s) => !expected(s));
    if (pageErrs.length) res.v.push(['G4', 'page error: ' + pageErrs[0] + (pageErrs.length > 1 ? ' (+' + (pageErrs.length - 1) + ')' : '')]);
    const cerr = errs.filter((e) => !/Failed to load resource/.test(e));   // those are counted as requests
    if (cerr.length) res.v.push(['G4', 'console error: ' + cerr[0] + (cerr.length > 1 ? ' (+' + (cerr.length - 1) + ')' : '')]);
    if (badReq.length) res.v.push(['G4', 'failed request: ' + [...new Set(badReq)].slice(0, 3).join(' ; ')]);
    if (res.v.length) { const f = SHOTS + '/' + [host, kind, path.replace(/[^a-z0-9]+/gi, '_'), role, lang, w].join('-') + '.png'; await page.screenshot({ path: f }).catch(() => undefined); res.shot = f; }
  } finally { await page.close().catch(() => undefined); }
  return res;
}

// The box runs other heavy jobs (the OOM killer took 7 per-worker Chromes on the first run): workers SHARE a browser
// (PER_BROWSER tabs each), a render waits while MemAvailable is low, and a dead browser is relaunched once per group.
const PER_BROWSER = +(process.env.PER_BROWSER || 4);   // CONC <= PER_BROWSER keeps it to one Chrome at a time
async function launch() {
  for (let i = 0; ; i++) {
    try { return await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', timeout: 90000, args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--lang=en-US', '--class=gcprobe', '--renderer-process-limit=6', '--js-flags=--max-old-space-size=768'], protocolTimeout: 90000 }); }
    catch (e) { if (i >= 5) throw e; console.log('~ launch failed (' + String(e.message).slice(0, 50) + ') — retry in 15 s'); await new Promise((r) => setTimeout(r, 15000)); }
  }
}
function memAvailMB() { try { return +(fs.readFileSync('/proc/meminfo', 'utf8').match(/MemAvailable:\s+(\d+)/) || [0, 0])[1] / 1024; } catch (e) { return 99999; } }
async function memGate() { for (let i = 0; i < 60 && memAvailMB() < 2500; i++) await new Promise((r) => setTimeout(r, 5000)); }

async function runPool(tasks, cookies, label) {
  const results = new Array(tasks.length); let next = 0, done = 0;
  const nb = Math.max(1, Math.ceil(Math.min(CONC, tasks.length) / PER_BROWSER));
  const boxes = []; for (let i = 0; i < nb; i++) boxes.push({ b: await launch(), ctx: {}, gen: 0, relaunching: null });
  const relaunch = async (box, gen) => {
    if (box.gen !== gen) return box.relaunching;   // someone in this group already did
    box.gen++; box.ctx = {};
    box.relaunching = (async () => { try { await box.b.close(); } catch (x) { /* dead */ } box.b = await launch(); })();
    return box.relaunching;
  };
  const worker = async (wi) => {
    const box = boxes[wi % nb];
    while (true) {
      const i = next++; if (i >= tasks.length) break;
      let r = null;
      for (let attempt = 0; attempt < 3 && !r; attempt++) {
        await memGate(); if (box.relaunching) await box.relaunching;
        const gen = box.gen; const hold = {}; tasks[i].__hold = hold; let timer;
        try { r = await Promise.race([render(box, tasks[i], cookies), new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('render timeout 150s')), 150000); })]); }
        catch (e) {
          if (DEAD.test(e.message) || !box.b.isConnected()) { console.log('~ worker ' + wi + ' browser died (' + String(e.message).slice(0, 50) + ') — relaunching'); await relaunch(box, gen); }
          else if (/render timeout/.test(e.message) && attempt < 2) { if (hold.page) hold.page.close().catch(() => undefined); }
          else r = { T: tasks[i], v: [['G4', 'render failed: ' + String(e.message).slice(0, 100)]], anchors: [], info: {} };
        } finally { clearTimeout(timer); delete tasks[i].__hold; }
      }
      if (!r) r = { T: tasks[i], v: [['G4', 'render failed 3× (browser crash / timeout)']], anchors: [], info: {} };
      results[i] = r; done++;
      if (done % 100 === 0) console.log(`  ${label} ${done}/${tasks.length} · ${Math.round((Date.now() - t0) / 60000)} min · mem ${Math.round(memAvailMB())} MB`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONC, tasks.length) }, (_, i) => worker(i)));
  for (const box of boxes) { try { await box.b.close(); } catch (e) { /* gone */ } }
  return results;
}

// ---------------------------------------------------------------- G8 link check (node fetch, GET, anonymous, read-only)
async function linkStatus(u) {
  try {
    const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 40000);
    const r = await fetch(u, { redirect: 'follow', signal: ctl.signal, headers: { 'user-agent': 'Mozilla/5.0 (GripBat global-contract link check)' } });
    clearTimeout(to); return r.status;
  } catch (e) { return 'ERR ' + String(e.cause && e.cause.code || e.message).slice(0, 30); }
}

(async () => {
  const { S, routes } = enumerate();
  const baseOf = { uat: UAT, live: LIVE };
  // engine crawl
  if (ONLY.includes('engine')) {
    const b = await launch();
    for (const host of HOSTSEL) { const paths = await crawlEngine(b, host, baseOf[host]); for (const p of paths) if (!S.some((s) => s.host === host && s.path === p)) S.push({ host, kind: 'engine', path: p }); }
    await b.close();
  }
  const surfaces = S.filter((s) => HOSTSEL.includes(s.host) && ONLY.includes(s.kind));
  const roles = personaRoles();
  const cookies = {};
  for (const r of roles) if (r.email) { const s = await signIn(r.email); if (!s.ok) console.log('! sign-in failed for ' + r.role + ' ' + r.email); cookies[r.role] = s.jar; }
  const count = {}; for (const s of surfaces) count[s.host + ' ' + s.kind] = (count[s.host + ' ' + s.kind] || 0) + 1;
  console.log('surfaces (enumerated):', JSON.stringify(count), '· app routes in app.config.ts:', routes, '· roles:', roles.map((r) => r.role).join(','));
  // tasks
  const tasks = [];
  surfaces.forEach((s, si) => {
    // roles change what the APP shows, so every app route runs for every role; site / engine / back-office pages are
    // the same document for everyone (engine sessions are not hkpl roles) — anonymous + tenant admin cover them
    const rs = s.host !== 'uat' ? [{ role: 'anon' }] : s.kind === 'app' ? roles : roles.filter((r) => r.role === 'anon' || r.role === 'admin');
    for (const r of rs) for (const lang of LANGS) tasks.push({ ...s, base: baseOf[s.host], role: r.role, lang, w: 412 });
    if (!process.env.QUICK) for (const w of [768, 1280]) {
      // site pages: every lang at both widths; the rest: sampled — each surface gets ONE of 768 / 1280, lang rotating
      if (s.kind !== 'site' && (si % 2) !== (w === 768 ? 0 : 1)) continue;
      const langs = s.kind === 'site' ? LANGS : [LANGS[si % 3]];
      for (const lang of langs) tasks.push({ ...s, base: baseOf[s.host], role: 'anon', lang, w });
    }
  });
  console.log('renders planned:', tasks.length, '· workers:', CONC);
  let results = await runPool(tasks, cookies, 'pass 1');
  // retry every failing render once, in a FRESH browser pool
  const failIdx = results.map((r, i) => (r.v.length ? i : -1)).filter((i) => i >= 0);
  console.log('pass 1 done:', failIdx.length, 'failing renders — retrying each once in a fresh browser');
  const retried = await runPool(failIdx.map((i) => tasks[i]), cookies, 'retry');
  let flakes = 0;
  failIdx.forEach((i, k) => { if (!retried[k].v.length) flakes++; results[i] = retried[k]; results[i].retried = true; });
  // G8: site reachability from / (≤3 layers) + every link < 400
  const g8 = [];
  if (ONLY.includes('site') && HOSTSEL.includes('uat')) {
    const siteRes = results.filter((r) => r.T.host === 'uat' && r.T.kind === 'site' && r.T.role === 'anon' && r.T.lang === 'en' && r.T.w === 412);
    const byPath = {}; for (const r of siteRes) byPath[r.T.path] = r;
    const norm = (h) => { try { const u = new URL(h); return u.origin === UAT ? u.pathname : null; } catch (e) { return null; } };
    const depth = { '/': 0 }; let frontier = ['/'];
    for (let d = 1; d <= 3; d++) { const nf = []; for (const p of frontier) for (const h of ((byPath[p] || {}).anchors || [])) { const q = norm(h); if (q && byPath[q] && depth[q] === undefined) { depth[q] = d; nf.push(q); } } frontier = nf; }
    // a file that redirects elsewhere (a retired page's stub) is not a page: it cannot be an orphan
    const landsElsewhere = (p) => { const r = byPath[p]; const f = r && r.info && r.info.final; return !!f && f.split('?')[0] !== p; };
    for (const s of surfaces.filter((x) => x.host === 'uat' && x.kind === 'site' && x.file)) if (depth[s.path] === undefined && !landsElsewhere(s.path)) g8.push(['G8', 'orphan: ' + s.path + ' (' + s.file + ') not reachable from / within 3 layers', { T: { host: 'uat', kind: 'site', path: s.path, role: 'anon', lang: 'en', w: 412 } }]);
  }
  const links = new Set(); for (const r of results) for (const a of r.anchors || []) links.add(a);
  const skip = (u) => /\/api\/|\/auth\/qa\/|logout|signout|dupr/i.test(u) || /^https?:\/\/(localhost|127\.)/.test(u);
  const linkList = [...links].filter((u) => !skip(u));
  const linkBad = [];
  for (let i = 0; i < linkList.length; i += 8) {
    const chunk = linkList.slice(i, i + 8); const st = await Promise.all(chunk.map(linkStatus));
    chunk.forEach((u, k) => {
      const own = u.startsWith(UAT) || u.startsWith(LIVE);
      // an external host answering 401 / 403 / 429 to a script is bot protection, not a dead link (a person gets the page)
      if (!own && [401, 403, 429].includes(st[k])) return;
      // federation endpoints are off by design (SPEC: no federation) — the engine's About page lists them; listed in G8
      if (own && st[k] === 403 && /\/\.well-known\/(host-meta|nodeinfo)/.test(u)) return;
      if (!(typeof st[k] === 'number' && st[k] < 400)) linkBad.push([u, st[k]]);
    });
  }
  for (const [u, st] of linkBad) { const from = results.filter((r) => (r.anchors || []).includes(u)).map((r) => r.T.host + ':' + r.T.path); g8.push(['G8', 'link ' + st + ' ' + u + ' (on ' + [...new Set(from)].slice(0, 3).join(', ') + ')', { T: { host: 'links', kind: 'link', path: u, role: '-', lang: '-', w: 0 } }]); }
  // family table
  const fam = {}; const RULES = ['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8'];
  for (const r of RULES) fam[r] = { n: 0, sig: {} };
  const addV = (rule, msg, T) => { const f = fam[rule]; f.n++; const sig = msg.replace(/\d+px/g, 'Npx').replace(/×\d+/g, '×N').replace(/\(\+\d+\)/, ''); const where = `${T.host} ${T.kind} ${T.path} ${T.role} ${T.lang} ${T.w}`; (f.sig[sig] = f.sig[sig] || []).push(where); };
  for (const r of results) for (const [rule, msg] of r.v) addV(rule, msg, r.T);
  for (const [rule, msg, r] of g8) addV(rule, msg, r.T);
  const renders = results.length; const failing = results.filter((r) => r.v.length).length;
  console.log('\n=== GLOBAL CONTRACT — family table ===');
  const families = {}; const evidence = [];
  for (const r of RULES) {
    families[r] = fam[r].n;
    console.log(`${r}  ${fam[r].n} violation(s)`);
    const sigs = Object.entries(fam[r].sig).sort((a, b) => b[1].length - a[1].length);
    for (const [sig, where] of sigs) { const line = `${r} ×${where.length} ${sig} — e.g. ${where.slice(0, 3).join(' | ')}`; console.log('   ' + line.slice(0, 400)); evidence.push(line.slice(0, 600)); }
  }
  const fails = Object.values(families).reduce((a, b) => a + b, 0);
  const v = { id: 'global-contract', at: new Date().toISOString(), condition_fired: true, verdict: fails ? 'fail' : 'pass', fails, checks: renders + linkList.length, renders, failing_renders: failing, flakes_cleared_on_retry: flakes, links_checked: linkList.length, surfaces: count, minutes: Math.round((Date.now() - t0) / 60000), families, evidence: evidence.length ? evidence : [`${renders} renders + ${linkList.length} links, zero violations of G1–G8`] };
  fs.writeFileSync('/root/social-engine/probes/global-contract.verdict.json', JSON.stringify(v, null, 1));
  // COVERAGE-LEDGER-V1 (2026-09-20): what was actually rendered, so probes/invariants.probe.cjs can claim a
  // surface x role from a real render (I3) instead of assuming the run covered it. Additive; nothing else reads it.
  fs.writeFileSync('/root/social-engine/probes/global-contract.coverage.json', JSON.stringify({
    id: 'global-contract', at: new Date().toISOString(), only: ONLY, hosts: HOSTSEL,
    rendered: results.map((r) => ({ host: r.T.host, kind: r.T.kind, path: r.T.path, role: r.T.role, lang: r.T.lang, w: r.T.w, fails: r.v.map((x) => x[0]) })),
  }));
  fs.writeFileSync('/root/social-engine/probes/global-contract.detail.json', JSON.stringify(results.filter((r) => r.v.length).map((r) => ({ T: { host: r.T.host, kind: r.T.kind, path: r.T.path, role: r.T.role, lang: r.T.lang, w: r.T.w }, v: r.v, info: r.info, shot: r.shot })), null, 1));
  console.log(`\n${v.verdict} · ${renders} renders (${failing} failing, ${flakes} cleared on retry) · ${linkList.length} links · ${v.minutes} min · families ${JSON.stringify(families)}`);
  process.exit(0);
})();

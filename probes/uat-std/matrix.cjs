// UAT-STD MATRIX RUNNER (lane UAT-STD, 2026-09-25) — FRONTEND_UAT_STANDARD v2.0 section 2 matrix, checks 5A/5B/5C/5E/5H +
// SHELL-DRIFT, one render per page x role x language x width x engine. The checks are the in-page functions in
// inpage.js (one copy of every rule), sequenced by measure.cjs; this file only walks the matrix and records raw facts to
// JSONL. grade.cjs turns facts into verdicts and families. Laws: 1 (abstain — every cell records its preconditions and a
// failed one makes the cell NO VERDICT), 7 (the build is recorded at the start, every 100 renders and at the end; each
// cell carries the build it ran on).
//
//   kaka / Chromium:  GB_BROWSER_REMOTE=no bash /root/gen/browser-slot.sh bash probes/run.sh uat-std/matrix.cjs
//   PC / WebKit:      ENGINE=webkit TOKENS=<file> OUT=<dir> node matrix.cjs   (read-only: writes no fixtures)
'use strict';
if (process.env.ENGINE !== 'webkit') require('../_guard.cjs');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const D = require('./driver.cjs');
const M = require('./measure.cjs');

const ENGINE = process.env.ENGINE || 'chromium';
const BASE = process.env.BASE || 'https://uat.gripbat.com';
const OUT = process.env.OUT || '/root/gen/l6-scope/uat-std';
const RUN = process.env.RUN || 'baseline';
const ROLES = (process.env.ROLES || 'visitor,player-amy,host-ken,clubowner-mei,admin').split(',');
const WIDTHS = (process.env.WIDTHS || '320,390,768,1280').split(',').map(Number);
const LANGS = (process.env.LANGS || 'en,zh_Hant,zh_Hans').split(',');
const CONC = +(process.env.CONC || 3);
const AXE_WIDTHS = (process.env.AXE_WIDTHS || '390,1280').split(',').map(Number);
const AXE_LANGS_WIDE = (process.env.AXE_LANGS_WIDE || 'en').split(',');   // at >=1024 axe runs in these languages only
const KBD = process.env.KBD || '1280:en';     // keyboard walk at <width>:<lang>
const ESC = process.env.ESC || '390:en';      // Escape-closes-dialog on the tab roots at <width>:<lang>
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;
const CELLS = process.env.CELLS ? JSON.parse(fs.readFileSync(process.env.CELLS, 'utf8')) : null;   // re-grade: an explicit cell list
const PAGES = JSON.parse(fs.readFileSync(path.join(__dirname, 'pages.json'), 'utf8'));
const HEIGHT = { 320: 640, 360: 780, 390: 844, 414: 896, 768: 1024, 820: 1180, 1024: 768, 1280: 900, 1440: 900 };
fs.mkdirSync(path.join(OUT, 'shots', ENGINE), { recursive: true });

async function tokens() {
  if (process.env.TOKENS) return JSON.parse(fs.readFileSync(process.env.TOKENS, 'utf8'));
  const { getNativeToken } = require('../_native-session.cjs');
  const t = {};
  for (const r of ROLES) if (r !== 'visitor') t[r] = (await getNativeToken(r)).token;
  return t;
}
async function buildId() {
  let html = '', status = 0;
  try { const r = await fetch(BASE + '/app/?build-probe=' + Date.now(), { cache: 'no-store' }); status = r.status; html = await r.text(); } catch (e) { html = ''; }
  const m = html.match(/\/app\/js\/app\.([0-9a-f]+)\.js/);
  let engine = null;
  if (ENGINE !== 'webkit') { try { engine = require('child_process').execFileSync('bash', ['/root/gen/engine-ship.sh', '--status'], { timeout: 60000 }).toString().split('\n').filter((l) => /web-uat-1:|web-1:/.test(l)).map((l) => l.trim().replace(/\s+/g, ' ')).join(' ; '); } catch (e) { engine = 'status failed: ' + String(e.message).slice(0, 80); } }
  return { at: new Date().toISOString(), status, appBundle: m ? m[1] : null, indexSha256: crypto.createHash('sha256').update(html).digest('hex').slice(0, 16), engine };
}

// the persona's session as the app keeps it (Taro H5 storage wraps values as {"data": …}); the language gate is answered
function initStorage(a) {
  try {
    if (a.token) localStorage.setItem('boyau_social_token', JSON.stringify({ data: a.token })); else localStorage.removeItem('boyau_social_token');
    localStorage.setItem('hkpl_lang_ok', JSON.stringify({ data: '1' }));
  } catch (e) { /* storage blocked */ }
}
function other(role, pp) { return role === 'player-amy' ? pp.KEN : pp.AMY; }

let BUILD = null;
async function renderCell(P, job, w) {
  const pg = job.page, lang = job.lang, role = job.role;
  const params = (pg.params || '').replace('{OTHER}', other(role, PAGES.personas));
  const url = BASE + '/app/pages/' + pg.route + '?' + (params ? params + '&' : '') + 'lang=' + lang;
  const cell = { run: RUN, engine: ENGINE, role, lang, w, page: pg.key, cls: pg.cls, src: pg.src, url: url.replace(BASE, ''), at: new Date().toISOString(), build: BUILD && BUILD.appBundle, engineRev: BUILD && BUILD.engine };
  const t0 = Date.now();
  await D.viewport(P, w, HEIGHT[w] || 900);
  const nav = await D.goto(P, url);
  cell.status = nav.status; if (nav.error) cell.navError = nav.error;
  cell.settleMs = await M.settle(P);
  let watcher = false; try { watcher = await M.inject(P); } catch (e) { cell.injectError = String(e.message).slice(0, 100); }
  if (watcher) { const t1 = Date.now(); cell.loadingLeft = await M.waitLoaded(P, 15000); cell.loadWaitMs = Date.now() - t1; }
  const ready = watcher ? await D.ev(P, () => window.__gbUat.ready()).catch(() => null) : null;
  cell.ready = ready;
  const tokenKept = await D.ev(P, () => { try { return !!localStorage.getItem('boyau_social_token'); } catch (e) { return null; } }).catch(() => null);
  const iCalls = P.net.filter((n) => /\/api\/i(\?|$)/.test(n.u));
  // a page that never asks /api/i (a static help page) is still a signed-in render when the token the app keeps answers as
  // the persona: ask the engine from inside the page with the stored token (the token never leaves the page)
  if (role !== 'visitor' && tokenKept && !iCalls.length) {
    const s = await D.ev(P, async () => { try { const t = JSON.parse(localStorage.getItem('boyau_social_token')).data; const r = await fetch('/api/i', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ i: t }) }); return r.status; } catch (e) { return 0; } }).catch(() => 0);
    iCalls.push({ u: '/api/i (asked by the probe)', s, m: 'POST' });
  }
  cell.pre = {
    loaded: nav.status > 0 && nav.status < 400 && !!ready && (ready.textLen > 15 || (ready.textLen >= 4 && ready.controls >= 1)) && (ready.app || ready.page) && !cell.loadingLeft,
    watcher,
    signed: role === 'visitor' ? (tokenKept === false) : (!!tokenKept && iCalls.some((n) => n.s === 200)),
    signedEvidence: role === 'visitor' ? 'no token in storage' : 'token kept: ' + tokenKept + '; POST /api/i ' + (iCalls.map((n) => n.s).join(',') || 'not called'),
    controls: ready ? ready.controls : 0,
    lang: ready ? ready.htmlLang : '',
  };
  cell.errors = P.errors.slice(0, 5); cell.failedApi = P.failed.slice(0, 8);
  if (!cell.pre.loaded || !watcher) { cell.ms = Date.now() - t0; return cell; }
  const base = path.join(OUT, 'shots', ENGINE, role, lang, String(w)); fs.mkdirSync(base, { recursive: true });
  const [kw, kl] = KBD.split(':'); const [ew, el] = ESC.split(':');
  const reload = async () => { await D.goto(P, url); await M.settle(P); await M.inject(P); await M.dismissLoadLayer(P, {}); };
  try {
    await M.measure(P, cell, {
      lang, shotBase: path.join(base, pg.key.replace(/[^a-z0-9@-]/gi, '_')),
      axe: AXE_WIDTHS.includes(w) && (w < 1024 || AXE_LANGS_WIDE.includes(lang)),
      kbd: +kw === w && kl === lang,
      esc: +ew === w && el === lang && pg.cls === 'tab-root',
      reload,
    });
  } catch (e) { cell.measureError = String(e.message || e).slice(0, 200); }
  cell.ms = Date.now() - t0;
  return cell;
}

(async () => {
  BUILD = await buildId();
  const b0 = BUILD; const builds = [b0];
  console.log('[uat-std] build at start', JSON.stringify(b0));
  const tok = await tokens();
  // SEEDED LONG CONTENT (seed.cjs): the long-named meet is one more detail route; the long chat is what chat/index shows
  // player-amy and host-ken (their {OTHER} is each other)
  try { const fx = JSON.parse(fs.readFileSync(process.env.FIXTURES || path.join(OUT, 'fixtures.json'), 'utf8')); if (fx.meetId && !PAGES.pages.some((p) => p.key === 'meet@long')) PAGES.pages.push({ key: 'meet@long', route: 'meet/index', params: 'id=' + fx.meetId, cls: 'detail', src: 'src/pages/meet/index.tsx', variant: true }); } catch (e) { console.log('[uat-std] no seeded fixtures (' + String(e.message).slice(0, 60) + ')'); }
  const pages = PAGES.pages.filter((p) => !ONLY || ONLY.has(p.key));
  let jobs = [];
  if (CELLS) { const by = {}; for (const c of CELLS) { const k = c.role + '|' + c.lang + '|' + c.page; (by[k] = by[k] || { role: c.role, lang: c.lang, page: PAGES.pages.find((p) => p.key === c.page), widths: [] }).widths.push(c.w); } jobs = Object.values(by).filter((j) => j.page); }
  else for (const role of ROLES) for (const lang of LANGS) for (const page of pages) jobs.push({ role, lang, page, widths: WIDTHS });
  const total = jobs.reduce((s, j) => s + j.widths.length, 0);
  console.log('[uat-std]', ENGINE, 'jobs', jobs.length, 'renders', total, 'conc', CONC);
  let E = await D.launch(ENGINE); let gen = 0, relaunching = null;
  // THE BROWSER CAN DIE UNDER US (the operator PC runs several lanes' WebKit at once; measured 2026-09-25: "Target page,
  // context or browser has been closed" mid-run). One shared relaunch, then every worker rebuilds its contexts.
  async function revive() {
    if (D.alive(E)) return gen;
    if (!relaunching) relaunching = (async () => { try { await D.end(E); } catch (e) { /* dead */ } E = await D.launch(ENGINE); gen++; console.log('[uat-std] browser relaunched (#' + gen + ')'); })().finally(() => { relaunching = null; });
    await relaunching; return gen;
  }
  const outFile = path.join(OUT, 'cells-' + ENGINE + '-' + RUN + '.jsonl');
  if (!process.env.APPEND) fs.writeFileSync(outFile, '');
  // RESUME: with APPEND=1 the cells already written (and not fatal) are skipped
  const have = new Set(); if (process.env.APPEND && fs.existsSync(outFile)) for (const l of fs.readFileSync(outFile, 'utf8').split('\n')) { try { const c = JSON.parse(l); if (!c.fatal) have.add([c.role, c.lang, c.w, c.page].join('|')); } catch (e) { /* partial line */ } }
  let next = 0, done = 0; const T0 = Date.now();
  async function worker() {
    let ctxs = {}, pagesBy = {}, myGen = gen;
    const fresh = async (role) => { ctxs[role] = await D.context(E, initStorage, { token: role === 'visitor' ? null : tok[role] }); pagesBy[role] = await D.newPage(ctxs[role]); };
    while (next < jobs.length) {
      const job = jobs[next++];
      for (const w of job.widths) {
        if (have.has([job.role, job.lang, w, job.page.key].join('|'))) continue;
        let cell = null;
        for (let attempt = 0; attempt < 3 && !cell; attempt++) {
          try {
            if (myGen !== gen) { ctxs = {}; pagesBy = {}; myGen = gen; }
            if (!ctxs[job.role]) await fresh(job.role);
            cell = await renderCell(pagesBy[job.role], job, w);
          } catch (e) {
            const msg = String(e.message || e);
            if (!D.alive(E) || /closed|crash|disconnected/i.test(msg)) { await revive(); ctxs = {}; pagesBy = {}; myGen = gen; continue; }
            cell = { run: RUN, engine: ENGINE, role: job.role, lang: job.lang, w, page: job.page.key, cls: job.page.cls, fatal: msg.slice(0, 200), build: BUILD && BUILD.appBundle };
            try { await D.close(pagesBy[job.role]); } catch (x) { /* */ }
            try { await fresh(job.role); } catch (x) { await revive(); ctxs = {}; pagesBy = {}; myGen = gen; }
          }
        }
        if (!cell) cell = { run: RUN, engine: ENGINE, role: job.role, lang: job.lang, w, page: job.page.key, cls: job.page.cls, fatal: 'browser died 3 times on this cell', build: BUILD && BUILD.appBundle };
        fs.appendFileSync(outFile, JSON.stringify(cell) + '\n');
        done++;
        if (done % 100 === 0) {
          const nb = await buildId(); if (nb.appBundle !== BUILD.appBundle || nb.engine !== BUILD.engine) { console.log('[uat-std] BUILD CHANGED mid-run', JSON.stringify(nb)); builds.push(nb); } BUILD = nb;
          const el = (Date.now() - T0) / 1000; console.log('[uat-std] ' + done + '/' + total + ' renders · ' + Math.round(el) + ' s · ' + (el / done).toFixed(2) + ' s/render');
        }
      }
    }
    for (const r of Object.keys(ctxs)) { await D.close(pagesBy[r]); await D.closeCtx(ctxs[r]); }
  }
  await Promise.all(Array.from({ length: CONC }, () => worker()));
  await D.end(E);
  const b1 = await buildId(); if (b1.appBundle !== BUILD.appBundle || b1.engine !== BUILD.engine) builds.push(b1);
  console.log('[uat-std] build at end', JSON.stringify(b1));
  const same = builds.length === 1 && b0.appBundle === b1.appBundle && b0.indexSha256 === b1.indexSha256 && b0.engine === b1.engine;
  fs.writeFileSync(path.join(OUT, 'build-' + ENGINE + '-' + RUN + '.json'), JSON.stringify({ start: b0, end: b1, changes: builds, same, renders: done, seconds: Math.round((Date.now() - T0) / 1000) }, null, 1));
  console.log('[uat-std] done', done, 'renders; build unchanged:', same);
})().catch((e) => { console.error('[uat-std] FATAL', e); process.exit(2); });

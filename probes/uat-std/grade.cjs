// UAT-STD GRADER — turns the matrix's raw cells (cells-<engine>-<run>.jsonl) into: per-cell x per-check verdicts
// (PASS / FAIL / FLAKY / NO VERDICT / N/A), one row per FAMILY (law 4), header drift across pages, and the three outputs:
//   /root/gen/l6-scope/uat-std-defects.json · /root/gen/l6-scope/UAT_STD_BASELINE.md (written by report.cjs from grade.json)
//   /root/social-engine/probes/uat-std-baseline.verdict.json
// Re-grade runs (RUN=regrade1, regrade2 …) are read too: a family seen in the baseline cell but not in a re-grade of the
// same cell (preconditions met) is FLAKY; seen every time = confirmed.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const G = require('./grade-lib.cjs');
const OVR = (() => { try { return require('./overrides.json'); } catch (e) { return {}; } })();
// a finding that is not a product defect: the instrument matched data (override 'probe'), a probe artefact, or another lane's [probe] fixture text
const notProduct = (x) => (OVR[x.fam] && OVR[x.fam].class === 'probe') || x.probe || (x.check === '5H' && x.label && x.label.indexOf('[probe') >= 0);
const OUT = process.env.OUT || '/root/gen/l6-scope/uat-std';
const APP = process.env.APP_TREE || '/root/hkpl-taro-branch';
const SEV = { S1: 1, S2: 2, S3: 3, S4: 4 };
const CHECKS = ['5A', '5B', '5C', '5E', '5H', 'SHELL'];

function readCells(file) { if (!fs.existsSync(file)) return []; return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean); }
const key = (c) => [c.engine, c.role, c.lang, c.w, c.page].join('|');

const files = fs.readdirSync(OUT).filter((f) => /^cells-(chromium|webkit)-.+.jsonl$/.test(f));
const byER = {};   // engine -> run -> cells
for (const f of files) { const [, eng, run] = f.match(/^cells-(chromium|webkit)-(.+).jsonl$/); ((byER[eng] = byER[eng] || {})[run] = readCells(path.join(OUT, f))); }
const byRun = {}; for (const e of Object.keys(byER)) for (const r of Object.keys(byER[e])) (byRun[r] = byRun[r] || []).push(...byER[e][r]);
// WHICH RUN IS GRADED, per engine: GRADED='chromium=regrade1,webkit=baseline' (default: 'baseline' for every engine).
// REGRADES='chromium=regrade2+baseline,webkit=regrade1' names the re-grade runs of each engine (default: every run named regrade*).
const perEng = (spec, dflt) => { const m = {}; for (const e of Object.keys(byER)) m[e] = dflt(e); if (spec) for (const part of spec.split(',')) { const [e, v] = part.split('='); if (v !== undefined) m[e] = v.split('+'); else for (const k of Object.keys(m)) m[k] = part.split('+'); } return m; };
const GRADED = perEng(process.env.GRADED || process.env.BASELINE_RUN, () => ['baseline']);
const REGR = perEng(process.env.REGRADES || process.env.REGRADE_RUNS, (e) => Object.keys(byER[e]).filter((r) => /^regrade/.test(r)).sort());
const BASE_RUN = JSON.stringify(GRADED);
const base = []; for (const e of Object.keys(GRADED)) for (const r of GRADED[e]) base.push(...((byER[e] || {})[r] || []));
const regradeNames = []; const regrades = [];
for (const e of Object.keys(REGR)) for (const r of REGR[e]) { if (GRADED[e].includes(r) || !(byER[e] || {})[r]) continue; regradeNames.push(e + ':' + r); regrades.push(byER[e][r]); }
// a merged 'latest' cell is never its own re-grade: the run it came from (c.mergedFrom) is skipped for that cell
const regIndex = regrades.map((cells, i) => { const m = new Map(); const file = 'cells-' + regradeNames[i].replace(':', '-') + '.jsonl'; for (const c of cells) m.set(key(c), Object.assign(c, { __file: file })); return m; });
const regFor = (c) => regIndex.map((m) => m.get(key(c))).filter((r) => r && r.__file !== c.mergedFrom);

function nvReason(c) {
  if (c.fatal) return 'fatal: ' + c.fatal;
  if (!c.pre) return 'no preconditions recorded';
  if (!c.pre.loaded && c.loadingLeft) return 'still loading after 15 s (' + c.loadingLeft + ' skeleton / spinner on screen)';
  if (!c.pre.loaded) return 'page did not load (status ' + c.status + ', text ' + (c.ready ? c.ready.textLen : '?') + ')';
  if (!c.pre.watcher) return 'instrument not injected';
  if (!c.pre.signed) return 'role not signed in as asserted (' + c.pre.signedEvidence + ')';
  if (c.measureError) return 'measure error: ' + c.measureError;
  return null;
}
function cellVerdicts(c) {
  const out = {}; const nv = nvReason(c);
  const F = nv ? [] : G.findings(c);
  for (const ch of CHECKS) {
    if (nv) { out[ch] = { v: 'NO VERDICT', why: nv }; continue; }
    if (ch === '5B' && c.pre.noModal === false) { out[ch] = { v: 'NO VERDICT', why: 'a layer stayed open over the page (' + JSON.stringify((c.modalAfterDismiss || {}).undeclared || (c.modalAfterDismiss || {}).declared || []) + ')' }; continue; }
    const f = F.filter((x) => x.check === ch && !x.review && !notProduct(x));
    out[ch] = f.length ? { v: 'FAIL', fams: [...new Set(f.map((x) => x.fam))], worst: f.map((x) => x.sev).sort()[0] } : { v: 'PASS' };
  }
  if (!nv && !Array.isArray(c.axe) && !c.kbd && !(c.esc && c.esc.length)) out['5E'] = { v: 'N/A', why: 'axe / keyboard / Escape run at 390 (all langs) + 1280 (EN) only' };
  return { verdicts: out, findings: F };
}

// ---- grade every baseline cell, with re-grades for FLAKY ------------------------------------------------------------
const rows = []; const famMap = new Map(); const headerRows = [];
for (const c of base) {
  const { verdicts, findings } = cellVerdicts(c);
  // re-grade: for each FAIL / NO VERDICT, look the same cell up in every re-grade run
  const reg = regFor(c);
  for (const ch of CHECKS) {
    const v = verdicts[ch]; if (!v || (v.v !== 'FAIL' && v.v !== 'NO VERDICT')) continue;
    // a flip on the SAME build is FLAKY (law 3); a flip on a NEWER build is a changed product (another lane shipped), not flakiness
    const againC = reg.map((r) => ({ r, v: cellVerdicts(r).verdicts[ch] })).filter((x) => x.v);
    const again = againC.map((x) => x.v);
    v.regrades = againC.map((x) => x.v.v + (x.r.build !== c.build ? '@' + x.r.build : ''));
    const sameBuild = againC.filter((x) => x.r.build === c.build);
    if (sameBuild.some((x) => x.v.v !== v.v && x.v.v !== 'NO VERDICT')) v.flaky = true;
    else if (againC.some((x) => x.r.build !== c.build && x.v.v !== v.v && x.v.v !== 'NO VERDICT')) v.changedOnNewerBuild = true;
    if (v.v === 'NO VERDICT' && again.length && again.every((a) => a.v !== 'NO VERDICT')) { const a = again[again.length - 1]; v.resolvedBy = a.v; }
  }
  rows.push({ key: key(c), engine: c.engine, role: c.role, lang: c.lang, w: c.w, page: c.page, cls: c.cls, build: c.build, verdicts });
  // records made before the avatar rule (inpage v3 first cut) called the AppHeader's avatar lead (.ah-lead.ah-av) a 'back':
  // normalise from the recorded element class, so every run is graded by the same rule
  if (c.shellRest && c.shellRest.header && c.shellRest.header.left && /\bah-av\b/.test(c.shellRest.header.left.el) && c.shellRest.header.left.kind === 'back') { c.shellRest.header.left.kind = 'avatar'; c.shellRest.header.sig = c.shellRest.header.sig.replace(/^lead:back/, 'lead:avatar'); }
  if (c.shellRest && c.shellRest.header && c.shellRest.header.sig && !nvReason(c)) headerRows.push({ page: c.page, cls: c.cls, w: c.w, role: c.role, lang: c.lang, engine: c.engine, sig: c.shellRest.header.sig, header: c.shellRest.header, shot: c.shotRest });
  else if (!nvReason(c) && c.shellRest) headerRows.push({ page: c.page, cls: c.cls, w: c.w, role: c.role, lang: c.lang, engine: c.engine, sig: 'no-header-row', header: null, shot: c.shotRest });
  const seenHere = new Set();
  for (const f of findings) {
    let F = famMap.get(f.fam);
    if (!F) { F = { fam: f.fam, check: f.check, sev: f.sev, review: !!f.review, probe: !!f.probe, cells: new Set(), inst: 0, pages: new Set(), widths: new Set(), engines: new Set(), langs: new Set(), roles: new Set(), sample: null, flakyCells: 0, confirmedCells: 0 }; famMap.set(f.fam, F); }
    if (SEV[f.sev] < SEV[F.sev]) F.sev = f.sev;
    F.inst++; F.cells.add(key(c)); F.pages.add(c.page); F.widths.add(c.w); F.engines.add(c.engine); F.langs.add(c.lang); F.roles.add(c.role);
    if (!F.sample || (!F.sample.shot && (c.shotRest || c.shotEnd))) F.sample = { cell: key(c), url: c.url, el: f.el, label: f.label, cover: f.cover, detail: f.detail, shot: (f.phase === 'hitEnd' || /page-end/.test(f.fam)) ? (c.shotEnd || c.shotRest) : c.shotRest };
    if (!seenHere.has(f.fam)) {
      seenHere.add(f.fam);
      const reg = regFor(c).filter((r) => !nvReason(r));
      if (reg.length) { const same = reg.filter((r) => r.build === c.build), newer = reg.filter((r) => r.build !== c.build); const has = (r) => G.findings(r).some((x) => x.fam === f.fam); if (reg.every(has)) F.confirmedCells++; else if (same.length && !same.every(has)) F.flakyCells++; else if (newer.length && !newer.every(has)) F.goneOnNewerBuild = (F.goneOnNewerBuild || 0) + 1; else F.flakyCells++; }
    }
  }
}
// header drift (per class x width, across pages, per engine)
const drift = [];
for (const eng of ['chromium', 'webkit']) drift.push(...G.driftFindings(headerRows.filter((r) => r.engine === eng)).map((d) => Object.assign(d, { engine: eng })));
// ONE family per page class (law 4: the rule is "one header per class"); the detail is the class's pattern histogram at 390
const histo = {};
for (const r of headerRows.filter((x) => x.w === 390 && x.engine === 'chromium')) { const h = (histo[r.cls] = histo[r.cls] || {}); (h[r.sig] = h[r.sig] || new Set()).add(r.page); }
const histoText = (cls) => Object.entries(histo[cls] || {}).sort((a, b) => b[1].size - a[1].size).map(([s, p]) => p.size + ' pages ' + s + ' (' + [...p].slice(0, 4).join(', ') + (p.size > 4 ? ' …' : '') + ')').join(' ; ');
for (const d of drift) {
  const fk = d.fam;
  let F = famMap.get(fk);
  if (!F) { F = { fam: fk, check: 'SHELL', sev: d.sev, review: false, cells: new Set(), inst: 0, pages: new Set(), widths: new Set(), engines: new Set(), langs: new Set(), roles: new Set(), sample: null, flakyCells: 0, confirmedCells: 0 }; famMap.set(fk, F); }
  F.inst++; F.pages.add(d.page); F.widths.add(d.w); F.engines.add(d.engine);
  const hr = headerRows.find((r) => r.page === d.page && r.w === d.w && r.engine === d.engine && r.sig === d.sig);
  if (hr) { F.cells.add([hr.engine, hr.role, hr.lang, hr.w, hr.page].join('|')); F.langs.add(hr.lang); F.roles.add(hr.role); }
  if (!F.sample) F.sample = { detail: '', shot: hr && hr.shot, el: hr && hr.header ? hr.header.el : 'no header row', label: hr && hr.header && hr.header.title ? hr.header.title.text : '' };
  F.sample.detail = 'header patterns in this class at 390: ' + histoText(d.fam.split('|').pop());
}

// ---- source file:line for a family (the most specific class token, found in the app tree) -----------------------------
const srcCache = {};
function srcOf(fam, pages) {
  const toks = (fam.match(/\.([a-z][a-z0-9-]{2,})/g) || []).map((t) => t.slice(1)).filter((t) => !/^(is-tap|tap|taro|hk-btn|border-0|nut-button|taro_page|sh-page)$/.test(t) && !/^taro-/.test(t));
  const pageDir = String((pages && pages[0]) || '').replace(/@.*/, '');
  if (!/header-drift/.test(fam)) for (const t of toks.reverse()) {
    const ck = t + '|' + pageDir;
    if (srcCache[ck] !== undefined) { if (srcCache[ck]) return srcCache[ck]; continue; }
    let hits = [];
    try { hits = execFileSync('bash', ['-c', `cd ${APP} && grep -rn -E "(className=[^>]*[\\"' {]${t}([\\"' }]|$))" src --include=*.tsx | head -40 | cut -d: -f1,2`]).toString().trim().split('\n').filter(Boolean); } catch (e) { hits = []; }
    if (!hits.length) { try { hits = execFileSync('bash', ['-c', `cd ${APP} && grep -rn -E "\\.${t}([^a-z0-9-]|$)" src --include=*.scss | head -40 | cut -d: -f1,2`]).toString().trim().split('\n').filter(Boolean); } catch (e) { hits = []; } }
    // the page's own file first, then the shared components, then the first hit anywhere
    const hit = hits.find((h) => pageDir && h.startsWith('src/pages/' + pageDir + '/')) || hits.find((h) => h.startsWith('src/components/')) || hits[0] || '';
    srcCache[ck] = hit ? APP.replace('/root/', '') + '/' + hit : '';
    if (srcCache[ck]) return srcCache[ck];
  }
  if (/header-drift/.test(fam)) return APP.replace('/root/', '') + '/src/components/AppHeader.tsx:18 (the kit header; deviating pages draw their own — see pages)';
  if (/header-drift/.test(fam) && pageDir) { try { const h = execFileSync('bash', ['-c', `cd ${APP} && grep -n -E "AppHeader|className='(bi-top|ah)" src/pages/${pageDir}/index.tsx | head -1 | cut -d: -f1`]).toString().trim(); return APP.replace('/root/', '') + '/src/pages/' + pageDir + '/index.tsx' + (h ? ':' + h : ''); } catch (e) { /* */ } }
  return pageDir ? APP.replace('/root/', '') + '/src/pages/' + pageDir + '/index.tsx' : '';
}

// ---- class: real / probe / env ---------------------------------------------------------------------------------------
function classOf(F) {
  if (OVR[F.fam] && OVR[F.fam].class) return OVR[F.fam].class;
  if (F.probe) return 'probe';
  if (/^5A\|env-/.test(F.fam)) return 'env';
  if (/^5A\|api\|5\d\d/.test(F.fam) || /^5A\|pageerror\|.*(ChunkLoad|Failed to fetch|NetworkError)/.test(F.fam)) return 'env';
  // another lane's '[probe] …' fixture text on screen is environment litter (G13), not a product string
  if (/^5H\|/.test(F.fam) && /\[probe/.test((F.sample && F.sample.label) || '')) return 'env';
  return 'real';
}

const fams = [...famMap.values()].map((F) => {
  const pages = [...F.pages];
  const o = {
    fam: F.fam, check: F.check, severity: F.sev, review: F.review, class: classOf(F),
    cells: F.cells.size, instances: F.inst, pages: pages.sort(), widths: [...F.widths].sort((a, b) => a - b), engines: [...F.engines].sort(), langs: [...F.langs].sort(), roles: [...F.roles].sort(),
    regrade: { confirmedCells: F.confirmedCells, flakyCells: F.flakyCells, goneOnNewerBuild: F.goneOnNewerBuild || 0 },
    screenshot: F.sample && F.sample.shot ? String(F.sample.shot).replace('/root/', '') : null,
    element: F.sample ? F.sample.el : null, label: F.sample ? F.sample.label : null, onTop: F.sample ? F.sample.cover || null : null, detail: F.sample ? F.sample.detail : null, example: F.sample ? F.sample.cell : null, exampleUrl: F.sample ? F.sample.url : null,
  };
  if (OVR[F.fam]) o.classWhy = OVR[F.fam].why;
  o.source = srcOf(F.fam, pages);
  o.owner = G.owner(F.fam, pages);
  return o;
}).sort((a, b) => (a.review - b.review) || SEV[a.severity] - SEV[b.severity] || b.cells - a.cells);
fams.forEach((f, i) => { f.id = 'UAT-' + String(i + 1).padStart(3, '0'); });

// ---- counts --------------------------------------------------------------------------------------------------------
const counts = { cells: rows.length, checks: {}, byCheck: {} };
const tally = { PASS: 0, FAIL: 0, FLAKY: 0, 'NO VERDICT': 0, 'N/A': 0 };
for (const r of rows) for (const ch of CHECKS) {
  const v = r.verdicts[ch]; if (!v) continue;
  const lab = v.flaky ? 'FLAKY' : v.v === 'NO VERDICT' && v.resolvedBy ? v.resolvedBy : v.v;
  tally[lab] = (tally[lab] || 0) + 1;
  (counts.byCheck[ch] = counts.byCheck[ch] || { PASS: 0, FAIL: 0, FLAKY: 0, 'NO VERDICT': 0, 'N/A': 0 })[lab]++;
}
counts.checks = tally;
const realFams = fams.filter((f) => !f.review);
counts.families = { total: realFams.length, review: fams.filter((f) => f.review).length, bySeverity: realFams.reduce((m, f) => (m[f.severity] = (m[f.severity] || 0) + 1, m), {}), byClass: realFams.reduce((m, f) => (m[f.class] = (m[f.class] || 0) + 1, m), {}), byOwner: realFams.reduce((m, f) => (m[f.owner] = (m[f.owner] || 0) + 1, m), {}) };
counts.byEngine = rows.reduce((m, r) => (m[r.engine] = (m[r.engine] || 0) + 1, m), {});
// law 7: which cells ran on which served bundle (another lane deploying mid-run changes it)
counts.byBuild = rows.reduce((m, r) => { const k = r.engine + ' app.' + r.build; m[k] = (m[k] || 0) + 1; return m; }, {});
counts.changedOnNewerBuild = rows.reduce((n, r) => n + Object.values(r.verdicts).filter((v) => v && v.changedOnNewerBuild).length, 0);
// CLOSED DURING THE RUN: families the first (mixed-build) Chromium run saw that the graded Chromium run no longer shows —
// other lanes shipped while this lane measured (law 7). Listed with the builds they were seen on; not re-verified by their owners.
const gradedFams = new Set(); for (const c of base.filter((x) => x.engine === 'chromium')) if (!nvReason(c)) for (const x of G.findings(c)) gradedFams.add(x.fam);
const closedDuringRun = [];
if (!(GRADED.chromium || []).includes('baseline') && byER.chromium && byER.chromium.baseline) {
  const m = new Map();
  for (const c of byER.chromium.baseline) { if (nvReason(c)) continue; for (const x of G.findings(c)) { if (gradedFams.has(x.fam) || x.review || notProduct(x)) continue; let e = m.get(x.fam); if (!e) { e = { fam: x.fam, sev: x.sev, cells: new Set(), pages: new Set(), builds: new Set(), detail: x.detail, label: x.label, shot: c.shotRest }; m.set(x.fam, e); } e.cells.add(key(c)); e.pages.add(c.page); e.builds.add(c.build); } }
  for (const e of m.values()) closedDuringRun.push({ fam: e.fam, severity: e.sev, cells: e.cells.size, pages: [...e.pages].sort(), seenOnBuilds: [...e.builds], detail: e.detail, label: e.label, owner: G.owner(e.fam, [...e.pages]) });
  closedDuringRun.sort((a, b) => b.cells - a.cells);
}
const nonPass = [];
for (const r of rows) for (const ch of CHECKS) { const v = r.verdicts[ch]; if (v && v.v !== 'PASS' && v.v !== 'N/A') nonPass.push([r.engine, r.role, r.lang, r.w, r.page, ch, v.flaky ? 'FLAKY' : v.v, (v.fams || []).join(' ; ') || v.why || '', (v.regrades || []).join('/')]); }
fs.writeFileSync(path.join(OUT, 'uat-std-cells.csv'), 'engine,role,lang,width,page,check,verdict,families_or_reason,regrades\n' + nonPass.map((a) => a.map((x) => '"' + String(x).replace(/"/g, "'") + '"').join(',')).join('\n') + '\n');
fs.writeFileSync(path.join(OUT, 'grade.json'), JSON.stringify({ at: new Date().toISOString(), runs: Object.keys(byRun), gradedRun: BASE_RUN, regradeRuns: regradeNames, counts, families: fams, closedDuringRun, drift, headerRows: headerRows.map((h) => ({ page: h.page, cls: h.cls, w: h.w, engine: h.engine, role: h.role, lang: h.lang, sig: h.sig, title: h.header && h.header.title, left: h.header && h.header.left, right: h.header && h.header.right && h.header.right.map((x) => x.label) })) }, null, 1));
console.log('[uat-std grade] cells', rows.length, JSON.stringify(counts.checks), 'families', JSON.stringify(counts.families));

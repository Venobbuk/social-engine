// UAT-STD SELF-TEST (law 2): every instrument must FAIL on its planted fault and PASS on the clean page, in THIS engine,
// through the same measure.cjs sequence and grade-lib.cjs predicate the baseline uses. Plus one LIVE plant: a covering
// bar injected into the real app page (5B must name it as the cover, and stop naming it once it is removed).
//
//   kaka / Chromium: GB_BROWSER_REMOTE=no bash /root/gen/browser-slot.sh bash probes/run.sh uat-std/selftest.cjs
//   PC / WebKit:     ENGINE=webkit OUT=<dir> node selftest.cjs
'use strict';
if (process.env.ENGINE !== 'webkit') require('../_guard.cjs');
const fs = require('fs');
const path = require('path');
const D = require('./driver.cjs');
const M = require('./measure.cjs');
const G = require('./grade-lib.cjs');
const { page } = require('./plants.cjs');
const ENGINE = process.env.ENGINE || 'chromium';
const OUT = process.env.OUT || '/root/gen/l6-scope/uat-std';
const BASE = process.env.BASE || 'https://uat.gripbat.com';

// id · check · family regex · plant flags · base flags · width · lang · extra step
const CASES = [
  ['5B-pinned', '5B', /^5B\|pinned\|/, { plantCtaUnderBar: true }, { cta: true, plantCtaUnderBar: false }],
  ['5B-bottom', '5B', /^5B\|bottom\|/, { plantNoSpacer: true }, {}],
  ['5B-overlap', '5B', /^5B\|overlap\|/, { plantInFlowCover: true }, {}, 390, 'en', null, true],
  ['5B-undeclared-modal', '5B', /^5B\|undeclared-modal/, { plantUndeclared: true }, {}],
  ['5B-modal-abstains', '5B', 'ABSTAIN', { plantModal: true }, {}],
  ['5C-target-lt24', '5C', /^5C\|target-lt24/, { plantSmall: true }, {}],
  ['5C-target-lt44-primary', '5C', /^5C\|target-lt44/, { plantPrimarySmall: true }, {}],
  ['5C-hscroll-320', '5C', /^5C\|hscroll/, { plantWide: true, pageScrollX: true }, { pageScrollX: true }, 320],
  ['5C-overflow-clipped', '5C', /^5C\|overflow-clipped/, { plantWide: true }, {}, 320],
  ['5C-text-clipped', '5C', /^5C\|text-clipped/, { plantClipped: true }, {}],
  ['5C-name-ellipsis', '5C', /^5C\|name-ellipsis/, { plantEllipsis: true }, {}],
  ['5C-text-overlap', '5C', /^5C\|text-overlap/, { plantOverlapText: true }, {}],
  // UAT-LAYOUT 2026-09-25: text hidden by a clamp / ellipsis is not drawn, so it overlaps nothing (a real overlap still fires);
  // a 2-line clamped name WITH its full name as a title is the 5H rule (no title, or a 3-line clamp, still fires)
  ['5C-text-overlap-vs-clamp', '5C', /^5C\|text-overlap/, { clampRows: true, plantOverlapText: true }, { clampRows: true }],
  ['5C-name-clamped-no-title', '5C', /^5C\|name-clamped/, { clampRows: true, plantClampNoTitle: true }, { clampRows: true }],
  ['5C-name-clamped-3-lines', '5C', /^5C\|name-clamped/, { clampRows: true, plantClamp3: true }, { clampRows: true }],
  // a toast (Taro's DOM) over a control: the tap must reach the control
  ['5B-toast-catches-taps', '5B', /^5B\|toast-catches-taps/, { toast: true, plantToastCatches: true }, { toast: true }],
  // a switch stretched to its row's width is a finding; a 46 px switch in the same row is not
  ['5C-switch-wide', '5C', /^5C\|switch-wide/, { switchRow: true, plantSwitchWide: true }, { switchRow: true }],
  // a visually-hidden screen-reader label is clipped by design and never a text-clipped finding; a real clip still fires
  ['5C-text-clipped-vs-sr-only', '5C', /^5C\|text-clipped/, { srOnly: true, plantClipped: true }, { srOnly: true }],
  // a 2-line heading with a block child (line-height < 1) is 2 lines; a 3-line name still fires
  ['5C-name-wraps-vs-heading', '5C', /^5C\|name-wraps-3plus/, { clampRows: true, plantNameWrap: true }, { clampRows: true }],
  ['5C-name-wraps-3plus', '5C', /^5C\|name-wraps-3plus/, { plantNameWrap: true }, {}],
  ['5C-sticky-stack', '5C', /^5C\|sticky-stack/, { plantSticky2: true }, {}],
  ['5C-inner-scrollbar', '5C', /^5C\|inner-scrollbar/, { plantScrollbar: true }, {}, 1280],
  ['5C-row-cut-at-edge', '5C', /^5C\|row-cut-at-edge/, { plantChipCut: true }, {}],
  ['5E-axe', '5E', /^5E\|axe\|/, { plantImgNoAlt: true }, {}, 390, 'en', 'axe'],
  ['5E-kbd-trap', '5E', /^5E\|kbd-trap/, { plantTrap: true }, {}, 1280, 'en', 'kbd'],
  ['5E-kbd-unreachable', '5E', /^5E\|kbd-unreachable/, { plantUnreachable: true }, {}, 1280, 'en', 'kbd'],
  ['5E-kbd-no-visible-focus', '5E', /^5E\|kbd-no-visible-focus/, { plantNoFocus: true }, {}, 1280, 'en', 'kbd'],
  ['5E-escape-ignored', '5E', /^5E\|escape-ignored/, { plantEscapeIgnored: true }, {}, 390, 'en', 'esc'],
  ['5H-raw-key', '5H', /^5H\|raw-key/, { plantKey: true }, {}],
  ['5H-uuid', '5H', /^5H\|uuid/, { plantUuid: true }, {}],
  ['5H-raw-id', '5H', /^5H\|raw-id/, { plantAid: true }, {}],
  ['5H-junk', '5H', /^5H\|junk/, { plantJunk: true }, {}],
  ['5H-english-on-zh', '5H', /^5H\|english-on-zh\|/, { plantEnglish: true, lang: 'zh_Hant' }, { lang: 'zh_Hant' }, 390, 'zh_Hant'],
  ['5H-g2-brand', '5H', /^5H\|g2-brand/, { plantG2: true }, {}],
  ['5H-g2-title', '5H', /^5H\|g2-brand\|.*\|title-meta/, { title: 'HKPL · GripBat' }, {}],
  ['5H-signin-dead-end', '5H', /^5H\|signin-dead-end/, { signinText: true, plantDeadEnd: true }, { signinText: true }],
  ['SHELL-floater-tabbar', 'SHELL', /^SHELL\|floater-tabbar/, { plantFabOnBar: true }, { fab: true }],
  ['SHELL-floater-floater', 'SHELL', /^SHELL\|floater-floater/, { plantFabFab: true }, { fab: true }],
  ['SHELL-floater-page-end', 'SHELL', /^SHELL\|floater-over-page-end/, { plantNoSpacer: true, fab: true }, { fab: true }],
];

async function one(E, P, id, flags, w, lang, extra) {
  await D.viewport(P, w, w >= 1024 ? 900 : w === 320 ? 640 : 844);
  await D.content(P, page(flags));
  await M.inject(P);
  const cell = { engine: ENGINE, role: 'selftest', lang, w, page: id, pre: { loaded: true, watcher: true } };
  await M.measure(P, cell, { lang, axe: extra === 'axe', kbd: extra === 'kbd', esc: extra === 'esc', reload: async () => { await D.content(P, page(flags)); await M.inject(P); } });
  return cell;
}

async function livePlant(P) {
  // the real app, the real shell, one covering bar injected where the tab bar lives (and above it): 5B must name it
  await D.viewport(P, 390, 844);
  await D.goto(P, BASE + '/app/pages/community/index?lang=en');
  await M.settle(P); await M.inject(P);
  const before = await D.ev(P, () => { window.__gbUat.scrollAll(false); return window.__gbUat.hitScan(); });
  await D.ev(P, () => { const d = document.createElement('div'); d.id = 'gbuat-plant'; d.style.cssText = 'position:fixed;left:0;right:0;bottom:0;height:340px;z-index:99999;background:rgba(255,0,0,.2)'; document.body.appendChild(d); });
  const rest = await D.ev(P, () => window.__gbUat.hitScan());
  await D.ev(P, () => window.__gbUat.scrollAll(true)); await M.sleep(400);
  const end = await D.ev(P, () => window.__gbUat.hitScan());
  await D.ev(P, () => { document.getElementById('gbuat-plant').remove(); window.__gbUat.scrollAll(false); });
  const after = await D.ev(P, () => window.__gbUat.hitScan());
  const byPlant = (h) => (h.found || []).filter((f) => /gbuat-plant/.test(f.cover + ' ' + f.coverPath));
  return {
    id: '5B-live-plant (community/index, 390, visitor)',
    plantFired: byPlant(rest).length + byPlant(end).length > 0,
    plantKinds: [...new Set(byPlant(rest).concat(byPlant(end)).map((f) => f.kind))],
    cleanPassed: byPlant(after).length === 0 && byPlant(before).length === 0,
    checked: rest.checked, beforeFound: (before.found || []).length, restByPlant: byPlant(rest).length, endByPlant: byPlant(end).length, afterByPlant: byPlant(after).length,
  };
}

async function liveToast(P) {
  // the real app at 390: Taro's toast DOM injected over the page. The APP's css must make it tap-through (clean); the same toast
  // with pointer-events forced back on must be caught (plant) — so a pass cannot come from an instrument that sees nothing
  await D.viewport(P, 390, 844);
  await D.goto(P, BASE + '/app/pages/community/index?lang=en');
  await M.settle(P); await M.inject(P);
  const put = (force) => D.ev(P, (f) => { const o = document.getElementById('gbuat-toast'); if (o) o.remove(); const d = document.createElement('div'); d.id = 'gbuat-toast'; d.className = 'taro__toast'; d.innerHTML = '<div style="position:fixed;z-index:1000;top:0;right:0;left:0;bottom:0;display:none"></div><div style="z-index:5000;display:flex;flex-direction:column;justify-content:center;position:fixed;top:50%;left:50%;min-width:120px;min-height:120px;padding:15px;transform:translate(-50%,-50%);background:rgba(17,17,17,.7);color:#fff' + (f ? ';pointer-events:auto' : '') + '"><p style="' + (f ? 'pointer-events:auto' : '') + '">Matches generated</p></div>'; document.body.appendChild(d); return window.__gbUat.toastBlocks(); }, force);
  const clean = await put(false), plant = await put(true);
  await D.ev(P, () => { const o = document.getElementById('gbuat-toast'); if (o) o.remove(); });
  return { id: '5B-live-toast (community/index, 390, the app css)', plantFired: plant.length > 0, cleanPassed: clean.length === 0, clean, plant };
}

function driftSelfTest() {
  const mk = (page, sig) => ({ page, cls: 'tab-root', w: 390, sig });
  const clean = G.driftFindings([mk('a', 'lead:none|title:center'), mk('b', 'lead:none|title:center'), mk('c', 'lead:none|title:center')]);
  const plant = G.driftFindings([mk('a', 'lead:none|title:center'), mk('b', 'lead:none|title:center'), mk('c', 'lead:avatar|title:none|logo:y')]);
  return { id: 'SHELL-header-drift (cross-page rule)', plantFired: plant.length === 1 && plant[0].page === 'c', cleanPassed: clean.length === 0 };
}

(async () => {
  let E = await D.launch(ENGINE);
  let C = await D.context(E, () => undefined, null);
  let P = await D.newPage(C);
  // the operator PC can kill a WebKit mid-run (other lanes share it): relaunch and retry the case once
  const relaunch = async () => { try { await D.end(E); } catch (x) { /* dead */ } E = await D.launch(ENGINE); C = await D.context(E, () => undefined, null); P = await D.newPage(C); };
  const results = [];
  const cap = await (async () => { await D.viewport(P, 1280, 900); await D.content(P, page({})); await M.inject(P); return D.ev(P, () => window.__gbUat.scrollbarCapability()); })();
  const capMobile = await (async () => { await D.viewport(P, 390, 844); await D.content(P, page({})); await M.inject(P); return D.ev(P, () => window.__gbUat.scrollbarCapability()); })();
  const ONLYC = process.env.CASES ? new RegExp(process.env.CASES) : null;
  for (const [id, check, fam, plantFlags, baseFlags, w = 390, lang = 'en', extra = null, allowReview = false] of CASES) {
    if (ONLYC && !ONLYC.test(id)) continue;
    const r = { id, check, w, lang };
    for (let attempt = 0; attempt < 2; attempt++) {
    try {
      // 5C-inner-scrollbar is graded on the CSS fact (a scrollbar not hidden), so it runs in every engine; the sentinel px is reported
      const clean = await one(E, P, id + '-clean', Object.assign({ lang }, baseFlags), w, lang, extra);
      const plant = await one(E, P, id + '-plant', Object.assign({ lang }, baseFlags, plantFlags), w, lang, extra);
      const hits = (cell) => G.findings(cell).filter((f) => (allowReview || !f.review) && fam.test && fam.test(f.fam));
      if (fam === 'ABSTAIN') { r.plantFired = plant.pre.noModal === false; r.cleanPassed = clean.pre.noModal === true; r.detail = { plantModal: plant.modalAtLoad, dismissed: plant.dismissed }; }
      else { const hp = hits(plant), hc = hits(clean); r.plantFired = hp.length > 0; r.cleanPassed = hc.length === 0; r.plantHits = hp.slice(0, 3).map((f) => f.fam + ' ' + (f.detail || '')); r.cleanHits = hc.slice(0, 3).map((f) => f.fam + ' ' + (f.detail || '')); }
      r.verdict = r.plantFired && r.cleanPassed ? 'pass' : 'fail';
    } catch (e) { r.verdict = 'no_verdict'; r.error = String(e.message || e).slice(0, 200); if (attempt === 0 && /closed|crash|disconnected/i.test(r.error)) { await relaunch(); delete r.error; continue; } }
    break; }
    results.push(r);
    console.log((r.verdict === 'pass' ? 'PASS ' : r.verdict.toUpperCase() + ' ') + id + (r.verdict !== 'pass' ? ' ' + JSON.stringify({ plantFired: r.plantFired, cleanPassed: r.cleanPassed, cleanHits: r.cleanHits, plantHits: r.plantHits, error: r.error, why: r.why }) : ''));
  }
  // standard section 13: regexes written through shells lose their backslashes (\b becomes a backspace or a bare 'b')
  { const ok = (s) => !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(s) && /ALLOW_LATIN = \/\\b\(GripBat/.test(s) && /STOP = \/\\b\(the/.test(s);
    const src = fs.readFileSync(path.join(__dirname, 'inpage.js'), 'utf8');
    const planted = src.replace('ALLOW_LATIN = /\\b(GripBat', 'ALLOW_LATIN = /b(GripBat').replace('STOP = /\\b(the', 'STOP = /\b(the');
    const g = { id: 'GUARD-inpage-regex-integrity', plantFired: !ok(planted), cleanPassed: ok(src) }; g.verdict = g.plantFired && g.cleanPassed ? 'pass' : 'fail'; results.push(g); console.log(g.verdict.toUpperCase() + ' ' + g.id); }
  if (!ONLYC) { const d = driftSelfTest(); d.verdict = d.plantFired && d.cleanPassed ? 'pass' : 'fail'; results.push(d); console.log(d.verdict.toUpperCase() + ' ' + d.id); }
  if (!ONLYC || ONLYC.test('5B-live-toast')) try { const lt = await liveToast(P); lt.verdict = lt.plantFired && lt.cleanPassed ? 'pass' : 'fail'; results.push(lt); console.log(lt.verdict.toUpperCase() + ' ' + lt.id + ' ' + JSON.stringify(lt)); } catch (e) { results.push({ id: '5B-live-toast', verdict: 'no_verdict', error: String(e.message).slice(0, 200) }); }
  if (!ONLYC) try { const lp = await livePlant(P); lp.verdict = lp.plantFired && lp.cleanPassed ? 'pass' : 'fail'; results.push(lp); console.log(lp.verdict.toUpperCase() + ' ' + lp.id + ' ' + JSON.stringify(lp)); } catch (e) { results.push({ id: '5B-live-plant', verdict: 'no_verdict', error: String(e.message).slice(0, 200) }); }
  await D.end(E);
  const pass = results.filter((r) => r.verdict === 'pass').length, fail = results.filter((r) => r.verdict === 'fail').length, nv = results.filter((r) => r.verdict === 'no_verdict').length;
  const v = { id: 'uat-std-selftest-' + ENGINE, at: new Date().toISOString(), engine: ENGINE, scrollbarSentinelPx: { desktop1280: cap, mobile390: capMobile }, condition_fired: results.every((r) => r.verdict !== 'pass' || r.plantFired), verdict: fail ? 'fail' : nv ? 'no_verdict' : 'pass', counts: { pass, fail, no_verdict: nv, total: results.length }, results };
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'selftest-' + ENGINE + (ONLYC ? '-partial' : '') + '.json'), JSON.stringify(v, null, 1));
  console.log('[uat-std selftest]', ENGINE, v.verdict, JSON.stringify(v.counts), 'scrollbar sentinel', JSON.stringify(v.scrollbarSentinelPx));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('[uat-std selftest] FATAL', e); process.exit(2); });

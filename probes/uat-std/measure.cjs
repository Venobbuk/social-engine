// UAT-STD measurement sequence for ONE render — shared by the matrix (real pages) and the self-test (planted pages), so the
// self-test exercises exactly the sequence the baseline runs. Every value comes from inpage.js; this file only orders the
// steps (at rest -> every scroller at its end -> back), dismisses a layer that is open at load, and runs axe / keyboard /
// Escape where asked.
'use strict';
const fs = require('fs');
const path = require('path');
const D = require('./driver.cjs');
const INPAGE = fs.readFileSync(path.join(__dirname, 'inpage.js'), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let AXE = null;
function axeSource(engine) { if (!AXE) AXE = fs.readFileSync(process.env.AXE || (engine === 'webkit' ? 'D:/tmp/gb-uat-tools/node_modules/axe-core/axe.min.js' : '/root/gen/uat-tools/node_modules/axe-core/axe.min.js'), 'utf8'); return AXE; }

async function settle(P) {
  const t0 = Date.now(); let last = -1, same = 0;
  while (Date.now() - t0 < 12000) {
    await sleep(350);
    let n = -1; try { n = await D.ev(P, () => (document.body && document.body.innerText || '').length + document.querySelectorAll('*').length); } catch (e) { n = -2; }
    if (n === last && n > 0) { same++; if (same >= 3 && Date.now() - t0 > 1500) break; } else same = 0;
    last = n;
  }
  return Date.now() - t0;
}
/** After inject: wait (<= ms) until no skeleton / spinner is on screen. Returns how many are left (0 = loaded). */
async function waitLoaded(P, ms = 15000) {
  const t0 = Date.now(); let n = 0;
  while (Date.now() - t0 < ms) { n = await D.ev(P, () => window.__gbUat.loading()).catch(() => 0); if (!n) return 0; await sleep(500); }
  return n;
}
async function inject(P) { await D.evs(P, INPAGE); return D.ev(P, () => !!(window.__gbUat && window.__gbUat.v === 3)); }

async function axeRun(P) {
  await D.evs(P, axeSource(P.E.engine));
  return D.ev(P, async () => {
    const r = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] }, resultTypes: ['violations'] });
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, n: v.nodes.length, help: v.help, sc: v.tags.filter((t) => /^wcag\d{3,4}$/.test(t)).join(','), targets: v.nodes.slice(0, 4).map((n) => String(n.target && n.target[0] || '').slice(0, 100)) }));
  });
}

async function keyboardWalk(P) {
  await D.ev(P, () => { window.__gbUat.scrollAll(false); if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); });
  const ctl = await D.ev(P, () => window.__gbUat.controls());
  const nf = await D.ev(P, () => window.__gbUat.focusables());
  const max = Math.min(120, Math.max(20, Math.round(nf * 1.3) + 5));
  const stops = []; let stuck = 0, trap = null, prev = null;
  for (let i = 0; i < max; i++) {
    await D.key(P, 'Tab'); await sleep(40);
    const f = await D.ev(P, () => window.__gbUat.focusInfo());
    if (f.el && prev && f.uid === prev.uid) { stuck++; if (stuck >= 3 && nf > 1) { trap = f; break; } } else stuck = 0;
    if (f.el && stops.length && f.uid === stops[0].uid && stops.length > 2) break;   // wrapped round
    if (f.el) stops.push(f);
    prev = f;
  }
  const uniq = [...new Map(stops.map((s) => [s.uid, s])).values()];
  const notFocusable = ctl.filter((c) => !c.focusable);
  return { controls: ctl.length, focusables: nf, stops: uniq.length, noRing: uniq.filter((s) => !s.ring).map((s) => s.el + ' "' + s.label + '"').slice(0, 12), noRingN: uniq.filter((s) => !s.ring).length, obscured: uniq.filter((s) => s.obscured).map((s) => s.el).slice(0, 8), obscuredN: uniq.filter((s) => s.obscured).length, trap: trap ? trap.el : null, notFocusableN: notFocusable.length, notFocusable: notFocusable.map((c) => c.el + ' "' + c.label + '"').slice(0, 15) };
}

/** Tap each header action; when a layer opens, press Escape and see whether it closes. `reload` restores the page. */
async function escapeCheck(P, reload) {
  const sh = await D.ev(P, () => window.__gbUat.shell());
  const acts = (sh.header && sh.header.right) || [];
  const res = [];
  for (const a of acts.slice(0, 4)) {
    const before = await D.ev(P, () => location.pathname + location.search);
    const n0 = await D.ev(P, () => document.querySelectorAll('body *').length);
    await D.tap(P, a.rect.x + a.rect.w / 2, a.rect.y + a.rect.h / 2); await sleep(900);
    const after = await D.ev(P, () => location.pathname + location.search);
    if (after !== before) { res.push({ control: a.el, label: a.label, result: 'navigates', to: after.slice(0, 80) }); await reload(); continue; }
    const m = await D.ev(P, () => window.__gbUat.modalState());
    const grew = (await D.ev(P, () => document.querySelectorAll('body *').length)) - n0;
    if (!m.open && grew < 5) { res.push({ control: a.el, label: a.label, result: 'no-layer' }); continue; }
    await D.key(P, 'Escape'); await sleep(600);
    const m2 = await D.ev(P, () => window.__gbUat.modalState());
    const grew2 = (await D.ev(P, () => document.querySelectorAll('body *').length)) - n0;
    res.push({ control: a.el, label: a.label, result: m.open ? (m2.open ? 'escape-ignored' : 'escape-closes') : (grew2 >= 5 ? 'layer-without-aria-modal-escape-ignored' : 'layer-without-aria-modal-escape-closes'), declared: m.declared, undeclared: m.undeclared });
    if (m2.open || grew2 >= 5) await reload();
  }
  return res;
}

/** A layer open at load (a first-run prompt, an award popup) is recorded, then dismissed with Escape and with its own
 *  Close / Not now control tapped at its centre; if it will not go, 5B abstains for the cell (law 1). */
async function dismissLoadLayer(P, cell) {
  let ms = await D.ev(P, () => window.__gbUat.modalState());
  if (ms.open) {
    cell.modalAtLoad = ms; cell.dismissed = [];
    await D.key(P, 'Escape'); await sleep(500);
    ms = await D.ev(P, () => window.__gbUat.modalState()); cell.escapeClosedLoadLayer = !ms.open;
    for (let round = 0; round < 4 && ms.open; round++) {
      const cl = await D.ev(P, () => window.__gbUat.closers());
      if (!cl.length) break;
      const c = cl[0]; await D.tap(P, c.rect.x + c.rect.w / 2, c.rect.y + c.rect.h / 2); cell.dismissed.push(c.el + ' "' + c.label + '"'); await sleep(700);
      ms = await D.ev(P, () => window.__gbUat.modalState());
    }
    cell.modalAfterDismiss = ms.open ? ms : null;
  }
  return !ms.open;
}

/** The body of a render after the page is loaded and the watcher injected. opts: { lang, shotBase, axe, kbd, esc, reload } */
async function measure(P, cell, opts) {
  cell.pre.noModal = await dismissLoadLayer(P, cell).catch((e) => { cell.modalError = String(e.message).slice(0, 100); return false; });
  cell.hitRest = await D.ev(P, () => window.__gbUat.hitScan());
  cell.shellRest = await D.ev(P, () => window.__gbUat.shell());
  cell.c5 = await D.ev(P, () => window.__gbUat.c5());
  cell.h5 = await D.ev(P, (l) => window.__gbUat.h5(l), opts.lang);
  if (opts.shotBase) cell.shotRest = await D.shot(P, opts.shotBase + '-rest.jpg');
  cell.scrolled = await D.ev(P, () => window.__gbUat.scrollAll(true)); await sleep(500);
  cell.hitEnd = await D.ev(P, () => window.__gbUat.hitScan());
  cell.shellEnd = await D.ev(P, () => window.__gbUat.shell());
  cell.stickyEnd = (await D.ev(P, () => window.__gbUat.c5())).stickyStack;
  if (opts.shotBase && ((cell.hitEnd.found || []).length || (cell.shellEnd.overlaps || []).length)) cell.shotEnd = await D.shot(P, opts.shotBase + '-end.jpg');
  await D.ev(P, () => window.__gbUat.scrollAll(false));
  if (opts.axe) cell.axe = await axeRun(P).catch((e) => ({ error: String(e.message).slice(0, 120) }));
  if (opts.kbd) cell.kbd = await keyboardWalk(P).catch((e) => ({ error: String(e.message).slice(0, 120) }));
  if (opts.esc) cell.esc = await escapeCheck(P, opts.reload).catch((e) => ([{ error: String(e.message).slice(0, 120) }]));
  return cell;
}
module.exports = { settle, waitLoaded, inject, axeRun, keyboardWalk, escapeCheck, dismissLoadLayer, measure, sleep };

// UAT-STD: the facts behind the operator's six findings, read from the graded 'latest' cells and the first baseline cells of
// home / inbox at 390 (Chromium, EN) — prints JSON for report-extra.json.
'use strict';
const fs = require('fs');
const OUT = process.env.OUT || '/root/gen/l6-scope/uat-std';
const read = (f) => fs.readFileSync(OUT + '/' + f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const pick = (L, page, role, w = 390, lang = 'en') => L.find((c) => c.page === page && c.role === role && c.w === w && c.lang === lang);
const out = {};
for (const [run, file] of [['baseline', 'cells-chromium-baseline.jsonl'], ['latest', 'cells-chromium-latest.jsonl']]) {
  const L = read(file); const o = out[run] = {};
  for (const role of ['visitor', 'player-amy']) for (const page of ['home', 'inbox']) {
    const c = pick(L, page, role); if (!c || !c.shellRest) { o[page + '/' + role] = null; continue; }
    const h = c.shellRest.header || {};
    o[page + '/' + role] = {
      build: c.build, header: h.sig, left: h.left && h.left.el, title: h.title && h.title.text, right: (h.right || []).map((x) => x.label),
      floaters: (c.shellRest.floaters || []).map((f) => f.btn + ' ' + JSON.stringify(f.rect) + ' z' + f.z),
      overlaps: (c.shellRest.overlaps || []).map((x) => x.kind + ': ' + x.a + ' ~ ' + (x.b || (x.over || []).join(',')) + (x.px ? ' ' + x.px + 'px' : '')),
      innerScrollbars: (c.c5.innerScrollbars || []).map((s) => s.el.split(' > ').pop() + ' drawn ' + s.measured + 'px'),
      deadEnd: c.h5 && c.h5.deadEnd, rowCut: (c.c5.hscrollers || []).filter((x) => x.cutChild).map((x) => x.desc + ' "' + x.cutChild.text + '" ' + x.cutChild.visiblePx + '/' + x.cutChild.of + 'px cue ' + x.affordance),
      nameWrap: (c.c5.nameWrap || []).map((x) => x.el.split(' > ').pop() + ' "' + x.text + '" ' + x.lines + ' lines'),
      crestClamp: (c.c5.clamp || []).filter((x) => /crest/.test(x.el)).map((x) => '"' + x.text + '" clamp ' + x.lines),
      shot: c.shotRest,
    };
  }
}
// the scrollbar fact in the engine that draws classic bars: Chromium 1280 (desktop), home + inbox
const L = read('cells-chromium-latest.jsonl');
out.scrollbar1280 = ['home', 'inbox'].map((p) => { const c = pick(L, p, 'visitor', 1280); return c && { page: p, build: c.build, bars: (c.c5.innerScrollbars || []).map((s) => s.el.split(' > ').pop() + ' ' + s.measured + 'px'), shot: c.shotRest }; });
console.log(JSON.stringify(out, null, 1));

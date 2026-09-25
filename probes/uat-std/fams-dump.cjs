// UAT-STD helper: print the graded families (grade.json) one line each — for the lane's own review, prints no tokens.
'use strict';
const g = require((process.env.OUT || '/root/gen/l6-scope/uat-std') + '/grade.json');
const re = process.env.FAM ? new RegExp(process.env.FAM) : null;
console.log(JSON.stringify(g.counts.checks), JSON.stringify(g.counts.families), 'graded', g.gradedRun, 'regrades', JSON.stringify(g.regradeRuns));
for (const f of g.families) {
  if (re && !re.test(f.fam)) continue;
  if (!re && process.env.SEVMAX && f.severity > process.env.SEVMAX) continue;
  console.log([f.id, f.severity, f.review ? 'R' : '-', f.class, f.cells + 'c', f.fam.slice(0, 95), f.pages.length + 'p:' + f.pages.slice(0, 5).join(','), f.widths.join('/'), f.engines.join('/'), f.owner, 'rg ' + JSON.stringify(f.regrade), String(f.label || '').slice(0, 30), String(f.onTop || '').slice(0, 40), String(f.detail || '').slice(0, process.env.DW ? +process.env.DW : 90), f.source].join(' | '));
}

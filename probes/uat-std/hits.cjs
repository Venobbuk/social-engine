// UAT-STD helper: list the distinct 5H hits (text + element) per page for one kind (english | g2 | aid | rawKey | junk) in a run,
// so each family can be classified real / probe by reading what it matched. Usage: KIND=english RUN=regrade1 node hits.cjs
'use strict';
const fs = require('fs');
const OUT = process.env.OUT || '/root/gen/l6-scope/uat-std';
const KIND = process.env.KIND || 'english', RUN = process.env.RUN || 'regrade1', ENGINE = process.env.ENGINE || 'chromium';
const by = {};
for (const l of fs.readFileSync(OUT + '/cells-' + ENGINE + '-' + RUN + '.jsonl', 'utf8').split('\n')) {
  if (!l) continue; const c = JSON.parse(l); if (!c.h5) continue;
  for (const x of c.h5[KIND] || []) { const k = c.page; (by[k] = by[k] || new Map()).set(x.hit + ' @ ' + String(x.el).split(' > ').pop() + (x.attr ? ' [' + x.attr + ']' : ''), (by[k].get(x.hit + ' @ ' + String(x.el).split(' > ').pop() + (x.attr ? ' [' + x.attr + ']' : '')) || 0) + 1); }
}
for (const [p, m] of Object.entries(by)) { console.log('== ' + p); for (const [k, n] of [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, +(process.env.N || 6))) console.log('   ' + n + '  ' + k.slice(0, 140)); }

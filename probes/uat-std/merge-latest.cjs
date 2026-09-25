// UAT-STD: build the "latest" run of one engine — every cell's MOST RECENT measurement across the given runs (later runs win),
// so the graded picture is the newest build each cell was seen on, and the earlier runs become its re-grades (law 3).
//   ENGINE=chromium node merge-latest.cjs <out.jsonl> <run1.jsonl> <run2.jsonl> ...   (oldest first)
'use strict';
const fs = require('fs');
const [out, ...ins] = process.argv.slice(2);
const key = (c) => [c.engine, c.role, c.lang, c.w, c.page].join('|');
const m = new Map(); const from = {};
for (const f of ins) {
  let n = 0;
  for (const l of fs.readFileSync(f, 'utf8').split('\n')) { if (!l) continue; let c; try { c = JSON.parse(l); } catch (e) { continue; } if (c.fatal && m.has(key(c))) continue; m.set(key(c), Object.assign(c, { mergedFrom: f.split('/').pop() })); n++; }
  from[f] = n;
}
fs.writeFileSync(out, [...m.values()].map((c) => JSON.stringify(c)).join('\n') + '\n');
const byRun = {}; for (const c of m.values()) byRun[c.mergedFrom] = (byRun[c.mergedFrom] || 0) + 1;
console.log('[merge-latest]', m.size, 'cells →', out, '· latest measurement from', JSON.stringify(byRun));

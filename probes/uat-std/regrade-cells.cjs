// UAT-STD law 3: the cell list to re-grade — every baseline cell with a FAIL or NO VERDICT (from uat-std-cells.csv, which
// grade.cjs writes), for one engine. Usage: ENGINE=chromium node regrade-cells.cjs > /root/gen/l6-scope/uat-std/regrade-cells-chromium.json
'use strict';
const fs = require('fs');
const OUT = process.env.OUT || '/root/gen/l6-scope/uat-std';
const ENGINE = process.env.ENGINE || 'chromium';
const rows = fs.readFileSync(OUT + '/uat-std-cells.csv', 'utf8').split('\n').slice(1).filter(Boolean).map((l) => l.split('","').map((x) => x.replace(/^"|"$/g, '')));
const seen = new Map();
for (const [engine, role, lang, w, page, , verdict] of rows) {
  if (engine !== ENGINE || !/FAIL|NO VERDICT/.test(verdict)) continue;
  const k = [role, lang, w, page].join('|'); if (!seen.has(k)) seen.set(k, { role, lang, w: +w, page });
}
process.stdout.write(JSON.stringify([...seen.values()]));
console.error('[uat-std regrade] ' + ENGINE + ': ' + seen.size + ' cells to re-grade');

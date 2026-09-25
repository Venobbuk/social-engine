// UAT-STD: the WebKit half runs on the operator PC; its cells carry Windows screenshot paths. After the cells and shots are
// copied to kaka (OUT/shots/webkit/...), rewrite shotRest / shotEnd to the kaka path. Usage: node fix-wk-paths.cjs <cells.jsonl>
'use strict';
const fs = require('fs');
const OUT = process.env.OUT || '/root/gen/l6-scope/uat-std';
const f = process.argv[2];
const L = fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const fix = (p) => { if (!p) return p; const s = String(p).replace(/\\/g, '/'); const i = s.indexOf('shots/webkit/'); return i < 0 ? s : OUT + '/' + s.slice(i); };
let n = 0; for (const c of L) for (const k of ['shotRest', 'shotEnd']) if (c[k]) { c[k] = fix(c[k]); n++; }
fs.writeFileSync(f, L.map((x) => JSON.stringify(x)).join('\n') + '\n');
const miss = L.filter((c) => c.shotRest && !fs.existsSync(c.shotRest)).length;
console.log('[fix-wk-paths] rewrote', n, 'paths; missing files', miss, '; e.g.', (L.find((c) => c.shotRest) || {}).shotRest);

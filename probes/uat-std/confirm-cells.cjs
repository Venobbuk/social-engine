// UAT-STD: the cells for the END-OF-RUN confirmation on the build that is live now — every cell of every S1/S2 family, plus the
// shell pages of the operator's findings (home, inbox, community at 390, visitor + player-amy, EN), one engine.
//   ENGINE=chromium node confirm-cells.cjs > confirm-cells.json
'use strict';
const fs = require('fs');
const OUT = process.env.OUT || '/root/gen/l6-scope/uat-std';
const ENGINE = process.env.ENGINE || 'chromium';
const g = JSON.parse(fs.readFileSync(OUT + '/grade.json', 'utf8'));
const hi = new Set(g.families.filter((f) => !f.review && (f.severity === 'S1' || f.severity === 'S2')).map((f) => f.fam));
const rows = fs.readFileSync(OUT + '/uat-std-cells.csv', 'utf8').split('\n').slice(1).filter(Boolean).map((l) => l.split('","').map((x) => x.replace(/^"|"$/g, '')));
const m = new Map();
for (const [engine, role, lang, w, page, , , fams] of rows) { if (engine !== ENGINE) continue; if (!String(fams).split(' ; ').some((f) => hi.has(f))) continue; m.set([role, lang, w, page].join('|'), { role, lang, w: +w, page }); }
for (const role of ['visitor', 'player-amy']) for (const page of ['home', 'inbox', 'community']) m.set([role, 'en', 390, page].join('|'), { role, lang: 'en', w: 390, page });
process.stdout.write(JSON.stringify([...m.values()]));
console.error('[confirm-cells] ' + ENGINE + ': ' + m.size + ' cells (' + hi.size + ' S1/S2 families)');

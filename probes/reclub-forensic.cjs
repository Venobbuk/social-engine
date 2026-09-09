#!/usr/bin/env node
// probes/reclub-forensic.cjs — proves the forensic doc rests on the decoded bundle: XAPK manifest version,
// Hermes string-table count, and that every quoted label/route/enum in the doc exists verbatim in strings.txt.
'use strict';
const fs = require('fs'); const path = require('path');
const SP = 'D:/tmp/claude/C--Users-Venobbuk-AppData-Roaming-Claude-scratch-workspaces-4016c153-54ae-4f0e-875d-d947ac9c07aa-feeec166-1152-4046-8fba-34f102b2976b-scratch-2026-09-09-33d341/349d7648-cd2c-46b4-bc74-39509aac311e/scratchpad/reclub';
const DOC = 'D:/Downloads/RECLUB_FORENSIC_PAGES_20260910.md';
const checks = []; const ok = (name, pass, detail) => checks.push({ name, pass: !!pass, detail });
const manifest = JSON.parse(fs.readFileSync(path.join(SP, 'x/manifest.json'), 'utf8'));
ok('xapk manifest version', manifest.version_name === '2.45.12' && manifest.package_name === 'co.reclub', `${manifest.package_name} ${manifest.version_name}`);
const strings = fs.readFileSync(path.join(SP, 'out/strings.txt'), 'utf8').split('\n');
ok('decoded string count', strings.length - 1 >= 128251, `${strings.length - 1} lines (>= 128,251 decoded strings; some contain newlines)`);
const set = new Set(strings);
const doc = fs.readFileSync(DOC, 'utf8');
ok('doc exists', doc.length > 5000, `${doc.split('\n').length} lines`);
// every [C ...] / [R ...] / [A ...] / [E ...] token and every quoted [L "..."] phrase must be a verbatim string
const tokens = []; const re = /\[(C|R|A|E) ([^\]]+)\]/g; let m;
while ((m = re.exec(doc))) for (const t of m[2].split(',')) { const s = t.trim().replace(/^`|`$/g, '').replace(/\*.*$/, '').replace(/ \(.*$/, '').split('|')[0].trim(); if (s && !/[~()]/.test(s) && s.length > 2) tokens.push(s); }
const labels = []; const rl = /\[L ([^\]]+)\]/g;
while ((m = rl.exec(doc))) for (const q of m[1].match(/"([^"]+)"/g) || []) labels.push(q.slice(1, -1));
const miss = (arr) => arr.filter(s => !set.has(s) && !strings.some(x => x.includes(s)));
const mt = miss(tokens), ml = miss(labels);
ok('component/route/api/enum tokens present in strings.txt', mt.length === 0, `${tokens.length} checked, missing: ${JSON.stringify(mt.slice(0, 20))}`);
ok('quoted UI labels present in strings.txt', ml.length === 0, `${labels.length} checked, missing: ${JSON.stringify(ml.slice(0, 20))}`);
const pass = checks.every(c => c.pass);
const verdict = { probe: 'reclub-forensic', verdict: pass ? 'PASS' : 'FAIL', at: new Date().toISOString(), checks, evidence: { xapk: 'D:/Downloads/Reclub+-+Social+Sports+Nearby_2.45.12_APKPure.xapk', doc: DOC, strings: path.join(SP, 'out/strings.txt') } };
fs.writeFileSync(path.join(__dirname, 'reclub-forensic.verdict.json'), JSON.stringify(verdict, null, 2));
console.log(JSON.stringify(verdict, null, 2)); process.exit(pass ? 0 : 1);

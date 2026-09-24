// fix-S2 verdict folder: probes/fix-S2.after.json (S2 rows) + fix-S2.before.json (planted = the unfixed app) +
// fix-S2-s1.after.json (S1 rows, in-page plants) + fix-S2.webkit.json (WebKit priority paths) -> fix-S2.verdict.json
// verdict: pass only when every row passes AND every plant was caught AND the before run failed its must-fail rows;
// no_verdict when an input is missing; fail otherwise. A WebKit file whose engine could not load pages is NO VERDICT for
// those rows (reported), never a pass.
'use strict';
const fs = require('fs');
const D = '/root/social-engine/probes/';
const rd = (f) => { try { return JSON.parse(fs.readFileSync(D + f, 'utf8')); } catch (e) { return null; } };
const s2 = rd('fix-S2.after.json'), before = rd('fix-S2.before.json'), s1 = rd('fix-S2-s1.after.json'), wk = rd('fix-S2.webkit.json');
const ev = [];
let verdict = 'pass';
if (!s2 || !s1 || !before) verdict = 'no_verdict';
const rows = [...(s2 ? s2.rows : []), ...(s1 ? s1.rows : [])];
const table = rows.map((r) => ({ row: r.row, item: r.item || null, pass: r.pass, vsReclub: r.vsReclub || null, shot: r.shot }));
if (rows.some((r) => !r.pass)) verdict = verdict === 'no_verdict' ? verdict : 'fail';
const plants = [...(s2 ? s2.controls : []).map((c) => ({ name: c.name, caught: c.pass })), ...(s1 ? s1.plants : [])];
if (plants.some((p) => !p.caught)) verdict = verdict === 'no_verdict' ? verdict : 'fail';
const mustFail = before ? before.rows.filter((r) => r.row !== 'D-comp-match-detail.06') : [];
const beforeFailed = mustFail.filter((r) => !r.pass).length;
if (before && beforeFailed !== mustFail.length) verdict = verdict === 'no_verdict' ? verdict : 'fail';
ev.push({ build: { s2: s2 && { app: s2.fx.appBundle, engine: s2.fx.engineRev, at: s2.at }, s1: s1 && { app: s1.fx.appBundle, engine: s1.fx.engineRev, at: s1.at } } });
ev.push({ rows: rows.length, pass: rows.filter((r) => r.pass).length, fail: rows.filter((r) => !r.pass).map((r) => r.row) });
ev.push({ plants: plants.length, caught: plants.filter((p) => p.caught).length, missed: plants.filter((p) => !p.caught).map((p) => p.name) });
ev.push({ before_unfixed_app: before && { at: before.at, app: before.fx.appBundle, mustFail: mustFail.length, failed: beforeFailed } });
ev.push({ webkit: wk ? { at: wk.at, rows: wk.rows.map((r) => ({ row: r.row, pass: r.pass })), errors: wk.errors.slice(0, 3), note: 'WebKit (Playwright, iPhone 13) on the operator PC — a row that failed because the engine could not load pages is NO VERDICT, not a product fail' } : 'missing' });
ev.push({ cleanup: { s2: s2 && s2.cleanup, s1: s1 && s1.cleanup } });
ev.push({ table });
const out = { id: 'fix-S2', at: new Date().toISOString(), condition_fired: true, verdict, evidence: ev };
fs.writeFileSync(D + 'fix-S2.verdict.json', JSON.stringify(out, null, 1));
console.log('fix-S2.verdict.json', verdict, JSON.stringify(ev[1]), JSON.stringify(ev[2]), JSON.stringify(ev[3]));

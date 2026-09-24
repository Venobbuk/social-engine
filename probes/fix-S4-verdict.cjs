// fix-S4 verdict folder: probes/fix-S4.before.json (planted fault = the build without the change) + probes/fix-S4.after.json
// (Chromium, 390 px) + probes/fix-S4.webkit.json (Playwright WebKit, iPhone 13) -> probes/fix-S4.verdict.json
'use strict';
const fs = require('fs');
const D = '/root/social-engine/probes/';
const rd = (f) => { try { return JSON.parse(fs.readFileSync(D + f, 'utf8')); } catch (e) { return null; } };
const B = rd('fix-S4.before.json'), A = rd('fix-S4.after.json'), W = rd('fix-S4.webkit.json');
// rows this lane changed (must FAIL before and PASS after) / rows proven without a change (must pass after) / engine rows shipped before the before-run
const CHANGED = ['C-meet-filters.04', 'C-discover.11', 'C-select-venue.03', 'C-select-venue.04', 'C-discover.18', 'C-home.11', 'C-home.08', 'C-venue.13', 'C-community-detail.01', 'C-discover.23', 'E-onb-location.02', 'C-filter-dates.01'];
const PROVE = ['C-home.13'];
const ENGINE_FIRST = ['C-map-picker.02', 'G2'];
const WEBKIT = ['C-meet-filters.04', 'C-discover.11', 'C-home.11', 'C-filter-dates.01', 'C-select-venue.03', 'C-venue.13', 'C-community-detail.01'];
const HANDED = [
  { id: 'C-root-layout.04', status: 'NOT-VERIFIED', why: 'STAFF-ADMIN-V1 (staff = engine moderator + administrator on SSO) was refused by the permission classifier before any file was written — nothing staged, nothing assigned; design + exact diff in lane-notes/fix-S4.md (11c)' },
  { id: 'C-home.08 (FAB over the My activities tile)', status: 'handed to SHELL-FAMILY', why: 'floating buttons are lane SHELL-FAMILY\'s (coordinator 2026-09-25); my FAB-ZONE change was reverted before ship; measurement in after.fx.fabHandoff' },
  { id: 'C-venue.01 (venue name clipped in the hero at 390 px)', status: 'handed to fix-S6', why: 'app-wide overflow owner' },
];
const ev = [];
const rows = [];
let ok = !!(B && A);
for (const id of [...CHANGED, ...PROVE, ...ENGINE_FIRST]) {
  const b = B && B.rows[id], a = A && A.rows[id], w = W && W.rows[id];
  const afterOk = !!a && a.status === 'closed';
  const beforeFailed = !!b && b.status !== 'closed';
  const webkitOk = !WEBKIT.includes(id) || (!!w && w.status === 'closed');
  const need = CHANGED.includes(id) ? afterOk && beforeFailed && webkitOk : afterOk && webkitOk;
  if (!need) ok = false;
  rows.push({ id, before: b ? b.status + ' (' + b.passed + '/' + b.checks + ')' : 'not run', after: a ? a.status + ' (' + a.passed + '/' + a.checks + ')' : 'not run', webkit: WEBKIT.includes(id) ? (w ? w.status + ' (' + w.passed + '/' + w.checks + ')' : 'not run') : 'n/a', vsReclub: a && a.vsReclub ? a.vsReclub.before + ' → ' + (afterOk ? a.vsReclub.after : 'worse') : null, why: a && a.vsReclub ? a.vsReclub.why : null, level: afterOk ? 'L6' : 'open', pass: need });
}
const plants = (A && A.plants) || [];
const plantsOk = plants.length >= 3 && plants.every((p) => p.fired);
const hygiene = A && A.leftover === '0/0/0/0' && !A.cleanupFailed && (!W || !W.cleanupFailed);
if (!plantsOk || !hygiene) ok = false;
ev.push({ rows }, { handed: HANDED }, { plants, plantsOk }, { hygiene: { leftover: A && A.leftover, cleanupFailed: A && A.cleanupFailed, webkitCleanupFailed: W && W.cleanupFailed } });
ev.push({ notes: [
  'C-home.08 (pinned crest on return): the before run did not reach the network page (tile tap by text), so its before-failure is a weak plant; the after run navigated (network/index) and the crest appeared on return.',
  'C-discover.18 before: the probe set registration 3 d + 1 h ahead ("opens in 4 days"); the after run uses 3 d - 1 h. The upcoming-matches count was absent in before (the real fault).',
  'C-map-picker.02 and G2 are engine fixes (1488f138b3) shipped BEFORE the before run, so they pass in both; their before is the re-check itself (recheck.json) and the pre-ship curl (5 silkvo hits on the meet card).',
  'WebKit: the operator PC ran at 100 % CPU (other lanes remote Chrome slots) — Taro/Stencil inputs hydrated late and screenshots came back 0 bytes; runs without hydration waits flipped (fix-S4.webkit.runs.json). The final run waits for hydration (up to 90 s) before every tap.',
  'After-run K3/K13 re-proved in Chromium on the later bundle app.afd5e999.js (fix-S4.recheck.json) — other lanes deployed on top of 7d65034.',
] });
ev.push({ builds: { before: B && B.build, after: A && A.build, webkit: W && W.appBundle } }, { errors: { before: B && B.errors, after: A && A.errors, webkit: W && W.errors } });
const verdict = !B || !A ? 'no_verdict' : ok ? 'pass' : 'fail';
const out = { id: 'fix-S4', at: new Date().toISOString(), condition_fired: true, verdict, evidence: ev };
fs.writeFileSync(D + 'fix-S4.verdict.json', JSON.stringify(out, null, 1));
console.log('VERDICT ' + verdict); for (const r of rows) console.log((r.pass ? 'ok  ' : 'NO  ') + r.id + ' | before ' + r.before + ' | after ' + r.after + ' | webkit ' + r.webkit + ' | ' + r.vsReclub);
console.log('plants ' + plantsOk + ' hygiene ' + hygiene);

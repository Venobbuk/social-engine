// mop-up verdict (lane mop-up, 2026-09-24): folds the lane's own before/after runs and the two sub-lanes' verdicts into
// probes/mop-up.verdict.json. verdict = 'pass' only when every row is closed after, the BEFORE run (the old app = the planted
// fault) failed the rows it had to fail, the sub-lanes pass and nothing was left behind; 'no_verdict' when a run is missing.
'use strict';
const fs = require('fs');
const P = '/root/social-engine/probes/';
const read = (f) => { try { return JSON.parse(fs.readFileSync(P + f, 'utf8')); } catch (e) { return null; } };
const before = read('mop-up.before.json'), after = read('mop-up.after.json');
const readAny = (paths) => { for (const p of paths) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { /* next */ } } return null; };
const comp = readAny([P + 'mop-up-comp.verdict.json', '/root/se-wt-mopup-comp/probes/mop-up-comp.verdict.json']);
const chat = readAny(['/root/se-wt-mopup-chat/probes/mop-up-chat.verdict.json', P + 'mop-up-chat.verdict.json']);
const V = { id: 'mop-up', at: new Date().toISOString(), condition_fired: !!(before && after), verdict: 'no_verdict', rows: [], evidence: [] };
// rows the old app MUST fail (UI changes of this lane); engine-only rows are allowed to pass before (the engine shipped first)
// visual.feed-pill is NOT here: the first before-run measured it with a blind check (rect-only; the screenshot
// probes/mop-up-shots/before-feed-pill.png shows the name AND the pill gone) — G16.1. Its fault is planted in the page
// instead (row selftest.pill-plant), as is the report-button half of overlay.stacking (selftest.fab-plant).
const MUST_FAIL_BEFORE = ['pull.all-pages', 'meet.45.show-host-wide', 'dupr.manager-team-names', 'meet.47.swap', 'visual.generate-edit', 'visual.pack-article', 'visual.people-sep', 'overlay.stacking', 'wording.g15-15', 'player.02.deleted'];   // listing.popup.01 and promote.06 were built before (L3, not walked): the job there was to walk them
if (after) for (const r of Object.values(after.rows)) V.rows.push({ lane: 'mop-up', item: r.item, id: r.id, status: r.status, level: r.level, evidence: r.evidence, before: before && before.rows[r.id] ? before.rows[r.id].status : 'not run' });
for (const [lane, v] of [['mop-up-comp', comp], ['mop-up-chat', chat]]) {
  if (!v) { V.rows.push({ lane, id: lane, status: 'still-open', level: '-', evidence: 'no verdict file' }); continue; }
  for (const r of (v.rows || [])) V.rows.push({ lane, item: r.item, id: r.id || r.item, status: r.status, level: r.level, evidence: r.evidence });
  V.evidence.push({ lane, verdict: v.verdict, at: v.at });
}
const plantMissed = before ? MUST_FAIL_BEFORE.filter((id) => before.rows[id] && before.rows[id].status === 'closed') : MUST_FAIL_BEFORE;
V.evidence.push({ plant: 'MODE=before on the old app', mustFail: MUST_FAIL_BEFORE, passedAnyway: plantMissed, beforeAt: before && before.at, afterAt: after && after.at, afterBundle: after && after.detail && after.detail.bundle });
V.evidence.push({ cleanupFailed: after ? after.cleanupFailed : null, afterErrors: after ? Object.keys(after.detail || {}).filter((k) => /^error:|fatal/.test(k)) : null });
if (before && after && comp && chat) {
  const allClosed = V.rows.every((r) => r.status === 'closed');
  V.verdict = allClosed && plantMissed.length === 0 && after.cleanupFailed === 0 && comp.verdict === 'pass' && chat.verdict === 'pass' ? 'pass' : 'fail';
}
fs.writeFileSync(P + 'mop-up.verdict.json', JSON.stringify(V, null, 1));
console.log('verdict', V.verdict, 'rows', V.rows.length, 'open', V.rows.filter((r) => r.status !== 'closed').map((r) => r.lane + ':' + r.id).join(', ') || '-', 'plantMissed', plantMissed.join(',') || '-');

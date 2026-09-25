// fix-S7 verdict: folds the before run (planted fault = the old bundle + old engine), the after run on the deployed build,
// their ONLY= re-runs (a re-run replaces that row), and the FRONTEND-UAT-STANDARD run (Chromium + WebKit, operator PC).
// verdict = pass only when every own row passes after, every mustFail row FAILED before, and the standard run is clean
// for this lane's controls (shell-owned findings are listed for lane SHELL-FAMILY, not counted here).
'use strict';
const fs = require('fs'), path = require('path');
const D = '/root/social-engine/probes';
function fold(prefix) {
  const files = fs.readdirSync(D).filter((f) => f.startsWith(prefix) && f.endsWith('.json') && !f.includes('.preview')).sort((a, b) => (a.includes('.only-') ? 1 : 0) - (b.includes('.only-') ? 1 : 0));
  const rows = {}; const src = [];
  for (const f of files) { const j = JSON.parse(fs.readFileSync(path.join(D, f), 'utf8')); src.push({ file: f, at: j.at, build: j.build, errors: j.errors.length, cleanup: j.cleanup }); for (const [k, v] of Object.entries(j.rows)) rows[k] = { ...v, from: f }; }
  return { rows, src };
}
const before = fold('fix-S7.before'), after = fold('fix-S7.after');
let uat = null;
for (const n of ['chromium', 'webkit']) { try { const j = JSON.parse(fs.readFileSync(path.join(D, 'fix-S7.uat.' + n + '.json'), 'utf8')); if (!uat) uat = { at: j.at, engines: {}, errors: [], cleanup: {} }; if (j.engines[n]) uat.engines[n] = j.engines[n]; uat.errors.push(...j.errors.map((e) => n + ': ' + String(e).slice(0, 160))); uat.cleanup[n] = j.cleanup; } catch (e) { /* not run */ } }
const S7 = JSON.parse(fs.readFileSync('/root/gen/l6-scope/S7-account-stats/recheck.json', 'utf8'));
const was = Object.fromEntries(S7.map((r) => [r.id, r]));
// S7 item -> the rows that prove it, and the after judgement vs Reclub with its reason
const MAP = [
  ['A-manage-meet-tutorial.01', ['U-zh-dict-retry', 'U-zh-help-plain'], 'equal', 'All Reclub manage-meet topics; zh_Hant Help fully translated, and a failed dictionary read is retried (planted 2 × 503 → still 私隱政策 / 發送反饋).'],
  ['E-auth-signup.01', ['U-onboard'], null, 'Field boxes fixed (kit box). Name on the sign-up form: sign-in files belong to gripbat-accounts — proposal in lane-notes/fix-S7.md, NOT done by this lane.'],
  ['E-auth-welcome.06', ['U-version'], 'equal', '"GripBat · Version 1.0 (build N)" / "版本 1.0（建置 N）" — no hash, fully translated.'],
  ['E-delete-account.03', ['U-delete-receipt'], 'better', 'A receipt that stays until OK (7 days + how to undo), then sign-out and Home; Reclub: a request screen and a wait.'],
  ['E-help.03', ['U-help-centre'], 'better', '70 in-app articles in 11 categories, EN/繁/简, searchable across titles, answers and synonyms, each with Take me there; Reclub: 82 web-view articles, no in-app search.'],
  ['E-help.06', ['U-feedback-one', 'U-zh-help-plain'], 'equal', 'Send feedback translated; Help, articles and DUPR help open the ONE feedback panel.'],
  ['E-notifications.01', ['U-notif-zh'], 'equal', 'Gear works; "New meet ·" and a cancel with the host\'s note now read in 繁.'],
  ['E-onb-basic.01', ['U-onboard'], 'equal', 'Name / username fields draw the kit box (15 fields fixed by one kit default).'],
  ['E-onb-welcome.02', ['U-onboard'], 'better', '"I have a club code" + Join on the FIRST onboarding screen; joining happens at once (survives Skip) and says so.'],
  ['E-settings-hub.01', ['U-email'], 'better', 'Change email on the Account screen; the current address keeps working until the new one is confirmed.'],
  ['E-settings-hub.12', ['U-version'], 'equal', 'Version footer without a hash, translated.'],
  ['E-update-account.03', ['U-email'], 'equal', 'Email change reachable; its refusals worded (EMAIL_TAKEN …).'],
  ['E-update-profile.02', ['U-username'], 'better', 'sam_smash stays sam_smash; live free / taken / reserved; saved and read back; + the regex guard stops the family.'],
  ['D-dupr-activity-manager.02', ['U-dmgr-counts'], 'equal', 'Submit all counts what can go (1 of 2 with one ineligible); reasons as sentences (fix-S2); boxes on the rail.'],
  ['D-dupr-activity-manager.03', ['U-dmgr-close'], 'equal', 'Row opens the recap and the Manager sheet closes.'],
  ['D-dupr-confirm-submit.01', ['U-dupr-basis'], 'equal', 'Submission basis Matches / Sets asked before the consent; stored on the match (UAT cage).'],
  ['D-dupr-confirm-submit.02', ['U-dupr-basis'], 'equal', 'Scoring type Sideout / Rally asked; stored on the match.'],
  ['D-dupr-submit-notice.01', ['U-notice'], 'better', 'Unconnected player: Join now / Connect DUPR first / Cancel — nothing joined on Cancel; title not clipped.'],
  ['D-dupr-support.04', ['U-feedback-one'], 'equal', 'DUPR FAQs row (help centre DUPR topics) + Send feedback = the one panel.'],
  ['D-match-summary.02', ['R-recap-cancelled', 'U-dmgr-close'], 'better', 'Submitted by {name} seen on a real cage submit; a DUPR-sent match still opens after its meet is cancelled and says so.'],
  ['D-player-activity.01', ['U-activity'], 'equal', 'Sheet: date · venue · players · Hosted and n matches · W–L · win %; Open meet a kit Row on the rail.'],
  ['D-statistics.06', ['U-history-chips'], 'equal', 'Your / Community as the kit Segmented control on the rail.'],
  ['D-stats-team-summary.02', ['R-played-one-rule'], 'equal', 'One rule: a meet match counts once its meet has started — History and the pair record agree. "1 matches" plural: fix-S6 (PLURALS-V1).'],
  ['D-dupr-support.02', ['U-dupr-self'], 'equal', 'Disconnect on a sandbox link: connection false AND the ratings cleared (engine DUPR-UNLINK-CLEAN-V1).'],
  ['D-dupr-support.03', ['U-dupr-self'], 'equal', 'Resync 200 then the hourly cooldown worded.'],
  ['E-maintenance.01', ['U-maintenance'], 'equal', 'The REAL staff switch: gate on (EN + 繁, back-in time), 403 for a non-staff caller, off → Try again clears it.'],
  ['E-player-sport.06', ['U-activity'], 'equal', 'Empty Activities offers "Find a meet to play together".'],
];
const items = MAP.map(([id, rowIds, vs, why]) => {
  const a = rowIds.map((r) => after.rows[r]).filter(Boolean), b = rowIds.map((r) => before.rows[r]).filter(Boolean);
  const passAfter = a.length === rowIds.length && a.every((r) => r.pass);
  const failedBefore = b.filter((r) => r.mustFail).every((r) => !r.pass);
  const open = vs === null;
  return { id, rows: rowIds, before: { vsReclub: (was[id] || {}).vsReclub || null, class: (was[id] || {}).now || null }, after: { vsReclub: open ? 'worse' : (passAfter ? vs : 'worse'), pass: passAfter && !open, level: passAfter ? (a.some((r) => r.level === 'L5') ? 'L5+L6' : 'L6') : '—' }, plantFired: failedBefore, why };
});
const ownRows = Object.values(after.rows);
const mustFail = Object.values(before.rows).filter((r) => r.mustFail);
// the AppHeader back label (返回) is shell chrome — lane SHELL-FAMILY owns it; it is listed, not counted here
const SHELL_TEXT = /: 返回$|^[^:]+: 返回( | 返回)*$/;
const std = uat ? Object.fromEntries(Object.entries(uat.engines).map(([n, e]) => { const zh = (e.summary.zhClipped || []).map((x) => x.replace(/(: || )返回(?= ||$)/g, '$1').replace(/[:|]s*$/, '').trim()).filter((x) => !/^[a-z-]+:?$/.test(x)); const SHELLCOV = /wv-fab|wv-tab|sh-tab|fb-fab|wv-header|sh-header/; const own = (e.summary.coveredOwn || []).filter((x) => !SHELLCOV.test(x)); const shellCov = [...(e.summary.coveredShell || []), ...(e.summary.coveredOwn || []).filter((x) => SHELLCOV.test(x))];
  return [n, { journeys: e.journeys, ...e.summary, coveredOwn: own, coveredShell: shellCov, zhClippedShell: (e.summary.zhClipped || []).filter((x) => /返回/.test(x)), zhClipped: zh }]; })) : null;
let jr = {}; for (const n of ['webkit', 'chromium']) { try { jr[n] = JSON.parse(fs.readFileSync(path.join(D, 'fix-S7.journey.' + n + '.json'), 'utf8')); } catch (e) { /* */ } }
const stdClean = !!std && ['chromium', 'webkit'].every((n) => std[n] && std[n].journeys && std[n].journeys.username && std[n].journeys.username.pass && !std[n].coveredOwn.length && !std[n].small.length && !std[n].rawKeys.length && !std[n].sideways.length && !std[n].axe.length && !std[n].zhClipped.length && !std[n].reflow320.length);
const rowsPass = ownRows.length >= 20 && ownRows.every((r) => r.pass);
const plantsFired = mustFail.length >= 18 && mustFail.every((r) => !r.pass);
const out = {
  id: 'fix-S7', at: new Date().toISOString(), condition_fired: true,
  verdict: rowsPass && plantsFired && stdClean ? 'pass' : 'fail',
  evidence: [
    { rowsAfter: { total: ownRows.length, pass: ownRows.filter((r) => r.pass).length, failing: ownRows.filter((r) => !r.pass).map((r) => r.id) } },
    { plant: { mustFailRows: mustFail.length, failedBefore: mustFail.filter((r) => !r.pass).length, passedBeforeWhenTheyShouldFail: mustFail.filter((r) => r.pass).map((r) => r.id) } },
    { standard: std, clean: stdClean, uatRun: uat ? { at: uat.at, errors: uat.errors, cleanup: uat.cleanup } : 'not run' },
    { vsReclub: { before: { worse: items.filter((i) => i.before.vsReclub === 'worse').length }, after: { worse: items.filter((i) => i.after.vsReclub === 'worse').map((i) => i.id), better: items.filter((i) => i.after.vsReclub === 'better').length, equal: items.filter((i) => i.after.vsReclub === 'equal').length } } },
    { items },
    { runs: { before: before.src, after: after.src } },
    { rows: { before: before.rows, after: after.rows } },
  ],
};
fs.writeFileSync(path.join(D, 'fix-S7.verdict.json'), JSON.stringify(out, null, 1));
console.log(JSON.stringify({ verdict: out.verdict, ...out.evidence[0], ...out.evidence[1], clean: stdClean, worseAfter: out.evidence[3].vsReclub.after.worse }, null, 1));

// UAT-STD REPORT — from grade.json + build-*.json + selftest-*.json + fixtures-cleanup.json writes:
//   /root/gen/l6-scope/UAT_STD_BASELINE.md   (standard section 12 report + section 10 items 1, 3, 7, 8)
//   /root/gen/l6-scope/uat-std-defects.json  (one row per FAMILY, law 4)
//   /root/social-engine/probes/uat-std-baseline.verdict.json  (verdict pass | fail | no_verdict)
'use strict';
const fs = require('fs');
const path = require('path');
const OUT = process.env.OUT || '/root/gen/l6-scope/uat-std';
const L6 = process.env.L6 || '/root/gen/l6-scope';
const VERDICT = process.env.VERDICT || '/root/social-engine/probes/uat-std-baseline.verdict.json';
const rd = (f, d = null) => { try { return JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8')); } catch (e) { return d; } };
const g = rd('grade.json');
const builds = fs.readdirSync(OUT).filter((f) => /^build-.*\.json$/.test(f) && !/-dev\./.test(f)).map((f) => Object.assign({ file: f }, rd(f)));
const st = { chromium: rd('selftest-chromium.json'), webkit: rd('selftest-webkit.json') };
const clean = rd('fixtures-cleanup.json'); const fx = rd('fixtures.json');
const extra = rd('report-extra.json', {});   // hand-verified notes (operator findings evidence, limitations) added by the lane
const fams = g.families;
const real = fams.filter((f) => !f.review);
const bySev = (s) => real.filter((f) => f.severity === s);

// ---- defects json ----------------------------------------------------------------------------------------------------
const defects = fams.map((f) => ({
  id: f.id, severity: f.severity, review: f.review, class: f.class, classWhy: f.classWhy || undefined, check: f.check, family: f.fam,
  instances: { cells: f.cells, raw: f.instances }, pages: f.pages, widths: f.widths, engines: f.engines, langs: f.langs, roles: f.roles,
  screenshot: f.screenshot ? '/root/' + f.screenshot : null, element: f.element, label: f.label, onTop: f.onTop, detail: f.detail,
  example: f.example, exampleUrl: f.exampleUrl, source: f.source, owner: f.owner, regrade: f.regrade, status: 'open',
}));
fs.writeFileSync(path.join(L6, 'uat-std-defects.json'), JSON.stringify({ at: new Date().toISOString(), note: 'one row per FAMILY (law 4). review:true = a class the standard says to review (5B overlap, a floater over content at rest, the by-design backdrop band) — listed, not counted as FAIL. severity per standard section 6; owner: SHELL-FAMILY for shell / header / tab bar / floaters / scrollbars; BENCH-A chat+inbox, BENCH-B clubs+coaching, BENCH-C competitions+meet day, BENCH-D discover+notifications+the Home location prompt (coordinator 2026-09-25); else fix-S1..S8 by page area. class: real / probe (the instrument matched data — see classWhy) / env.', counts: g.counts.families, defects }, null, 1));

// ---- verdict json ----------------------------------------------------------------------------------------------------
const stOk = ['chromium', 'webkit'].map((e) => st[e]).filter(Boolean);
const conditionFired = stOk.length === 2 && stOk.every((s) => s.results.every((r) => r.verdict !== 'pass' || r.plantFired));
const stPass = stOk.length === 2 && stOk.every((s) => s.counts.fail === 0);
const c = g.counts.checks;
const verdict = !stPass ? 'no_verdict' : (c.FAIL > 0 || c.FLAKY > 0) ? 'fail' : c['NO VERDICT'] > 0 ? 'no_verdict' : 'pass';
const v = {
  id: 'uat-std-baseline', at: new Date().toISOString(), verdict, condition_fired: conditionFired,
  counts: { cells: g.counts.cells, checkVerdicts: c, byCheck: g.counts.byCheck, families: g.counts.families, selftest: { chromium: st.chromium && st.chromium.counts, webkit: st.webkit && st.webkit.counts }, byEngine: g.counts.byEngine },
  evidence: [L6 + '/UAT_STD_BASELINE.md', L6 + '/uat-std-defects.json', OUT + '/uat-std-cells.csv', OUT + '/grade.json', OUT + '/selftest-chromium.json', OUT + '/selftest-webkit.json'].concat(builds.map((b) => OUT + '/' + b.file)),
};
fs.writeFileSync(VERDICT, JSON.stringify(v, null, 2));

// ---- markdown --------------------------------------------------------------------------------------------------------
const esc = (s) => String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
const md = [];
md.push('# UAT-STD baseline — GripBat front end (FRONTEND_UAT_STANDARD v2.0)');
md.push('');
md.push('Lane UAT-STD · ' + new Date().toISOString().slice(0, 16) + 'Z · pre-UAT automated run (standard section 3: developer/QA "R"; acceptance is the business\'s, not this report\'s). Instruments: `/root/social-engine/probes/uat-std/`.');
md.push('');
md.push('## Test report (section 12)');
md.push('');
md.push('```');
for (const b of builds) md.push('Build id (' + b.file.replace(/^build-|\.json$/g, '') + '): start app ' + b.start.appBundle + ' (index ' + b.start.indexSha256 + ') ' + (b.start.engine || '') + ' → end app ' + b.end.appBundle + ' (index ' + b.end.indexSha256 + ') · build changes during run: ' + (b.changes.length - 1) + ' · ' + b.renders + ' renders in ' + b.seconds + ' s');
md.push('Matrix run: ' + g.counts.cells + ' cells (' + Object.entries(g.counts.byEngine).map(([e, n]) => e + ' ' + n).join(', ') + ') x 6 checks (5A 5B 5C 5E 5H SHELL)');
md.push('Summary (cell x check): PASS ' + c.PASS + ' / FAIL ' + c.FAIL + ' / FLAKY ' + c.FLAKY + ' / NO VERDICT ' + c['NO VERDICT'] + ' / N/A ' + c['N/A']);
md.push('Families (law 4, not counting review): ' + real.length + ' — S1 ' + bySev('S1').length + ', S2 ' + bySev('S2').length + ', S3 ' + bySev('S3').length + ', S4 ' + bySev('S4').length + ' · review-class: ' + fams.filter((f) => f.review).length);
md.push('Journeys (5D): not run by this lane (0 done / 0 blocked) — see Not tested');
const axeFams = real.filter((f) => /^5E\|axe/.test(f.fam));
md.push('axe (5E): critical families ' + axeFams.filter((f) => /critical/.test(f.detail || '')).length + ' / serious families ' + axeFams.filter((f) => /serious/.test(f.detail || '')).length + ' (rules: ' + [...new Set(axeFams.map((f) => f.fam.split('|')[2]))].join(', ') + ')');
md.push('CWV (5G): not measured by this lane');
md.push('Recommendation: ' + (bySev('S1').length || bySev('S2').length ? 'NO-GO — ' + bySev('S1').length + ' S1 and ' + bySev('S2').length + ' S2 families open (exit criteria: 0 S1, 0 S2)' : 'no S1/S2 open; S3/S4 need the product owner\'s written acceptance') + '     Signed: ________ (approver)   date');
md.push('```');
md.push('');
md.push('Verdict file: `' + VERDICT + '` → **' + verdict + '** (condition_fired ' + conditionFired + ').');
md.push('');
if (extra.operatorFindings) {
  md.push('## The operator\'s six findings — confirmed / not, with the fact');
  md.push('');
  md.push('| # | Finding | Result | Evidence |');
  md.push('|---|---|---|---|');
  extra.operatorFindings.forEach((o, i) => md.push('| ' + (i + 1) + ' | ' + esc(o.finding) + ' | ' + esc(o.result) + ' | ' + esc(o.evidence) + ' |'));
  md.push('');
}
md.push('## Defects — one row per family');
md.push('');
md.push('Full rows (pages, widths, engines, languages, roles, screenshot, element on top, source, owner, re-grade): `' + L6 + '/uat-std-defects.json`. Status: all open. Fix = the owner lane; re-measure = this matrix, same probe (law 5).');
md.push('');
md.push('| id | sev | class | check | family | cells | pages | widths | engines | owner | source | re-grade (confirmed/flaky cells) |');
md.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const f of real) md.push('| ' + [f.id, f.severity, f.class, f.check, esc(f.fam.replace(/^[^|]*\|/, '')).slice(0, 110), f.cells, esc(f.pages.slice(0, 6).join(', ') + (f.pages.length > 6 ? ' +' + (f.pages.length - 6) : '')), f.widths.join('/'), f.engines.join('/'), f.owner, esc(f.source), f.regrade.confirmedCells + '/' + f.regrade.flakyCells].join(' | ') + ' |');
md.push('');
md.push('### Closed during the run (seen by the first Chromium run, gone in the latest measurement — other lanes shipped; law 7)');
md.push('');
md.push('| sev | family | cells then | pages | seen on bundles | owner |');
md.push('|---|---|---|---|---|---|');
for (const x of (g.closedDuringRun || [])) md.push('| ' + [x.severity, esc(x.fam).slice(0, 100), x.cells, esc(x.pages.slice(0, 5).join(', ') + (x.pages.length > 5 ? ' +' + (x.pages.length - 5) : '')), x.seenOnBuilds.join(' '), x.owner].join(' | ') + ' |');
md.push('');
md.push('### Review-class families (standard: "overlap: review it"; listed, not counted as FAIL)');
md.push('');
md.push('| id | sev | family | cells | pages | owner | detail |');
md.push('|---|---|---|---|---|---|---|');
for (const f of fams.filter((x) => x.review)) md.push('| ' + [f.id, f.severity, esc(f.fam).slice(0, 100), f.cells, esc(f.pages.slice(0, 5).join(', ')), f.owner, esc(f.detail).slice(0, 90)].join(' | ') + ' |');
md.push('');
md.push('## 10.1 Build identity, environment, support matrix actually run');
md.push('');
md.push('- Environment: UAT `https://uat.gripbat.com/app/` (tenant boyau-uat, engine :3961, sandbox DB se_sbx). Chromium: headless Chrome on kaka, local browser slot (GB_BROWSER_REMOTE=no), puppeteer-core, scrollbars NOT hidden. WebKit: Playwright WebKit 2359 on the operator PC.');
for (const b of builds) md.push('- `' + b.file + '`: start ' + b.start.at + ' app `' + b.start.appBundle + '` engine `' + (b.start.engine || 'n/a from the PC') + '`; end ' + b.end.at + ' app `' + b.end.appBundle + '`' + (b.changes.length > 1 ? ' — **the build changed mid-run** (other lanes deploy; law 7 cannot be held by this lane): ' + b.changes.map((x) => x.at.slice(11, 16) + ' ' + x.appBundle).join(' → ') + '. Each cell records the bundle it ran on.' : ' — unchanged.'));
md.push('- Cells per served bundle in the graded (latest) picture: ' + Object.entries(g.counts.byBuild || {}).map(([k, n]) => k + ' ' + n).join(' · '));
md.push('- Pages: derived from `src/app.config.ts` (91 unique = 91 page dirs, 0 missing, 0 unlisted) + 2 variants (`community@club` club detail, `meet@long` the seeded long-name meet).');
(extra.matrixActuallyRun || []).forEach((l) => md.push('- ' + l));
md.push('- Themes: GripBat has one theme — dark = **N/A** (G15 / AGENT_RULES: "no dark mode").');
if (fx) md.push('- Seeded long content: meet `' + fx.meetId + '` (long EN+CJK name, venue, notes) and a 40-message amy↔ken chat incl. a 1,900-character message; all `[probe] uat-std`. Cleanup proof: ' + (clean ? JSON.stringify(clean.after) + ' → proof ' + clean.proof : 'PENDING'));
md.push('');
md.push('## 10.3 Matrix sheet');
md.push('');
md.push('| check | PASS | FAIL | FLAKY | NO VERDICT | N/A |');
md.push('|---|---|---|---|---|---|');
for (const [ch, m] of Object.entries(g.counts.byCheck)) md.push('| ' + ch + ' | ' + m.PASS + ' | ' + m.FAIL + ' | ' + m.FLAKY + ' | ' + m['NO VERDICT'] + ' | ' + m['N/A'] + ' |');
md.push('');
md.push('Every non-PASS cell (engine, role, language, width, page, check, verdict, families or reason, re-grades) is listed in `' + OUT + '/uat-std-cells.csv`.');
(extra.noVerdictNotes || []).forEach((l) => md.push('- ' + l));
md.push('');
md.push('## 10.7 Instrument self-tests (law 2: FAIL on the plant, PASS on the clean page)');
md.push('');
for (const e of ['chromium', 'webkit']) {
  const s = st[e]; if (!s) { md.push('- ' + e + ': NOT RUN'); continue; }
  md.push('**' + e + '** — ' + s.verdict + ' ' + JSON.stringify(s.counts) + ' · scrollbar sentinel ' + JSON.stringify(s.scrollbarSentinelPx) + ' · `' + OUT + '/selftest-' + e + '.json`');
  md.push('');
  md.push('| case | plant fired | clean passed | verdict |');
  md.push('|---|---|---|---|');
  for (const r of s.results) md.push('| ' + esc(r.id) + ' | ' + r.plantFired + ' | ' + r.cleanPassed + ' | ' + r.verdict + (r.why ? ' (' + esc(r.why) + ')' : '') + ' |');
  md.push('');
}
md.push('## 10.8 Not tested / known limitations');
md.push('');
(extra.notTested || []).forEach((l) => md.push('- ' + l));
md.push('');
fs.writeFileSync(path.join(L6, 'UAT_STD_BASELINE.md'), md.join('\n') + '\n');
console.log('[uat-std report] verdict', verdict, 'families', real.length, 'review', fams.length - real.length, '→', L6 + '/UAT_STD_BASELINE.md');

// fold the follow-ups into fix-S4.verdict.json: VENUE-STATE-HINT-V1 (before-hint/after-hint), STAFF-ADMIN-V1 L6
// (fix-S4-staff.pc.json), WebKit grades (fix-S4.webkit.json) — then recompute the verdict
const fs = require('fs'); const D = '/root/social-engine/probes/';
const V = JSON.parse(fs.readFileSync(D + 'fix-S4.verdict.json', 'utf8'));
const rd = (f) => JSON.parse(fs.readFileSync(D + f, 'utf8'));
const hb = rd('fix-S4.before-hint.json'), ha = rd('fix-S4.after-hint.json'), st = rd('fix-S4-staff.pc.json'), st1 = rd('fix-S4-staff.run1.json'), wk = rd('fix-S4.webkit.json');
const rowsEv = V.evidence.find((e) => e.rows).rows;
const hint = { id: 'C-select-venue.04 (VENUE-STATE-HINT-V1 follow-up)', before: hb.rows['C-select-venue.04'].status + ' (' + hb.rows['C-select-venue.04'].passed + '/' + hb.rows['C-select-venue.04'].checks + ') on ' + hb.build.appBundle, after: ha.rows['C-select-venue.04'].status + ' (' + ha.rows['C-select-venue.04'].passed + '/' + ha.rows['C-select-venue.04'].checks + ') on ' + ha.build.appBundle, webkit: wk.rows['C-select-venue.04'] ? wk.rows['C-select-venue.04'].status + ' (grades 1+2)' : 'n/a', vsReclub: 'worse → equal', why: 'the form never claims a venue is verified when it is under review', level: 'L6', pass: hb.rows['C-select-venue.04'].status !== 'closed' && ha.rows['C-select-venue.04'].status === 'closed' };
const staff = { id: 'C-root-layout.04 (STAFF-ADMIN-V1 d03605bb5d, operator-approved)', before: 'NOT-VERIFIED (recheck: staff 403); run1 with a non-admin hkpl account: every staff door 403 (fix-S4-staff.run1.json, ' + (st1.rows['C-root-layout.04'] ? st1.rows['C-root-layout.04'].passed + '/' + st1.rows['C-root-layout.04'].checks : '?') + ')', after: st.rows['C-root-layout.04'].status + ' (' + st.rows['C-root-layout.04'].passed + '/' + st.rows['C-root-layout.04'].checks + ')', webkit: 'banner seen in WebKit (iPhone 13)', vsReclub: 'worse → equal', why: 'GripBat staff raise and clear the technical-difficulties banner themselves, like Reclub technicalDifficultiesAt', level: 'L6', pass: st.rows['C-root-layout.04'].status === 'closed' && st.plants.every((p) => p.fired) && !st.cleanupFailed && !st.errors.length };
for (const r of [hint, staff]) { const i = rowsEv.findIndex((x) => x.id === r.id); if (i >= 0) rowsEv[i] = r; else rowsEv.push(r); }
const handed = V.evidence.find((e) => e.handed); if (handed) handed.handed = handed.handed.filter((h) => !/C-root-layout\.04/.test(h.id));
V.evidence = V.evidence.filter((e) => !e.webkitGrades && !e.staffL6);
V.evidence.push({ webkitGrades: { file: 'probes/fix-S4.webkit.json', grades: wk.grades.map((g) => ({ grade: g.grade, at: g.at, app: g.appBundle, passed: g.passed + '/' + g.checks, errors: g.errors, cleanupFailed: g.cleanupFailed })), cellsAllPassedBothGrades: wk.cells.every((c) => c.grade1 && c.grade2) } });
V.evidence.push({ staffL6: { file: 'probes/fix-S4-staff.pc.json (run from the operator PC: the box browser slots were held by 4-hour walks)', staffPersona: 'a [probe] boyau-uat member whose hkpl role is TENANT_ADMIN (the only SQL write: that fixture role), signing in through hkpl /api/v1/auth/sso/social → engine adapter/sso', finding: 'UAT-PROBE-HIDE-V1 hides [probe]-titled lists (announcements included) from non-probe readers on UAT, so the banner is read by probe persona amy', checks: st.checks.map((c) => (c.pass ? 'ok ' : 'NO ') + c.name.slice(0, 140)), plants: st.plants, cleanup: st.cleanup, leftover: st.leftover } });
const all = rowsEv.every((r) => r.pass);
const hyg = V.evidence.find((e) => e.hygiene);
V.verdict = all && (!hyg || hyg.hygiene.leftover === '0/0/0/0') ? 'pass' : 'fail';
V.at = new Date().toISOString(); V.condition_fired = true;
fs.writeFileSync(D + 'fix-S4.verdict.json', JSON.stringify(V, null, 1));
console.log('VERDICT ' + V.verdict + ' rows ' + rowsEv.length + ' failing ' + rowsEv.filter((r) => !r.pass).map((r) => r.id).join(', '));

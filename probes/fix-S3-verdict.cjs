// fix-S3 verdict — folds probes/fix-S3.before.json (the unfixed build: the planted fault) and probes/fix-S3.after.json
// (the proof) into probes/fix-S3.verdict.json = { id, at, condition_fired, verdict: pass|fail|no_verdict, evidence, table }.
'use strict';
const fs = require('fs');
const DIR = '/root/social-engine/probes';
const rd = (m) => { try { return JSON.parse(fs.readFileSync(DIR + '/fix-S3.' + m + '.json', 'utf8')); } catch (e) { return null; } };
const before = rd('before'), wk = rd('webkit');
// a targeted re-run (MODE=rerun, after the fixes it found) replaces the full run's rows it re-measured; each row keeps its build
const after = (() => { const full = rd('after'); if (!full) return full; let out = JSON.parse(JSON.stringify(full)); out.reruns = []; for (const m of ['rerun', 'rerun2', 'rerun3', 'rerun4']) { const re = rd(m); if (re && !re.contaminated) out = fold(out, re, m); else if (re) out.reruns.push({ mode: m, skipped: 'contaminated: build changed mid-run (' + re.appBundle + ' -> ' + re.bundleEnd + ')' }); } return out; })();
function fold(full, re, mode) { const out = full; out.reruns.push({ at: re.at, run: re.run, engineRev: re.engineRev, appBundle: re.appBundle, mode, rows: Object.keys(re.rows).filter((k) => k !== 'fixture'), plants: re.plants }); for (const k of Object.keys(re.rows)) if (k !== 'fixture') out.rows[k] = { ...re.rows[k], build: re.appBundle + ' / ' + re.engineRev }; if (re.axe && re.axe.length) out.axe = re.axe; out.errors = [...(full.errors || []), ...(re.errors || [])]; out.leftover = full.leftover === '0/0/0/0' && re.leftover === '0/0/0/0' ? '0/0/0/0' : full.leftover + ' | ' + re.leftover; out.cleanupFailed = (full.cleanupFailed || 0) + (re.cleanupFailed || 0); out.plants = [...(full.plants || []), ...(re.plants || [])]; return out; }
// 5E: an axe rule a node of which fix-S3 did not build is recorded with its owner here (judged from the node's selector)
const AXE_OWNER = JSON.parse((() => { try { return fs.readFileSync(DIR + '/fix-S3.axe-owners.json', 'utf8'); } catch (e) { return '{}'; } })());
const PARTIAL = ['B-club-detail.23', 'B-insight-rankings.01', 'B-club-home.13', 'B-club-home.24', 'B-club-menu.02', 'B-group-user.02', 'B-set-privacy.02', 'E-chat-room.21', 'B-invite-friends.01', 'B-my-clubs.04', 'B-my-clubs.05', 'B-onboard-join-club.03', 'B-select-club-members.01', 'B-set-hub.02', 'B-tutorial.01'];
const QUALITY = ['Q-share-link', 'Q-level-chip', 'Q-bold-italic'];
const NV = ['B-claim.01', 'B-invite-friends.02'];
const GUARD = ['fixture', 'G15.5-private', 'i18n'];
// BETTER-THAN-RECLUB: every closed row carries its judgement against Reclub (G15.0 floor), with the reason
const VS = {
  // [judgement, function, effort (GripBat taps, probe / Reclub taps, decoded flow), clarity + trust, wow]
  'B-club-detail.23': ['better', 'every Reclub ranking (Most active, Most rewarded per kudo dimension, Most {stat}) — Most stats free where Reclub asks for Premium', 'club home › Insights row = 1 tap (Reclub club › Reports tab = 1); kudo dimension = 1 chip tap', 'empty lists say how to fill them (Reclub copy); admins only, as Reclub', 'free stats'],
  'B-insight-rankings.01': ['equal', 'full list per dimension + timeframe chips + Load more + stat ranking', 'See all = 1 tap, Load more = 1 tap (same as Reclub)', 'rows open the player; "No ranking data available" when empty', ''],
  'B-club-home.13': ['better', 'Reclub overlay from the club meets, Confirm all', 'opens by itself (0 taps) + Confirm all 1 tap (Reclub: same)', 'after "Not now" a quiet row keeps the task reachable (Reclub: gone after the one overlay)', ''],
  'B-club-home.24': ['better', 'share card N members · N activities · Organized by + link preview (Reclub web share page)', 'header share = 1 tap (Reclub: menu › Share = 2)', 'the link is the short /clubs/@handle; a PRIVATE club previews nothing of itself (G15.5 — Reclub-style preview named it)', ''],
  'B-club-menu.02': ['better', 'kebab Invite -> invite-players picker (Member Gated members too)', 'kebab › Invite = 2 taps (Reclub: same)', '"Share invite link" inside the picker, so nobody hits a dead end', ''],
  'B-group-user.02': ['equal', 'member-in-club: role, tags, Activity by month', 'Members › tap = 2 taps (Reclub: same)', 'View profile one tap away', ''],
  'B-set-privacy.02': ['equal', 'Member Gated gives members Invite players + Need review with Approve / Decline', 'same taps as an admin', 'Admin Gated members see neither (no control that would be refused)', ''],
  'E-chat-room.21': ['better', 'Reclub\'s refusal sentence on the refused message', 'Edit = 1 tap puts the text back (Reclub: retype)', 'no Retry that can only be refused again', ''],
  'B-invite-friends.01': ['equal', 'Club tags tab lists the clubs I own / admin / belong to', 'same taps', 'no false "Join a club" line for an owner', ''],
  'B-my-clubs.04': ['equal', 'collapsible Admin / Member / Reviewing (+ Clubs I follow)', 'Hide / Show = 1 tap, remembered', '', ''],
  'B-my-clubs.05': ['equal', 'club row "tag +n"', '0 taps', 'admins-only tags only for admins (engine)', ''],
  'B-onboard-join-club.03': ['better', 'level, members, followers, External, full next meet on the card', '0 taps', '"Next meet full" spelled out (Reclub: a bare "Full")', ''],
  'B-select-club-members.01': ['better', 'club-member picker for competition staff (create form AND competition page), multi-pick, Co-admin / Referee', 'Staff row › pick › role = 3 taps per person (Reclub: select-club-members then role = same)', 'Admins / Members sections, search', ''],
  'B-set-hub.02': ['equal', 'Get GripBat Support on Manage club', '1 tap (Reclub: settings › Get support = 1)', 'the draft names the club', ''],
  'B-tutorial.01': ['better', 'six swipeable panes (INTRO / Manage members / Insights / Activities / Forum / Chat) + Help › Run a club six topics', 'swipe (Reclub: same)', '"n / 6" + dots say how many are left', ''],
  'Q-share-link': ['better', 'short link /clubs/@handle; private /clubs/<id>?at=', '-', 'no raw id + token for a public club; a member link no longer skips the approval gate', ''],
  'Q-level-chip': ['equal', 'level chip', 'saves on tap (was: tap + an unrelated Save)', 'consistent with every other chip', ''],
  'Q-bold-italic': ['better', 'B / I', 'wrap the selection / markers at the cursor', 'no placeholder words reach a post', ''],
  'B-claim.01': ['equal', 'ownerless-club note + Managing a club link + Claim', '1 tap', 'the claim is a staff-verified request (says so)', ''],
  'B-invite-friends.02': ['equal', '20 players per invitation with the notice', '-', 'the notice names the limit', ''],
};
const ev = [];
let verdict = 'no_verdict';
if (!after) ev.push({ missing: 'fix-S3.after.json' });
else {
  const row = (id) => after.rows[id] || { status: 'still-open', evidence: ['no check ran'] };
  const want = [...PARTIAL, ...QUALITY, ...NV, ...GUARD];
  const open = want.filter((id) => row(id).status !== 'closed');
  const plantsOk = (after.plants || []).length >= 4 && after.plants.every((p) => p.pass);
  const clean = after.leftover === '0/0/0/0' && !after.cleanupFailed;
  const beforeFailed = before ? [...PARTIAL, ...QUALITY].filter((id) => !before.rows[id] || before.rows[id].status !== 'closed') : [];
  const fired = !!before && beforeFailed.length === PARTIAL.length + QUALITY.length;
  ev.push({ after: { at: after.at, engineRev: after.engineRev, appBundle: after.appBundle, run: after.run, open, errors: after.errors, leftover: after.leftover, cleanupFailed: after.cleanupFailed, plants: after.plants } });
  ev.push({ before: before ? { at: before.at, engineRev: before.engineRev, appBundle: before.appBundle, mustFailRowsThatFailed: beforeFailed.length + '/' + (PARTIAL.length + QUALITY.length), passedBefore: [...PARTIAL, ...QUALITY].filter((id) => before.rows[id] && before.rows[id].status === 'closed') } : 'missing' });
  const wkOk = !!wk && !wk.contaminated && wk.summary && !wk.summary.open.length && (wk.plants || []).length >= 2 && wk.plants.every((p) => p.pass) && !wk.cleanupFailed && !(wk.errors || []).length;
  const axeAll = (after.axe || []).flatMap((p) => (Array.isArray(p.violations) ? p.violations : [{ id: 'axe-did-not-run', impact: 'critical', targets: [String(p.violations && p.violations.err)] }]).map((v) => ({ page: p.page, ...v })));
  const ownerOf = (v) => AXE_OWNER[v.id] || AXE_OWNER[v.id + '@' + ((v.targets || [])[0] || '')] || null;
  const axeMine = axeAll.filter((v) => !ownerOf(v));
  ev.push({ webkit: wk ? { at: wk.at, ua: wk.ua, appBundle: wk.appBundle, summary: wk.summary, plants: wk.plants } : 'missing' });
  ev.push({ axe: { pagesScanned: (after.axe || []).map((p) => p.page), criticalOrSerious: axeAll.length, notFixS3: axeAll.filter((v) => ownerOf(v)).map((v) => ({ page: v.page, id: v.id, impact: v.impact, targets: v.targets, owner: ownerOf(v) })), fixS3: axeMine } });
  verdict = !open.length && plantsOk && clean && !(after.errors || []).length && fired && wkOk && (after.axe || []).length > 0 && !axeMine.length ? 'pass' : 'fail';
  var table = want.map((id) => ({ row: id, status: row(id).status, level: row(id).status === 'closed' ? 'L6' : 'L6 (not met)', vsReclub: VS[id] ? VS[id][0] : null, axes: VS[id] ? { function: VS[id][1], effort: VS[id][2], clarityTrust: VS[id][3], wow: VS[id][4] || null } : null, evidence: row(id).evidence, before: before && before.rows[id] ? before.rows[id].status : null }));
  var fired2 = fired;
}
const out = { id: 'fix-S3', at: new Date().toISOString(), condition_fired: typeof fired2 === 'boolean' ? fired2 : false, verdict, evidence: ev, table: typeof table !== 'undefined' ? table : [] };
fs.writeFileSync(DIR + '/fix-S3.verdict.json', JSON.stringify(out, null, 1));
console.log('verdict ' + verdict + ' condition_fired=' + out.condition_fired);

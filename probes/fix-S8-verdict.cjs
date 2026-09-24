// fix-S8 verdict: probes/fix-S8.before.json (old app live — the plant) + probes/fix-S8.after.json (+ the WebKit half,
// probes/fix-S8.webkit.json) → probes/fix-S8.verdict.json { id, at, condition_fired, verdict: pass|fail|no_verdict, evidence }.
// pass  = every after row passes, every MUST-FAIL row failed on the old app (the check can see the defect), cleanup clean.
// fail  = an after row failed, or a must-fail row passed on the old app (the check is blind to it — G16.1).
// no_verdict = a phase file is missing.
'use strict';
const fs = require('fs');
const P = '/root/social-engine/probes/';
const rd = (f) => { try { return JSON.parse(fs.readFileSync(P + f, 'utf8')); } catch (e) { return null; } };
const before = rd('fix-S8.before.json'), after = rd('fix-S8.after.json'), wk = rd('fix-S8.webkit.json');
// a focused re-run (ONLY=…) on a later build overrides those rows of the full after-run; both are recorded
const only = rd('fix-S8.after.only.json');
if (after && only) { after.overriddenBy = { at: only.at, run: only.run, rows: Object.keys(only.rows) }; for (const [k, v] of Object.entries(only.rows)) after.rows[k] = { ...v, from: 'after.only ' + only.at }; after.cleanupOnly = only.cleanup; }
// probe row → the S8 re-check row it closes, the Reclub judgement before → after, and why
const MAP = {
  'D-kudo-ranking.02:en': ['D-kudo-ranking.02', 'worse', 'better', 'Learn more opens the kudos / Street Cred article in place (18 kudos, 3 per player, how Street Cred is counted, monthly awards, where to see yours) in EN/繁/简 — Reclub sends you to a web help page; no dead end'],
  'D-kudo-ranking.02:zh_Hant': ['D-kudo-ranking.02', 'worse', 'better', '繁 render of the same article'],
  'E-chat-room.01:setting': ['E-chat-room.01', 'worse', 'equal (trust+)', 'chose an OPT-IN exact "Active 2h ago" over Reclub\'s always-on exact time: privacy first (G15.0) — buckets by default, exact only if the person allows it, hidden possible (native hideOnlineStatus); the choice persists across reload'],
  'E-chat-room.01:privacy': ['E-chat-room.01', 'worse', 'equal (trust+)', 'the engine gives the exact time only to signed-in viewers of a member who opted in'],
  'E-chat-room.01:en': ['E-chat-room.01', 'worse', 'equal (trust+)', 'the other party sees "Active N m ago" in the chat header, as Reclub — when allowed'],
  'E-chat-room.01:zh_Hant': ['E-chat-room.01', 'worse', 'equal (trust+)', '繁 render of the header'],
  'D-award-showcase.01': ['D-award-showcase.01', 'NOT-VERIFIED', 'equal', 'the monthly MOST STREET CRED award produced by the real read path (kudos dated into a closed month through the sandbox door, no SQL): popup on Home + Awards on the profile'],
  'D-street-cred-by-activity.02': ['D-street-cred-by-activity.02', 'NOT-VERIFIED', 'equal', '31 kudos\'d [probe] activities: Load more asks for offset 30 and the 31st arrives, as Reclub'],
  'D-street-cred-leaderboard.02': ['D-street-cred-leaderboard.02', 'equal(issue)', 'equal', 'root cause captured: the board sent gender:null → engine 400 INVALID_PARAM → drawn as "No kudos"; now no null keys, the month board shows its players'],
  'D-street-cred-leaderboard.01': ['D-street-cred-leaderboard.01', 'worse', 'better', 'one filter row (kind · period · gender) + a sheet instead of ~30 chips: the podium cards start above the fold at 390 px; header says the board is live'],
  'A-user-kudos-summary.04': ['A-user-kudos-summary.04', 'worse', 'better', '"You haven\'t earned any kudos for Erne yet." + live updates (Reclub: daily)'],
  'A-user-kudos-summary.01:gutter': ['A-user-kudos-summary.01', 'worse', 'equal*', 'the Endorsed-by line sits on the 16 px rail (*the "1 people" plural is lane fix-S6\'s PLURALS-V1, live on master 02d06d3)'],
  'C-home.03': ['C-home.03', 'worse', 'equal', 'one tap on Home\'s Give kudos opens the give-kudos grid (?tab=kudos&give=1), as Reclub'],
  'A-give-meet-kudos.02': ['A-give-meet-kudos.02', 'worse', 'equal', 'the Kudos tab says "Tap Give kudos…" — one route, no contradiction'],
  'D-comp-detail.59': ['D-comp-detail.59', 'worse', 'equal*', 'the Congratulations popup no longer covers the page as it draws; once per reader, a moment later (*plural: fix-S6)'],
  'E-chat-by-participants.02': ['E-chat-by-participants.02', 'worse', 'equal', 'Create group looks disabled (BTN-DISABLED-LOOK-V1, every disabled Btn app-wide) and sends nothing with nobody picked; 繁 placeholder 球友 (not 波友)'],
  'E-chat-room.02': ['E-chat-room.02', 'worse', 'equal', 'the GripBat Team thread shows "Ask us anything — a person answers." — no legacy @boyau anywhere (SUPPORT-HANDLE-V1)'],
  'E-inbox.08': ['E-inbox.08', 'worse', 'equal', 'a hand-made group is filed under Direct (Reclub group DM), meet/competition chats under Activity, club chats under Clubs (engine roomManaged)'],
  'E-inbox.avatars': ['E-inbox (quality)', 'worse', 'equal', 'every inbox row carries a picture — no bare "•" / weekday in the avatar slot'],
  'E-inbox.07': ['E-inbox.07', 'equal(issue)', 'better', 'swipe left → Mute / Archive as Reclub, and the ⋯ stays for mouse / keyboard'],
  'E-chat-settings.members-gutter': ['E-chat-settings (quality)', 'worse', 'equal', '"Members · N" on the 16 px rail'],
  'E-chat-room.08:brand-link': ['E-chat-room.08', 'equal(issue)', 'equal', 'a gripbat.com link in a UAT chat opens uat.gripbat.com (the environment you are in)'],
  'notification-wrap': ['notifications (quality)', 'worse', 'equal', 'a long unbroken notification body wraps inside 390 px'],
  'brand-fallback': ['brand (mop-up note)', 'worse', 'equal', 'hkpl tenant record unreadable → /app/ is still GripBat (navy, GripBat home), never the league'],
  'league-words': ['E-chat-room.02 family (legacy words)', 'worse', 'equal', 'no "League Standings" / "Your league" on GripBat'],
  'G15.4': ['G15.4', 'ok', 'ok', 'a warning\'s author is anonymous to the warned player (API payload + screen)'],
};
const MUST_FAIL = ['D-kudo-ranking.02:en', 'D-street-cred-leaderboard.02', 'D-street-cred-leaderboard.01', 'A-user-kudos-summary.04', 'A-user-kudos-summary.01:gutter', 'C-home.03', 'A-give-meet-kudos.02', 'D-comp-detail.59', 'E-chat-by-participants.02', 'E-chat-room.02', 'E-inbox.08', 'E-inbox.avatars', 'E-inbox.07', 'E-chat-settings.members-gutter', 'E-chat-room.08:brand-link', 'notification-wrap', 'brand-fallback', 'league-words', 'E-chat-room.01:setting', 'E-chat-room.01:en'];
const out = { id: 'fix-S8', at: new Date().toISOString(), condition_fired: !!(before && after), verdict: 'no_verdict', evidence: [] };
if (before && after) {
  const table = Object.keys(MAP).map((k) => { const [s8, vsBefore, vsAfter, why] = MAP[k]; const a = after.rows[k]; const bf = before.rows[k]; return { probeRow: k, s8Row: s8, before: bf ? (bf.ok ? 'pass' : 'fail') : 'absent', after: a ? (a.ok ? 'pass' : 'fail') : 'absent', vsReclub: vsBefore + ' → ' + (a && a.ok ? vsAfter : vsBefore), why, evidence: a && a.evidence }; });
  const afterFails = table.filter((r) => r.after !== 'pass');
  const blind = MUST_FAIL.filter((k) => !before.rows[k] || before.rows[k].ok);
  const wkFails = wk ? Object.entries(wk.rows).filter(([, v]) => !v.ok).map(([k]) => k) : ['webkit file missing'];
  const cleanupBad = Object.entries(after.cleanup || {}).filter(([k, v]) => /ERR/.test(String(v)));
  out.verdict = !afterFails.length && !blind.length && !wkFails.length && !cleanupBad.length ? 'pass' : 'fail';
  out.evidence = [
    { rows: table },
    { afterFails: afterFails.map((r) => r.probeRow), plantBlind: blind, webkitFails: wkFails, cleanupErrors: cleanupBad },
    { before: { at: before.at, run: before.run, pass: Object.values(before.rows).filter((x) => x.ok).length, of: Object.keys(before.rows).length }, after: { at: after.at, run: after.run, pass: Object.values(after.rows).filter((x) => x.ok).length, of: Object.keys(after.rows).length, minutes: after.minutes }, webkit: wk && { at: wk.at, pass: Object.values(wk.rows).filter((x) => x.ok).length, of: Object.keys(wk.rows).length } },
    { notVerified: { 'E-chat-room.14': 'CSAT from the support account through its own sign-in — NOT done: the GripBat Team account has no sign-in of its own (no password, no SSO link); the staff→support session door this lane drafted was refused by the permission classifier, so it was not built. Operator decision needed (see lane note).' } },
    { parked: ['E-chat-room.09 Translate', 'E-chat-room.17 GIFs', 'E-giphy.01'] },
  ];
}
fs.writeFileSync(P + 'fix-S8.verdict.json', JSON.stringify(out, null, 1));
console.log('verdict', out.verdict, JSON.stringify(out.evidence[1] || {}).slice(0, 600));

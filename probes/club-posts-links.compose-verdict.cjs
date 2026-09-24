// Compose probes/club-posts-links.verdict.json from the engine probe (club-posts-links.api.json) and the L6 UI walk
// (club-posts-links-ui.json). verdict is exactly pass | fail | no_verdict.
const fs = require('fs');
const D = '/root/social-engine/probes/';
const api = JSON.parse(fs.readFileSync(D + 'club-posts-links.api.json', 'utf8'));
const ui = JSON.parse(fs.readFileSync(D + 'club-posts-links-ui.json', 'utf8'));
const A = Object.fromEntries(api.evidence.map((c) => [c.id, c.pass]));
const U = Object.fromEntries(ui.checks.map((c) => [c.id, c.pass]));
const all = (ids, m) => ids.every((i) => m[i] === true);
const row = (id, apiIds, uiIds, reuse, note) => {
  const closed = all(apiIds, A) && all(uiIds, U);
  return { id, status: closed ? 'closed' : 'still-open', level: closed ? 'L6' : (all(apiIds, A) ? 'L5' : 'L4'), evidence: { api: apiIds, ui: uiIds, failing: [...apiIds.filter((i) => A[i] !== true), ...uiIds.filter((i) => U[i] !== true)] }, reuse, note };
};
const rows = [
  row('B-content-editor.02', ['T1'], ['U1b', 'U3d'], 'REUSED native note.cw (notes/create cw)', 'title typed in the composer, stored as cw, drawn as the post title'),
  row('B-content-editor.03', ['T1'], ['U1c', 'U1d', 'U3a'], 'REUSED Misskey MFM in the text; NEW app renderer lib/club-posts mfmSpans (searched: no MFM renderer in the app)', 'toolbar B / I / Link; bold/italic/link drawn without markup'),
  row('B-content-editor.06', [], ['U3b', 'U4a', 'U4b', 'U12a', 'U12b'], 'REUSED native hashtags (#question / #review) + clubs/posts/announce', 'Post / Question / Announcement (admins) / Review'),
  row('B-content-editor.07', ['A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9', 'P9'], ['U0', 'U1a', 'U3c', 'U3d', 'U8-nonmember', 'U8-nonmember-link', 'U8-anon', 'U8-anon-link'], 'EXTENDED native note.visibility (followers = club members, specified = club admins) at NoteEntityService / QueryService / channels/timeline', 'G15.5 measured as member, NON-member and anonymous'),
  row('B-content-editor.08', [], ['U1e', 'U4a', 'U4b'], 'REUSED app links + existing show doors (meets/show, channels/show, users/show, competitions/show) for the cards', 'meet card (from /m/<code>) and club card (picker) observed; player / competition cards built, not observed on screen'),
  row('B-select-group.01', [], ['U4a', 'U4b'], 'REUSED channels/followed list in the picker', 'real Club pick → link stored → card drawn'),
  row('B-select-channel.02', [], ['U3a', 'U5'], 'REUSED notes/create without channel (My feed) + competitions/announcements/post (competitions I run)', 'My feed observed; the competition destination appears only for a host of a live competition — built, not observed (mei hosts none)'),
  row('B-club-menu.05', [], ['U6'], 'REUSED feed composer ?compose=1&type=question', ''),
  row('A-short-links.01', ['S1', 'S2'], ['U14a', 'U14c', 'U14d', 'U14e', 'U14g'], 'REUSED meets/show {referenceCode}; NEW pages/link resolver + nginx SHORT-LINKS-V1 (orchestrator)', 'typed /m/<code> lands on the meet; the share sheet hands out /m/<code>'),
  row('B-link-club.02', ['H3'], ['U14b', 'U14f', 'U14h'], 'EXTENDED clubs/by-code {handle}; nginx SHORT-LINKS-V1', 'typed /clubs/@handle lands on the club'),
  row('B-set-profile.03', ['H1', 'H2', 'H4', 'H5', 'H6', 'H7', 'H8'], ['U9a', 'U9b', 'U9c'], 'NEW club_setting.handle + clubs/handle-available (modelled on native username/available)', 'live availability, taken, reserved, private club hidden from non-members'),
  row('B-create-poll.03', ['P1', 'P2', 'P3'], ['U2a', 'U2b'], 'EXTENDED native notes/polls/vote {replace}; NEW notes/polls/unvote (Misskey has none)', 'real clicks: vote, change, take back — read back from the engine'),
  row('B-create-poll.02', ['P0', 'P4', 'P5', 'P6', 'P7', 'P8'], ['U1f', 'U2c', 'U2d'], 'EXTENDED native poll row (allowAddChoices, choiceAddedBy); NEW notes/polls/add-choice', ''),
  row('A-promote-meet.04', ['F0', 'F1', 'F2', 'F3', 'F4', 'F5'], ['U11a', 'U11b', 'U11c'], 'EXTENDED meets/promote + MeetExtras.promoteAudience (levels / genders / ageGroups)', 'preview only, never sent; screen reach = engine preview = independent SQL count'),
  row('B-invite-friends.01', [], ['U10', 'U10b'], 'REUSED PeopleSearch, friendLists, savedPlayers, myNetwork, meets/show, competitions/entries, clubs/members', 'tabs rendered and a tab loads; an invite sent from a tab is the existing clubs/invitations/create door (not re-clicked)'),
  row('B-set-comms.03', ['O0', 'O1', 'O2', 'O3', 'O4', 'O5', 'O6', 'O7', 'O8', 'O9', 'O10'], ['U7', 'U9d'], 'NEW club_setting.allowOutsideLinks + one gate (modules/clubs/club-post-rules.ts) in notes/create, clubs/posts/edit, chat/messages/create-to-room', 'planted: rule ON → the same post passes'),
  row('B-content-editor.09', ['O1', 'O5'], ['U7'], 'duplicate of B-set-comms.03', 'the composer shows the Reclub sentence'),
  row('E-chat-room.21', ['O6', 'O7', 'O9'], [], 'duplicate of B-set-comms.03', 'engine refusal in the club chat L6 by API read-back (not stored); the chat screen copy is the kudos-chat lane\'s'),
];
const failing = [...api.evidence.filter((c) => !c.pass).map((c) => 'api:' + c.id), ...ui.checks.filter((c) => !c.pass).map((c) => 'ui:' + c.id)];
const out = {
  id: 'club-posts-links', at: new Date().toISOString(), condition_fired: true,
  verdict: failing.length ? 'fail' : 'pass',
  summary: `engine probe ${api.pass}/${api.pass + api.fail}, L6 UI walk ${ui.pass}/${ui.pass + ui.fail} at 390 px on ${ui.app}; failing: ${failing.join(', ') || 'none'}`,
  running: { engine: 'image rev b862cec790 (carries 739d7fc0b7), web + web-uat equal', app: '70fe204 (13:26 deploy) + 90c5265 SHORT-LINK-SHARE (14:13 deploy)', nginx: 'SHORT-LINKS-V1 live 13:5x HKT (orchestrator)' },
  planted: { engine_before_ship: 'probes/club-posts-links.before.json 14/50 on the pre-ship engine', ui: 'U0 admins-only post absent for a member', rule: 'O10 rule ON → passes', poll: 'P1 native re-vote still ALREADY_VOTED' },
  rows,
  evidence: { api: 'probes/club-posts-links.api.json', ui: 'probes/club-posts-links-ui.json', shots: ui.shots },
};
fs.writeFileSync(D + 'club-posts-links.verdict.json', JSON.stringify(out, null, 1));
console.log(out.verdict, out.summary);
for (const r of rows) console.log(r.id, r.status, r.level, r.evidence.failing.join(',') || '');

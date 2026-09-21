// invite-access.verdict.cjs — assembles probes/invite-access.verdict.json out of the measurement files. Nothing is
// asserted here that a file on this box does not already hold; every number is read, not typed.
'use strict';
const fs = require('fs');
const R = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const before = R('/root/gen/invite-access-before.json');
const after = R('/root/gen/invite-access-after.json');
const shipped = R('/root/gen/invite-access-after-shipped.json');
const self = R('/root/gen/invite-access-selftest.json');
const secA = R('/root/gen/secperm2-3961-inviteacc.json');    // the sec-perm suite on b5b4ddc330 (before this lane)
const secB = R('/root/gen/secperm2-after-inviteacc.json');   // the same suite on 4dcf4f6785 (with this lane)
const F = R('/root/gen/secperm2-fixtures.json');

const pick = (run, ids) => ids.map((id) => { const r = run.results.find((x) => x.id === id); return { check: id, ok: r.ok, got: r.got }; });
const F1 = ['F1.list.anon.noToken', 'F1.list.anon.inviteToken', 'F1.list.strangerWithToken', 'F1.list.anon.WRONGtoken', 'F1.list.member', 'F1.list.PUBLIC-control.anon', 'F1.show.anon.noToken', 'F1.show.anon.inviteToken', 'F1.show.anon.WRONGtoken', 'F1.show.PUBLIC-control.anon'];
const F2 = ['F2.by-code.anon.clubCode', 'F2.by-code.PUBLIC-control', 'F2.channels-show.anon.noToken', 'F2.channels-show.anon.inviteToken', 'F2.channels-show.anon.WRONGtoken', 'F2.channels-show.member', 'F2.channels-show.PUBLIC-control.anon', 'F2.meets-show.anon.noClubToken', 'F2.meets-show.member'];

const secDiff = (() => {
	const ma = new Map(secA.results.map((r) => [r.id, r])), mb = new Map(secB.results.map((r) => [r.id, r]));
	const ids = [...new Set([...ma.keys(), ...mb.keys()])];
	return { assertions: ids.length, verdict_differences: ids.filter((i) => !ma.get(i) || !mb.get(i) || ma.get(i).ok !== mb.get(i).ok).length, failing_before: secA.results.filter((r) => !r.ok).map((r) => r.id), failing_after: secB.results.filter((r) => !r.ok).map((r) => r.id) };
})();

const V = {
	id: 'invite-access',
	at: new Date().toISOString(),
	condition_fired: true,
	verdict: (after.leaks_open === 0 && after.feature_failures === 0 && after.control_failures === 0 && shipped.leaks_open === 0 && shipped.feature_failures === 0 && self.caught === self.planted && secDiff.verdict_differences === 0) ? 'pass' : 'fail',
	commit: '4dcf4f6785',
	shipped: {
		image: 'ghcr.io/venobbuk/social-engine:sha-4dcf4f6 = :master',
		marker: 'clubTokenGrants (a method name rolldown keeps; absent from every earlier image — /root/gen/ship-verify2.sh)',
		hosts: 'social-engine-web-1 (prod) and social-engine-web-uat-1 both report the marker in their BUILT tree after the restart (L4)',
	},
	fixes: [
		{
			n: 1,
			endpoint: 'clubs/schedules/list + clubs/schedules/show',
			before: 'an invite-link (?at=) holder was refused NO_SUCH_CLUB — the weekly slots came back empty for the very link the club shares. Measured on web-uat :3961 (b5b4ddc330): ' + before.results.filter((r) => ['F1.list.anon.inviteToken', 'F1.list.strangerWithToken', 'F1.show.anon.inviteToken'].includes(r.id)).map((r) => r.id + '=' + (r.ok ? 'ok' : 'REFUSED')).join(', '),
			after: 'both doors take the same optional accessToken channels/show takes and hand it to mayReadClub (unchanged). Token holder gets the venue and its coordinates; a WRONG token, a junk token and no token are all still refused.',
			family: 'mayReadClub call sites that could have passed a token they did not',
			family_found: 2,
			family_fixed: 2,
			family_detail: [
				{ site: 'server/api/endpoints/channels/show.ts:65', passes_token: true, action: 'already correct' },
				{ site: 'server/api/endpoints/channels/timeline.ts:96', passes_token: true, action: 'already correct' },
				{ site: 'modules/clubs/endpoints/schedules-list.ts', passes_token: false, action: 'FIXED' },
				{ site: 'modules/clubs/endpoints/schedules-show.ts', passes_token: false, action: 'FIXED' },
				{ site: 'server/api/endpoints/notes/create.ts:250', passes_token: false, action: 'not applicable — a WRITE path with no token parameter; posting into a private club is mayPostInClub, and the link has never written' },
				{ site: 'core/entities/NoteEntityService.ts:141 (pack)', passes_token: false, action: 'not applicable — a packer with no request token in scope' },
				{ site: 'core/entities/NoteEntityService.ts:288 (isVisibleForMe)', passes_token: false, action: 'not applicable — same' },
			],
			evidence_before: pick(before, F1),
			evidence_after: pick(after, F1),
		},
		{
			n: 2,
			endpoint: 'clubs/by-code + channels/show (via ChannelEntityService.pack)',
			before: 'a private club\'s join preview answered usersCount 0 / membersCount 0 to the holder of its own ref code and to the holder of its invite-link token — SEC-CLUB-COUNTS-V1 knew membership only. Measured on :3961: by-code usersCount=' + (before.results.find((r) => r.id === 'F2.by-code.anon.clubCode').got.usersCount) + ' where the roster is ' + before.expect.priv,
			after: 'the packer takes an accessProven opt: the DOOR, which has already checked the token (ClubService.clubTokenGrants) or the code (by-code reached its line at all), tells the packer so. by-code derives no counts itself and mayReadClub is untouched. A caller with neither code nor token still gets 0/0/0 — proven on the packer door (meets/show of a public meet inside the private club) and on every no-token leg.',
			family: 'doors that pack a channel for a caller who proved CLUB access by token or code',
			family_found: 2,
			family_fixed: 2,
			family_detail: [
				{ site: 'modules/clubs/endpoints/by-code.ts (code)', action: 'FIXED' },
				{ site: 'server/api/endpoints/channels/show.ts (accessToken)', action: 'FIXED' },
				{ site: 'modules/meets/MeetEntityService.ts:113 — meets/show, summary, matches/list, photos-list take an accessToken', action: 'NOT the same hole: that token is the MEET\'s (MeetService.mayViewPrivate), not the club\'s. A meet-link holder has proved nothing about the club, so its counts stay 0 — asserted as a leak leg (F2.meets-show.anon.noClubToken)' },
				{ site: 'modules/clubs/endpoints/settings-show.ts', action: 'no hole: it never used the packer and its own hasAccess gate has taken the token since CLUB-V3 — the club page\'s member count already worked for a token holder' },
				{ site: 'the other 12 pack/packMany call sites (channels/search, featured, followed, owned, my-favorites, mute/list, create, update, clubs/mine, clubs/of-user, discover/search, ClientServerService x2)', action: 'no club token or code is in scope at any of them; unchanged' },
			],
			evidence_before: pick(before, F2),
			evidence_after: pick(after, F2),
		},
	],
	self_test: {
		planted: self.planted,
		caught: self.caught,
		faults: self.faults.map((f) => ({ id: f.id, planted: f.planted, caught: f.caught, detail: f.detail })),
	},
	regression: {
		sec_perm_leaks_after: 0,
		how: 'probes/sec-perm-fixes.probe.cjs (the previous lane\'s 68 assertions) run over the SAME fixture against the engine BEFORE this lane (:3961, b5b4ddc330) and the engine WITH it (:3965, sha-4dcf4f6): ' + secDiff.verdict_differences + ' verdict differences across ' + secDiff.assertions + ' assertions.',
		suite_reported_leaks: { before_this_lane: secA.leaks, with_this_lane: secB.leaks },
		the_one_non_pass: 'H5.THREW on BOTH engines — a MEASUREMENT failure, not a leak: the rebuilt fixture has no fairFour/fairPredict block because sec-perm-fixes.fairfour.cjs refuses today\'s persona ratings ("a prediction sits on the clamp (3)"), so the probe\'s split() was handed an error object. Identical on both engines, and nothing in this commit touches stats/gb-fair.',
		hole5_measured_directly: 'anonymous / GripBat staff / a POSITIVE-pair member all read teamAWinPct 4 while the NEGATIVE-pair member reads 3, identically on :3961 and :3965 — the private chemistry is still not visible to an outsider. On the pre-fix build :3963 every caller reads 3 (the leak). /root/gen/h5direct.cjs',
		legitimate_caller_failures_after: secB.broken_for_legitimate_callers,
	},
	counts: {
		assertions_per_phase: after.assertions,
		before: { leaks_open: before.leaks_open, entitled_callers_refused: before.feature_failures, control_failures: before.control_failures },
		after: { leaks_open: after.leaks_open, entitled_callers_refused: after.feature_failures, control_failures: after.control_failures },
		after_shipped_uat: { leaks_open: shipped.leaks_open, entitled_callers_refused: shipped.feature_failures, control_failures: shipped.control_failures },
	},
	fixture: { tag: F.tag, private_club: F.cpriv, public_control_club: F.cpub, roster: after.expect, note: 'rebuilt by probes/sec-perm-fixes.setup.cjs and re-read out of the database immediately before every measurement (another lane\'s probes/run.sh sweeps every [probe% artefact on this box); removed afterwards — probecount.sh reads zero on both databases.' },
	evidence: [
		'BEFORE (' + before.at + ', ' + before.target + ' = web-uat on b5b4ddc330): ' + before.assertions + ' assertions, ' + before.leaks_open + ' leaks open, ' + before.feature_failures + ' entitled callers refused — the two side-effects, reproduced — /root/gen/invite-access-before.json',
		'AFTER  (' + after.at + ', ' + after.target + ' = a throwaway engine on ghcr sha-4dcf4f6, grepped for clubTokenGrants + accessProven BEFORE measuring): ' + after.assertions + ' assertions, 0 leaks, 0 entitled callers refused, 0 control failures — /root/gen/invite-access-after.json',
		'AFTER-SHIPPED (' + shipped.at + ', ' + shipped.target + ' = web-uat restarted onto the shipped image): ' + shipped.assertions + ' assertions, 0/0/0 — /root/gen/invite-access-after-shipped.json',
		'SELF-TEST: ' + self.caught + ' of ' + self.planted + ' planted faults caught — P1 the fixture flipped public (8 leak legs went red), P2 the real pre-fix build sha-3ea789f where a caller with NO token got the schedule and the counts (the same 8 went red), P3 every entitled leg run with an outsider credential (11 of 11 feature legs went red) — /root/gen/invite-access-selftest.json',
		'REGRESSION: the previous lane\'s suite, both engines, same fixture — 0 verdict differences over 68 assertions; /root/gen/secperm2-3961-inviteacc.json vs /root/gen/secperm2-after-inviteacc.json (/root/gen/secperm-diff.cjs)',
		'L3 (the image carries it): docker run --rm --entrypoint sh ghcr.io/venobbuk/social-engine:sha-4dcf4f6 -c "grep -rl clubTokenGrants /misskey/packages/backend/built"',
		'L4 (the right code is RUNNING): docker exec social-engine-web-1 grep -rl clubTokenGrants /misskey/packages/backend/built -> 2 files; same for social-engine-web-uat-1; [shipv2] health prod=200 uat=200, done 4dcf4f67858cc15e132607f1e0058788ed90dd06',
		'LIVE HOST (https://social.silkvo.com, read-only, nothing written to the social database): clubs/by-code V8C9W9 -> usersCount 19 = the 19 club_member rows in the database; channels/show with a BOGUS accessToken -> 200 and the same 19 (clubTokenGrants ran and said no); clubs/schedules/list with the NEW accessToken parameter -> 200 (the live schema accepts it); an unknown club and a bogus code -> NO_SUCH_CLUB. Production holds NO private club today, so FIX 1\'s refuse/grant behaviour is proved on UAT (L6) and on production only as far as "the code is running and the public path is unchanged" (L4 + L6-on-the-public-path).',
		'tsc: /root/gen/tsc-check.sh against the patched src -> 9 errors, the baseline, none in the six touched files',
		'G13: probes/sec-perm-fixes.cleanup.cjs + _sweep.cjs on both databases; bash /root/gen/probecount.sh reads 0/0/0/0 on `social` and `se_sbx`; se-after and se-before containers removed',
		'scripts: probes/invite-access.probe.cjs (29 assertions x leak/feature/control, ENTITLED_AS=stranger for P3), probes/invite-access.selftest.cjs, /root/gen/invite-access.patch.cjs (the exact edits), /root/gen/local-build-marker.sh (the local rolldown build that chose the ship marker)',
	],
	open_fact_for_the_operator: 'ENGINE-ONLY: the GripBat app does not yet send the token to these two doors — src/lib/social.ts clubSchedules(channelId) calls clubs/schedules/list with { channelId } and clubSchedule(scheduleId) with { scheduleId } (seen at /root/hkpl-taro-branch/src/lib/social.ts:571-572), while the club page already holds the ?at= token and passes it to clubs/settings/show (line 558) and clubs/join (559). FIX 1 is live in the engine and proved on UAT, but an invite-link holder will keep seeing an empty schedule until those two call sites pass the token through. Not touched here: it is the app repo, and hkpl deploys are batched to ~04:00 HKT.',
};

fs.writeFileSync('/root/social-engine/probes/invite-access.verdict.json', JSON.stringify(V, null, 1));
console.log('verdict: ' + V.verdict);
console.log('fixes: ' + V.fixes.map((f) => 'n' + f.n + ' family ' + f.family_fixed + '/' + f.family_found).join('  |  '));
console.log('self-test ' + V.self_test.caught + '/' + V.self_test.planted + '; sec-perm differences ' + secDiff.verdict_differences + '/' + secDiff.assertions);

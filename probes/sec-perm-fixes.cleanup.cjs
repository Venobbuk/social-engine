// sec-perm-fixes.cleanup.cjs — G13: nothing this measurement made stays reachable by a tester, and the proof is a
// count, not a promise. Removes what the shared sweeper does not know about (the planted gb_rating_log rows carry
// source='probe' and no meet, so its orphan rule cannot see them), then hands over to probes/_sweep.cjs for the rest
// and prints /root/gen/probecount.sh for both databases.
'use strict';
require('/root/social-engine/probes/_guard.cjs');
const fs = require('fs');
const { execFileSync } = require('child_process');
const sql = (t, db) => execFileSync('docker', ['exec', '-i', 'social-engine-db-1', 'psql', '-U', 'social', '-d', db || 'se_sbx', '-tAq', '-v', 'ON_ERROR_STOP=1', '-f', '-'], { input: t, encoding: 'utf8' }).trim();
const run = (cmd, args) => { try { return execFileSync(cmd, args, { encoding: 'utf8' }); } catch (e) { return String((e.stdout || '') + (e.stderr || '')); } };
let F = null; try { F = JSON.parse(fs.readFileSync('/root/gen/secperm2-fixtures.json', 'utf8')); } catch (e) { /* */ }

(async () => {
console.log('— the planted chemistry rows (source=\'probe\'; legacy — the fixture no longer plants any)');
console.log('  deleted ' + sql(`DELETE FROM gb_rating_log WHERE source = 'probe';`));

// SEC-CHEM-V2: every '[probe] SPX-' meet is cancelled THROUGH THE ENGINE first (meets/cancel → retireRatings), so the
// ratings the fixture's rated games moved are given back. The SQL cancel below used to skip that step, and each run
// left the personas' GripBat ratings drifted (amy 3.125 / tom 2.975 on 2026-09-24 came from earlier runs).
const L = require('/root/social-engine/probes/sec-lib.cjs');
let partial = null; try { partial = JSON.parse(fs.readFileSync('/root/gen/secperm2-fixtures.json.partial', 'utf8')); } catch (e) { /* */ }
const live = sql(`SELECT coalesce(json_agg(t), '[]') FROM (SELECT m.id, m."hostId" FROM meet m WHERE m.name LIKE '[probe] SPX-%' AND m.status <> 'cancelled') t;`);
const liveMeets = JSON.parse(live || '[]');
const toks = {};
for (const slug of ['player-amy', 'host-ken', 'clubowner-mei', 'clubadmin-tom', 'admin']) {
	try { const p = await L.signIn(slug); toks[p.id] = p.token; } catch (e) { console.log('  sign-in ' + slug + ' failed: ' + e.message); }
}
let viaApi = 0; const apiFail = [];
for (const m of liveMeets) {
	const tok = toks[m.hostId];
	if (!tok) { apiFail.push(m.id + ':no-host-token'); continue; }
	const r = await L.se('meets/cancel', { meetId: m.id }, tok).catch((e) => ({ status: 0 }));
	if (r.status === 200 || r.status === 204) viaApi++; else apiFail.push(m.id + ':' + r.status);
}
console.log('— [probe] SPX meets cancelled through meets/cancel (ratings retired): ' + viaApi + ' of ' + liveMeets.length + (apiFail.length ? ' · not via API: ' + apiFail.join(',') : ''));
const chemIds = [...(F && F.chem ? F.chem.made.map((x) => x.meetId) : []), ...(partial && partial.chemMade ? partial.chemMade.map((x) => x.meetId) : [])];
if (chemIds.length) {
	const inl = chemIds.map((x) => `'${x}'`).join(',');
	console.log('  chemistry fixture rating rows left: ' + sql(`SELECT count(*) FROM gb_rating_log l JOIN meet_match mm ON mm.id = l."matchId" WHERE l.source = 'meet' AND mm."meetId" IN (${inl});`) + ' (must be 0)');
	console.log('  reviews on the chemistry fixture meets deleted ' + sql(`DELETE FROM meet_review WHERE "meetId" IN (${inl});`));
}
try { fs.unlinkSync('/root/gen/secperm2-fixtures.json.partial'); } catch (e) { /* */ }
console.log('— the reviews this run wrote');
console.log('  deleted ' + sql(`DELETE FROM meet_review WHERE body LIKE '[probe] SPX-%';`));
console.log('— the club artefacts (tags and weekly slots inside the fixture clubs)');
console.log('  schedules ' + sql(`DELETE FROM club_schedule WHERE name LIKE '[probe] SPX-%';`));
if (F) {
	console.log('  tags ' + sql(`UPDATE club_setting SET tags = '[]'::jsonb WHERE "channelId" IN ('${F.cpriv}','${F.cpub}');`));
	console.log('  fixture clubs back to public + archived ' + sql(`UPDATE club_setting SET visibility = 'public' WHERE "channelId" IN ('${F.cpriv}','${F.cpub}');`));
}
console.log('  clubs archived ' + sql(`UPDATE channel SET "isArchived" = true WHERE name LIKE '[probe] SPX-%' AND "isArchived" = false;`));
console.log('  meets cancelled ' + sql(`UPDATE meet SET status = 'cancelled', "cancelledAt" = now() WHERE name LIKE '[probe] SPX-%' AND status <> 'cancelled';`));
// SEC-CHEM-V2: OUR OWN rooms / participants / matches — the shared sweep leaves anything younger than 45 min
// (SWEEP-AGE-V2) to its owner's finally, and this is that finally. Only '[probe] SPX-%', only cancelled meets.
const spx = `(SELECT id FROM meet WHERE name LIKE '[probe] SPX-%' AND status = 'cancelled')`;
const rooms = `(SELECT id FROM chat_room WHERE name LIKE '[probe] SPX-%')`;
sql(`DELETE FROM chat_message WHERE "toRoomId" IN ${rooms};`);
sql(`DELETE FROM chat_room_membership WHERE "roomId" IN ${rooms};`);
sql(`DELETE FROM chat_room_invitation WHERE "roomId" IN ${rooms};`);
console.log('  chat rooms ' + sql(`DELETE FROM chat_room WHERE name LIKE '[probe] SPX-%';`));
console.log('  gb_rating_log of SPX meets (after retire, must be 0) ' + sql(`DELETE FROM gb_rating_log l USING meet_match mm WHERE l.source = 'meet' AND l."matchId" = mm.id AND mm."meetId" IN ${spx};`));
console.log('  reviews ' + sql(`DELETE FROM meet_review WHERE "meetId" IN ${spx};`));
sql(`DELETE FROM meet_match WHERE "meetId" IN ${spx};`);
console.log('  participants ' + sql(`DELETE FROM meet_participant WHERE "meetId" IN ${spx};`));
sql(`DELETE FROM meet_group WHERE "meetId" IN ${spx};`);

console.log('\n— the throwaway engines this run started (prod and web-uat are NOT touched)');
for (const c of ['se-before', 'se-jsonb']) console.log('  ' + c + ': ' + run('docker', ['rm', '-f', c]).trim());

console.log('\n— the shared sweep (G13.3): run from the shell after this, for BOTH databases:');
console.log('    SE_DB=se_sbx node /root/social-engine/probes/_sweep.cjs');
console.log('    SWEEP_NOTIF=skip SE_DB=social node /root/social-engine/probes/_sweep.cjs');
console.log('    bash /root/gen/probecount.sh        # must read zero on both');
})().catch((e) => { console.error('CLEANUP ERROR ' + (e && e.stack ? e.stack : e)); process.exit(1); });

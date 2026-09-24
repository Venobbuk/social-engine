// PROBE SWEEP — runs after EVERY engine probe (probes/run.sh) and in the nightly UAT reset, whether the probe passed,
// failed or threw halfway: nothing a check made stays visible to a real tester (GLOBAL_CONTRACT G13).
//
// WHY IT GREW (fresh-eyes P1-3, 2026-09-20). An independent tester opened the Inbox on UAT and found 27 leftover
// threads — '[probe] SEC-9bhz1r consent', '[probe] DIAG-b2-mu9bmjqm' — 24 of them reading "This meet has been
// cancelled", with the one real conversation buried at position 2. Measured that afternoon: 24 probe threads in Amy's
// inbox, 13 probe notifications. Four separate holes, all of them "the sweeper only knew about the rows it happened
// to be written for":
//   1. CHAT ROOMS were never touched. Cancelling a meet does not remove its chat room, and the room carries the meet's
//      name, so every probe meet left a '[probe] …' thread in every participant's inbox for ever.
//   2. The message rule matched the PROBE'S OWN text ("probe <stamp>", "%[probe%") but not what the ENGINE writes into
//      a probe's room — "This meet has been cancelled." is our copy, not the probe's, so it survived every sweep.
//   3. PARTICIPANT ROWS were left, so a cancelled probe meet was still linked to real testers' accounts.
//   4. RATINGS. processRatings() refuses a match in a cancelled meet (GbRating.ts pendingMatches), but a probe meet is
//      rated BEFORE the sweeper cancels it, and the gb_rating_log row then stays for ever. Amy Chan's Statistics read
//      "GRIPBAT RATING 3.32 · 3 matches · On fire — 3 wins in 3 · Upsets 3" over "0 Meets played": all three of those
//      matches came from probe meets this sweeper had already cancelled. The Edge was the wrong number, not the tiles.
// Notifications live in Redis streams, not in SQL — /root/gen/sweep-probe-notifications.sh owns those and is called
// from here so one command cleans everything.
//
// PROOF, NOT A PROMISE (G13.5): with --count (or after any sweep) it prints REACHABLE probe artifacts per surface and
// exits non-zero when the total is not 0.
'use strict';
const { execSync } = require('child_process');

// INVARIANTS-V1: the sandbox is where probes run, so the sweeper has to be able to reach it:
// SE_DB=se_sbx node _sweep.cjs  (default stays `social` so every existing caller is unchanged).
const DB = process.env.SE_DB || 'social';
const COUNT_ONLY = process.argv.includes('--count');
const sql = (q) => execSync('docker exec social-engine-db-1 psql -U social -d ' + DB + ' -Atc "' + q.replace(/"/g, '\\"') + '"', { encoding: 'utf8' }).trim();
const n = (q) => Number(sql(q) || 0);

/* WHAT COUNTS AS PROBE LITTER. G13.1 requires the '[probe] ' prefix on every fixture, and everything made since
 * carries it. The two legacy spellings are named explicitly rather than matched by a loose '%probe%', which would
 * also delete a tester who typed the word. One definition, used by the sweep and by the count. */
/* `[probe%` and not `[probe]%`: lanes write BOTH `[probe] SEC-9bhz1r consent` and `[probe w1-b1] reserve`, and the
 * bracketed-tag form slipped through every sweep until 2026-09-20 (5 meets, 19 guests). One literal bracket plus the
 * word is still specific enough that a tester who types "probe" is never swept. */
const NAMED = `(name LIKE '[probe%' OR name ILIKE 'probe meet%' OR name ILIKE 'probe gated%')`;
const TEXTED = `(text LIKE '%[probe%' OR text ~ '^(probe|dbg) [a-z0-9]+$')`;
/* A probe's GUEST sits inside a meet with an ordinary name — the tester's own 'Casual doubles' had two of them, and
 * flagged it as the one leftover they could not clear themselves. The name is on the participant, not the meet, so
 * every meet-name rule above is blind to it. */
const GUEST = `("displayName" LIKE '[probe%' OR "displayName" ~* '^probe (guest|player|user)')`;

const minAgeMs = Number(process.env.SWEEP_MIN_AGE_MIN ?? 180) * 60000;   // SWEEP-AGE-V3 (2026-09-24): 45 -> 180 min — L6 re-checks run up to 2 h and their own fixtures were swept mid-run
const cutoff = Math.max(0, Date.now() - minAgeMs - 946684800000).toString(36).padStart(8, '0');
if (!/^[0-9a-z]{8}$/.test(cutoff)) throw new Error('_sweep: bad age cutoff ' + cutoff);
const OLD = (col = 'id') => `${col} collate "C" < '${cutoff}'`;

function sweep () {
  const out = [];
  // 1. the fixtures themselves, out of every list a tester can open
  /* SWEEP-AGE-V1 (2026-09-23): every lane's run.sh calls this sweep, and it used to cancel EVERY live [probe] fixture —
   * including one another lane was measuring at that moment (comp-dupr-app run 3 lost its competition mid-run). A
   * fixture younger than SWEEP_MIN_AGE_MIN (default 45) may belong to a probe that is still running, so it is left for
   * its owner's `finally` or the next sweep. The age comes from the aidx id (8 base36 chars = ms since 2000-01-01); an
   * id that does not parse to a plausible date throws, it never counts as old. SWEEP_MIN_AGE_MIN=0 sweeps everything. */
  /* SWEEP-AGE-V2: the age test is ONE SQL predicate, applied to EVERY destructive step below — V1 gated only the three
   * cancels, and a test run then deleted 6 participants + 4 chat rooms of a running lane's fresh meets. aid/aidx ids
   * start with 8 fixed-width lowercase base36 chars of ms since 2000-01-01, so under "C" collation string order IS
   * time order. SWEEP_MIN_AGE_MIN=0 → cutoff = now → everything counts as old. */
  out.push('meet ' + sql(`update meet set status='cancelled', "cancelledAt"=now() where ${NAMED} and status='active' and ${OLD()}`));
  out.push('channel ' + sql(`update channel set "isArchived"=true where ${NAMED} and "isArchived"=false and ${OLD()}`));
  out.push('competition ' + sql(`update competition set status='cancelled' where ${NAMED} and status <> 'cancelled' and ${OLD()}`));
  out.push('note ' + sql(`delete from note where text like '%[probe]%' and ${OLD()}`));

  /* 2. THE RATINGS A PROBE MEET MINTED. The rule already exists — GbRating.pendingMatches refuses a match whose meet
   *    is cancelled — but it is applied at rating time only, and the probe rates before the sweeper cancels. Delete
   *    the log rows that belong to a probe meet, then make gb_player_rating agree with what is LEFT of the log, so
   *    the Edge card and the player's own match count are one fact again. */
  out.push('rating_log ' + sql(`delete from gb_rating_log l using meet_match mm, meet m where l.source='meet' and l."matchId"=mm.id and mm."meetId"=m.id and ${NAMED.replace(/name/g, 'm.name')} and ${OLD('m.id')}`));
  /* AND THE ORPHANS. A probe that tidies up after itself deletes its meet and its matches but never the rating rows
   * they minted, so the rule above — which JOINS to meet_match — cannot see them: the row outlives the match that
   * justified it. MEASURED 2026-09-20: 6 such rows in se_sbx, 3 of them Amy Chan's, and they were the whole of the
   * "GRIPBAT RATING 3.32 · 3 matches · On fire · Upsets 3" her Statistics showed over "0 Meets played". A rating row
   * whose match no longer exists cannot be checked by anyone and must not count. */
  out.push('orphan_rating ' + sql(`delete from gb_rating_log l where l.source='meet' and not exists (select 1 from meet_match mm where mm.id = l."matchId")`));
  /* AND WHAT A CANCELLED MEET MINTED. Same rule as the engine's own (GbRating.pendingMatches: a match in a cancelled
   * meet is never rated), applied to rows that were minted before the meet was cancelled. The engine patch in
   * /root/gen/engine-patches-fe/ closes it at the source; this keeps the data honest until that ships. */
  out.push('cancelled_rating ' + sql(`delete from gb_rating_log l using meet_match mm, meet m where l.source='meet' and l."matchId"=mm.id and mm."meetId"=m.id and m.status='cancelled'`));
  /* gb_player_rating is a COUNTER, not a derivation, so it has to be put back to what is left of the log — otherwise
   * the Edge keeps printing the match count of matches that no longer exist. Last resort: a player with nothing left
   * loses the row entirely and falls back to their seeded level, which is what a player with no rated match is. */
  sql(`with agg as (select "userId", sport, count(*)::int cnt, (array_agg(post order by "playedAt" desc))[1] as last from gb_rating_log where not skipped and "userId" <> '-' group by 1,2)
       update gb_player_rating r set matches = agg.cnt, rating = agg.last, "updatedAt" = now() from agg where r."userId" = agg."userId" and r.sport = agg.sport and (r.matches <> agg.cnt or r.rating <> agg.last)`);
  out.push('player_rating ' + sql(`delete from gb_player_rating r where not exists (select 1 from gb_rating_log l where l."userId" = r."userId" and l.sport = r.sport and not l.skipped)`));

  /* 3. THE CHAT ROOMS. A meet's room carries the meet's name, so a probe meet leaves a '[probe] …' thread in every
   *    participant's inbox. Cancelling the meet never touched it. The room and everything hanging off it go. */
  const rooms = `(select id from chat_room where ${NAMED} and ${OLD()})`;
  sql(`delete from chat_message where "toRoomId" in ${rooms}`);
  sql(`delete from chat_room_membership where "roomId" in ${rooms}`);
  sql(`delete from chat_room_invitation where "roomId" in ${rooms}`);
  out.push('chat_room ' + sql(`delete from chat_room where ${NAMED} and ${OLD()}`));
  // …and the probes' own lines in rooms that are NOT theirs (a DM to a tester, a line in a real club's chat)
  out.push('chat_message ' + sql(`delete from chat_message where ${TEXTED} and ${OLD()}`));

  /* 4. UNLINK. A cancelled meet is out of Discover, but its participant rows still tie real testers' accounts to it,
   *    and its reviews/matches still exist. G13.3: nothing a probe made stays reachable from a tester's screens. */
  const meets = `(select id from meet where ${NAMED} and ${OLD()})`;
  out.push('meet_review ' + sql(`delete from meet_review where "meetId" in ${meets}`));
  sql(`delete from meet_match where "meetId" in ${meets}`);
  out.push('meet_participant ' + sql(`delete from meet_participant where "meetId" in ${meets}`));
  sql(`delete from meet_group where "meetId" in ${meets}`);

  /* 4b. THE PROBES' GUESTS INSIDE SOMEONE ELSE'S MEET. Drop any match that referenced them first (team1Ids /
   *     team2Ids hold participant ids, so a deleted guest would leave a dangling id and a match nobody can read),
   *     then the guest rows, then close a casual game that no longer has two players — a one-player casual game is
   *     not a game, and it is what the tester was left staring at. */
  const GUEST_OLD = `(${GUEST} and ${OLD()})`;
  const guests = `(select id from meet_participant where ${GUEST_OLD})`;
  const guestMeets = sql(`select distinct "meetId" from meet_participant where ${GUEST_OLD}`).split('\n').filter(Boolean)
    .map(id => `'${id.replace(/[^a-z0-9]/g, '')}'`);
  sql(`delete from meet_match where "team1Ids" && array(select id from meet_participant where ${GUEST_OLD}) or "team2Ids" && array(select id from meet_participant where ${GUEST_OLD})`);
  out.push('probe_guest ' + sql(`delete from meet_participant where ${GUEST_OLD}`));
  // only the meets a probe guest was just removed from — never a tester's own game that is waiting for an opponent
  out.push('casual_left ' + (guestMeets.length ? sql(`update meet set status='cancelled', "cancelledAt"=now() where id in (${guestMeets.join(',')}) and 'casual' = any(flags) and status='active' and (select count(*) from meet_participant p where p."meetId" = meet.id) < 2`) : 'UPDATE 0'));
  void guests;

  // 5. venue feedback a probe filed (G13.4: a probe-filed report never lands in a human queue)
  out.push('venue_feedback ' + sql(`delete from venue_feedback where body like '%[probe%' and ${OLD()}`));

  console.log('[sweep] db ' + DB + ' · ' + out.join(' · '));
}

/** G13.5: the proof is a query, not a sentence. Reachable = what a tester could still open. */
function count () {
  const rows = [
    ['meets (active)', n(`select count(*) from meet where ${NAMED} and status <> 'cancelled'`)],
    ['meet participants', n(`select count(*) from meet_participant p join meet m on m.id = p."meetId" where ${NAMED.replace(/name/g, 'm.name')}`)],
    ['probe guests in other meets', n(`select count(*) from meet_participant where ${GUEST}`)],
    ['chat rooms', n(`select count(*) from chat_room where ${NAMED}`)],
    ['chat messages', n(`select count(*) from chat_message where ${TEXTED}`)],
    ['clubs (live)', n(`select count(*) from channel where ${NAMED} and "isArchived" = false`)],
    ['competitions (live)', n(`select count(*) from competition where ${NAMED} and status <> 'cancelled'`)],
    ['notes', n("select count(*) from note where text like '%[probe]%'")],
    ['ratings from probe meets', n(`select count(*) from gb_rating_log l join meet_match mm on mm.id = l."matchId" join meet m on m.id = mm."meetId" where l.source = 'meet' and ${NAMED.replace(/name/g, 'm.name')}`)],
    ['ratings whose match is gone', n(`select count(*) from gb_rating_log l where l.source = 'meet' and not exists (select 1 from meet_match mm where mm.id = l."matchId")`)],
    ['ratings a cancelled meet minted', n(`select count(*) from gb_rating_log l join meet_match mm on mm.id = l."matchId" join meet m on m.id = mm."meetId" where l.source = 'meet' and m.status = 'cancelled'`)],
    ['venue feedback', n(`select count(*) from venue_feedback where body like '%[probe%'`)],
    ['meet reviews', n(`select count(*) from meet_review r join meet m on m.id = r."meetId" where ${NAMED.replace(/name/g, 'm.name')}`)],
  ];
  const total = rows.reduce((s, r) => s + r[1], 0);
  for (const [k, v] of rows) console.log('[probe-litter] ' + (v === 0 ? 'OK  ' : 'LEFT') + ' ' + String(v).padStart(5) + '  ' + k);
  console.log('[probe-litter] db ' + DB + ' · reachable probe artifacts: ' + total);
  return total;
}

if (!COUNT_ONLY) {
  sweep();
  /* Notifications are Redis streams, so SQL never saw them. One command cleans everything (G13.3). It walks every
   * Redis database, so a caller sweeping both SQL databases in a row asks for it once (SWEEP_NOTIF=skip). */
  if (process.env.SWEEP_NOTIF !== 'skip') {
    try { console.log(execSync('bash /root/gen/sweep-probe-notifications.sh', { encoding: 'utf8' }).trim()); }
    catch (e) { console.log('[sweep] notification sweep left entries behind or failed: ' + ((e && e.stdout) || (e && e.message) || '')); }
  }
}
const left = count();
/* SWEEP-AGE-V2-EXIT: after a sweep, only ABANDONED litter (older than the age gate) fails the caller — a younger
 * fixture may be another lane's run in flight; it is still printed above, it is just not this caller's failure.
 * `--count` (probecount.sh, the final gate) stays strict: everything reachable counts. */
const abandoned = COUNT_ONLY ? left : n(`select (select count(*) from meet where ${NAMED} and status <> 'cancelled' and ${OLD()})
  + (select count(*) from channel where ${NAMED} and "isArchived" = false and ${OLD()})
  + (select count(*) from competition where ${NAMED} and status <> 'cancelled' and ${OLD()})
  + (select count(*) from chat_room where ${NAMED} and ${OLD()})
  + (select count(*) from meet_participant where ${GUEST} and ${OLD()})`);
if (!COUNT_ONLY) console.log('[probe-litter] db ' + DB + ' · abandoned (older than ' + (minAgeMs / 60000) + ' min): ' + abandoned);
if (abandoned !== 0) process.exitCode = 2;

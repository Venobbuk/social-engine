#!/usr/bin/env node
// DISCOVER-V3 — anchored, idempotent inserts into the engine's SHARED files (AGENT_RULES §1: re-read at run time,
// insert by a unique anchor, never copy a whole shared file). Node, because this PC has no python; same semantics.
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', 'packages', 'backend', 'src');
function edit(rel, anchor, insert, after, marker) {
  const p = path.join(ROOT, rel);
  let s = fs.readFileSync(p, 'utf8');
  const key = marker || insert.trim().split('\n')[0];
  if (s.includes(key)) { console.log('skip (present): ' + rel); return; }
  const i = s.indexOf(anchor);
  if (i < 0) { console.log('ANCHOR MISSING in ' + rel + ': ' + anchor.slice(0, 60)); process.exit(1); }
  const j = after ? i + anchor.length : i;
  s = s.slice(0, j) + insert + s.slice(j);
  fs.writeFileSync(p, s);
  console.log('edited: ' + rel);
}

// 1. endpoint registry — after the last venues line
edit('server/api/endpoint-list.ts',
  "export * as 'venues/locations/delete' from '@/modules/venues/endpoints/locations-delete.js';\n",
  "// DISCOVER-V3: venue feedback + owner claim, coach profile, stats (DUPR rankings, pairings, h2h, street cred)\n" +
  "export * as 'venues/feedback' from '@/modules/venues/endpoints/feedback-create.js';\n" +
  "export * as 'venues/feedback/list' from '@/modules/venues/endpoints/feedback-list.js';\n" +
  "export * as 'venues/claim' from '@/modules/venues/endpoints/claim.js';\n" +
  "export * as 'coaches/show' from '@/modules/coaches/endpoints/show.js';\n" +
  "export * as 'coaches/update' from '@/modules/coaches/endpoints/update.js';\n" +
  "export * as 'coaches/list' from '@/modules/coaches/endpoints/list.js';\n" +
  "export * as 'stats/dupr-rankings' from '@/modules/stats/endpoints/dupr-rankings.js';\n" +
  "export * as 'stats/pairings' from '@/modules/stats/endpoints/pairings.js';\n" +
  "export * as 'stats/h2h' from '@/modules/stats/endpoints/h2h.js';\n" +
  "export * as 'stats/street-cred' from '@/modules/stats/endpoints/street-cred.js';\n" +
  "export * as 'stats/kudos-by-activity' from '@/modules/stats/endpoints/kudos-by-activity.js';\n",
  true, "export * as 'venues/feedback' from");

// 2. MeetPlayerLevel — the coach columns (Reclub Coach model: one profile per user per sport = this table's grain)
edit('modules/meets/models/MeetPlayerLevel.ts',
  "\t// ONBOARDED-V1: set once when the player finishes",
  "\t// DISCOVER-V3 (coach): Reclub's Coach model (experience / rate / notes / status Active|Inactive), one per (user, sport).\n" +
  "\t@Column('varchar', { length: 16, nullable: true, comment: 'active | inactive; null = no coach profile' })\n" +
  "\tpublic coachStatus: string | null;\n\n" +
  "\t@Column('varchar', { length: 2048, nullable: true })\n" +
  "\tpublic coachExperience: string | null;\n\n" +
  "\t@Column('varchar', { length: 256, nullable: true })\n" +
  "\tpublic coachRate: string | null;\n\n" +
  "\t@Column('varchar', { length: 2048, nullable: true })\n" +
  "\tpublic coachNotes: string | null;\n\n" +
  "\t@Column('timestamp with time zone', { nullable: true })\n" +
  "\tpublic coachUpdatedAt: Date | null;\n\n",
  false, 'public coachStatus');

// 3. meets/list — Reclub's remaining Discover filters (spec §9.4): times, friendsOnly, hideEmpty, verifiedOnly
edit('modules/meets/endpoints/list.ts',
  "\t\thideFull: { type: 'boolean', default: false },\n",
  "\t\t// DISCOVER-V3: Reclub filter.tsx — times (mornings 4-11 / afternoons 11-17 / evenings 17-24, the meet's own\n" +
  "\t\t// timezone), friendsOnly (host or a confirmed player is someone I follow), hideEmpty (no confirmed player yet),\n" +
  "\t\t// verifiedOnly (the meet's venue row is Verified)\n" +
  "\t\ttimes: { type: 'array', items: { type: 'string', enum: ['mornings', 'afternoons', 'evenings'] }, nullable: true },\n" +
  "\t\tfriendsOnly: { type: 'boolean', default: false },\n" +
  "\t\thideEmpty: { type: 'boolean', default: false },\n" +
  "\t\tverifiedOnly: { type: 'boolean', default: false },\n",
  true, 'friendsOnly: { type: ');
edit('modules/meets/endpoints/list.ts',
  "\t\t\tif (ps.hideFull) {\n",
  "\t\t\t// DISCOVER-V3 filters\n" +
  "\t\t\tif (ps.times && ps.times.length > 0 && ps.times.length < 3) {\n" +
  "\t\t\t\tconst bands: string[] = [];\n" +
  "\t\t\t\tconst hour = 'EXTRACT(HOUR FROM (meet.\"startAt\" AT TIME ZONE meet.timezone))';\n" +
  "\t\t\t\tif (ps.times.includes('mornings')) bands.push(`(${hour} >= 4 AND ${hour} < 11)`);\n" +
  "\t\t\t\tif (ps.times.includes('afternoons')) bands.push(`(${hour} >= 11 AND ${hour} < 17)`);\n" +
  "\t\t\t\tif (ps.times.includes('evenings')) bands.push(`(${hour} >= 17 OR ${hour} < 4)`);\n" +
  "\t\t\t\tq.andWhere(`(${bands.join(' OR ')})`);\n" +
  "\t\t\t}\n" +
  "\t\t\tif (ps.friendsOnly) {\n" +
  "\t\t\t\tif (me == null) return [];\n" +
  "\t\t\t\tq.andWhere('(EXISTS (SELECT 1 FROM following f WHERE f.\"followerId\" = :fMe AND f.\"followeeId\" = meet.\"hostId\") OR EXISTS (SELECT 1 FROM meet_participant fp JOIN following f2 ON f2.\"followeeId\" = fp.\"userId\" WHERE fp.\"meetId\" = meet.id AND fp.status IN (\\'confirmed\\', \\'hold\\') AND f2.\"followerId\" = :fMe))', { fMe: me.id });\n" +
  "\t\t\t}\n" +
  "\t\t\tif (ps.hideEmpty) q.andWhere('EXISTS (SELECT 1 FROM meet_participant ep WHERE ep.\"meetId\" = meet.id AND ep.status = \\'confirmed\\')');\n" +
  "\t\t\tif (ps.verifiedOnly) q.andWhere('meet.\"venueId\" IS NOT NULL AND EXISTS (SELECT 1 FROM venue v WHERE v.id = meet.\"venueId\" AND v.status = \\'verified\\')');\n",
  false, '// DISCOVER-V3 filters');
console.log('done');

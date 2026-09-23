/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// CLUB-TIERS-V1 (2026-09-20) — Reclub's two relationships with a club, as SQL other modules share without a DI edge.
//
//   FOLLOWER  Misskey's own channel_following (channels/follow, native; ChannelFollowingService.follow). A follower sees
//             the club's public content: its public meets, public posts, announcements — and hears about new public meets.
//   MEMBER    club_member (GripBat's extension — Misskey has no membership concept), joined through the club's gate
//             (open → now; approval → a request the admins decide; invite → an invitation or the ?at= link). A member
//             is also a follower (joining follows; unfollowing a club you belong to is leaving it). The owner is always a
//             member (a row with via 'owner', and implicitly by channel.userId).
//
// The ONE rule for "is X a member of club C" lives in ClubService.isMember; these fragments are the same rule for raw
// SQL readers (ChannelEntityService counts, MeetService.mayViewPrivate, meets/list, promote audiences).

/** `EXISTS` for "user <userExpr> is a member of club <channelExpr>" — a club_member row or the club's owner. */
export function memberExistsSql(channelExpr: string, userExpr: string): string {
	return `(EXISTS (SELECT 1 FROM "club_member" cm WHERE cm."channelId" = ${channelExpr} AND cm."userId" = ${userExpr})
		OR EXISTS (SELECT 1 FROM "channel" co WHERE co."id" = ${channelExpr} AND co."userId" = ${userExpr}))`;
}

/** `EXISTS` for "user <userExpr> is the owner or an admin of club <channelExpr>". */
export function adminExistsSql(channelExpr: string, userExpr: string): string {
	return `(EXISTS (SELECT 1 FROM "channel" co WHERE co."id" = ${channelExpr} AND co."userId" = ${userExpr})
		OR EXISTS (SELECT 1 FROM "club_setting" cs WHERE cs."channelId" = ${channelExpr} AND ${userExpr} = ANY(cs."adminIds")))`;
}

/** Members and followers per club, one query for any number of clubs.
 *  members   = club_member rows other than the owner's, + 1 for an owned club
 *  followers = channel_following rows of people who are NOT members (the follower tier only, owner excluded) —
 *              so members + followers is the club's whole audience, nobody counted twice.
 *  notes     = GB-NOTESCOUNT-LIVE-V1 (2026-09-23): the club's note rows that exist NOW. Misskey's channel.notesCount is a
 *              running total (NoteCreateService increments it, NoteDeleteService never decrements it) — measured 17 on a
 *              club whose timeline has 7 posts (probes/page-agreement, counter_not_its_rows). Counted like members. */
export async function clubCounts(db: { query: (sql: string, params?: unknown[]) => Promise<unknown> }, channelIds: string[]): Promise<Map<string, { members: number; followers: number; notes: number }>> {
	if (channelIds.length === 0) return new Map();
	const rows = await db.query(
		`SELECT c."id",
		        ((SELECT count(*) FROM "club_member" m WHERE m."channelId" = c."id" AND m."userId" IS DISTINCT FROM c."userId")
		         + (CASE WHEN c."userId" IS NOT NULL THEN 1 ELSE 0 END))::int AS "members",
		        (SELECT count(*) FROM "channel_following" f WHERE f."followeeId" = c."id" AND f."followerId" IS DISTINCT FROM c."userId"
		           AND NOT EXISTS (SELECT 1 FROM "club_member" m2 WHERE m2."channelId" = c."id" AND m2."userId" = f."followerId"))::int AS "followers",
		        (SELECT count(*) FROM "note" n WHERE n."channelId" = c."id")::int AS "notesLive"
		   FROM "channel" c WHERE c."id" = ANY($1)`, [channelIds]) as { id: string; members: number | string; followers: number | string; notesLive: number | string }[];
	return new Map(rows.map(r => [r.id, { members: Number(r.members), followers: Number(r.followers), notes: Number(r.notesLive) }]));
}

/** Reclub club forum: may this user post (or comment, or renote) in the club? Admins always; members while the forum is
 *  on; followers and visitors never. The same rule as ClubService.canPost, for the note-creation core (no DI edge). */
export async function mayPostInClub(db: { query: (sql: string, params?: unknown[]) => Promise<unknown> }, channelId: string, userId: string): Promise<boolean> {
	const rows = await db.query(`SELECT ${adminExistsSql('$1', '$2')} AS "admin", ${memberExistsSql('$1', '$2')} AS "member",
		COALESCE((SELECT s."enableForum" FROM "club_setting" s WHERE s."channelId" = $1), true) AS "forum"`, [channelId, userId]) as { admin: boolean; member: boolean; forum: boolean }[];
	const r = rows[0];
	return !!r && (r.admin || (r.member && r.forum));
}

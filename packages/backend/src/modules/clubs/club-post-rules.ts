/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { DataSource } from 'typeorm';
import type { ClubService } from '@/modules/clubs/ClubService.js';

/*
 * CLUB-POSTS-LINKS-V1 (lane club-posts-links, 2026-09-23) — two club rules that Misskey has no concept of.
 *
 * 1. OUTSIDE ACTIVITY LINKS (Reclub B-set-comms.03 "Allow outside activity links", API refusal non_club_links_not_allowed,
 *    copy channels:outside_links_restricted "Oops! The club admin has restricted links to outside activities."). With the
 *    club setting OFF, a member may not put ANOTHER club's (or a club-less) meet or competition into the club's posts,
 *    comments or chat — as a meet card (chat meetId) or as a link to it (the app's meet / competition page, or the /m/<code>
 *    short link). The club's own activities stay allowed; the owner and admins are exempt (they set the rule). Enforced
 *    server-side at every write door: notes/create (post + comment), clubs/posts/edit, chat/messages/create-to-room.
 *
 * 2. CLUB HANDLE (Reclub B-set-profile.03, /clubs/@handle): 3-30 characters, a-z 0-9 _ , lower-case, unique; a name
 *    containing "gripbat" or a route word is reserved (Reclub users:restricted_name reserves its own brand).
 */

export const OUTSIDE_LINK_ERROR_ID = 'club:outside_links';
export const OUTSIDE_LINK_MESSAGE = 'The club admin has restricted links to outside activities.';
/** The API refusal every write door throws (Reclub non_club_links_not_allowed). */
export const handleTakenError = { message: 'This handle is taken.', code: 'CLUB_HANDLE_TAKEN', id: 'c1b00000-0000-4000-8000-0000000000c1' } as const;
export const handleInvalidError = { message: 'A handle is 3-30 characters: a-z, 0-9 and _ (not at the ends).', code: 'CLUB_HANDLE_INVALID', id: 'c1b00000-0000-4000-8000-0000000000c2' } as const;
export const handleReservedError = { message: 'This handle is reserved.', code: 'CLUB_HANDLE_RESERVED', id: 'c1b00000-0000-4000-8000-0000000000c3' } as const;
export const outsideLinksError = { message: OUTSIDE_LINK_MESSAGE, code: 'OUTSIDE_LINK_BLOCKED', id: 'c1b00000-0000-4000-8000-0000000000a1' } as const;

const MEET_PAGE = /pages\/meet\/index\?[^\s]*?\bid=([a-z0-9]{6,32})/gi;
const COMP_PAGE = /pages\/tournament\/index\?[^\s]*?\bid=([a-z0-9]{6,32})/gi;
const MEET_SHORT = /(?:https?:\/\/[^\s/]+|^|[\s(])\/m\/([A-Za-z0-9]{4,16})(?![A-Za-z0-9])/g;

export interface ActivityRefs { meetIds: string[]; meetCodes: string[]; competitionIds: string[] }

/** Every meet / competition a text points at (ids from app links, meet reference codes from /m/<code>). */
export function activityRefs(text: string | null | undefined): ActivityRefs {
	const t = String(text ?? '');
	const all = (re: RegExp) => Array.from(t.matchAll(re), (m) => m[1]);
	return { meetIds: [...new Set(all(MEET_PAGE))], meetCodes: [...new Set(all(MEET_SHORT))], competitionIds: [...new Set(all(COMP_PAGE))] };
}

/** True when any referenced activity exists and does not belong to this club. Unknown ids are not activities. */
export async function pointsOutside(db: DataSource, channelId: string, refs: ActivityRefs): Promise<boolean> {
	if (refs.meetIds.length || refs.meetCodes.length) {
		const r = await db.query(`SELECT 1 FROM "meet" WHERE ("id" = ANY($1) OR "referenceCode" = ANY($2)) AND "channelId" IS DISTINCT FROM $3 LIMIT 1`, [refs.meetIds, refs.meetCodes, channelId]) as unknown[];
		if (r.length) return true;
	}
	if (refs.competitionIds.length) {
		const r = await db.query(`SELECT 1 FROM "competition" WHERE "id" = ANY($1) AND "channelId" IS DISTINCT FROM $2 LIMIT 1`, [refs.competitionIds, channelId]) as unknown[];
		if (r.length) return true;
	}
	return false;
}

/**
 * THE outside-links gate. Returns null when allowed, else the refusal message. `text` is what the writer sends; `meetId` a
 * chat meet card. A channel with no club_setting row, or with the setting on (the default), allows everything.
 */
export async function outsideLinkRefusal(db: DataSource, clubService: ClubService, channelId: string | null | undefined, userId: string, text: string | null | undefined, meetId?: string | null): Promise<string | null> {
	if (!channelId) return null;
	const refs = activityRefs(text);
	if (meetId) refs.meetIds.push(meetId);
	if (!refs.meetIds.length && !refs.meetCodes.length && !refs.competitionIds.length) return null;
	const row = await db.query(`SELECT "allowOutsideLinks" FROM "club_setting" WHERE "channelId" = $1`, [channelId]) as { allowOutsideLinks: boolean }[];
	if (!row.length || row[0].allowOutsideLinks !== false) return null;
	if ((await clubService.clubRole(channelId, userId)).admin) return null;
	return (await pointsOutside(db, channelId, refs)) ? OUTSIDE_LINK_MESSAGE : null;
}

/** The club a chat room belongs to (the club chat, CLUB-CHAT-V1), or null. */
export async function clubOfRoom(db: DataSource, roomId: string): Promise<string | null> {
	const r = await db.query(`SELECT "channelId" FROM "club_setting" WHERE "chatRoomId" = $1 LIMIT 1`, [roomId]) as { channelId: string }[];
	return r.length ? r[0].channelId : null;
}

// ------------------------------------------------------------------------------------------------ club handle
const HANDLE_RE = /^[a-z0-9][a-z0-9_]{1,28}[a-z0-9]$/;
const RESERVED = new Set(['admin', 'admins', 'support', 'official', 'staff', 'help', 'settings', 'new', 'app', 'api', 'club', 'clubs', 'meet', 'meets', 'm', 'me', 'null', 'undefined', 'uat', 'test']);

export function normalizeHandle(h: string | null | undefined): string {
	return String(h ?? '').trim().replace(/^@/, '').toLowerCase();
}

/** null when the handle is well-formed and not reserved, else why not ('invalid' | 'reserved'). */
export function handleProblem(h: string): 'invalid' | 'reserved' | null {
	if (!HANDLE_RE.test(h)) return 'invalid';
	if (RESERVED.has(h) || h.includes('gripbat')) return 'reserved';
	return null;
}

/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { DataSource } from 'typeorm';
import type { ChatService } from '@/core/ChatService.js';
import type { MiMeet } from '@/modules/meets/models/Meet.js';

/* CHAT-V2 — the meet chat's SYSTEM LINES (Reclub spec_meets §Y.10 / spec_profile_social_system §9.1 previews):
 *   joined     "{name} has joined the conversation."      — a player's row reaches confirmed (MeetService.onConfirmedNow)
 *   cancelled  "This meet has been cancelled."            — MeetService.cancel
 *   time       "{name} updated the meet time."            — MeetService.update, startAt / durationMinutes changed
 *   venue      "{name} updated the meet location."        — venueName / venueAddress / venueId changed
 *   fee        "{name} updated the meet fee."             — feeType / feeAmount / feeCurrency changed
 *   ended      "This meet has ended. Thank you for playing!" — the minute sweep, once the end time has passed
 * plus the ARCHIVE RULE: with the "ended" line the room's readOnlyAt is set to end + 14 days (competition chats: 7 days,
 * TOURNAMENT stream — call chatService.setRoomReadOnlyAt(roomId, end + 7 d) from its own transition).
 * The line is stored on the message (`system` jsonb) as { key, name?, meetId } and localized by the client; the engine
 * never renders copy. One plain module, no DI: MeetService already holds the ChatService and the DataSource. Best-effort —
 * a chat hiccup never fails the meet transition. */
export type MeetSystemKey = 'joined' | 'cancelled' | 'time' | 'venue' | 'fee' | 'ended';

export const MEET_CHAT_ARCHIVE_DAYS = 14;

export async function meetSystemLine(chatService: ChatService, meet: Pick<MiMeet, 'id' | 'chatRoomId'>, key: MeetSystemKey, data: { name?: string | null; userId?: string | null } = {}): Promise<void> {
	if (!meet.chatRoomId) return;
	try {
		await chatService.createSystemMessageToRoom(meet.chatRoomId, { key, meetId: meet.id, ...(data.name ? { name: data.name } : {}), ...(data.userId ? { userId: data.userId } : {}) });
	} catch {
		// chat is best-effort
	}
}

/** Which of the update's fields Reclub announces: the first matching key (time > venue > fee), or null. */
export function meetUpdateSystemKey(before: MiMeet, patch: Partial<MiMeet>): Exclude<MeetSystemKey, 'joined' | 'cancelled' | 'ended'> | null {
	const changed = (k: keyof MiMeet) => patch[k] !== undefined && String(patch[k] instanceof Date ? (patch[k] as Date).toISOString() : patch[k] ?? '') !== String(before[k] instanceof Date ? (before[k] as Date).toISOString() : before[k] ?? '');
	if (changed('startAt') || changed('durationMinutes')) return 'time';
	if (changed('venueName') || changed('venueAddress') || changed('venueId')) return 'venue';
	if (changed('feeType') || changed('feeAmount') || changed('feeCurrency')) return 'fee';
	return null;
}

/** The minute sweep's half: every active meet whose end has passed (within the last 3 days, so a restart never floods
 *  old rooms) and whose room has no "ended" line yet gets one, and its room is archived MEET_CHAT_ARCHIVE_DAYS later. */
export async function sweepEndedMeetChats(db: DataSource, chatService: ChatService, now = new Date()): Promise<number> {
	const rows = await db.query(
		`SELECT m."id", m."chatRoomId", m."startAt", m."durationMinutes"
		   FROM "meet" m
		  WHERE m."status" = 'active' AND m."chatRoomId" IS NOT NULL
		    AND m."startAt" + (m."durationMinutes" * interval '1 minute') <= $1
		    AND m."startAt" >= $1::timestamptz - interval '3 days'
		    AND NOT EXISTS (SELECT 1 FROM "chat_message" c WHERE c."toRoomId" = m."chatRoomId" AND c."system"->>'key' = 'ended')
		  LIMIT 200`, [now]) as { id: string; chatRoomId: string; startAt: Date; durationMinutes: number }[];
	let n = 0;
	for (const r of rows) {
		const end = new Date(new Date(r.startAt).getTime() + r.durationMinutes * 60_000);
		await meetSystemLine(chatService, { id: r.id, chatRoomId: r.chatRoomId }, 'ended');
		try { await chatService.setRoomReadOnlyAt(r.chatRoomId, new Date(end.getTime() + MEET_CHAT_ARCHIVE_DAYS * 86_400_000)); } catch { /* best-effort */ }
		n++;
	}
	return n;
}

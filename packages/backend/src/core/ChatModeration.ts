/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { DataSource } from 'typeorm';
import type { MiChatRoom } from '@/models/ChatRoom.js';
import type { MiUser } from '@/models/User.js';

/* CHAT-MOD-V1 (WAVE-1 lane B3, 2026-09-20) — who runs a room, read by chat/threads/show so the app knows whether to
 * offer Delete on someone else's message, and whether a room's membership is its own.
 *  - runsRoom: THE rule for CHAT-MODERATE-V1 — chat/messages/delete (the door) and chat/threads/show canModerate (the
 *    menu) both call it, so they cannot disagree: the room owner; in a club chat the club's owner and admins; in a meet
 *    chat the host and co-hosts; in a competition chat its host and co-admins (COMP-W1B4 adminIds).
 *  - roomManagement: a room another module mints and keeps in step is MANAGED — a meet's chat (meet.chatRoomId), a
 *    club's chat (club_setting.chatRoomId), a competition's chat. Its membership follows the meet roster / the club /
 *    the entries, so members are removed THERE, never from the chat alone. A plain group (chat/rooms/create or
 *    chat/rooms/create-group) is managed by nobody but its owner. */
export type ManagedKind = 'meet' | 'club' | 'competition' | null;

export async function runsRoom(db: DataSource, roomId: MiChatRoom['id'], userId: MiUser['id']): Promise<boolean> {
	const rows = await db.query(`SELECT 1 FROM "chat_room" r WHERE r."id" = $1 AND r."ownerId" = $2
		UNION ALL SELECT 1 FROM "club_setting" s JOIN "channel" c ON c."id" = s."channelId" WHERE s."chatRoomId" = $1 AND (c."userId" = $2 OR $2 = ANY(s."adminIds"))
		UNION ALL SELECT 1 FROM "meet" m WHERE m."chatRoomId" = $1 AND (m."hostId" = $2 OR EXISTS (SELECT 1 FROM "meet_participant" p WHERE p."meetId" = m."id" AND p."userId" = $2 AND p."isHost"))
		UNION ALL SELECT 1 FROM "competition" k WHERE k."chatRoomId" = $1 AND (k."hostId" = $2 OR $2 = ANY(k."adminIds"))
		LIMIT 1`, [roomId, userId]) as unknown[];
	return rows.length > 0;
}

export async function roomManagement(db: DataSource, roomId: MiChatRoom['id']): Promise<ManagedKind> {
	const rows = await db.query(`SELECT 'club' AS "kind" FROM "club_setting" WHERE "chatRoomId" = $1
		UNION ALL SELECT 'meet' FROM "meet" WHERE "chatRoomId" = $1
		UNION ALL SELECT 'competition' FROM "competition" WHERE "chatRoomId" = $1
		LIMIT 1`, [roomId]) as { kind: ManagedKind }[];
	return rows.length ? rows[0].kind : null;
}

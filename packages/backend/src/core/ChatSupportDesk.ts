/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { In, IsNull } from 'typeorm';
import type { DataSource } from 'typeorm';
import type { ChatMessagesRepository, ChatRoomMembershipsRepository, ChatRoomsRepository, UsersRepository } from '@/models/_.js';
import type { MiChatRoom } from '@/models/ChatRoom.js';
import type { MiUser } from '@/models/User.js';
import type { ChatService } from '@/core/ChatService.js';
import type { RoleService } from '@/core/RoleService.js';
import { supportUsername, csatAskAttachment, CsatError } from '@/core/ChatCsat.js';

/* SUPPORT-DESK-V1 (lane BENCH-A, E-chat-room.14; orchestrator decision 2026-09-25) — "Contact support" is a ROOM whose staff side
 * is the people holding GripBat's STAFF role, not a 1-on-1 with the GripBat Team account (engine user GRIPBAT_SUPPORT_USERNAME,
 * default 'boyau'), which nobody can sign in to: no password, no SSO link (lane fix-S8's note), so support threads and the
 * CSAT survey could only be worked by reading its token from the database.
 *
 * The desk: one room per player, OWNED by the Team account (so no player or staff member can delete it or remove the others),
 * described 'support:<playerId>', named "Support · <player>". Members: the player + every current staff member —
 * RoleService moderators and administrators (STAFF-ADMIN-V1: hkpl SUPER_ADMIN / TENANT_ADMIN of a GripBat tenant become a
 * full moderator + administrator at SSO sign-in). The membership is re-synced each time the player opens the desk: new staff
 * join, a member who is no longer staff (and is not the player) is removed, so a demoted admin stops reading support threads.
 * The survey (Reclub channels:csat.*) moves with it: a STAFF member closes with csatAsk in the room; only the room's player
 * answers, once, before it expires (CSAT_DAYS) — the same attachments as CHAT-CSAT-V1's 1-on-1.
 * REUSED: ChatService.createRoom / createRoomInvitation(notify:false) + joinToRoom (the meet roster pattern, MeetService),
 * RoleService.getModeratorIds, ChatCsat. NEW: the desk room rule (searched: no support / helpdesk concept in Misskey or hkpl's
 * chat; hkpl's bug-report inbox has no conversation). */
export const SUPPORT_PREFIX = 'support:';

export function supportPlayerId(room: Pick<MiChatRoom, 'description'> | null | undefined): string | null {
	const d = room && room.description ? String(room.description) : '';
	return d.startsWith(SUPPORT_PREFIX) ? d.slice(SUPPORT_PREFIX.length) : null;
}

export async function supportTeam(users: UsersRepository): Promise<MiUser | null> {
	return users.findOneBy({ usernameLower: supportUsername().toLowerCase(), host: IsNull() });
}

/** Is this room a support desk room (owned by the Team account, described support:<id>)? */
export async function isSupportRoom(users: UsersRepository, room: Pick<MiChatRoom, 'ownerId' | 'description'>): Promise<boolean> {
	if (supportPlayerId(room) == null) return false;
	const team = await supportTeam(users);
	return team != null && team.id === room.ownerId;
}

export class SupportDeskError extends Error { constructor(public code: 'no_team' | 'is_team') { super(code); } }

/** Find-or-create the player's desk room and bring its staff side up to date. */
export async function openSupportDesk(deps: {
	users: UsersRepository; rooms: ChatRoomsRepository; memberships: ChatRoomMembershipsRepository; chatService: ChatService; roleService: RoleService;
}, me: MiUser): Promise<{ room: MiChatRoom; staff: number; added: number; removed: number }> {
	const team = await supportTeam(deps.users);
	if (team == null) throw new SupportDeskError('no_team');
	if (team.id === me.id) throw new SupportDeskError('is_team');
	let room = await deps.rooms.findOneBy({ ownerId: team.id, description: SUPPORT_PREFIX + me.id });
	if (room == null) room = await deps.chatService.createRoom(team, { name: ('Support · ' + (me.name || me.username)).slice(0, 256), description: SUPPORT_PREFIX + me.id });
	const staffIds = (await deps.roleService.getModeratorIds({ includeAdmins: true, excludeExpire: true })).filter(id => id !== team.id);
	const want = new Set([me.id, ...staffIds]);
	const have = (await deps.memberships.findBy({ roomId: room.id })).map(m => m.userId);
	let added = 0;
	for (const id of want) {
		if (have.includes(id)) continue;
		try {
			await deps.chatService.createRoomInvitation(team.id, room.id, id, { notify: false }).catch((e: any) => { if (!/already invited/.test(String(e && e.message))) throw e; });
			await deps.chatService.joinToRoom(id, room.id);
			added++;
		} catch { /* one refusal (a full room) must not stop the others */ }
	}
	const stale = have.filter(id => !want.has(id));
	if (stale.length) await deps.memberships.delete({ roomId: room.id, userId: In(stale) });
	return { room, staff: staffIds.length, added, removed: stale.length };
}

/** CSAT in a desk room: who may ask (staff, not the room's player), and the answer (only the room's player). */
export async function csatForRoom(deps: { db: DataSource; users: UsersRepository; messages: ChatMessagesRepository; roleService: RoleService }, me: MiUser, room: MiChatRoom,
	ps: { csatAsk?: boolean; csat?: { askId: string; score: number; comment?: string | null } }): Promise<Record<string, any>> {
	if (!(await isSupportRoom(deps.users, room))) throw new CsatError('not_support');
	const playerId = supportPlayerId(room);
	if (ps.csatAsk) {
		if (me.id === playerId || !(await deps.roleService.isModerator({ id: me.id }))) throw new CsatError('not_support');
		return csatAskAttachment();
	}
	const a = ps.csat!;
	if (me.id !== playerId) throw new CsatError('not_support');
	if (!Number.isInteger(a.score) || a.score < 1 || a.score > 5) throw new CsatError('bad_score');
	const ask = await deps.messages.findOneBy({ id: a.askId });
	if (ask == null || ask.toRoomId !== room.id || ask.fromUserId === me.id || !ask.attachment || ask.attachment.kind !== 'csat-ask' || ask.deletedAt) throw new CsatError('no_such_ask');
	if (ask.attachment.answered) throw new CsatError('answered');
	if (new Date(String(ask.attachment.expiresAt)).getTime() < Date.now()) throw new CsatError('expired');
	const comment = a.comment && a.comment.trim() ? a.comment.trim().slice(0, 500) : null;
	await deps.db.query(`UPDATE "chat_message" SET "attachment" = "attachment" || jsonb_build_object('answered', true, 'score', $2::int) WHERE id = $1`, [ask.id, a.score]);
	return { kind: 'csat', askId: ask.id, score: a.score, comment };
}

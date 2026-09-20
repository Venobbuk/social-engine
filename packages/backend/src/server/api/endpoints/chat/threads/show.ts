/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DI } from '@/di-symbols.js';
import { ChatService } from '@/core/ChatService.js';
import { ApiError } from '@/server/api/error.js';
import type { UsersRepository } from '@/models/_.js';
import type { DataSource } from 'typeorm';
import { runsRoom, roomManagement } from '@/core/ChatModeration.js';

/* CHAT-V2 — the GripBat-only half of a thread's settings sheet (Reclub chats/settings/[channelId]).
 *
 * NUKE-THREADS-SHOW-V1 (2026-09-20, G11 "adopt Misskey first"): this endpoint used to re-pack the room and its
 * members, which is exactly what the NATIVE `chat/rooms/show` (ChatRoom: owner, name, isMuted, readOnlyAt) and
 * `chat/rooms/members` (ChatRoomMembership[] with the UserLite) already answer. Those two are now what the client
 * calls, and `isOwner` / `canLeave` / `readOnly` are read off the packed room. What is left here is only what
 * Misskey has no concept of:
 *   chatMuted   — the account-wide "chat notifications off" toggle (notification_mute scope 'chat')
 *   muted       — this thread is muted. For a ROOM that is the NATIVE flag (chat_room_membership.isMuted, or the
 *                 owner's redis flag) read through ChatService.isRoomMuted — no store of ours. For a 1-on-1 it is
 *                 notification_mute scope 'user', because Misskey has no per-person chat mute.
 *   canModerate — CHAT-MOD-V1: I may delete anyone's message here (club owner/admin, meet host/co-host, comp host)
 *   managed     — the GripBat module that owns this room's membership (meet / club / competition), null = plain group
 *   archived    — INBOX-ARCHIVE-V1: I archived this thread (notification_mute scope 'archiveRoom' / 'archiveUser')
 */
export const meta = {
	tags: ['chat'],

	requireCredential: true,

	kind: 'read:chat',

	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			kind: { type: 'string', optional: false, nullable: false, enum: ['room', 'user'] },
			muted: { type: 'boolean', optional: false, nullable: false },
			chatMuted: { type: 'boolean', optional: false, nullable: false },
			canModerate: { type: 'boolean', optional: false, nullable: false },
			managed: { type: 'string', optional: false, nullable: true, enum: ['meet', 'club', 'competition'] },
			archived: { type: 'boolean', optional: false, nullable: false },
		},
	},

	errors: {
		noSuchThread: {
			message: 'No such thread.',
			code: 'NO_SUCH_THREAD',
			id: 'c2a1d5e0-5c1b-4f7e-9a3c-7e1b2c3d4e70',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		roomId: { type: 'string', format: 'misskey:id' },
		userId: { type: 'string', format: 'misskey:id' },
	},
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,
		@Inject(DI.db)
		private db: DataSource,

		private chatService: ChatService,
	) {
		super(meta, paramDef, async (ps, me) => {
			await this.chatService.checkChatAvailability(me.id, 'read');
			const mutes = await this.chatService.notificationMutesOf(me.id);
			const chatMuted = mutes.some(m => m.scope === 'chat');

			if (ps.roomId) {
				const room = await this.chatService.findRoomById(ps.roomId);
				if (room == null || !(await this.chatService.hasPermissionToViewRoomTimeline(me.id, room))) throw new ApiError(meta.errors.noSuchThread);
				return {
					kind: 'room',
					muted: await this.chatService.isRoomMuted(me.id, room.id),
					chatMuted,
					canModerate: await runsRoom(this.db, room.id, me.id),
					managed: await roomManagement(this.db, room.id),
					archived: mutes.some(m => m.scope === 'archiveRoom' && m.targetId === room.id),
				};
			}

			if (ps.userId) {
				const other = await this.usersRepository.findOneBy({ id: ps.userId });
				if (other == null) throw new ApiError(meta.errors.noSuchThread);
				return {
					kind: 'user',
					muted: mutes.some(m => m.scope === 'user' && m.targetId === other.id),
					chatMuted,
					canModerate: false,
					managed: null,
					archived: mutes.some(m => m.scope === 'archiveUser' && m.targetId === other.id),
				};
			}

			throw new ApiError(meta.errors.noSuchThread);
		});
	}
}

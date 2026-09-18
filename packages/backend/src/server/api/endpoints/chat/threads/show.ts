/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DI } from '@/di-symbols.js';
import { ChatService } from '@/core/ChatService.js';
import { ChatEntityService } from '@/core/entities/ChatEntityService.js';
import { UserEntityService } from '@/core/entities/UserEntityService.js';
import { ApiError } from '@/server/api/error.js';
import type { UsersRepository } from '@/models/_.js';

/* CHAT-V2 — one thread's settings sheet in one read (Reclub chats/settings/[channelId]): muted?, read-only?, the members
 * (a room: owner first, then the memberships), whether I own it and may leave it. `roomId` for a meet / club / group
 * thread, `userId` for a 1-on-1. */
export const meta = {
	tags: ['chat'],

	requireCredential: true,

	kind: 'read:chat',

	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			kind: { type: 'string', optional: false, nullable: false },
			muted: { type: 'boolean', optional: false, nullable: false },
			chatMuted: { type: 'boolean', optional: false, nullable: false },
			readOnlyAt: { type: 'string', optional: false, nullable: true },
			readOnly: { type: 'boolean', optional: false, nullable: false },
			isOwner: { type: 'boolean', optional: false, nullable: false },
			canLeave: { type: 'boolean', optional: false, nullable: false },
			room: { type: 'object', optional: false, nullable: true, ref: 'ChatRoom' },
			members: { type: 'array', optional: false, nullable: false, items: { type: 'object', optional: false, nullable: false, ref: 'UserLite' } },
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

		private chatService: ChatService,
		private chatEntityService: ChatEntityService,
		private userEntityService: UserEntityService,
	) {
		super(meta, paramDef, async (ps, me) => {
			await this.chatService.checkChatAvailability(me.id, 'read');
			const mutes = await this.chatService.notificationMutesOf(me.id);
			const chatMuted = mutes.some(m => m.scope === 'chat');

			if (ps.roomId) {
				const room = await this.chatService.findRoomById(ps.roomId);
				if (room == null || !(await this.chatService.hasPermissionToViewRoomTimeline(me.id, room))) throw new ApiError(meta.errors.noSuchThread);
				const memberships = await this.chatService.getRoomMembershipsWithPagination(room.id, 100);
				const ids = [room.ownerId, ...memberships.map(m => m.userId).filter(id => id !== room.ownerId)];
				const members = await this.userEntityService.packMany(ids, me);
				const packedRoom = await this.chatEntityService.packRoom(room, me);
				return {
					kind: 'room',
					// muted by this stream's switch OR by Misskey's membership mute (the meet kebab's meets/chat-mute)
					muted: mutes.some(m => m.scope === 'room' && m.targetId === room.id) || packedRoom.isMuted === true,
					chatMuted,
					readOnlyAt: room.readOnlyAt ? room.readOnlyAt.toISOString() : null,
					readOnly: room.readOnlyAt != null && room.readOnlyAt.getTime() <= Date.now(),
					isOwner: room.ownerId === me.id,
					canLeave: room.ownerId !== me.id,
					room: packedRoom,
					members,
				};
			}

			if (ps.userId) {
				const other = await this.usersRepository.findOneBy({ id: ps.userId });
				if (other == null) throw new ApiError(meta.errors.noSuchThread);
				return {
					kind: 'user',
					muted: mutes.some(m => m.scope === 'user' && m.targetId === other.id),
					chatMuted,
					readOnlyAt: null,
					readOnly: false,
					isOwner: false,
					canLeave: false,
					room: null,
					members: await this.userEntityService.packMany([me.id, other.id], me),
				};
			}

			throw new ApiError(meta.errors.noSuchThread);
		});
	}
}

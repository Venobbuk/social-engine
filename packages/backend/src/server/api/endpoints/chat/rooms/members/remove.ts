/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DI } from '@/di-symbols.js';
import { ApiError } from '@/server/api/error.js';
import { ChatService } from '@/core/ChatService.js';
import { roomManagement } from '@/core/ChatModeration.js';

/* CHAT-MEMBERS-V1 (2026-09-20) — Reclub chat settings › member sheet › "Remove member", for a GROUP chat: its owner takes
 * a member out (their membership row goes, the room stops showing in their inbox, they can no longer read or write it).
 * A meet's / club's / competition's chat is MANAGED — its membership follows the meet roster / the club / the entries,
 * so it is refused here (MANAGED_ROOM): remove the person from the meet or the club instead, which is what takes them out
 * of its chat. The owner cannot remove themselves (they delete the room). */
export const meta = {
	tags: ['chat'],
	requireCredential: true,
	kind: 'write:chat',
	errors: {
		noSuchRoom: {
			message: 'No such room.',
			code: 'NO_SUCH_ROOM',
			id: 'c2a1d5e0-5c1b-4f7e-9a3c-7e1b2c3d4e91',
		},
		notOwner: {
			message: 'Only the owner of this chat can remove members.',
			code: 'NOT_OWNER',
			id: 'c2a1d5e0-5c1b-4f7e-9a3c-7e1b2c3d4e92',
			httpStatusCode: 403,
		},
		managedRoom: {
			message: 'This chat follows a meet, club or competition: remove the person there.',
			code: 'MANAGED_ROOM',
			id: 'c2a1d5e0-5c1b-4f7e-9a3c-7e1b2c3d4e93',
		},
		noSuchMember: {
			message: 'This person is not a member of the chat.',
			code: 'NO_SUCH_MEMBER',
			id: 'c2a1d5e0-5c1b-4f7e-9a3c-7e1b2c3d4e94',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		roomId: { type: 'string', format: 'misskey:id' },
		userId: { type: 'string', format: 'misskey:id' },
	},
	required: ['roomId', 'userId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.db)
		private db: DataSource,
		private chatService: ChatService,
	) {
		super(meta, paramDef, async (ps, me) => {
			await this.chatService.checkChatAvailability(me.id, 'write');
			const room = await this.chatService.findRoomById(ps.roomId);
			if (room == null || !(await this.chatService.hasPermissionToViewRoomTimeline(me.id, room))) throw new ApiError(meta.errors.noSuchRoom);
			if (room.ownerId !== me.id) throw new ApiError(meta.errors.notOwner);
			if ((await roomManagement(this.db, room.id)) != null) throw new ApiError(meta.errors.managedRoom);
			if (ps.userId === room.ownerId || !(await this.chatService.isRoomMember(room, ps.userId))) throw new ApiError(meta.errors.noSuchMember);
			await this.chatService.leaveRoom(ps.userId, room.id);
		});
	}
}

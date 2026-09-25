/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import ms from 'ms';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DI } from '@/di-symbols.js';
import { ApiError } from '@/server/api/error.js';
import { ChatService } from '@/core/ChatService.js';
import { RoleService } from '@/core/RoleService.js';
import type { ChatRoomMembershipsRepository, ChatRoomsRepository, UsersRepository } from '@/models/_.js';
import { openSupportDesk, SupportDeskError } from '@/core/ChatSupportDesk.js';

/* SUPPORT-DESK-V1 (lane BENCH-A, E-chat-room.14) — POST chat/support/open: the caller's support desk room (found or made), its
 * staff side re-synced to the current STAFF role holders. The app opens it as a room (chat/index?room=). core/ChatSupportDesk. */
export const meta = {
	tags: ['chat'],
	requireCredential: true,
	kind: 'write:chat',
	limit: { duration: ms('1hour'), max: 120 },
	res: {
		type: 'object', optional: false, nullable: false,
		properties: {
			roomId: { type: 'string', optional: false, nullable: false },
			name: { type: 'string', optional: false, nullable: false },
			staff: { type: 'number', optional: false, nullable: false },
		},
	},
	errors: {
		noDesk: { message: 'The support desk is not set up on this server.', code: 'NO_SUPPORT_DESK', id: 'b8d2f0a4-3c5e-4d6f-9a1b-5e0c00000d01' },
		isTeam: { message: 'The GripBat Team account has no support desk of its own.', code: 'SUPPORT_IS_TEAM', id: 'b8d2f0a4-3c5e-4d6f-9a1b-5e0c00000d02' },
	},
} as const;

export const paramDef = { type: 'object', properties: {} } as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.usersRepository) private usersRepository: UsersRepository,
		@Inject(DI.chatRoomsRepository) private chatRoomsRepository: ChatRoomsRepository,
		@Inject(DI.chatRoomMembershipsRepository) private chatRoomMembershipsRepository: ChatRoomMembershipsRepository,
		private chatService: ChatService,
		private roleService: RoleService,
	) {
		super(meta, paramDef, async (ps, me) => {
			await this.chatService.checkChatAvailability(me.id, 'write');
			try {
				const r = await openSupportDesk({ users: this.usersRepository, rooms: this.chatRoomsRepository, memberships: this.chatRoomMembershipsRepository, chatService: this.chatService, roleService: this.roleService }, me);
				return { roomId: r.room.id, name: r.room.name, staff: r.staff };
			} catch (e) {
				if (e instanceof SupportDeskError) throw new ApiError(e.code === 'is_team' ? meta.errors.isTeam : meta.errors.noDesk);
				throw e;
			}
		});
	}
}

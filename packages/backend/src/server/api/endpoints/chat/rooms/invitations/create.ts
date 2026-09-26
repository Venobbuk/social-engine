/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import ms from 'ms';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DI } from '@/di-symbols.js';
import { ApiError } from '@/server/api/error.js';
import { ChatService } from '@/core/ChatService.js';
import { ChatEntityService } from '@/core/entities/ChatEntityService.js';
import { UserBlockingService } from '@/core/UserBlockingService.js';

export const meta = {
	tags: ['chat'],

	requireCredential: true,

	prohibitMoved: true,

	kind: 'write:chat',

	limit: {
		duration: ms('1day'),
		max: 50,
	},

	res: {
		type: 'object',
		optional: false, nullable: false,
		ref: 'ChatRoomInvitation',
	},

	errors: {
		noSuchRoom: {
			message: 'No such room.',
			code: 'NO_SUCH_ROOM',
			id: '916f9507-49ba-4e90-b57f-1fd4deaa47a5',
		},

		// INT-BATCH1 (GripBat): a group chat is made with this native door, one invitation per player — never across a block
		blocked: {
			message: 'You cannot invite this user.',
			code: 'BLOCKED',
			id: 'c2a1d5e0-5c1b-4f7e-9a3c-7e1b2c3d4e98',
		},

		// L6-CLUB REINVITE-400-V1 (2026-09-26): ChatService.createRoomInvitation throws a bare Error('already invited') when an
		// invitation row exists — pending, or IGNORED by the invitee (native Misskey keeps the ignored row so the owner cannot
		// spam them, and does not tell the owner). It reached the owner as a 500 INTERNAL_ERROR, whose English "Internal error
		// occurred" sentence the app printed as the toast in every language. Now a 400 the app can word; pending and ignored stay
		// indistinguishable (the owner is still not told that they were ignored).
		alreadyInvited: {
			message: 'This player has already been invited.',
			code: 'ALREADY_INVITED',
			id: '6f3b8f5e-2c1d-4d9a-8e7b-1c6c1ab0e1a1',
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
		private chatService: ChatService,
		private chatEntityService: ChatEntityService,
		private userBlockingService: UserBlockingService,
	) {
		super(meta, paramDef, async (ps, me) => {
			await this.chatService.checkChatAvailability(me.id, 'write');

			const room = await this.chatService.findMyRoomById(me.id, ps.roomId);
			if (room == null) {
				throw new ApiError(meta.errors.noSuchRoom);
			}
			if (await this.userBlockingService.checkBlocked(ps.userId, me.id) || await this.userBlockingService.checkBlocked(me.id, ps.userId)) {
				throw new ApiError(meta.errors.blocked);
			}
			let invitation;
			try {
				invitation = await this.chatService.createRoomInvitation(me.id, room.id, ps.userId);
			} catch (e) {
				if (e instanceof Error && e.message === 'already invited') throw new ApiError(meta.errors.alreadyInvited);   // REINVITE-400-V1
				throw e;
			}
			return await this.chatEntityService.packRoomInvitation(invitation, me);
		});
	}
}

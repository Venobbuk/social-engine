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

/* CHAT-V2 — "Turn off chat notifications" for a 1-on-1 thread (Reclub ChannelUserNotifications None / All). The
 * thread keeps its unread marker; the other side's messages raise no newChatMessage event and no push while muted.
 * NUKE-CHAT-MUTE-V1 (G11): a ROOM is muted with the NATIVE chat/rooms/mute, so this door no longer takes a roomId.
 * Misskey has no per-person chat mute, so only the 1-on-1 half stays ours (notification_mute scope 'user'). */
export const meta = {
	tags: ['chat'],

	requireCredential: true,

	kind: 'write:chat',

	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			muted: { type: 'boolean', optional: false, nullable: false },
		},
	},

	errors: {
		noSuchThread: {
			message: 'No such thread.',
			code: 'NO_SUCH_THREAD',
			id: 'c2a1d5e0-5c1b-4f7e-9a3c-7e1b2c3d4e71',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		userId: { type: 'string', format: 'misskey:id' },
		mute: { type: 'boolean' },
	},
	required: ['userId', 'mute'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,

		private chatService: ChatService,
	) {
		super(meta, paramDef, async (ps, me) => {
			await this.chatService.checkChatAvailability(me.id, 'read');

			if (ps.userId) {
				const other = await this.usersRepository.findOneBy({ id: ps.userId });
				if (other == null || other.id === me.id) throw new ApiError(meta.errors.noSuchThread);
				await this.chatService.setNotificationMute(me.id, 'user', other.id, ps.mute);
				return { muted: ps.mute };
			}
			throw new ApiError(meta.errors.noSuchThread);
		});
	}
}

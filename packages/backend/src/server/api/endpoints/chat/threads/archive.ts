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

/* INBOX-ARCHIVE-V1 (2026-09-20) — Reclub's inbox "Archive" / "Unarchive" (PUT /channels/{id}/users/{me}/archival): one
 * thread moves to MY Archived tile and out of the other tiles. Only for me; the thread, its messages, its unread marker
 * and its notifications are untouched (mute is a separate switch). A new message does not unarchive it — Reclub
 * behaves the same; the Archived tile still shows the unread dot. Stored as a per-account flag row
 * (notification_mute scope archiveRoom / archiveUser, see models/NotificationMute). */
export const meta = {
	tags: ['chat'],
	requireCredential: true,
	kind: 'write:chat',
	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			archived: { type: 'boolean', optional: false, nullable: false },
		},
	},
	errors: {
		noSuchThread: {
			message: 'No such thread.',
			code: 'NO_SUCH_THREAD',
			id: 'c2a1d5e0-5c1b-4f7e-9a3c-7e1b2c3d4e95',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		roomId: { type: 'string', format: 'misskey:id' },
		userId: { type: 'string', format: 'misskey:id' },
		archive: { type: 'boolean' },
	},
	required: ['archive'],
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
			if (ps.roomId) {
				const room = await this.chatService.findRoomById(ps.roomId);
				if (room == null || !(await this.chatService.isRoomMember(room, me.id))) throw new ApiError(meta.errors.noSuchThread);
				await this.chatService.setNotificationMute(me.id, 'archiveRoom', room.id, ps.archive);
				return { archived: ps.archive };
			}
			if (ps.userId) {
				const other = await this.usersRepository.findOneBy({ id: ps.userId });
				if (other == null || other.id === me.id) throw new ApiError(meta.errors.noSuchThread);
				await this.chatService.setNotificationMute(me.id, 'archiveUser', other.id, ps.archive);
				return { archived: ps.archive };
			}
			throw new ApiError(meta.errors.noSuchThread);
		});
	}
}

/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import type { ChatMessagesRepository } from '@/models/_.js';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DI } from '@/di-symbols.js';
import { ChatService } from '@/core/ChatService.js';
import { ApiError } from '@/server/api/error.js';

// CHAT-MODERATE-V1 (W1, T1 E-chat-msg-menu.04): the author deletes their own message (as before); the people who RUN a room
// delete anyone's message in it — the room owner, the club's owner and admins in the club chat, the meet host and co-hosts
// in the meet chat, the competition host in its chat. Before, only the author could (findMyMessageById), so an admin's
// only tool against an abusive message was switching the whole chat off. Anyone else still gets NO_SUCH_MESSAGE.
export const meta = {
	tags: ['chat'],

	requireCredential: true,

	kind: 'write:chat',

	errors: {
		noSuchMessage: {
			message: 'No such message.',
			code: 'NO_SUCH_MESSAGE',
			id: '36b67f0e-66a6-414b-83df-992a55294f17',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		messageId: { type: 'string', format: 'misskey:id' },
	},
	required: ['messageId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.db)
		private db: DataSource,

		@Inject(DI.chatMessagesRepository)
		private chatMessagesRepository: ChatMessagesRepository,

		private chatService: ChatService,
	) {
		super(meta, paramDef, async (ps, me) => {
			await this.chatService.checkChatAvailability(me.id, 'write');

			const message = await this.chatMessagesRepository.findOneBy({ id: ps.messageId });
			if (message == null) {
				throw new ApiError(meta.errors.noSuchMessage);
			}
			if (message.fromUserId !== me.id && !(message.toRoomId && await this.runsRoom(message.toRoomId, me.id))) {
				throw new ApiError(meta.errors.noSuchMessage);
			}
			await this.chatService.deleteMessage(message);
		});
	}

	/** CHAT-MODERATE-V1: does this user run the room (owner / club owner or admin / meet host or co-host / competition host)? */
	private async runsRoom(roomId: string, userId: string): Promise<boolean> {
		const rows = await this.db.query(`SELECT 1 FROM "chat_room" r WHERE r."id" = $1 AND r."ownerId" = $2
			UNION ALL SELECT 1 FROM "club_setting" s JOIN "channel" c ON c."id" = s."channelId" WHERE s."chatRoomId" = $1 AND (c."userId" = $2 OR $2 = ANY(s."adminIds"))
			UNION ALL SELECT 1 FROM "meet" m WHERE m."chatRoomId" = $1 AND (m."hostId" = $2 OR EXISTS (SELECT 1 FROM "meet_participant" p WHERE p."meetId" = m."id" AND p."userId" = $2 AND p."isHost"))
			UNION ALL SELECT 1 FROM "competition" k WHERE k."chatRoomId" = $1 AND k."hostId" = $2
			LIMIT 1`, [roomId, userId]) as unknown[];
		return rows.length > 0;
	}
}

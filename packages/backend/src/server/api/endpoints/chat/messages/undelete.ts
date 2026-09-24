/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { ChatMessagesRepository } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import { ChatService } from '@/core/ChatService.js';
import { ApiError } from '@/server/api/error.js';

// CHAT-SOFTDELETE-V1 (KUDOS-CHAT-V1, E-chat-msg-menu.05) — Reclub's message menu "Undelete" (undeleteMessage). EXTENDS
// the native chat/messages/delete, which now keeps the row (ChatService.deleteMessage): only the person who deleted it
// may bring it back — the author who unsent it, or the moderator who removed it. Anyone else: NO_SUCH_MESSAGE.
export const meta = {
	tags: ['chat'],
	requireCredential: true,
	kind: 'write:chat',
	errors: {
		noSuchMessage: { message: 'No such message.', code: 'NO_SUCH_MESSAGE', id: 'e8a1f0c2-51b7-4f2e-9d1c-0000000000d1' },
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
		@Inject(DI.chatMessagesRepository)
		private chatMessagesRepository: ChatMessagesRepository,
		private chatService: ChatService,
	) {
		super(meta, paramDef, async (ps, me) => {
			await this.chatService.checkChatAvailability(me.id, 'write');
			const message = await this.chatMessagesRepository.findOneBy({ id: ps.messageId });
			if (message == null || message.deletedAt == null || message.deletedById !== me.id) throw new ApiError(meta.errors.noSuchMessage);
			await this.chatService.undeleteMessage(message);
		});
	}
}

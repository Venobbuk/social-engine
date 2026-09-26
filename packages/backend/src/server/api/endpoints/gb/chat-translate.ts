/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import * as Redis from 'ioredis';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DI } from '@/di-symbols.js';
import { HttpRequestService } from '@/core/HttpRequestService.js';
import { ChatService } from '@/core/ChatService.js';
import type { ChatMessagesRepository, ChatRoomsRepository } from '@/models/_.js';
import { ApiError } from '@/server/api/error.js';
import { NOT_CONFIGURED, UPSTREAM_FAILED, TARGETS, translateMode, translateText, mockTranslation } from '@/core/GbChatExtras.js';

// CHAT-EXTRAS-V1 (Reclub E-chat-room.09 Translate message / Show original) — gb/chat/translate {messageId, target}:
// Gemini (GEMINI-TRANSLATE-V1, via the SG tunnel; OpenRouter / DeepSeek as fallbacks — core/GbChatExtras.ts translateText) with a translate-only system prompt (source detected, output = the translation only), into
// the reader's language (EN / ZH-HANT / ZH-HANS). Only the viewer's copy is translated — nothing is stored on the message.
// Access is the chat's own rule, stricter than the older chat/messages/translate: a party of the 1-on-1 or a MEMBER of
// the room (ChatService.isRoomMember, REUSED). Cached per message + target (30 days); limited per user. 503
// NOT_CONFIGURED without a key.
export const meta = {
	tags: ['chat'],
	requireCredential: true,
	kind: 'read:chat',
	limit: { duration: 60 * 1000, max: 20 },
	res: { type: 'object', optional: false, nullable: false, properties: {
		text: { type: 'string', optional: false, nullable: false },
		target: { type: 'string', optional: false, nullable: false },
		cached: { type: 'boolean', optional: false, nullable: false },
		// which provider answered: gemini | openrouter | deepseek, 'mock' (UAT mock) or 'cache' (served from the 30-day cache)
		provider: { type: 'string', optional: false, nullable: false },
	} },
	errors: {
		notConfigured: NOT_CONFIGURED,
		upstream: UPSTREAM_FAILED,
		noSuchMessage: { message: 'No such message.', code: 'NO_SUCH_MESSAGE', id: 'c7e1a0b2-5d3f-4e8a-9b1c-2f6d0a4e8c05', httpStatusCode: 404 },
		nothing: { message: 'Nothing to translate.', code: 'NOTHING_TO_TRANSLATE', id: 'c7e1a0b2-5d3f-4e8a-9b1c-2f6d0a4e8c06' },
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		messageId: { type: 'string', format: 'misskey:id' },
		target: { type: 'string', enum: TARGETS },
	},
	required: ['messageId', 'target'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.redis) private redisClient: Redis.Redis,
		@Inject(DI.chatMessagesRepository) private chatMessagesRepository: ChatMessagesRepository,
		@Inject(DI.chatRoomsRepository) private chatRoomsRepository: ChatRoomsRepository,
		private chatService: ChatService,
		private httpRequestService: HttpRequestService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const mode = translateMode();
			if (mode === 'off') throw new ApiError(meta.errors.notConfigured);
			const message = await this.chatMessagesRepository.findOneBy({ id: ps.messageId });
			if (message == null || message.deletedAt != null) throw new ApiError(meta.errors.noSuchMessage);
			if (message.toRoomId) {
				const room = await this.chatRoomsRepository.findOneBy({ id: message.toRoomId });
				if (room == null || !(await this.chatService.isRoomMember(room, me.id))) throw new ApiError(meta.errors.noSuchMessage);
			} else if (message.fromUserId !== me.id && message.toUserId !== me.id) {
				throw new ApiError(meta.errors.noSuchMessage);
			}
			const text = (message.text ?? '').slice(0, 4000);
			if (text.trim() === '') throw new ApiError(meta.errors.nothing);
			const target = ps.target;
			if (mode === 'mock') return { text: mockTranslation(text, target), target, cached: false, provider: 'mock' };
			const key = `gb:tr:v1:${message.id}:${target}`;
			const hit = await this.redisClient.get(key);
			if (hit != null) return { text: hit, target, cached: true, provider: 'cache' };
			let out: string; let provider: string;
			try {
				({ text: out, provider } = await translateText(this.httpRequestService, text, target));
			} catch {
				throw new ApiError(meta.errors.upstream);
			}
			await this.redisClient.set(key, out, 'EX', 30 * 86400);
			return { text: out, target, cached: false, provider };
		});
	}
}

/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { URLSearchParams } from 'node:url';
import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { HttpRequestService } from '@/core/HttpRequestService.js';
import { RoleService } from '@/core/RoleService.js';
import { ChatService } from '@/core/ChatService.js';
import type { ChatMessagesRepository, ChatRoomsRepository, MiMeta } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import { ApiError } from '@/server/api/error.js';

// KUDOS-CHAT-V1 (E-chat-room.09) — Reclub's message menu "Translate message" / "Show original". EXTENDS the native
// notes/translate (endpoints/notes/translate.ts): the same translator the instance is configured with (meta
// deeplAuthKey / deeplIsPro — DeepL), the same role policy (canUseTranslator), the same UNAVAILABLE answer when no
// translator is set, so the app shows the item only when meta `translatorAvailable` is true. Reads a CHAT message
// instead of a note: only a party of the 1-on-1 or a member of the room may have it translated; a deleted message
// has no text to translate.
export const meta = {
	tags: ['chat'],
	requireCredential: true,
	kind: 'read:chat',
	res: {
		type: 'object',
		optional: true, nullable: false,
		properties: {
			sourceLang: { type: 'string' },
			text: { type: 'string' },
		},
	},
	errors: {
		unavailable: { message: 'Translate of messages unavailable.', code: 'UNAVAILABLE', id: 'f3b2c1d0-6e5a-4c9b-8a7f-0000000000e1' },
		noSuchMessage: { message: 'No such message.', code: 'NO_SUCH_MESSAGE', id: 'f3b2c1d0-6e5a-4c9b-8a7f-0000000000e2' },
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		messageId: { type: 'string', format: 'misskey:id' },
		targetLang: { type: 'string', minLength: 2, maxLength: 16 },
	},
	required: ['messageId', 'targetLang'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.meta)
		private serverSettings: MiMeta,
		@Inject(DI.chatMessagesRepository)
		private chatMessagesRepository: ChatMessagesRepository,
		@Inject(DI.chatRoomsRepository)
		private chatRoomsRepository: ChatRoomsRepository,
		private chatService: ChatService,
		private httpRequestService: HttpRequestService,
		private roleService: RoleService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const policies = await this.roleService.getUserPolicies(me.id);
			if (!policies.canUseTranslator) throw new ApiError(meta.errors.unavailable);

			const message = await this.chatMessagesRepository.findOneBy({ id: ps.messageId });
			if (message == null || message.deletedAt != null) throw new ApiError(meta.errors.noSuchMessage);
			if (message.toRoomId) {
				const room = await this.chatRoomsRepository.findOneBy({ id: message.toRoomId });
				if (room == null || !(await this.chatService.hasPermissionToViewRoomTimeline(me.id, room))) throw new ApiError(meta.errors.noSuchMessage);
			} else if (message.fromUserId !== me.id && message.toUserId !== me.id) {
				throw new ApiError(meta.errors.noSuchMessage);
			}

			const text = message.text ?? '';
			if (text.trim() === '') return;
			if (this.serverSettings.deeplAuthKey == null) throw new ApiError(meta.errors.unavailable);

			let targetLang = ps.targetLang;
			if (targetLang.includes('-')) targetLang = targetLang.split('-')[0];
			const params = new URLSearchParams();
			params.append('text', text);
			params.append('target_lang', targetLang);
			const endpoint = this.serverSettings.deeplIsPro ? 'https://api.deepl.com/v2/translate' : 'https://api-free.deepl.com/v2/translate';
			const res = await this.httpRequestService.send(endpoint, {
				method: 'POST',
				headers: {
					'Authorization': `DeepL-Auth-Key ${this.serverSettings.deeplAuthKey}`,
					'Content-Type': 'application/x-www-form-urlencoded',
					Accept: 'application/json, */*',
				},
				body: params.toString(),
			});
			const json = (await res.json()) as { translations: { detected_source_language: string; text: string }[] };
			return { sourceLang: json.translations[0].detected_source_language, text: json.translations[0].text };
		});
	}
}

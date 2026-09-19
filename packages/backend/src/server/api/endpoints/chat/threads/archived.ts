/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ChatService } from '@/core/ChatService.js';

/* INBOX-ARCHIVE-V1 — the threads I archived (chat/threads/archive), in one read for the inbox's Archived tile. */
export const meta = {
	tags: ['chat'],
	requireCredential: true,
	kind: 'read:chat',
	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			roomIds: { type: 'array', optional: false, nullable: false, items: { type: 'string', optional: false, nullable: false } },
			userIds: { type: 'array', optional: false, nullable: false, items: { type: 'string', optional: false, nullable: false } },
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {},
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private chatService: ChatService,
	) {
		super(meta, paramDef, async (ps, me) => {
			await this.chatService.checkChatAvailability(me.id, 'read');
			const rows = await this.chatService.notificationMutesOf(me.id);
			return {
				roomIds: rows.filter(r => r.scope === 'archiveRoom').map(r => r.targetId),
				userIds: rows.filter(r => r.scope === 'archiveUser').map(r => r.targetId),
			};
		});
	}
}

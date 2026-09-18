/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ChatService } from '@/core/ChatService.js';

/* CHAT-V2 — flip one app-level notification toggle (club / chat / promoted / updates). `on: false` writes a mute row.
 * `chat: false` silences every chat push (per-thread mutes stay as they are for when it is turned back on). */
export const meta = {
	tags: ['chat'],

	requireCredential: true,

	kind: 'write:chat',

	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			key: { type: 'string', optional: false, nullable: false },
			on: { type: 'boolean', optional: false, nullable: false },
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		key: { type: 'string', enum: ['club', 'chat', 'promoted', 'updates'] },
		on: { type: 'boolean' },
	},
	required: ['key', 'on'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private chatService: ChatService,
	) {
		super(meta, paramDef, async (ps, me) => {
			await this.chatService.setNotificationMute(me.id, ps.key, '', !ps.on);
			return { key: ps.key, on: ps.on };
		});
	}
}

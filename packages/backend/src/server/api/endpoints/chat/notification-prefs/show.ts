/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ChatService } from '@/core/ChatService.js';

/* CHAT-V2 — the settings page's notification toggles that are not Misskey notification types (Reclub settings/notifications:
 * club, chat, promoted meets, latest updates) plus the per-thread mutes, in one read. `true` = notifications ON. */
export const meta = {
	tags: ['chat'],

	requireCredential: true,

	kind: 'read:chat',

	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			club: { type: 'boolean', optional: false, nullable: false },
			chat: { type: 'boolean', optional: false, nullable: false },
			promoted: { type: 'boolean', optional: false, nullable: false },
			updates: { type: 'boolean', optional: false, nullable: false },
			meets: { type: 'boolean', optional: false, nullable: false },   // ACCOUNT-BUGS-V1: Settings › Meet updates
			social: { type: 'boolean', optional: false, nullable: false },   // SOCIAL-NOTIF-V1: kudos, feedback, awards
			promotedClub: { type: 'boolean', optional: false, nullable: false },   // SOCIAL-NOTIF-V1: promoted CLUB meets
			mutedRoomIds: { type: 'array', optional: false, nullable: false, items: { type: 'string', optional: false, nullable: false } },
			mutedUserIds: { type: 'array', optional: false, nullable: false, items: { type: 'string', optional: false, nullable: false } },
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
			const mutes = await this.chatService.notificationMutesOf(me.id);
			const off = (scope: string) => mutes.some(m => m.scope === scope);
			return {
				club: !off('club'),
				chat: !off('chat'),
				promoted: !off('promoted'),
				updates: !off('updates'),
				meets: !off('meets'),   // ACCOUNT-BUGS-V1
				social: !off('social'),   // SOCIAL-NOTIF-V1
				promotedClub: !off('promotedClub'),   // SOCIAL-NOTIF-V1
				mutedRoomIds: mutes.filter(m => m.scope === 'room').map(m => m.targetId),
				mutedUserIds: mutes.filter(m => m.scope === 'user').map(m => m.targetId),
			};
		});
	}
}

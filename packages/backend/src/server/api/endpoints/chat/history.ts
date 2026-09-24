/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DI } from '@/di-symbols.js';
import { ChatService } from '@/core/ChatService.js';
import { ChatEntityService } from '@/core/entities/ChatEntityService.js';
import { ApiError } from '@/server/api/error.js';
import type { DataSource } from 'typeorm';

export const meta = {
	tags: ['chat'],

	requireCredential: true,

	kind: 'read:chat',

	res: {
		type: 'array',
		optional: false, nullable: false,
		items: {
			type: 'object',
			optional: false, nullable: false,
			ref: 'ChatMessage',
		},
	},

	errors: {
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		limit: { type: 'integer', minimum: 1, maximum: 100, default: 10 },
		room: { type: 'boolean', default: false },
	},
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.db) private db: DataSource,
		private chatEntityService: ChatEntityService,
		private chatService: ChatService,
	) {
		super(meta, paramDef, async (ps, me) => {
			await this.chatService.checkChatAvailability(me.id, 'read');

			const history = ps.room ? await this.chatService.roomHistory(me.id, ps.limit) : await this.chatService.userHistory(me.id, ps.limit);

			const packedMessages = await this.chatEntityService.packMessagesDetailed(history, me);

			if (ps.room) {
				const roomIds = history.map(m => m.toRoomId!);
				const readStateMap = await this.chatService.getRoomReadStateMap(me.id, roomIds);

				for (const message of packedMessages) {
					message.isRead = readStateMap[message.toRoomId!] ?? false;
				}
				// INBOX-KIND-V1 (lane fix-S8, E-inbox.08): the GripBat module that owns each room — one query for the page — so the
				// inbox files a meet / competition chat under Activity, a club's under Clubs and a hand-made group under Direct
				// (it filed every room under Clubs). EXTENDS native chat/history; the rule is ChatModeration.roomManagement's.
				const ids = [...new Set(roomIds.filter(Boolean))];
				if (ids.length) {
					const rows = await this.db.query(`SELECT "chatRoomId" AS "roomId", 'club' AS kind, "channelId" AS id FROM "club_setting" WHERE "chatRoomId" = ANY($1)
						UNION ALL SELECT "chatRoomId", 'meet', id FROM "meet" WHERE "chatRoomId" = ANY($1)
						UNION ALL SELECT "chatRoomId", 'competition', id FROM "competition" WHERE "chatRoomId" = ANY($1)`, [ids]) as { roomId: string; kind: string; id: string }[];
					const by = new Map(rows.map(r => [r.roomId, r]));
					for (const message of packedMessages) {
						const k = by.get(message.toRoomId!);
						message.roomManaged = k ? k.kind : null;
						message.roomManagedId = k ? k.id : null;
					}
				}
			} else {
				const otherIds = history.map(m => m.fromUserId === me.id ? m.toUserId! : m.fromUserId!);
				const readStateMap = await this.chatService.getUserReadStateMap(me.id, otherIds);

				for (const message of packedMessages) {
					const otherId = message.fromUserId === me.id ? message.toUserId! : message.fromUserId!;
					message.isRead = readStateMap[otherId] ?? false;
				}
			}

			return packedMessages;
		});
	}
}

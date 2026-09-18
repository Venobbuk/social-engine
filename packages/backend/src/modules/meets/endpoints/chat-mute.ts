/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { MeetsRepository, MeetParticipantsRepository } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import { ChatService } from '@/core/ChatService.js';
import { ApiError } from '@/server/api/error.js';
import { meetErrors, toApiError } from './_shared.js';

// HOST-TOOLS-V1 — Reclub Details kebab "Turn off chat notifications" (walk §10), per meet. The flag lives on my
// participant row (chatMuted) and is pushed into the chat module's per-room mute (chat_room_membership.isMuted —
// ChatService skips muted members when a room message fans out to push / newChatMessage). The meet's host is the
// room OWNER and has no membership row, so ChatService.muteRoom keeps the owner's mute in redis and honours it there.
export const meta = {
	tags: ['meets'],
	requireCredential: true,
	prohibitMoved: true,
	kind: 'write:meets',
	res: {
		type: 'object', optional: false, nullable: false,
		properties: { chatMuted: { type: 'boolean', optional: false, nullable: false } },
	},
	errors: { ...meetErrors },
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		meetId: { type: 'string', format: 'misskey:id' },
		mute: { type: 'boolean' },
	},
	required: ['meetId', 'mute'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.meetsRepository)
		private meetsRepository: MeetsRepository,
		@Inject(DI.meetParticipantsRepository)
		private meetParticipantsRepository: MeetParticipantsRepository,
		private chatService: ChatService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const meet = await this.meetsRepository.findOneBy({ id: ps.meetId });
			if (meet == null) throw new ApiError(meta.errors.noSuchMeet);
			const mine = await this.meetParticipantsRepository.findOneBy({ meetId: meet.id, userId: me.id });
			if (mine == null) throw new ApiError(meta.errors.notParticipant);
			try {
				await this.meetParticipantsRepository.update(mine.id, { chatMuted: ps.mute });
				if (meet.chatRoomId) {
					try { await this.chatService.muteRoom(me.id, meet.chatRoomId, ps.mute); } catch { /* not in the room yet (not confirmed): the row flag is applied when they join */ }
				}
				return { chatMuted: ps.mute };
			} catch (e) {
				return toApiError(e);
			}
		});
	}
}

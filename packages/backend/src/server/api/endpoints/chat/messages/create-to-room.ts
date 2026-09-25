/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import ms from 'ms';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { GetterService } from '@/server/api/GetterService.js';
import { DI } from '@/di-symbols.js';
import { ApiError } from '@/server/api/error.js';
import { ChatService } from '@/core/ChatService.js';
import type { ChatMessagesRepository, DriveFilesRepository, MeetsRepository, MiUser, UsersRepository } from '@/models/_.js';
import { RoleService } from '@/core/RoleService.js';   // SUPPORT-DESK-V1
import { csatForRoom } from '@/core/ChatSupportDesk.js';   // SUPPORT-DESK-V1
import { CsatError } from '@/core/ChatCsat.js';   // SUPPORT-DESK-V1
import { replyAttachment } from '@/core/ChatReply.js';
import type { DataSource } from 'typeorm';
import { ClubService } from '@/modules/clubs/ClubService.js';
import { clubOfRoom, outsideLinkRefusal, outsideLinksError } from '@/modules/clubs/club-post-rules.js';

export const meta = {
	tags: ['chat'],

	requireCredential: true,

	prohibitMoved: true,

	kind: 'write:chat',

	limit: {
		duration: ms('1hour'),
		max: 500,
	},

	res: {
		type: 'object',
		optional: false, nullable: false,
		ref: 'ChatMessageLiteForRoom',
	},

	errors: {
		noSuchRoom: {
			message: 'No such room.',
			code: 'NO_SUCH_ROOM',
			id: '8098520d-2da5-4e8f-8ee1-df78b55a4ec6',
		},

		noSuchFile: {
			message: 'No such file.',
			code: 'NO_SUCH_FILE',
			id: 'b6accbd3-1d7b-4d9f-bdb7-eb185bac06db',
		},

		roomReadOnly: {
			message: 'This chat is archived and takes no new messages.',
			code: 'ROOM_READ_ONLY',
			id: 'c2a1d5e0-5c1b-4f7e-9a3c-7e1b2c3d4e52',
			httpStatusCode: 403,
		},

		// CHAT-REPLY-V1
		noSuchReply: {
			message: 'The message you reply to is not in this chat.',
			code: 'NO_SUCH_REPLY',
			id: 'c2a1d5e0-5c1b-4f7e-9a3c-7e1b2c3d4e96',
		},
		noSuchMeet: {
			message: 'No such meet.',
			code: 'NO_SUCH_MEET',
			id: 'c2a1d5e0-5c1b-4f7e-9a3c-7e1b2c3d4e50',
		},

		// CLUB-POSTS-LINKS-V1 (B-set-comms.03 / E-chat-room.21): the club chat refuses another club's meet or competition
		outsideLinks: outsideLinksError,

		// SUPPORT-DESK-V1: the survey in a support desk room (CHAT-CSAT-V1's codes)
		csatRefused: { message: 'This survey cannot be sent or answered.', code: 'CSAT_REFUSED', id: 'a7c4e9b1-2d3f-4e5a-8b6c-0000000000f4' },
		csatExpired: { message: 'This survey has expired.', code: 'CSAT_EXPIRED', id: 'a7c4e9b1-2d3f-4e5a-8b6c-0000000000f5' },
		csatAnswered: { message: 'This survey has been submitted.', code: 'CSAT_ANSWERED', id: 'a7c4e9b1-2d3f-4e5a-8b6c-0000000000f6' },

		contentRequired: {
			message: 'Content required. You need to set text or fileId.',
			code: 'CONTENT_REQUIRED',
			id: '340517b7-6d04-42c0-bac1-37ee804e3594',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		text: { type: 'string', nullable: true, maxLength: 2000 },
		fileId: { type: 'string', format: 'misskey:id' },
		/** CHAT-V2: share a meet — the message carries a card snapshot of it (attachment.kind = 'meet') */
		meetId: { type: 'string', format: 'misskey:id' },
		/** CHAT-REPLY-V1: reply to a message of this thread — the message carries its quote (attachment.kind = 'reply'); not with meetId */
		replyId: { type: 'string', format: 'misskey:id' },
		toRoomId: { type: 'string', format: 'misskey:id' },
		/** SUPPORT-DESK-V1: a staff member closes a support desk conversation with the survey bubble */
		csatAsk: { type: 'boolean' },
		/** SUPPORT-DESK-V1: the desk's player answers a survey bubble (once, before it expires) */
		csat: { type: 'object', properties: { askId: { type: 'string', format: 'misskey:id' }, score: { type: 'integer', minimum: 1, maximum: 5 }, comment: { type: 'string', nullable: true, maxLength: 500 } }, required: ['askId', 'score'] },
	},
	required: ['toRoomId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.driveFilesRepository)
		private driveFilesRepository: DriveFilesRepository,

		@Inject(DI.meetsRepository)
		private meetsRepository: MeetsRepository,

		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,

		private getterService: GetterService,
		private chatService: ChatService,
		private clubService: ClubService,
		@Inject(DI.db) private db: DataSource,
		@Inject(DI.chatMessagesRepository) private chatMessagesRepository: ChatMessagesRepository,   // SUPPORT-DESK-V1
		private roleService: RoleService,   // SUPPORT-DESK-V1
	) {
		super(meta, paramDef, async (ps, me) => {
			await this.chatService.checkChatAvailability(me.id, 'write');

			const room = await this.chatService.findRoomById(ps.toRoomId);
			if (room == null) {
				throw new ApiError(meta.errors.noSuchRoom);
			}

			// CHAT-V2 archive rule (meet chats: 14 days after the meet ends; competition chats: 7 days)
			if (room.readOnlyAt != null && room.readOnlyAt.getTime() <= Date.now()) {
				throw new ApiError(meta.errors.roomReadOnly);
			}

			let file = null;
			if (ps.fileId != null) {
				file = await this.driveFilesRepository.findOneBy({
					id: ps.fileId,
					userId: me.id,
				});

				if (file == null) {
					throw new ApiError(meta.errors.noSuchFile);
				}
			}

			// CHAT-V2: a meet card — a snapshot at send time (name / when / where), the id opens the live meet
			let attachment: Record<string, any> | null = null;
			if (ps.meetId != null) {
				const meet = await this.meetsRepository.findOneBy({ id: ps.meetId });
				if (meet == null) throw new ApiError(meta.errors.noSuchMeet);
				attachment = { kind: 'meet', meetId: meet.id, name: meet.name, startAt: meet.startAt.toISOString(), durationMinutes: meet.durationMinutes, venueName: meet.venueName, status: meet.status };
			}

			// CHAT-REPLY-V1: the quote of a message in this same thread (a reply cannot also carry a meet card)
			if (ps.replyId != null) {
				if (attachment != null) throw new ApiError(meta.errors.noSuchReply);
				attachment = await replyAttachment(this.chatService, this.usersRepository, ps.replyId, { roomId: room.id });
				if (attachment == null) throw new ApiError(meta.errors.noSuchReply);
				if (ps.text == null && file == null) throw new ApiError(meta.errors.contentRequired);
			}

			// CLUB-POSTS-LINKS-V1: a club's chat room with "Allow outside activity links" OFF — text links and meet cards
			const roomClub = await clubOfRoom(this.db, room.id);
			if (roomClub && await outsideLinkRefusal(this.db, this.clubService, roomClub, me.id, ps.text ?? null, ps.meetId ?? null)) throw new ApiError(meta.errors.outsideLinks);

			// SUPPORT-DESK-V1: the survey bubble (staff) and its answer (the desk's player) — never with a card, a quote or a file
			if (ps.csatAsk || ps.csat) {
				if (attachment != null || file != null) throw new ApiError(meta.errors.csatRefused);
				try {
					attachment = await csatForRoom({ db: this.db, users: this.usersRepository, messages: this.chatMessagesRepository, roleService: this.roleService }, me, room, { csatAsk: ps.csatAsk, csat: ps.csat });
				} catch (e) {
					if (e instanceof CsatError) throw new ApiError(e.code === 'expired' ? meta.errors.csatExpired : e.code === 'answered' ? meta.errors.csatAnswered : meta.errors.csatRefused);
					throw e;
				}
			}

			// テキストが無いかつ添付ファイルも無かったらエラー
			if (ps.text == null && file == null && attachment == null) {
				throw new ApiError(meta.errors.contentRequired);
			}

			return await this.chatService.createMessageToRoom(me, room, {
				text: ps.text,
				file: file,
				attachment,
			});
		});
	}
}

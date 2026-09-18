/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ChatService } from '@/core/ChatService.js';
import { AbuseReportService } from '@/core/AbuseReportService.js';
import { RoleService } from '@/core/RoleService.js';
import { ApiError } from '@/server/api/error.js';

/* CHAT-V2 — report a chat message (Reclub chat-message-menu → "Report objectionable content"). The report lands in the
 * moderators' abuse-report queue against the message's author, with the message's id and text quoted in the comment, so
 * the existing moderation console shows it beside every other report. Only a party to the thread may report. */
export const meta = {
	tags: ['chat'],

	requireCredential: true,

	kind: 'write:report-abuse',

	errors: {
		noSuchMessage: {
			message: 'No such message.',
			code: 'NO_SUCH_MESSAGE',
			id: 'c2a1d5e0-5c1b-4f7e-9a3c-7e1b2c3d4e60',
		},
		cannotReportYourself: {
			message: 'Cannot report yourself.',
			code: 'CANNOT_REPORT_YOURSELF',
			id: 'c2a1d5e0-5c1b-4f7e-9a3c-7e1b2c3d4e61',
		},
		cannotReportAdmin: {
			message: 'Cannot report the admin.',
			code: 'CANNOT_REPORT_THE_ADMIN',
			id: 'c2a1d5e0-5c1b-4f7e-9a3c-7e1b2c3d4e62',
		},
		notAParty: {
			message: 'You are not a party to this thread.',
			code: 'NOT_A_PARTY',
			id: 'c2a1d5e0-5c1b-4f7e-9a3c-7e1b2c3d4e63',
			httpStatusCode: 403,
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		messageId: { type: 'string', format: 'misskey:id' },
		comment: { type: 'string', minLength: 1, maxLength: 1024 },
	},
	required: ['messageId', 'comment'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private chatService: ChatService,
		private abuseReportService: AbuseReportService,
		private roleService: RoleService,
	) {
		super(meta, paramDef, async (ps, me) => {
			await this.chatService.checkChatAvailability(me.id, 'read');

			const message = await this.chatService.findMessageById(ps.messageId);
			if (message == null) throw new ApiError(meta.errors.noSuchMessage);
			if (message.fromUserId === me.id) throw new ApiError(meta.errors.cannotReportYourself);

			// a party: the other side of a 1-on-1, or a member of the room
			if (message.toRoomId) {
				const room = await this.chatService.findRoomById(message.toRoomId);
				if (room == null || !(await this.chatService.hasPermissionToViewRoomTimeline(me.id, room))) throw new ApiError(meta.errors.notAParty);
			} else if (message.toUserId !== me.id) {
				throw new ApiError(meta.errors.notAParty);
			}

			if (await this.roleService.isAdministrator({ id: message.fromUserId })) throw new ApiError(meta.errors.cannotReportAdmin);

			const quoted = (message.text ?? (message.fileId ? '(photo)' : message.attachment ? '(' + String(message.attachment.kind) + ' card)' : '')).slice(0, 200);
			await this.abuseReportService.report([{
				targetUserId: message.fromUserId,
				targetUserHost: null,
				reporterId: me.id,
				reporterHost: null,
				comment: `[message:${message.id}] "${quoted}" — ${ps.comment}`,
			}]);
		});
	}
}

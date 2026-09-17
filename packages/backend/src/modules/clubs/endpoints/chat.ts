/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ClubService } from '@/modules/clubs/ClubService.js';
import { ApiError } from '@/server/api/error.js';
import { IdentifiableError } from '@/misc/identifiable-error.js';

// CLUB-CHAT-V1: the club's chat room for this member (minted on first open) — see ClubService.chatRoom()
const clubErrors = {
	noSuchClub: { message: 'No such club.', code: 'NO_SUCH_CLUB', id: 'c1b00000-0000-4000-8000-000000000001' },
	notMember: { message: 'Only members can open the club chat.', code: 'CLUB_NOT_MEMBER', id: 'c1b00000-0000-4000-8000-000000000011' },
	chatOff: { message: 'This club has turned its chat off.', code: 'CLUB_CHAT_OFF', id: 'c1b00000-0000-4000-8000-000000000012' },
	clubError: { message: 'Club error.', code: 'CLUB_ERROR', id: 'c1b00000-0000-4000-8000-000000000003' },
} as const;
function toApiError(e: unknown): never {
	if (e instanceof IdentifiableError) {
		if (e.id === 'club:no_such_club') throw new ApiError(clubErrors.noSuchClub);
		if (e.id === 'club:not_member') throw new ApiError(clubErrors.notMember);
		if (e.id === 'club:chat_off') throw new ApiError(clubErrors.chatOff);
		throw new ApiError({ ...clubErrors.clubError, message: e.message });
	}
	throw e;
}

export const meta = {
	tags: ['clubs'],
	requireCredential: true,
	kind: 'write:chat',
	res: { type: 'object', optional: false, nullable: false, properties: { roomId: { type: 'string', optional: false, nullable: false } } },
	errors: clubErrors,
} as const;

export const paramDef = {
	type: 'object',
	properties: { channelId: { type: 'string', format: 'misskey:id' } },
	required: ['channelId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private clubService: ClubService) {
		super(meta, paramDef, async (ps, me) => {
			try {
				const c = await this.clubService.channel(ps.channelId);
				return await this.clubService.chatRoom(c, me);
			} catch (e) {
				return toApiError(e);
			}
		});
	}
}

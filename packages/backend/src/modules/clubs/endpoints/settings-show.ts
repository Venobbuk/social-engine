/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ClubService } from '@/modules/clubs/ClubService.js';
import { ApiError } from '@/server/api/error.js';
import { IdentifiableError } from '@/misc/identifiable-error.js';

// CLUB-ADMIN-V1 — see modules/clubs/ClubService.ts
const clubErrors = {
	noSuchClub: { message: 'No such club.', code: 'NO_SUCH_CLUB', id: 'c1b00000-0000-4000-8000-000000000001' },
	notAdmin: { message: 'Only the club owner or an admin can do that.', code: 'CLUB_NOT_ADMIN', id: 'c1b00000-0000-4000-8000-000000000002' },
	clubError: { message: 'Club error.', code: 'CLUB_ERROR', id: 'c1b00000-0000-4000-8000-000000000003' },
} as const;
function toApiError(e: unknown): never {
	if (e instanceof IdentifiableError) {
		if (e.id === 'club:no_such_club') throw new ApiError(clubErrors.noSuchClub);
		if (e.id === 'club:not_admin') throw new ApiError(clubErrors.notAdmin);
		throw new ApiError({ ...clubErrors.clubError, message: e.message });
	}
	throw e;
}

export const meta = {
	tags: ['clubs'],
	requireCredential: false,
	res: { type: 'object', optional: false, nullable: false, properties: { visibility: { type: 'string', optional: false, nullable: false }, gateType: { type: 'string', optional: false, nullable: false }, createMeetPermission: { type: 'string', optional: false, nullable: false }, sport: { type: 'string', optional: false, nullable: false }, level: { type: 'string', optional: false, nullable: true }, adminIds: { type: 'array', optional: false, nullable: false, items: { type: 'string' } }, venueIds: { type: 'array', optional: false, nullable: false, items: { type: 'string' } }, paymentInfo: { type: 'string', optional: false, nullable: true }, enableForum: { type: 'boolean', optional: false, nullable: false }, enableChat: { type: 'boolean', optional: false, nullable: false }, isAdmin: { type: 'boolean', optional: false, nullable: false }, isOwner: { type: 'boolean', optional: false, nullable: false }, isMember: { type: 'boolean', optional: false, nullable: false }, myRequest: { type: 'string', optional: false, nullable: true } } },
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
				const c = await this.clubService.channel(ps.channelId); const s = await this.clubService.settings(c.id);
			const isAdmin = me ? await this.clubService.isAdmin(c, me.id) : false;
			return { visibility: s.visibility, gateType: s.gateType, createMeetPermission: s.createMeetPermission, sport: s.sport, level: s.level, adminIds: isAdmin ? s.adminIds : [], venueIds: s.venueIds, paymentInfo: s.paymentInfo, enableForum: s.enableForum, enableChat: s.enableChat, isAdmin, isOwner: !!me && c.userId === me.id, isMember: me ? await this.clubService.isMember(c.id, me.id) : false, myRequest: me ? await this.clubService.myRequest(c.id, me.id) : null };
			} catch (e) {
				return toApiError(e);
			}
		});
	}
}

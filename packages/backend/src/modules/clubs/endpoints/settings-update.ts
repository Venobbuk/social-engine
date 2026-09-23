/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ClubService } from '@/modules/clubs/ClubService.js';
import { ApiError } from '@/server/api/error.js';
import { IdentifiableError } from '@/misc/identifiable-error.js';
import { handleInvalidError, handleProblem, handleReservedError, handleTakenError, normalizeHandle } from '@/modules/clubs/club-post-rules.js';

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
	requireCredential: true,
	kind: 'write:channels',
	res: { type: 'object', optional: false, nullable: false },
	errors: { ...clubErrors, handleTaken: handleTakenError, handleInvalid: handleInvalidError, handleReserved: handleReservedError }, // CLUB-HANDLE-V1
} as const;

export const paramDef = {
	type: 'object',
	properties: { channelId: { type: 'string', format: 'misskey:id' }, visibility: { type: 'string', enum: ['public', 'private'] }, gateType: { type: 'string', enum: ['open', 'approval', 'invite'] }, createMeetPermission: { type: 'string', enum: ['admins', 'members'] }, memberGated: { type: 'boolean' }, allowOutsideLinks: { type: 'boolean' } /* CLUB-POSTS-LINKS-V1 (B-set-comms.03) */, handle: { type: 'string', nullable: true, maxLength: 31 } /* CLUB-HANDLE-V1 (B-set-profile.03); null or '' clears */, sport: { type: 'string', maxLength: 32 }, level: { type: 'string', nullable: true, maxLength: 64 }, venueIds: { type: 'array', items: { type: 'string' }, maxItems: 20 }, paymentInfo: { type: 'string', nullable: true, maxLength: 512 }, enableForum: { type: 'boolean' }, enableChat: { type: 'boolean' }, awards: { type: 'array', items: { type: 'object' }, maxItems: 50 } },
	required: ['channelId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private clubService: ClubService) {
		super(meta, paramDef, async (ps, me) => {
			try {
				const c = await this.clubService.channel(ps.channelId);
			const patch: Record<string, unknown> = {};
			for (const k of ['visibility', 'gateType', 'createMeetPermission', 'sport', 'level', 'venueIds', 'paymentInfo', 'enableForum', 'enableChat', 'memberGated', 'allowOutsideLinks'] as const) if (ps[k] !== undefined) patch[k] = ps[k];
			// CLUB-HANDLE-V1: validated, reserved words refused, unique (the partial unique index is the backstop)
			if (ps.handle !== undefined) {
				const h = normalizeHandle(ps.handle);
				if (!h) patch.handle = null;
				else {
					const why = handleProblem(h);
					if (why === 'invalid') throw new ApiError(meta.errors.handleInvalid);
					if (why === 'reserved') throw new ApiError(meta.errors.handleReserved);
					const owner = await this.clubService.handleOwner(h);
					if (owner && owner !== c.id) throw new ApiError(meta.errors.handleTaken);
					patch.handle = h;
				}
			}
			if (ps.awards !== undefined) patch.awards = this.clubService.cleanAwards(ps.awards); // CLUB-V3: the awards showcase
			const s = await this.clubService.updateSettings(c, me, patch);
			return { ...s, updatedAt: s.updatedAt.toISOString() };
			} catch (e) {
				return toApiError(e);
			}
		});
	}
}

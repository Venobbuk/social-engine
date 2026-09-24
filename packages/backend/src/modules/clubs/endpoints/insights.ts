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
	requireCredential: true,
	kind: 'read:channels',
	res: { type: 'object', optional: false, nullable: false },
	errors: clubErrors,
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		channelId: { type: 'string', format: 'misskey:id' },
		timeframe: { type: 'string', enum: ['CURRENT_MONTH', 'LAST_MONTH', 'LAST_3_MONTHS', 'YTD', 'LAST_YEAR', 'ALL_TIME'], default: 'LAST_3_MONTHS' },
		// CLUB-RANKINGS-V1 (fix-S3): with a dimension the answer is that ONE full ranking, paged (See all / Load more)
		dimension: { type: 'string', enum: ['most_active', 'most_rewarded', 'most_stats'] },
		referenceId: { type: 'string', nullable: true, maxLength: 64 },
		offset: { type: 'integer', minimum: 0, default: 0 },
		limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
	},
	required: ['channelId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private clubService: ClubService) {
		super(meta, paramDef, async (ps, me) => {
			try {
				const c = await this.clubService.channel(ps.channelId);
			if (ps.dimension) return await this.clubService.insightRanking(c, me, ps.timeframe, ps.dimension, ps.referenceId ?? null, ps.offset, ps.limit);   // CLUB-RANKINGS-V1
			return await this.clubService.insights(c, me, ps.timeframe);
			} catch (e) {
				return toApiError(e);
			}
		});
	}
}

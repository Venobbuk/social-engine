/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { MeetsRepository, MeetMatchesRepository } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import { MeetMatchService } from '@/modules/meets/MeetMatchService.js';
import { MeetEntityService } from '@/modules/meets/MeetEntityService.js';
import { ApiError } from '@/server/api/error.js';
import { meetErrors, toApiError } from '../_shared.js';

// MEET-MATCH-V1: host (re)sends one match to hkpl's DUPR queue — the retry for a 'failed' row, or a manual send on a
// meet whose "Matches will be submitted" switch is off. Never throws on the remote: the row records the outcome.
export const meta = {
	tags: ['meets'],
	requireCredential: true,
	prohibitMoved: true,
	kind: 'write:meets',
	res: { type: 'object', optional: false, nullable: false, ref: 'MeetMatch' },
	errors: { ...meetErrors },
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		meetId: { type: 'string', format: 'misskey:id' },
		matchId: { type: 'string', format: 'misskey:id' },
	},
	required: ['meetId', 'matchId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.meetsRepository)
		private meetsRepository: MeetsRepository,
		@Inject(DI.meetMatchesRepository)
		private meetMatchesRepository: MeetMatchesRepository,
		private meetMatchService: MeetMatchService,
		private meetEntityService: MeetEntityService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const meet = await this.meetsRepository.findOneBy({ id: ps.meetId });
			if (meet == null) throw new ApiError(meta.errors.noSuchMeet);
			const match = await this.meetMatchesRepository.findOneBy({ id: ps.matchId, meetId: meet.id });
			if (match == null) throw new ApiError(meta.errors.noSuchMatch);
			if (!(await this.meetMatchService.isHost(meet, me))) throw new ApiError(meta.errors.notHost);
			if (match.duprStatus === 'submitted') throw new ApiError(meta.errors.duprLocked);
			try {
				const m = await this.meetMatchService.submitDupr(meet, match, me);
				return await this.meetEntityService.packMatch(m, meet, me, { eligibility: true });
			} catch (e) {
				return toApiError(e);
			}
		});
	}
}

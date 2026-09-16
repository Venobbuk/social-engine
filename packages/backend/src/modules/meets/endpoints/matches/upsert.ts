/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { MeetsRepository } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import { MeetMatchService } from '@/modules/meets/MeetMatchService.js';
import { MeetEntityService } from '@/modules/meets/MeetEntityService.js';
import { ApiError } from '@/server/api/error.js';
import { meetErrors, toApiError } from '../_shared.js';

// MEET-MATCH-V1: Reclub upsert-score / upsert-match in one door. Without matchId → create (host). With matchId →
// structure (round/court/teams) is the host's; scores follow canUpdateScore. Submitted matches are locked.
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
		matchId: { type: 'string', format: 'misskey:id', nullable: true },
		round: { type: 'integer', nullable: true, minimum: 1, maximum: 999 },
		courtIndex: { type: 'integer', nullable: true, minimum: 0, maximum: 64 },
		team1Ids: { type: 'array', nullable: true, maxItems: 8, items: { type: 'string', format: 'misskey:id' } },
		team2Ids: { type: 'array', nullable: true, maxItems: 8, items: { type: 'string', format: 'misskey:id' } },
		// score sets in order, each [team1, team2]; [] clears (isPending)
		scores: { type: 'array', nullable: true, maxItems: 5, items: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'integer', minimum: 0, maximum: 999 } } },
	},
	required: ['meetId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.meetsRepository)
		private meetsRepository: MeetsRepository,
		private meetMatchService: MeetMatchService,
		private meetEntityService: MeetEntityService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const meet = await this.meetsRepository.findOneBy({ id: ps.meetId });
			if (meet == null) throw new ApiError(meta.errors.noSuchMeet);
			try {
				const data: Parameters<MeetMatchService['upsert']>[2] = { matchId: ps.matchId ?? null };
				if (ps.round !== undefined) data.round = ps.round;
				if (ps.courtIndex !== undefined) data.courtIndex = ps.courtIndex;
				if (ps.team1Ids != null) data.team1Ids = ps.team1Ids;
				if (ps.team2Ids != null) data.team2Ids = ps.team2Ids;
				if (ps.scores != null) data.scores = ps.scores;
				const m = await this.meetMatchService.upsert(meet, me, data);
				return await this.meetEntityService.packMatch(m, meet, me, { eligibility: true });
			} catch (e) {
				return toApiError(e);
			}
		});
	}
}

/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DI } from '@/di-symbols.js';
import type { MeetsRepository } from '@/models/_.js';
import { MeetMatchService } from '@/modules/meets/MeetMatchService.js';
import { MeetEntityService } from '@/modules/meets/MeetEntityService.js';
import { ApiError } from '@/server/api/error.js';
import { meetErrors, toApiError } from '@/modules/meets/endpoints/_shared.js';

// MEET-GEN-V1: Reclub `POST /matches/generate` (spec_competition_dupr §Y.3): scheme · sublocations (courts) ·
// participantIds · limitRounds · persist (false = preview) · rankingCriteria · prioritizeLeastMatches · reset
// ("Clear current matches" — unscored, unsubmitted ones). Host only. Returns the rounds, saved or previewed.
export const meta = {
	tags: ['meets'],
	requireCredential: true,
	prohibitMoved: true,
	kind: 'write:meets',
	res: {
		type: 'object', optional: false, nullable: false,
		properties: {
			persisted: { type: 'boolean', optional: false, nullable: false },
			rounds: { type: 'integer', optional: false, nullable: false },
			fullRounds: { type: 'integer', optional: false, nullable: false },
			players: { type: 'integer', optional: false, nullable: false },
			warnings: { type: 'array', optional: false, nullable: false, items: { type: 'string' } },
			matches: { type: 'array', optional: false, nullable: false, items: { type: 'object', ref: 'MeetMatch' } },
		},
	},
	errors: { ...meetErrors },
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		meetId: { type: 'string', format: 'misskey:id' },
		scheme: { type: 'string', enum: ['SINGLES', 'ROTATING_PARTNERS', 'PRESET_TEAMS', 'LADDER_RUN'], default: 'ROTATING_PARTNERS' },
		sublocations: { type: 'integer', minimum: 1, maximum: 20, default: 1 },
		participantIds: { type: 'array', nullable: true, maxItems: 64, items: { type: 'string', format: 'misskey:id' } },
		limitRounds: { type: 'integer', nullable: true, minimum: 1, maximum: 40 },
		persist: { type: 'boolean', default: true },
		reset: { type: 'boolean', default: false },
		prioritizeLeastMatches: { type: 'boolean', default: true },
		rankingCriteria: { type: 'string', nullable: true, enum: ['MATCHES_WON', 'POINTS_WON', 'WIN_PCT', 'POINTS_PCT'] },
		seed: { type: 'integer', nullable: true },
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
				const out = await this.meetMatchService.generate(meet, me, {
					scheme: ps.scheme, courts: ps.sublocations, participantIds: ps.participantIds ?? null, limitRounds: ps.limitRounds ?? null,
					persist: ps.persist, reset: ps.reset, prioritizeLeastMatches: ps.prioritizeLeastMatches, rankingCriteria: ps.rankingCriteria ?? null, seed: ps.seed ?? null,
				});
				const matches = [];
				for (const m of out.matches) matches.push(await this.meetEntityService.packMatch(m, meet, me, { eligibility: false }));
				return { persisted: out.persisted, rounds: out.rounds, fullRounds: out.fullRounds, players: out.players, warnings: out.warnings, matches };
			} catch (e) {
				return toApiError(e);
			}
		});
	}
}

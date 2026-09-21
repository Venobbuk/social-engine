/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { CompetitionMatchesRepository } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import { ApiError } from '@/server/api/error.js';
import { CompetitionService } from '@/modules/competitions/CompetitionService.js';
import { CompetitionDuprService } from '@/modules/competitions/CompetitionDuprService.js';
import { CompetitionEntityService } from '@/modules/competitions/CompetitionEntityService.js';
import { competitionErrors, toApiError, anyObject } from './../_shared.js';

// COMP-DUPR-V1: the host (re)sends one TOURNAMENT match to hkpl's DUPR queue — the same door meets/matches/submit-dupr
// is, through the same submitter. Never throws on the remote: the row records the outcome.
//
// THE CONFIRMATION STEP. Without `confirm: true` this endpoint SENDS NOTHING and answers with the preview: the teams,
// each player's DUPR id, the scores, the eligibility errors, whether every entrant has consented, and the exact JSON
// hkpl would receive. The host confirms against that and calls again with confirm: true. (The meet door has the same
// step in the app — lib/dupr-submit.ts confirmDuprSubmit, W2_S_DUPR_CONSENT — but not in the engine; here it is
// refused at the engine, so no client can skip it.)
export const meta = {
	tags: ['competitions'],
	requireCredential: true,
	prohibitMoved: true,
	kind: 'write:meets',
	res: anyObject,
	errors: { ...competitionErrors },
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		competitionId: { type: 'string', format: 'misskey:id' },
		matchId: { type: 'string', format: 'misskey:id' },
		confirm: { type: 'boolean', nullable: true },
	},
	required: ['competitionId', 'matchId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.competitionMatchesRepository)
		private matchesRepository: CompetitionMatchesRepository,
		private competitionService: CompetitionService,
		private competitionDuprService: CompetitionDuprService,
		private competitionEntityService: CompetitionEntityService,
	) {
		super(meta, paramDef, async (ps, me) => {
			try {
				const c = await this.competitionService.get(ps.competitionId);
				const match = await this.matchesRepository.findOneBy({ id: ps.matchId, competitionId: c.id });
				if (match == null) throw new ApiError(meta.errors.noSuchMatch);
				if (!this.competitionService.isHost(c, me.id)) throw new ApiError(meta.errors.notHost);
				if (match.duprStatus === 'submitted') throw new ApiError(meta.errors.duprLocked);
				if (ps.confirm !== true) return await this.competitionDuprService.preview(c, match);
				const m = await this.competitionDuprService.submitDupr(c, match, me);
				return { confirmed: true, match: await this.competitionEntityService.packMatch(m, c, me) };
			} catch (e) {
				return toApiError(e);
			}
		});
	}
}

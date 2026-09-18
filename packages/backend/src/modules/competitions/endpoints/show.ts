/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { CompetitionsRepository } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import { ApiError } from '@/server/api/error.js';
import { CompetitionService } from '@/modules/competitions/CompetitionService.js';
import { CompetitionEntityService } from '@/modules/competitions/CompetitionEntityService.js';
import { competitionErrors, toApiError, anyObject } from './_shared.js';

// TOURNAMENT-V1: Reclub GET /competitions/<id> — the competition hub header. Private competitions need the host,
// an entry, or the share link's accessToken ("This competition is private / Only participants can access.").
export const meta = {
	tags: ['competitions'],
	requireCredential: false,
	kind: 'read:meets',
	res: anyObject,
	errors: { ...competitionErrors },
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		competitionId: { type: 'string', format: 'misskey:id' },
		referenceCode: { type: 'string', minLength: 1, maxLength: 16 },
		accessToken: { type: 'string', nullable: true, maxLength: 32 },
	},
	anyOf: [{ required: ['competitionId'] }, { required: ['referenceCode'] }],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.competitionsRepository)
		private competitionsRepository: CompetitionsRepository,
		private competitionService: CompetitionService,
		private competitionEntityService: CompetitionEntityService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const c = ps.competitionId ? await this.competitionsRepository.findOneBy({ id: ps.competitionId }) : await this.competitionsRepository.findOneBy({ referenceCode: ps.referenceCode ?? '' });
			if (c == null) throw new ApiError(meta.errors.noSuchCompetition);
			try {
				await this.competitionService.assertVisible(c, me, ps.accessToken);
				return await this.competitionEntityService.pack(c, me, { detailed: true });
			} catch (e) {
				return toApiError(e);
			}
		});
	}
}

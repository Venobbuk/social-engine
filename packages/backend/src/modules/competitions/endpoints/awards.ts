/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { CompetitionService } from '@/modules/competitions/CompetitionService.js';
import { CompetitionEntityService } from '@/modules/competitions/CompetitionEntityService.js';
import { competitionErrors, toApiError, anyArray } from './_shared.js';

// TOURNAMENT-V1: Reclub Results › Awards — podium (1st / 2nd / 3rd / co-3rd / 4th) and custom awards.
export const meta = {
	tags: ['competitions'],
	requireCredential: false,
	kind: 'read:meets',
	res: anyArray,
	errors: { ...competitionErrors },
} as const;

export const paramDef = {
	type: 'object',
	properties: { competitionId: { type: 'string', format: 'misskey:id' }, accessToken: { type: 'string', nullable: true, maxLength: 32 } },
	required: ['competitionId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private competitionService: CompetitionService, private competitionEntityService: CompetitionEntityService) {
		super(meta, paramDef, async (ps, me) => {
			try {
				const c = await this.competitionService.get(ps.competitionId);
				await this.competitionService.assertVisible(c, me, ps.accessToken);
				return await Promise.all((await this.competitionService.awards(c)).map((a) => this.competitionEntityService.packAward(a, me)));
			} catch (e) {
				return toApiError(e);
			}
		});
	}
}

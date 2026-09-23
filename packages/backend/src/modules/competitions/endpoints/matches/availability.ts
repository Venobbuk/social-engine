/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { CompetitionService } from '@/modules/competitions/CompetitionService.js';
import { CompetitionEntityService } from '@/modules/competitions/CompetitionEntityService.js';
import { competitionErrors, toApiError, anyObject } from './../_shared.js';

// COMP-T3-V1: Reclub Update match availability — "Are you able to attend this match?" Can go / Maybe / Can't go, for
// yourself, or (the host, a referee, the team's captain) for one of the match's players. status null clears.
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
		userId: { type: 'string', format: 'misskey:id', nullable: true },
		status: { type: 'string', nullable: true, enum: ['yes', 'maybe', 'no'] },
	},
	required: ['competitionId', 'matchId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private competitionService: CompetitionService, private competitionEntityService: CompetitionEntityService) {
		super(meta, paramDef, async (ps, me) => {
			try {
				const c = await this.competitionService.get(ps.competitionId);
				const m = await this.competitionService.setAvailability(c, me, ps.matchId, ps.userId ?? null, ps.status ?? null);
				return await this.competitionEntityService.packMatch(m, c, me);
			} catch (e) {
				return toApiError(e);
			}
		});
	}
}

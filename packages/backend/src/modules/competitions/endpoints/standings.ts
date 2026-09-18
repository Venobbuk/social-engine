/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { CompetitionService } from '@/modules/competitions/CompetitionService.js';
import { CompetitionEntityService } from '@/modules/competitions/CompetitionEntityService.js';
import { competitionErrors, toApiError, anyObject } from './_shared.js';

// TOURNAMENT-V1: Reclub Pools / Standings pane — one table per pool (or the whole round robin), the Reclub row shape
// (points, wins, losses, draws, TB wins/losses, H2H wins, score diff, H2H diff, sets won/loss, set win %, total score),
// plus placements (rank → entry) once the deciding stage is complete.
export const meta = {
	tags: ['competitions'],
	requireCredential: false,
	kind: 'read:meets',
	res: anyObject,
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
				const st = await this.competitionService.standings(c);
				const entries = await this.competitionEntityService.packEntries(await this.competitionService.entries(c), me);
				return { ...st, entries, pointCalculationType: c.pointCalculationType, tiebreakers: c.tiebreakers, format: c.format };
			} catch (e) {
				return toApiError(e);
			}
		});
	}
}

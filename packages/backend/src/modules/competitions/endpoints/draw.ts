/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { CompetitionService } from '@/modules/competitions/CompetitionService.js';
import { CompetitionEntityService } from '@/modules/competitions/CompetitionEntityService.js';
import { competitionErrors, toApiError, anyObject } from './_shared.js';

// TOURNAMENT-V1: generate the draw — round robin / pools (meets generator) or the knockout bracket (brackets-manager),
// the playoffs of a pool competition once every pool match is complete. reset wipes the matches first.
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
		stage: { type: 'string', enum: ['auto', 'regular', 'playoff'], default: 'auto' },
		reset: { type: 'boolean', default: false },
	},
	required: ['competitionId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private competitionService: CompetitionService, private competitionEntityService: CompetitionEntityService) {
		super(meta, paramDef, async (ps, me) => {
			try {
				const c = await this.competitionService.get(ps.competitionId);
				const r = await this.competitionService.draw(c, me, { stage: ps.stage, reset: ps.reset });
				const fresh = await this.competitionService.get(c.id);
				return { stage: r.stage, matches: await Promise.all(r.matches.map((m) => this.competitionEntityService.packMatch(m, fresh, me))), competition: await this.competitionEntityService.pack(fresh, me, { detailed: true }) };
			} catch (e) {
				return toApiError(e);
			}
		});
	}
}

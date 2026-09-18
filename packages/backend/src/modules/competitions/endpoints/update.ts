/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ApiError } from '@/server/api/error.js';
import { CompetitionService } from '@/modules/competitions/CompetitionService.js';
import { CompetitionEntityService } from '@/modules/competitions/CompetitionEntityService.js';
import type { MiCompetition } from '@/modules/competitions/models/Competition.js';
import { competitionErrors, competitionParamProps, pickCompetitionFields, toApiError, anyObject } from './_shared.js';

// TOURNAMENT-V1: Reclub PUT /competitions/<id> — edit details / format (format is fixed once the draw exists).
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
	properties: { competitionId: { type: 'string', format: 'misskey:id' }, ...competitionParamProps },
	required: ['competitionId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private competitionService: CompetitionService, private competitionEntityService: CompetitionEntityService) {
		super(meta, paramDef, async (ps, me) => {
			const { fields, badDate } = pickCompetitionFields(ps as Record<string, unknown>);
			if (badDate) throw new ApiError(meta.errors.invalidDate);
			try {
				const c = await this.competitionService.get(ps.competitionId);
				const updated = await this.competitionService.update(c, me, fields as Partial<MiCompetition>);
				return await this.competitionEntityService.pack(updated, me, { detailed: true });
			} catch (e) {
				return toApiError(e);
			}
		});
	}
}

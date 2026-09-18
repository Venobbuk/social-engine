/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { CompetitionService } from '@/modules/competitions/CompetitionService.js';
import { CompetitionEntityService } from '@/modules/competitions/CompetitionEntityService.js';
import { competitionErrors, toApiError } from './../_shared.js';

// TOURNAMENT-V1: Reclub upsert-competition-award (customize a place, choose recipient) and upsert-competition-custom-award.
export const meta = {
	tags: ['competitions'],
	requireCredential: true,
	prohibitMoved: true,
	kind: 'write:meets',
	res: { type: 'object', optional: false, nullable: true },
	errors: { ...competitionErrors },
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		competitionId: { type: 'string', format: 'misskey:id' },
		awardId: { type: 'string', format: 'misskey:id', nullable: true },
		type: { type: 'string', nullable: true, enum: ['first', 'second', 'third', 'coThird', 'fourth', 'custom'] },
		name: { type: 'string', nullable: true, maxLength: 128 },
		description: { type: 'string', nullable: true, maxLength: 512 },
		entryId: { type: 'string', format: 'misskey:id', nullable: true },
		enabled: { type: 'boolean', nullable: true },
		remove: { type: 'boolean', nullable: true },
	},
	required: ['competitionId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private competitionService: CompetitionService, private competitionEntityService: CompetitionEntityService) {
		super(meta, paramDef, async (ps, me) => {
			try {
				const c = await this.competitionService.get(ps.competitionId);
				const data: Parameters<CompetitionService['upsertAward']>[2] = { awardId: ps.awardId ?? null };
				if (ps.type !== undefined) data.type = ps.type;
				if (ps.name !== undefined) data.name = ps.name;
				if (ps.description !== undefined) data.description = ps.description;
				if (ps.entryId !== undefined) data.entryId = ps.entryId;
				if (ps.enabled !== undefined) data.enabled = ps.enabled;
				if (ps.remove !== undefined) data.remove = ps.remove;
				const a = await this.competitionService.upsertAward(c, me, data);
				return a ? await this.competitionEntityService.packAward(a, me) : null;
			} catch (e) {
				return toApiError(e);
			}
		});
	}
}

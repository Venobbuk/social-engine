/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { CompetitionService } from '@/modules/competitions/CompetitionService.js';
import { CompetitionEntityService } from '@/modules/competitions/CompetitionEntityService.js';
import { competitionErrors, toApiError, anyObject } from '../_shared.js';

// COMP-W1B4: a manager places a free agent in a team with an open place (Reclub free agents pane → Assign team).
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
		freeAgentEntryId: { type: 'string', format: 'misskey:id' },
		entryId: { type: 'string', format: 'misskey:id' },
	},
	required: ['competitionId', 'freeAgentEntryId', 'entryId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private competitionService: CompetitionService, private competitionEntityService: CompetitionEntityService) {
		super(meta, paramDef, async (ps, me) => {
			try {
				const c = await this.competitionService.get(ps.competitionId);
				const e = await this.competitionService.assignFreeAgent(c, me, ps.freeAgentEntryId, ps.entryId);
				return await this.competitionEntityService.packEntry(e, me);
			} catch (e) {
				return toApiError(e);
			}
		});
	}
}

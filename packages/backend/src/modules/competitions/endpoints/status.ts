/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { CompetitionService } from '@/modules/competitions/CompetitionService.js';
import { CompetitionEntityService } from '@/modules/competitions/CompetitionEntityService.js';
import { competitionErrors, toApiError, anyObject } from './_shared.js';

// TOURNAMENT-V1: the host's lifecycle door — Reclub Publish competition · Lock registration · Reopen registration ·
// Start competition · End competition · Reopen Competition · Reset competition.
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
		action: { type: 'string', enum: ['publish', 'lock', 'reopen', 'start', 'finish', 'reopenEnded', 'reset'] },
	},
	required: ['competitionId', 'action'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private competitionService: CompetitionService, private competitionEntityService: CompetitionEntityService) {
		super(meta, paramDef, async (ps, me) => {
			try {
				const c = await this.competitionService.get(ps.competitionId);
				const updated = await this.competitionService.setStatus(c, me, ps.action);
				return await this.competitionEntityService.pack(updated, me, { detailed: true });
			} catch (e) {
				return toApiError(e);
			}
		});
	}
}

/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { CompetitionService } from '@/modules/competitions/CompetitionService.js';
import { CompetitionEntityService } from '@/modules/competitions/CompetitionEntityService.js';
import { competitionErrors, toApiError, anyArray } from './_shared.js';

// TOURNAMENT-V1: Reclub GET /competitions — discover (public, live), mine (host or entered), hosting, club.
export const meta = {
	tags: ['competitions'],
	requireCredential: false,
	kind: 'read:meets',
	res: anyArray,
	errors: { ...competitionErrors },
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		scope: { type: 'string', enum: ['discover', 'mine', 'hosting', 'club'], default: 'discover' },
		channelId: { type: 'string', format: 'misskey:id', nullable: true },
		includePast: { type: 'boolean', default: false },
		limit: { type: 'integer', minimum: 1, maximum: 100, default: 30 },
		offset: { type: 'integer', minimum: 0, default: 0 },
	},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private competitionService: CompetitionService, private competitionEntityService: CompetitionEntityService) {
		super(meta, paramDef, async (ps, me) => {
			try {
				const rows = await this.competitionService.list(me, { scope: ps.scope, channelId: ps.channelId, includePast: ps.includePast, limit: ps.limit, offset: ps.offset });
				return await this.competitionEntityService.packMany(rows, me);
			} catch (e) {
				return toApiError(e);
			}
		});
	}
}

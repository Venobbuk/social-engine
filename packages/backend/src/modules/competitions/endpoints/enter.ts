/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { CompetitionService } from '@/modules/competitions/CompetitionService.js';
import { CompetitionEntityService } from '@/modules/competitions/CompetitionEntityService.js';
import { competitionErrors, toApiError, anyObject } from './_shared.js';

// TOURNAMENT-V1: Reclub join-competition — a player (singles), a pair (doubles: partnerIds[0]) or a team (name +
// partnerIds) signs up while registration is open. autoApprove decides confirmed vs pending.
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
		name: { type: 'string', nullable: true, maxLength: 128 },
		partnerIds: { type: 'array', nullable: true, maxItems: 19, items: { type: 'string', format: 'misskey:id' } },
		accessToken: { type: 'string', nullable: true, maxLength: 32 },
		leaveCurrent: { type: 'boolean' },   // COMP-FIXES-A: Reclub "Create a new team will also remove you from {teamName}"
	},
	required: ['competitionId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private competitionService: CompetitionService, private competitionEntityService: CompetitionEntityService) {
		super(meta, paramDef, async (ps, me) => {
			try {
				const c = await this.competitionService.get(ps.competitionId);
				if (ps.leaveCurrent) await this.competitionService.enterAsNewTeam(c, me, { name: ps.name, partnerIds: ps.partnerIds, accessToken: ps.accessToken });
				else await this.competitionService.enter(c, me, { name: ps.name, partnerIds: ps.partnerIds, accessToken: ps.accessToken });
				return await this.competitionEntityService.pack(await this.competitionService.get(c.id), me, { detailed: true });
			} catch (e) {
				return toApiError(e);
			}
		});
	}
}

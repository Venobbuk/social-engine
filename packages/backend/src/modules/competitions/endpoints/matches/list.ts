/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { CompetitionService } from '@/modules/competitions/CompetitionService.js';
import { CompetitionEntityService } from '@/modules/competitions/CompetitionEntityService.js';
import { competitionErrors, toApiError, anyArray } from './../_shared.js';

// TOURNAMENT-V1: Reclub Matches tab — every match of every stage. Hidden from non-hosts until revealDraw or the start.
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
				const visible = this.competitionService.isHost(c, me?.id) || c.revealDraw || c.status === 'inProgress' || c.status === 'done';
				if (!visible) return [];
				const ms = await this.competitionService.matches(c);
				return await Promise.all(ms.map((m) => this.competitionEntityService.packMatch(m, c, me)));
			} catch (e) {
				return toApiError(e);
			}
		});
	}
}

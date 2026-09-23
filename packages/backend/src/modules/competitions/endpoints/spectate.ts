/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { CompetitionService } from '@/modules/competitions/CompetitionService.js';
import { CompetitionEntityService } from '@/modules/competitions/CompetitionEntityService.js';
import { competitionErrors, toApiError, anyObject } from './_shared.js';

// COMP-T3-V1: Reclub "Join as a spectator" / "Cancel request" — the meet's spectator (a roster row holding no seat) on the
// competition's own entry row: never counted, never drawn, hears announcements, reads the general chat. The free-agent
// door's shape (free-agent.ts), a different status.
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
		leave: { type: 'boolean', nullable: true },
		accessToken: { type: 'string', nullable: true, maxLength: 32 },
	},
	required: ['competitionId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private competitionService: CompetitionService, private competitionEntityService: CompetitionEntityService) {
		super(meta, paramDef, async (ps, me) => {
			try {
				const c = await this.competitionService.get(ps.competitionId);
				await this.competitionService.spectate(c, me, { leave: ps.leave, accessToken: ps.accessToken });
				return await this.competitionEntityService.pack(await this.competitionService.get(c.id), me, { detailed: true });
			} catch (e) {
				return toApiError(e);
			}
		});
	}
}

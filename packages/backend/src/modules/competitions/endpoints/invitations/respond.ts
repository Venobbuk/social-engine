/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { CompetitionService } from '@/modules/competitions/CompetitionService.js';
import { CompetitionEntityService } from '@/modules/competitions/CompetitionEntityService.js';
import { competitionErrors, toApiError, anyObject } from '../_shared.js';

// COMP-W1B4 (T1 partner consent): accept (seated, joins the chat) or decline a team invitation. Returns the competition.
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
		entryId: { type: 'string', format: 'misskey:id' },
		accept: { type: 'boolean' },
	},
	required: ['competitionId', 'entryId', 'accept'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private competitionService: CompetitionService, private competitionEntityService: CompetitionEntityService) {
		super(meta, paramDef, async (ps, me) => {
			try {
				const c = await this.competitionService.get(ps.competitionId);
				await this.competitionService.respondInvitation(c, me, ps.entryId, ps.accept);
				return await this.competitionEntityService.pack(await this.competitionService.get(c.id), me, { detailed: true });
			} catch (e) {
				return toApiError(e);
			}
		});
	}
}

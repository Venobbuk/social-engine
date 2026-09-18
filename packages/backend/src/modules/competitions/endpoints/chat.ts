/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { CompetitionService } from '@/modules/competitions/CompetitionService.js';
import { competitionErrors, toApiError } from './_shared.js';

// TOURNAMENT-V1: the competition's general chat room for a host or entrant (the meet / club chat room pattern).
export const meta = {
	tags: ['competitions'],
	requireCredential: true,
	kind: 'write:chat',
	res: { type: 'object', optional: false, nullable: false, properties: { roomId: { type: 'string', optional: false, nullable: false } } },
	errors: { ...competitionErrors },
} as const;

export const paramDef = {
	type: 'object',
	properties: { competitionId: { type: 'string', format: 'misskey:id' } },
	required: ['competitionId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private competitionService: CompetitionService) {
		super(meta, paramDef, async (ps, me) => {
			try {
				const c = await this.competitionService.get(ps.competitionId);
				return await this.competitionService.chatRoom(c, me);
			} catch (e) {
				return toApiError(e);
			}
		});
	}
}

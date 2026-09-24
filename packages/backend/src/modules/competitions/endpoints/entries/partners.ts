/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { CompetitionService } from '@/modules/competitions/CompetitionService.js';
import { CompetitionEntityService } from '@/modules/competitions/CompetitionEntityService.js';
import { competitionErrors, toApiError, anyObject } from '../_shared.js';

// COMP-W1B4: the captain (or a manager) invites partners to an open place, or cancels an open invitation. Block-aware.
// MOP-UP-COMP: the same door reserves one place on the team, edits / releases it, or swaps a real player in.
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
		invite: { type: 'array', nullable: true, maxItems: 19, items: { type: 'string', format: 'misskey:id' } },
		cancel: { type: 'array', nullable: true, maxItems: 19, items: { type: 'string', format: 'misskey:id' } },
		// MOP-UP-COMP: reserve ONE place on the team (Reclub Reserve a spot / Edit reserved info / Remove reserved spot / Swap from community)
		reserve: { type: 'object', properties: { placeId: { type: 'string', format: 'misskey:id' }, name: { type: 'string', maxLength: 64 }, gender: { type: 'string', maxLength: 8 }, ageGroup: { type: 'string', maxLength: 8 }, level: { type: 'number', minimum: 0, maximum: 10 } } },
		releasePlaceId: { type: 'string', format: 'misskey:id' },
		swapPlaceId: { type: 'string', format: 'misskey:id' },
		swapUserId: { type: 'string', format: 'misskey:id' },
	},
	required: ['competitionId', 'entryId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private competitionService: CompetitionService, private competitionEntityService: CompetitionEntityService) {
		super(meta, paramDef, async (ps, me) => {
			try {
				const c = await this.competitionService.get(ps.competitionId);
				if (ps.reserve || ps.releasePlaceId || (ps.swapPlaceId && ps.swapUserId)) {   // MOP-UP-COMP
					const x = await this.competitionService.reservedPlace(c, me, ps.entryId, { reserve: ps.reserve ?? null, release: ps.releasePlaceId ?? null, swap: ps.swapPlaceId && ps.swapUserId ? { placeId: ps.swapPlaceId, userId: ps.swapUserId } : null });
					return await this.competitionEntityService.packEntry(x, me, c);
				}
				const e = await this.competitionService.setPartners(c, me, ps.entryId, { invite: ps.invite, cancel: ps.cancel });
				return await this.competitionEntityService.packEntry(e, me);
			} catch (e) {
				return toApiError(e);
			}
		});
	}
}

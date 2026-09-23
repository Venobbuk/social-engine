/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { CompetitionService } from '@/modules/competitions/CompetitionService.js';
import { CompetitionEntityService } from '@/modules/competitions/CompetitionEntityService.js';
import { competitionErrors, toApiError, anyObject } from './../_shared.js';

// TOURNAMENT-V1: the host's entry door — Reclub add club member / add outsider / reserve a spot (no entryId), approve,
// seed up/down, set pool, paid tag, forfeit, remove.
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
		entryId: { type: 'string', format: 'misskey:id', nullable: true },
		name: { type: 'string', nullable: true, maxLength: 128 },
		userIds: { type: 'array', nullable: true, maxItems: 20, items: { type: 'string', format: 'misskey:id' } },
		seed: { type: 'integer', nullable: true, minimum: 1, maximum: 256 },
		pool: { type: 'integer', nullable: true, minimum: 1, maximum: 32 },
		status: { type: 'string', nullable: true, enum: ['confirmed', 'withdrawn', 'forfeit'] },
		isPaid: { type: 'boolean', nullable: true },
		notes: { type: 'string', nullable: true, maxLength: 512 },
		remove: { type: 'boolean', nullable: true },
		// COMP-T3-V1 (Reclub participant settings "Eligible"): the host's call on one member; eligible null = the automatic rule
		eligibleUserId: { type: 'string', format: 'misskey:id', nullable: true },
		eligible: { type: 'boolean', nullable: true },
	},
	required: ['competitionId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private competitionService: CompetitionService, private competitionEntityService: CompetitionEntityService) {
		super(meta, paramDef, async (ps, me) => {
			try {
				const c = await this.competitionService.get(ps.competitionId);
				if (!ps.entryId) {
					const e = await this.competitionService.hostAddEntry(c, me, { name: ps.name, userIds: ps.userIds, seed: ps.seed });
					return await this.competitionEntityService.packEntry(e, me);
				}
				const patch: Parameters<CompetitionService['hostUpdateEntry']>[3] = {};
				if (ps.name !== undefined) patch.name = ps.name;
				if (ps.userIds !== undefined) patch.userIds = ps.userIds;
				if (ps.seed !== undefined) patch.seed = ps.seed;
				if (ps.pool !== undefined) patch.pool = ps.pool;
				if (ps.status !== undefined) patch.status = ps.status;
				if (ps.isPaid !== undefined) patch.isPaid = ps.isPaid;
				if (ps.notes !== undefined) patch.notes = ps.notes;
				if (ps.remove !== undefined) patch.remove = ps.remove;
				if (ps.eligibleUserId) { patch.eligibleUserId = ps.eligibleUserId; patch.eligible = ps.eligible ?? null; }   // COMP-T3-V1
				const e = await this.competitionService.hostUpdateEntry(c, me, ps.entryId, patch);
				return e ? await this.competitionEntityService.packEntry(e, me) : null;
			} catch (e) {
				return toApiError(e);
			}
		});
	}
}

/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { CompetitionService } from '@/modules/competitions/CompetitionService.js';
import { competitionErrors, toApiError } from './_shared.js';

// COMP-T3-V1: Reclub kebab "Delete competition" ("Are you sure you want to delete this competition?"). The owner only;
// a competition anyone else is part of is refused (cancel it first, so they are told) — CompetitionService.delete.
export const meta = {
	tags: ['competitions'],
	requireCredential: true,
	prohibitMoved: true,
	kind: 'write:meets',
	res: { type: 'object', optional: false, nullable: false, properties: { deleted: { type: 'boolean', optional: false, nullable: false } } },
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
				await this.competitionService.delete(c, me);
				return { deleted: true };
			} catch (e) {
				return toApiError(e);
			}
		});
	}
}

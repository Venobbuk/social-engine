/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { CompetitionService } from '@/modules/competitions/CompetitionService.js';
import { CompetitionEntityService } from '@/modules/competitions/CompetitionEntityService.js';
import { competitionErrors, toApiError, anyArray } from './_shared.js';

// COMP-W1B4 (T1 partner consent): my open team invitations — [{ competition, entry }], newest first.
export const meta = {
	tags: ['competitions'],
	requireCredential: true,
	prohibitMoved: true,
	kind: 'read:meets',
	res: anyArray,
	errors: { ...competitionErrors },
} as const;

export const paramDef = {
	type: 'object',
	properties: {},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private competitionService: CompetitionService, private competitionEntityService: CompetitionEntityService) {
		super(meta, paramDef, async (ps, me) => {
			try {
				const rows = await this.competitionService.invitationsOf(me.id);
				return await Promise.all(rows.map(async (r) => ({ competition: await this.competitionEntityService.pack(r.c, me), entry: await this.competitionEntityService.packEntry(r.e, me) })));
			} catch (e) {
				return toApiError(e);
			}
		});
	}
}

/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { CompetitionService } from '@/modules/competitions/CompetitionService.js';
import { CompetitionEntityService } from '@/modules/competitions/CompetitionEntityService.js';
import { competitionErrors, toApiError, anyObject } from './../_shared.js';

// COMP-T3-V1: Reclub Create / edit team — the CAPTAIN's door (the host's is entries/update): team name, description
// (entry.notes) and avatar (a drive image the setter uploaded; null clears).
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
		name: { type: 'string', nullable: true, maxLength: 128 },
		notes: { type: 'string', nullable: true, maxLength: 512 },
		avatarFileId: { type: 'string', format: 'misskey:id', nullable: true },
	},
	required: ['competitionId', 'entryId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private competitionService: CompetitionService, private competitionEntityService: CompetitionEntityService) {
		super(meta, paramDef, async (ps, me) => {
			try {
				const c = await this.competitionService.get(ps.competitionId);
				const e = await this.competitionService.editTeam(c, me, ps.entryId, { name: ps.name, notes: ps.notes, avatarFileId: ps.avatarFileId });
				return await this.competitionEntityService.packEntry(e, me, c);
			} catch (e) {
				return toApiError(e);
			}
		});
	}
}

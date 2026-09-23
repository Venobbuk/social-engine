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
	res: { type: 'object', optional: false, nullable: true },   // COMP-FIXES-A: null after Delete team
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
		// COMP-FIXES-A: the captain's own options — Reactivate team, Delete team and leave competition, hand over the
		// captaincy, Assign positions
		reactivate: { type: 'boolean' },
		deleteTeam: { type: 'boolean' },
		captainUserId: { type: 'string', format: 'misskey:id' },
		positions: { type: 'object', additionalProperties: { type: 'string', nullable: true, maxLength: 24 } },
	},
	required: ['competitionId', 'entryId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private competitionService: CompetitionService, private competitionEntityService: CompetitionEntityService) {
		super(meta, paramDef, async (ps, me) => {
			try {
				const c = await this.competitionService.get(ps.competitionId);
				if (ps.reactivate || ps.deleteTeam || ps.captainUserId || ps.positions) {   // COMP-FIXES-A
					const x = await this.competitionService.captainAction(c, me, ps.entryId, { reactivate: ps.reactivate, deleteTeam: ps.deleteTeam, captainUserId: ps.captainUserId, positions: ps.positions as Record<string, string | null> | undefined });
					return x ? await this.competitionEntityService.packEntry(x, me, c) : null;
				}
				const e = await this.competitionService.editTeam(c, me, ps.entryId, { name: ps.name, notes: ps.notes, avatarFileId: ps.avatarFileId });
				return await this.competitionEntityService.packEntry(e, me, c);
			} catch (e) {
				return toApiError(e);
			}
		});
	}
}

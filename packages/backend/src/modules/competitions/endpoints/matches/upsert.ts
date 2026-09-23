/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ApiError } from '@/server/api/error.js';
import { CompetitionService } from '@/modules/competitions/CompetitionService.js';
import { CompetitionEntityService } from '@/modules/competitions/CompetitionEntityService.js';
import type { CompetitionScoreSet } from '@/modules/competitions/models/CompetitionMatch.js';
import { competitionErrors, toApiError, parseIsoDate, anyObject } from './../_shared.js';

// TOURNAMENT-V1: Reclub upsert-competition-score + match manage in one door. Without matchId the host adds an extra
// match. scores = the score sets in order ({ t1, t2, type standard|tiebreaker|extra }); forfeit marks a side;
// the host's call finalizes (result fixed, a knockout winner advances) unless finalize:false; a player of the match
// saves a provisional score. reopen puts a completed match back to pending (a knockout one only while no later
// match is played).
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
		matchId: { type: 'string', format: 'misskey:id', nullable: true },
		scores: { type: 'array', nullable: true, maxItems: 9, items: { type: 'object', properties: { t1: { type: 'integer', minimum: 0, maximum: 999 }, t2: { type: 'integer', minimum: 0, maximum: 999 }, type: { type: 'string', enum: ['standard', 'tiebreaker', 'extra'] }, name: { type: 'string', nullable: true, maxLength: 32 } }, required: ['t1', 't2'] } },
		forfeit: { type: 'string', nullable: true, enum: ['entry1', 'entry2', 'both'] },
		finalize: { type: 'boolean', nullable: true },
		reopen: { type: 'boolean', nullable: true },
		entry1Id: { type: 'string', format: 'misskey:id', nullable: true },
		entry2Id: { type: 'string', format: 'misskey:id', nullable: true },
		round: { type: 'integer', nullable: true, minimum: 1, maximum: 999 },
		courtIndex: { type: 'integer', nullable: true, minimum: 0, maximum: 64 },
		startAt: { type: 'string', nullable: true, maxLength: 40 },
		notes: { type: 'string', nullable: true, maxLength: 512 },
		// COMP-T3-V1: the match's own referees; Remove match / Unremove (a non-bracket match)
		refereeIds: { type: 'array', nullable: true, maxItems: 4, items: { type: 'string', format: 'misskey:id' } },
		remove: { type: 'boolean', nullable: true },
		restore: { type: 'boolean', nullable: true },
	},
	required: ['competitionId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private competitionService: CompetitionService, private competitionEntityService: CompetitionEntityService) {
		super(meta, paramDef, async (ps, me) => {
			try {
				const c = await this.competitionService.get(ps.competitionId);
				const data: Parameters<CompetitionService['upsertMatch']>[2] = { matchId: ps.matchId ?? null };
				if (ps.scores != null) data.scores = ps.scores.map((s) => ({ t1: s.t1, t2: s.t2, type: (s.type ?? 'standard') as CompetitionScoreSet['type'], ...(s.name ? { name: s.name } : {}) }));
				if (ps.forfeit !== undefined) data.forfeit = ps.forfeit;
				if (ps.finalize != null) data.finalize = ps.finalize;
				if (ps.reopen != null) data.reopen = ps.reopen;
				if (ps.entry1Id !== undefined) data.entry1Id = ps.entry1Id;
				if (ps.entry2Id !== undefined) data.entry2Id = ps.entry2Id;
				if (ps.round !== undefined) data.round = ps.round;
				if (ps.courtIndex !== undefined) data.courtIndex = ps.courtIndex;
				if (ps.notes !== undefined) data.notes = ps.notes;
				if (ps.refereeIds !== undefined) data.refereeIds = ps.refereeIds;   // COMP-T3-V1
				if (ps.remove) data.remove = true;
				if (ps.restore) data.restore = true;
				if (ps.startAt !== undefined) { if (ps.startAt === null) data.startAt = null; else { const d = parseIsoDate(ps.startAt); if (!d) throw new ApiError(meta.errors.invalidDate); data.startAt = d; } }
				const m = await this.competitionService.upsertMatch(c, me, data);
				return await this.competitionEntityService.packMatch(m, await this.competitionService.get(c.id), me);
			} catch (e) {
				return toApiError(e);
			}
		});
	}
}

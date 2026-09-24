/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { MeetsRepository, MeetMatchesRepository } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import { MeetMatchService } from '@/modules/meets/MeetMatchService.js';
import { ApiError } from '@/server/api/error.js';
import { meetErrors, toApiError } from '../_shared.js';

// HOST-TOOLS-V1 — DUPR Manager "Submit all": every scored match not yet submitted / queued goes through the same
// submitDupr as the per-match door (eligibility → hkpl queue). Never throws per match: each row records its outcome.
export const meta = {
	tags: ['meets'],
	requireCredential: true,
	prohibitMoved: true,
	kind: 'write:meets',
	res: {
		type: 'object', optional: false, nullable: false,
		properties: {
			submitted: { type: 'number', optional: false, nullable: false },
			queued: { type: 'number', optional: false, nullable: false },
			failed: { type: 'number', optional: false, nullable: false },
			ineligible: { type: 'number', optional: false, nullable: false },
			skipped: { type: 'number', optional: false, nullable: false },
			results: { type: 'array', optional: false, nullable: false, items: { type: 'object', optional: false, nullable: false, properties: {
				matchId: { type: 'string', optional: false, nullable: false },
				duprStatus: { type: 'string', optional: false, nullable: true },
				duprError: { type: 'string', optional: false, nullable: true },
			} } },
		},
	},
	errors: { ...meetErrors },
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		meetId: { type: 'string', format: 'misskey:id' },
		basis: { type: 'string', enum: ['matches', 'sets'] },   // DUPR-OPTIONS-V1 (Reclub Submission basis)
		scoringType: { type: 'string', enum: ['sideout', 'rally'] },   // DUPR-OPTIONS-V1 (Reclub Scoring type)
	},
	required: ['meetId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.meetsRepository)
		private meetsRepository: MeetsRepository,
		@Inject(DI.meetMatchesRepository)
		private meetMatchesRepository: MeetMatchesRepository,
		private meetMatchService: MeetMatchService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const meet = await this.meetsRepository.findOneBy({ id: ps.meetId });
			if (meet == null) throw new ApiError(meta.errors.noSuchMeet);
			if (!(await this.meetMatchService.isHost(meet, me))) throw new ApiError(meta.errors.notHost);
			try {
				const ms = await this.meetMatchesRepository.find({ where: { meetId: meet.id }, order: { round: 'ASC', courtIndex: 'ASC' } });
				const counts = { submitted: 0, queued: 0, failed: 0, ineligible: 0, skipped: 0 };
				const results: { matchId: string; duprStatus: string | null; duprError: string | null }[] = [];
				for (const m of ms) {
					if (m.scores.length === 0 || m.duprStatus === 'submitted' || m.duprStatus === 'queued') { counts.skipped++; results.push({ matchId: m.id, duprStatus: m.duprStatus, duprError: m.duprError }); continue; }
					// SEC-CASUAL-CONSENT-V1: a casual game with an unconfirmed player is skipped (submitDupr would refuse it)
					if ((await this.meetMatchService.casualPending(meet, m)).length > 0) { counts.skipped++; results.push({ matchId: m.id, duprStatus: m.duprStatus, duprError: 'casual_unconfirmed' }); continue; }
					const r = await this.meetMatchService.submitDupr(meet, m, me, { basis: ps.basis ?? null, scoring: ps.scoringType ?? null });
					if (r.duprStatus === 'submitted') counts.submitted++;
					else if (r.duprStatus === 'queued') counts.queued++;
					else if (r.duprStatus === 'ineligible') counts.ineligible++;
					else counts.failed++;
					results.push({ matchId: r.id, duprStatus: r.duprStatus, duprError: r.duprError });
				}
				return { ...counts, results };
			} catch (e) {
				return toApiError(e);
			}
		});
	}
}

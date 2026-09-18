/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { MeetsRepository, MeetParticipantsRepository, MeetMatchesRepository } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import { MeetService } from '@/modules/meets/MeetService.js';
import { MeetMatchService } from '@/modules/meets/MeetMatchService.js';
import { MeetLevelService } from '@/modules/meets/MeetLevelService.js';
import { ApiError } from '@/server/api/error.js';
import { meetErrors, toApiError } from './_shared.js';

// HOST-TOOLS-V1 — Reclub's DUPR Manager (walk §10 capture 099; spec_competition_dupr.md §6.3 activity manager):
// Players tab = who on the roster is DUPR-connected before the meet ("Not connected" chip); Matches tab = every
// match with its DUPR state and eligibility. Host only; read-only (submit-dupr-all does the writing).
export const meta = {
	tags: ['meets'],
	requireCredential: true,
	kind: 'read:meets',
	res: {
		type: 'object', optional: false, nullable: false,
		properties: {
			players: { type: 'array', optional: false, nullable: false, items: { type: 'object', optional: false, nullable: false, properties: {
				participantId: { type: 'string', optional: false, nullable: false },
				userId: { type: 'string', optional: false, nullable: true },
				status: { type: 'string', optional: false, nullable: false },
				connected: { type: 'boolean', optional: false, nullable: false },
				duprSingles: { type: 'number', optional: false, nullable: true },
				duprDoubles: { type: 'number', optional: false, nullable: true },
			} } },
			matches: { type: 'array', optional: false, nullable: false, items: { type: 'object', optional: false, nullable: false, properties: {
				matchId: { type: 'string', optional: false, nullable: false },
				round: { type: 'number', optional: false, nullable: true },
				scored: { type: 'boolean', optional: false, nullable: false },
				duprStatus: { type: 'string', optional: false, nullable: true },
				duprError: { type: 'string', optional: false, nullable: true },
				isEligible: { type: 'boolean', optional: false, nullable: false },
				errors: { type: 'array', optional: false, nullable: false, items: { type: 'string', optional: false, nullable: false } },
			} } },
			connected: { type: 'number', optional: false, nullable: false },
			total: { type: 'number', optional: false, nullable: false },
			pending: { type: 'number', optional: false, nullable: false },
		},
	},
	errors: { ...meetErrors },
} as const;

export const paramDef = {
	type: 'object',
	properties: { meetId: { type: 'string', format: 'misskey:id' } },
	required: ['meetId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.meetsRepository)
		private meetsRepository: MeetsRepository,
		@Inject(DI.meetParticipantsRepository)
		private meetParticipantsRepository: MeetParticipantsRepository,
		@Inject(DI.meetMatchesRepository)
		private meetMatchesRepository: MeetMatchesRepository,
		private meetService: MeetService,
		private meetMatchService: MeetMatchService,
		private meetLevelService: MeetLevelService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const meet = await this.meetsRepository.findOneBy({ id: ps.meetId });
			if (meet == null) throw new ApiError(meta.errors.noSuchMeet);
			try {
				await this.meetService.assertHost(meet, me);
				const rows = await this.meetParticipantsRepository.find({ where: { meetId: meet.id, status: 'confirmed' }, order: { isHost: 'DESC', statusChangedAt: 'ASC' } });
				const userIds = rows.map(r => r.userId).filter((x): x is string => !!x);
				const levels = new Map((await this.meetLevelService.getLevels(userIds, meet.sport)).map(l => [l.userId, l]));
				const players = rows.map(p => {
					const l = p.userId ? levels.get(p.userId) ?? null : null;
					return { participantId: p.id, userId: p.userId, status: p.status, connected: !!(l && l.duprId), duprSingles: l?.duprSingles ?? null, duprDoubles: l?.duprDoubles ?? null };
				});
				const ms = await this.meetMatchesRepository.find({ where: { meetId: meet.id }, order: { round: 'ASC', courtIndex: 'ASC' } });
				const matches = [];
				for (const m of ms) {
					const e = await this.meetMatchService.eligibility(meet, m);
					matches.push({ matchId: m.id, round: m.round, scored: m.scores.length > 0, duprStatus: m.duprStatus, duprError: m.duprError, isEligible: e.isEligible, errors: e.errors.map(x => x.code) });
				}
				return {
					players, matches,
					connected: players.filter(p => p.connected).length,
					total: players.length,
					pending: matches.filter(m => m.scored && m.duprStatus !== 'submitted' && m.duprStatus !== 'queued').length,
				};
			} catch (e) {
				return toApiError(e);
			}
		});
	}
}

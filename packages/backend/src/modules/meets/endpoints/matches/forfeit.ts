/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { MeetsRepository, MeetMatchesRepository } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import { MeetService } from '@/modules/meets/MeetService.js';
import { MeetEntityService } from '@/modules/meets/MeetEntityService.js';
import { MeetMatchService } from '@/modules/meets/MeetMatchService.js';
import { ApiError } from '@/server/api/error.js';
import { scoringOf } from '@/modules/meets/MeetExtras.js';
import { meetErrors, toApiError } from '../_shared.js';

/**
 * MEET-EXTRAS-V1 — mark a match forfeited by team 1 or 2 (Reclub CompetitionMatchTeamStatus.Forfeit + forfeitWinScore):
 * the winner is credited the meet's forfeit score as one game so every reader of `scores` (cards, DUPR eligibility,
 * the generator's memory) sees the result; `team: 0` clears the forfeit and its score. Host only; a DUPR-submitted
 * match is locked.
 */
export const meta = {
	tags: ['meets'],
	requireCredential: true,
	prohibitMoved: true,
	kind: 'write:meets',
	res: { type: 'object', optional: false, nullable: false, ref: 'MeetMatch' },
	errors: { ...meetErrors },
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		meetId: { type: 'string', format: 'misskey:id' },
		matchId: { type: 'string', format: 'misskey:id' },
		team: { type: 'integer', minimum: 0, maximum: 2 },
	},
	required: ['meetId', 'matchId', 'team'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.db)
		private db: DataSource,
		@Inject(DI.meetsRepository)
		private meetsRepository: MeetsRepository,
		@Inject(DI.meetMatchesRepository)
		private meetMatchesRepository: MeetMatchesRepository,
		private meetService: MeetService,
		private meetEntityService: MeetEntityService,
		private meetMatchService: MeetMatchService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const meet = await this.meetsRepository.findOneBy({ id: ps.meetId });
			if (meet == null) throw new ApiError(meta.errors.noSuchMeet);
			try { await this.meetService.assertHost(meet, me); } catch (e) { return toApiError(e); }
			const match = await this.meetMatchesRepository.findOneBy({ id: ps.matchId, meetId: meet.id });
			if (match == null) throw new ApiError(meta.errors.noSuchMatch);
			if (match.duprStatus === 'submitted') throw new ApiError(meta.errors.duprLocked);
			// SEC-CASUAL-CONSENT-V1: a forfeit rewrites the score — refused once another player confirmed a casual game
			try { await this.meetMatchService.assertCasualUnlocked(meet, match); } catch (e) { return toApiError(e); }
			const rules = scoringOf(meet as unknown as Record<string, unknown>);
			const scores: [number, number][] = ps.team === 1 ? [[0, rules.forfeitScore]] : ps.team === 2 ? [[rules.forfeitScore, 0]] : [];
			await this.db.query(`UPDATE "meet_match" SET "forfeitTeam" = $2, "scores" = $3::jsonb, "updatedAt" = now() WHERE "id" = $1`, [match.id, ps.team === 0 ? null : ps.team, JSON.stringify(scores)]);
			const fresh = await this.meetMatchesRepository.findOneByOrFail({ id: match.id });
			const packed = await this.meetEntityService.packMatch(fresh, meet, me);
			return { ...packed, forfeitTeam: ps.team === 0 ? null : ps.team } as typeof packed;
		});
	}
}

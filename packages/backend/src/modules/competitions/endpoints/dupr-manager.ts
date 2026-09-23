/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { CompetitionEntriesRepository } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import { ApiError } from '@/server/api/error.js';
import { CompetitionService } from '@/modules/competitions/CompetitionService.js';
import { CompetitionDuprService } from '@/modules/competitions/CompetitionDuprService.js';
import { MeetLevelService } from '@/modules/meets/MeetLevelService.js';
import { competitionErrors, toApiError, anyObject } from './_shared.js';

// COMP-FIXES-B (2026-09-23): Reclub DUPR Manager for a competition (DUPRManager / onDUPRManager / MANAGE_DUPR,
// spec_competition_dupr.md §6.3). REUSED: the meet's door modules/meets/endpoints/dupr-manager.ts — the same response shape
// (players · matches · connected / total / pending), so the app draws the same sheet — with the tournament's own eligibility
// (CompetitionDuprService.eligibility, which reads a team match's line-up) and consent. Host only; READ-ONLY: it sends
// nothing (competitions/matches/submit-dupr-all does the sending, behind its own preview + confirm).
export const meta = {
	tags: ['competitions'],
	requireCredential: true,
	kind: 'read:meets',
	res: anyObject,
	errors: { ...competitionErrors },
} as const;

export const paramDef = {
	type: 'object',
	properties: { competitionId: { type: 'string', format: 'misskey:id' } },
	required: ['competitionId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.competitionEntriesRepository)
		private entriesRepository: CompetitionEntriesRepository,
		private competitionService: CompetitionService,
		private competitionDuprService: CompetitionDuprService,
		private meetLevelService: MeetLevelService,
	) {
		super(meta, paramDef, async (ps, me) => {
			try {
				const c = await this.competitionService.get(ps.competitionId);
				if (!this.competitionService.isHost(c, me.id)) throw new ApiError(meta.errors.notHost);
				const entries = (await this.competitionService.entries(c)).filter((e) => e.status === 'confirmed' || e.status === 'forfeit');
				const userIds = Array.from(new Set(entries.flatMap((e) => e.userIds)));
				const levels = new Map((await this.meetLevelService.getLevels(userIds, c.sport)).map((l) => [l.userId, l]));
				const players = entries.flatMap((e) => e.userIds.map((uid) => {
					const l = levels.get(uid) ?? null;
					return { participantId: e.id + ':' + uid, entryId: e.id, userId: uid, status: e.status, connected: !!(l && l.duprId), duprSingles: l?.duprSingles ?? null, duprDoubles: l?.duprDoubles ?? null };
				}));
				const matches = [];
				for (const m of await this.competitionService.matches(c)) {
					if (m.status === 'cancelled' || m.entry1Status === 'bye' || m.entry2Status === 'bye' || !m.entry1Id || !m.entry2Id) continue;
					const e = await this.competitionDuprService.eligibility(c, m);
					const pending = await this.competitionDuprService.pendingConsent(c, m);
					matches.push({
						matchId: m.id, round: m.round, stage: m.stage, pool: m.pool, entry1Id: m.entry1Id, entry2Id: m.entry2Id,
						scored: m.status === 'completed' && m.scores.length > 0, duprStatus: m.duprStatus, duprError: m.duprError,
						isEligible: e.isEligible && pending.length === 0, errors: [...(pending.length ? ['entry_unconfirmed'] : []), ...e.errors.map((x) => x.code)],
					});
				}
				return {
					players, matches,
					connected: players.filter((p) => p.connected).length,
					total: players.length,
					pending: matches.filter((m) => m.scored && m.duprStatus !== 'submitted' && m.duprStatus !== 'queued').length,
				};
			} catch (e) {
				return toApiError(e);
			}
		});
	}
}

/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ApiError } from '@/server/api/error.js';
import { CompetitionService } from '@/modules/competitions/CompetitionService.js';
import { CompetitionDuprService } from '@/modules/competitions/CompetitionDuprService.js';
import type { CompetitionDuprPreview } from '@/modules/competitions/CompetitionDuprService.js';
import { competitionErrors, toApiError, anyObject } from './../_shared.js';

// COMP-DUPR-V1 — the tournament's "Submit all": every scored match not yet submitted / queued goes through the same
// submitDupr as the per-match door. Never throws per match: each row records its own outcome.
//
// THE CONFIRMATION STEP, again at the engine: without `confirm: true` nothing is sent and the host is answered with
// one preview per match it would send (and the reason for each it would not).
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
		confirm: { type: 'boolean', nullable: true },
		basis: { type: 'string', enum: ['matches', 'sets'] },   // DUPR-OPTIONS-V1 (Reclub Submission basis)
		scoringType: { type: 'string', enum: ['sideout', 'rally'] },   // DUPR-OPTIONS-V1 (Reclub Scoring type)
	},
	required: ['competitionId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private competitionService: CompetitionService,
		private competitionDuprService: CompetitionDuprService,
	) {
		super(meta, paramDef, async (ps, me) => {
			try {
				const c = await this.competitionService.get(ps.competitionId);
				if (!this.competitionService.isHost(c, me.id)) throw new ApiError(meta.errors.notHost);
				const ms = await this.competitionService.matches(c);
				// COMP-FIXES-B: only a FINALIZED match is a result — a player's provisional score (inProgress) and a removed match
				// (cancelled) were candidates too, so Submit all could send an unfinalized or removed game to DUPR
				const isResult = (m: typeof ms[number]) => m.status === 'completed' && m.entry1Status !== 'bye' && m.entry2Status !== 'bye';
				const sendable = ms.filter(m => isResult(m) && (m.scores ?? []).length > 0 && m.duprStatus !== 'submitted' && m.duprStatus !== 'queued');

				if (ps.confirm !== true) {
					const previews: CompetitionDuprPreview[] = [];
					for (const m of sendable) previews.push(await this.competitionDuprService.preview(c, m, { basis: ps.basis ?? null, scoring: ps.scoringType ?? null }));
					return {
						confirmed: false,
						total: ms.length,
						candidates: sendable.length,
						willSubmit: previews.filter(p => p.willSubmit).length,
						previews,
					};
				}

				const counts = { submitted: 0, queued: 0, failed: 0, ineligible: 0, skipped: 0 };
				const results: { matchId: string; duprStatus: string | null; duprError: string | null }[] = [];
				for (const m of ms) {
					if (!isResult(m) || (m.scores ?? []).length === 0 || m.duprStatus === 'submitted' || m.duprStatus === 'queued') { counts.skipped++; results.push({ matchId: m.id, duprStatus: m.duprStatus, duprError: m.duprError }); continue; }
					// consent: a match with an unconfirmed entrant is skipped (submitDupr would refuse it)
					if ((await this.competitionDuprService.pendingConsent(c, m)).length > 0) { counts.skipped++; results.push({ matchId: m.id, duprStatus: m.duprStatus, duprError: 'entry_unconfirmed' }); continue; }
					const r = await this.competitionDuprService.submitDupr(c, m, me, { basis: ps.basis ?? null, scoring: ps.scoringType ?? null });
					if (r.duprStatus === 'submitted') counts.submitted++;
					else if (r.duprStatus === 'queued') counts.queued++;
					else if (r.duprStatus === 'ineligible') counts.ineligible++;
					else counts.failed++;
					results.push({ matchId: r.id, duprStatus: r.duprStatus, duprError: r.duprError });
				}
				return { confirmed: true, ...counts, results };
			} catch (e) {
				return toApiError(e);
			}
		});
	}
}

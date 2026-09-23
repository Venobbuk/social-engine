/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { CompetitionService } from '@/modules/competitions/CompetitionService.js';
import { competitionErrors, toApiError, anyObject } from './_shared.js';

// COMP-FIXES-B (2026-09-23): Reclub Request support › Recalculate (competitions.onResolveCompetition — "Results and matches are
// calculated and updated automatically. If something doesn't look right, you can try to recalculate it."). NEW: Misskey has no
// tournament; hkpl has no standalone recalculation to reuse (grep -i recalc routes lib: only routes/captain.js:1169, where a
// staff correction re-runs the captain submit path). The
// host's door re-derives every STORED fact that comes from something else (match results from their games, bracket rows from
// the bracket store, the podium from the placements) and answers what it corrected — CompetitionService.recalculate.
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
	properties: { competitionId: { type: 'string', format: 'misskey:id' } },
	required: ['competitionId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private competitionService: CompetitionService) {
		super(meta, paramDef, async (ps, me) => {
			try {
				const c = await this.competitionService.get(ps.competitionId);
				return await this.competitionService.recalculate(c, me);
			} catch (e) {
				return toApiError(e);
			}
		});
	}
}

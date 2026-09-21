/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { CoachScheduleService } from '@/modules/coaches/CoachScheduleService.js';
import { coachErrors, toApiError } from './_shared.js';

// COACHING-V1 — the COACH "My lessons": this week/month, per lesson the roster + locked price + paid/owed + an EMPTY
// flag + a live revenue tally. `range` picks the window (default this week).
export const meta = { tags: ['coaches'], requireCredential: true, kind: 'read:meets', res: { type: 'object', optional: false, nullable: false }, errors: coachErrors } as const;
export const paramDef = { type: 'object', properties: { range: { type: 'string', enum: ['week', 'month'] } }, required: [] } as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private coachScheduleService: CoachScheduleService) {
		super(meta, paramDef, async (ps, me) => {
			try {
				const now = new Date();
				const days = ps.range === 'month' ? 31 : 7;
				const from = new Date(now.getTime() - 3 * 86_400_000); // include the last few days so just-finished lessons still show
				const to = new Date(now.getTime() + days * 86_400_000);
				return await this.coachScheduleService.coachDashboard(me, from, to);
			} catch (e) { return toApiError(e); }
		});
	}
}

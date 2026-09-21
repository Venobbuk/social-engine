/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { CoachScheduleService } from '@/modules/coaches/CoachScheduleService.js';
import { coachErrors, toApiError } from './_shared.js';

// COACHING-V1 — the STUDENT "My lessons": upcoming booked lessons + active weekly enrolments (cancel / skip).
export const meta = { tags: ['coaches'], requireCredential: true, kind: 'read:meets', res: { type: 'object', optional: false, nullable: false }, errors: coachErrors } as const;
export const paramDef = { type: 'object', properties: {}, required: [] } as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private coachScheduleService: CoachScheduleService) {
		super(meta, paramDef, async (ps, me) => {
			try {
				return await this.coachScheduleService.studentDashboard(me);
			} catch (e) { return toApiError(e); }
		});
	}
}

/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { CoachScheduleService } from '@/modules/coaches/CoachScheduleService.js';
import { coachErrors, toApiError } from './_shared.js';

// COACHING-V1 — "Create lessons now": materialise the due occurrences of one slot at once (owner or club admin).
export const meta = { tags: ['coaches'], requireCredential: true, kind: 'write:account', res: { type: 'object', optional: false, nullable: false }, errors: coachErrors } as const;
export const paramDef = { type: 'object', properties: { scheduleId: { type: 'string', format: 'misskey:id' } }, required: ['scheduleId'] } as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private coachScheduleService: CoachScheduleService) {
		super(meta, paramDef, async (ps, me) => {
			try {
				const s = await this.coachScheduleService.get(ps.scheduleId);
				return await this.coachScheduleService.runForSchedule(me, s);
			} catch (e) { return toApiError(e); }
		});
	}
}

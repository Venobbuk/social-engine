/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { CoachScheduleService } from '@/modules/coaches/CoachScheduleService.js';
import { coachErrors, toApiError } from './_shared.js';

// COACHING-V1 — cancel a whole weekly enrolment. Leaves every future lesson it booked (freeze window permitting).
export const meta = { tags: ['coaches'], requireCredential: true, kind: 'write:meets', res: { type: 'object', optional: false, nullable: false }, errors: coachErrors } as const;
export const paramDef = { type: 'object', properties: { enrollmentId: { type: 'string', format: 'misskey:id' } }, required: ['enrollmentId'] } as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private coachScheduleService: CoachScheduleService) {
		super(meta, paramDef, async (ps, me) => {
			try {
				return await this.coachScheduleService.unenroll(ps.enrollmentId, me);
			} catch (e) { return toApiError(e); }
		});
	}
}

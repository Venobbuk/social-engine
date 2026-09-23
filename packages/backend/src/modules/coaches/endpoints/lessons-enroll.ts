/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { CoachScheduleService } from '@/modules/coaches/CoachScheduleService.js';
import { coachErrors, toApiError } from './_shared.js';

// COACHING-V1 — enrol in a weekly slot: 'series' (auto-book each future week until cancelled) or 'pack' (a fixed
// block bought as one payment). Books every already-materialised future occurrence; the sweep books the rest.
export const meta = { tags: ['coaches'], requireCredential: true, kind: 'write:meets', res: { type: 'object', optional: false, nullable: false }, errors: coachErrors } as const;
export const paramDef = { type: 'object', properties: { scheduleId: { type: 'string', format: 'misskey:id' }, mode: { type: 'string', enum: ['series', 'pack'] }, quotedPrice: { type: 'integer', nullable: true, minimum: 0 } }, required: ['scheduleId', 'mode'] } as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private coachScheduleService: CoachScheduleService) {
		super(meta, paramDef, async (ps, me) => {
			try {
				const s = await this.coachScheduleService.get(ps.scheduleId);
				const { enrollment, booked } = await this.coachScheduleService.enroll(s, me, ps.mode, ps.quotedPrice ?? null);   // GROUP-PRICE-V1: per-lesson price the sheet showed
				return { enrollment: this.coachScheduleService.packEnrollment(enrollment), booked };
			} catch (e) { return toApiError(e); }
		});
	}
}

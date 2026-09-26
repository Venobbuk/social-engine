/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { CoachScheduleService } from '@/modules/coaches/CoachScheduleService.js';
import { coachErrors, toApiError } from './_shared.js';

// L6-COACH PACK-PAID-V1 — the coach confirms (or takes back) the ONE payment for a lesson pack. Before this door nothing
// could set coach_enrollment.paid: a pack's seats read "Prepaid" on the coach's roster although nobody had paid, and the
// pack never reached the coach's "Collected so far". The coach's word only (owner, or an owner/admin of the club) — the
// student's side is the meet pattern's claim, never this.
export const meta = { tags: ['coaches'], requireCredential: true, kind: 'write:meets', res: { type: 'object', optional: false, nullable: false }, errors: coachErrors } as const;
export const paramDef = { type: 'object', properties: { enrollmentId: { type: 'string', format: 'misskey:id' }, paid: { type: 'boolean' } }, required: ['enrollmentId', 'paid'] } as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private coachScheduleService: CoachScheduleService) {
		super(meta, paramDef, async (ps, me) => {
			try {
				return await this.coachScheduleService.setPackPaid(ps.enrollmentId, ps.paid, me);
			} catch (e) { return toApiError(e); }
		});
	}
}

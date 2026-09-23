/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { CoachScheduleService } from '@/modules/coaches/CoachScheduleService.js';
import { ApiError } from '@/server/api/error.js';
import { coachErrors, toApiError } from './_shared.js';

// COACHING-V1 — a coach's public lesson slots (coach profile + Discover). Private slots only for the club's members.
// COACH-GATE-V1 (2026-09-23, coaching-polish): this PUBLIC door is also the app's anonymous feature gate — signed-out
// visitors may browse lessons (operator decision), so the app needs an answer without a credential. With the flag OFF
// it now answers 404 COACH_NOT_AVAILABLE (as every write door already does) instead of a quiet []; with it ON it answers
// 200 (an unknown coach → []). No error status on the ON path, so no console noise on every page that asks.
export const meta = { tags: ['coaches'], description: 'coach-gate-v1-7d1e: 404 COACH_NOT_AVAILABLE when coaching is off', requireCredential: false, res: { type: 'array', optional: false, nullable: false, items: { type: 'object', optional: false, nullable: false } }, errors: coachErrors } as const;
export const paramDef = { type: 'object', properties: { userId: { type: 'string', format: 'misskey:id' } }, required: ['userId'] } as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private coachScheduleService: CoachScheduleService) {
		super(meta, paramDef, async (ps, me) => {
			if (!this.coachScheduleService.enabled()) throw new ApiError(coachErrors.notAvailable);
			try {
				const rows = await this.coachScheduleService.listPublic(ps.userId, me ?? null);
				return await Promise.all(rows.map(s => this.coachScheduleService.packSchedule(s, me ?? null)));
			} catch (e) { return toApiError(e); }
		});
	}
}

/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { CoachScheduleService } from '@/modules/coaches/CoachScheduleService.js';
import { coachErrors, toApiError } from './_shared.js';

// COACHING-V1 — a coach's self-written "About / qualifications". Display only; nobody verifies or gates on it.
export const meta = { tags: ['coaches'], requireCredential: false, res: { type: 'object', optional: false, nullable: false }, errors: coachErrors } as const;
export const paramDef = { type: 'object', properties: { userId: { type: 'string', format: 'misskey:id' } }, required: ['userId'] } as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private coachScheduleService: CoachScheduleService) {
		super(meta, paramDef, async (ps) => {
			try { return await this.coachScheduleService.getCoachProfile(ps.userId); }
			catch (e) { return toApiError(e); }
		});
	}
}

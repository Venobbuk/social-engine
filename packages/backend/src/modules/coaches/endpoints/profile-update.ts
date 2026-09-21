/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { CoachScheduleService } from '@/modules/coaches/CoachScheduleService.js';
import { coachErrors, toApiError } from './_shared.js';

// COACHING-V1 — the coach writes their own "About / qualifications". No verification, no gate; it just displays.
export const meta = { tags: ['coaches'], requireCredential: true, kind: 'write:account', res: { type: 'object', optional: false, nullable: false }, errors: coachErrors } as const;
export const paramDef = { type: 'object', properties: { about: { type: 'string', nullable: true, maxLength: 2000 } }, required: ['about'] } as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private coachScheduleService: CoachScheduleService) {
		super(meta, paramDef, async (ps, me) => {
			try { return await this.coachScheduleService.setCoachProfile(me, ps.about ?? null); }
			catch (e) { return toApiError(e); }
		});
	}
}

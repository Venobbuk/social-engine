/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { CoachService } from '@/modules/coaches/CoachService.js';
import { coachErrors, toApiError } from './_shared.js';

// COACH-VERIFY-V1 — see modules/coaches/CoachService.ts.
// "Ask GripBat staff to verify me": the details are already the native profile fields (i/update), this records the
// APPLICATION and tells staff. Idempotent — a pending application, or the role, just comes back.
export const meta = {
	tags: ['coaches'],
	requireCredential: true,
	kind: 'write:account',
	res: { type: 'object', optional: false, nullable: false },
	errors: coachErrors,
} as const;

export const paramDef = { type: 'object', properties: {}, required: [] } as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private coachService: CoachService) {
		super(meta, paramDef, async (ps, me) => {
			try {
				return await this.coachService.apply(me);
			} catch (e) {
				return toApiError(e);
			}
		});
	}
}

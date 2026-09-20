/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { CoachService } from '@/modules/coaches/CoachService.js';
import { coachErrors, toApiError } from './_shared.js';

// COACH-VERIFY-V1 — my own application: 'none' | 'pending' | 'approved' | 'rejected', with my details and (after a
// decline) when I may apply again. The player's own coach screen reads THIS, never their profile fields, so
// "Waiting to be verified" is a fact the engine states and not a guess from what they typed about themselves.
export const meta = {
	tags: ['coaches'],
	requireCredential: true,
	kind: 'read:account',
	res: { type: 'object', optional: false, nullable: false },
	errors: coachErrors,
} as const;

export const paramDef = { type: 'object', properties: {}, required: [] } as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private coachService: CoachService) {
		super(meta, paramDef, async (ps, me) => {
			try {
				return await this.coachService.mine(me.id);
			} catch (e) {
				return toApiError(e);
			}
		});
	}
}

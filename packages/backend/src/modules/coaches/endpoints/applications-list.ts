/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { CoachService } from '@/modules/coaches/CoachService.js';
import { coachErrors, toApiError } from './_shared.js';

// COACH-VERIFY-V1 — the staff queue, the same shape and the same auth as clubs/claims/list.
// STAFF-ROLE-V1: holders of the GripBat staff role only (CoachService checks it; NOT_GRIPBAT_STAFF 403) — NOT Misskey
// moderators, which is the whole reason this door exists (admin/roles/assign is requireModerator:true).
// status 'pending' = the work to do; 'approved' = the verified coaches, so staff can take a badge back.
export const meta = {
	tags: ['coaches'],
	requireCredential: true,
	kind: 'read:account',
	res: { type: 'array', optional: false, nullable: false, items: { type: 'object', optional: false, nullable: false } },
	errors: coachErrors,
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		status: { type: 'string', enum: ['pending', 'approved'], default: 'pending' },
		limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
	},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private coachService: CoachService) {
		super(meta, paramDef, async (ps, me) => {
			try {
				return await this.coachService.list(me, ps.status, ps.limit);
			} catch (e) {
				return toApiError(e);
			}
		});
	}
}

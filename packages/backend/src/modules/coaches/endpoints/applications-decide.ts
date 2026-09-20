/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { CoachService } from '@/modules/coaches/CoachService.js';
import { coachErrors, toApiError } from './_shared.js';

// COACH-VERIFY-V1 — the staff decision, the same shape and the same auth as clubs/claims/decide.
// approve:true  -> the NATIVE Coach role is assigned (RoleService.assign — the row admin/roles/assign writes).
// approve:false -> declined; on an already-approved application the role is taken back. That is the revoke half.
// STAFF-ROLE-V1: holders of the GripBat staff role only (NOT_GRIPBAT_STAFF 403).
export const meta = {
	tags: ['coaches'],
	requireCredential: true,
	kind: 'write:account',
	res: { type: 'object', optional: false, nullable: false },
	errors: coachErrors,
} as const;

export const paramDef = {
	type: 'object',
	properties: { claimId: { type: 'string' }, approve: { type: 'boolean' } },
	required: ['claimId', 'approve'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private coachService: CoachService) {
		super(meta, paramDef, async (ps, me) => {
			try {
				return await this.coachService.decide(ps.claimId, ps.approve, me);
			} catch (e) {
				return toApiError(e);
			}
		});
	}
}

/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ClubService } from '@/modules/clubs/ClubService.js';
import { clubErrors, toApiError } from './_shared.js';

// CLUB-ADMIN-V1 — see modules/clubs/ClubService.ts
// STAFF-ROLE-V1: holders of the GripBat staff role only (ClubService checks it; NOT_GRIPBAT_STAFF 403) — not Misskey moderators.
// CLUB-CLAIM-VERIFY-V1: staff approve (sets the owner) or reject an ownership claim.
export const meta = {
	tags: ['clubs'],
	requireCredential: true,
	kind: 'write:channels',
	res: { type: 'object', optional: false, nullable: false },
	errors: clubErrors,
} as const;

export const paramDef = {
	type: 'object',
	properties: { claimId: { type: 'string' }, approve: { type: 'boolean' } },
	required: ['claimId', 'approve'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private clubService: ClubService) {
		super(meta, paramDef, async (ps, me) => {
			try {
				return await this.clubService.claimsDecide(ps.claimId, ps.approve, me);
			} catch (e) {
				return toApiError(e);
			}
		});
	}
}

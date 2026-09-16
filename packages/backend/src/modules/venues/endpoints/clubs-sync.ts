/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { VenueService } from '@/modules/venues/VenueService.js';
import { ApiError } from '@/server/api/error.js';
import { venueErrors } from './_shared.js';

// CLUB-SYNC-V1 (W4.6): hkpl POSTs its active Club rows per tenant; each becomes (or updates) a channel keyed by
// externalRef hkpl:<tenantId>:<clubId>. Same S2S secret as venues; unset → fails closed.
export const meta = {
	tags: ['venues', 'adapter'],
	requireCredential: false,
	res: { type: 'object', optional: false, nullable: false, properties: {
		created: { type: 'number', optional: false, nullable: false },
		updated: { type: 'number', optional: false, nullable: false },
		archived: { type: 'number', optional: false, nullable: false },
	} },
	errors: { unauthorized: venueErrors.unauthorized, unconfigured: venueErrors.unconfigured },
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		tenantId: { type: 'string', minLength: 1, maxLength: 64 },
		clubs: { type: 'array', maxItems: 1000, items: { type: 'object', properties: {
			externalRef: { type: 'string', minLength: 1, maxLength: 32 },
			name: { type: 'string', minLength: 1, maxLength: 128 },
			description: { type: 'string', nullable: true, maxLength: 2048 },
			active: { type: 'boolean', default: true },
		}, required: ['externalRef', 'name'] } },
	},
	required: ['tenantId', 'clubs'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private venueService: VenueService) {
		super(meta, paramDef, async (ps, me, token, file, cleanup, ip, headers) => {
			if (!this.venueService.s2sConfigured()) throw new ApiError(meta.errors.unconfigured);
			if (!this.venueService.s2sAuthorized(headers)) throw new ApiError(meta.errors.unauthorized);
			return await this.venueService.upsertClubs(ps.tenantId, ps.clubs);
		});
	}
}

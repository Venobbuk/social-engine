/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { VenueService } from '@/modules/venues/VenueService.js';
import { ApiError } from '@/server/api/error.js';
import { venueErrors } from './_shared.js';

// VENUE-V1 (W4.2): the one-way sync door. hkpl POSTs its approved+active Venue rows per tenant with the shared
// S2S secret in x-social-secret; they land as league-curated, Verified venues. Unset secret → fails closed.
export const meta = {
	tags: ['venues', 'adapter'],
	requireCredential: false,
	res: { type: 'object', optional: false, nullable: false, properties: {
		created: { type: 'number', optional: false, nullable: false },
		updated: { type: 'number', optional: false, nullable: false },
		closed: { type: 'number', optional: false, nullable: false },
	} },
	errors: { unauthorized: venueErrors.unauthorized, unconfigured: venueErrors.unconfigured },
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		tenantId: { type: 'string', minLength: 1, maxLength: 64 },
		venues: { type: 'array', maxItems: 500, items: { type: 'object', properties: {
			externalRef: { type: 'string', minLength: 1, maxLength: 64 },
			name: { type: 'string', minLength: 1, maxLength: 256 },
			address: { type: 'string', nullable: true, maxLength: 512 },
			district: { type: 'string', nullable: true, maxLength: 128 },
			city: { type: 'string', nullable: true, maxLength: 128 },
			country: { type: 'string', nullable: true, maxLength: 2 },
			lat: { type: 'number', nullable: true, minimum: -90, maximum: 90 },
			lng: { type: 'number', nullable: true, minimum: -180, maximum: 180 },
			googlePlaceId: { type: 'string', nullable: true, maxLength: 256 },
			amapPlaceId: { type: 'string', nullable: true, maxLength: 256 },
			courtCount: { type: 'integer', nullable: true, minimum: 0, maximum: 500 },
			active: { type: 'boolean', default: true },
		}, required: ['externalRef', 'name'] } },
	},
	required: ['tenantId', 'venues'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private venueService: VenueService) {
		super(meta, paramDef, async (ps, me, token, file, cleanup, ip, headers) => {
			if (!this.venueService.s2sConfigured()) throw new ApiError(meta.errors.unconfigured);
			if (!this.venueService.s2sAuthorized(headers)) throw new ApiError(meta.errors.unauthorized);
			return await this.venueService.upsertFromLeague(ps.tenantId, ps.venues);
		});
	}
}

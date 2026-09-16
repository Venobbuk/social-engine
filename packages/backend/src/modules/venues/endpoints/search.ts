/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { VenueService } from '@/modules/venues/VenueService.js';
import { packVenue } from './_shared.js';

// VENUE-V1: nearby / keyword venue search (Reclub Venues pane). Verified only unless includeUnderReview.
export const meta = {
	tags: ['venues'],
	requireCredential: false,
	res: { type: 'array', optional: false, nullable: false, items: { type: 'object', optional: false, nullable: false, ref: 'Venue' } },
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		q: { type: 'string', nullable: true, maxLength: 128 },
		lat: { type: 'number', nullable: true, minimum: -90, maximum: 90 },
		lng: { type: 'number', nullable: true, minimum: -180, maximum: 180 },
		radiusKm: { type: 'number', nullable: true, minimum: 1, maximum: 80 },
		includeUnderReview: { type: 'boolean', default: false },
		limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
	},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private venueService: VenueService) {
		super(meta, paramDef, async (ps) => {
			const rows = await this.venueService.search({ q: ps.q, lat: ps.lat, lng: ps.lng, radiusKm: ps.radiusKm, includeUnderReview: ps.includeUnderReview, limit: ps.limit });
			return rows.map(packVenue);
		});
	}
}

/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { VenueService } from '@/modules/venues/VenueService.js';
import { venueErrors, toVenueApiError } from './_shared.js';

// Reclub GET /venues/autocomplete {query, sessionToken, language, country, latitude, longitude} — Google Places (New).
// Fails closed with VENUE_PLACES_UNCONFIGURED until GOOGLE_PLACES_API_KEY is set (licence: operator's call).
export const meta = {
	tags: ['venues'],
	requireCredential: true,
	kind: 'read:meets',
	res: { type: 'array', optional: false, nullable: false, items: { type: 'object', optional: false, nullable: false, properties: {
		externalId: { type: 'string', optional: false, nullable: false },
		primary: { type: 'string', optional: false, nullable: false },
		secondary: { type: 'string', optional: false, nullable: false },
	} } },
	errors: { placesUnconfigured: venueErrors.placesUnconfigured, placesFailed: venueErrors.placesFailed },
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		query: { type: 'string', minLength: 1, maxLength: 200 },
		sessionToken: { type: 'string', nullable: true, maxLength: 64 },
		language: { type: 'string', nullable: true, maxLength: 10 },
		country: { type: 'string', nullable: true, minLength: 2, maxLength: 2 },
		lat: { type: 'number', nullable: true, minimum: -90, maximum: 90 },
		lng: { type: 'number', nullable: true, minimum: -180, maximum: 180 },
	},
	required: ['query'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private venueService: VenueService) {
		super(meta, paramDef, async (ps) => {
			try {
				return await this.venueService.autocomplete({ input: ps.query, sessionToken: ps.sessionToken, language: ps.language, country: ps.country, lat: ps.lat, lng: ps.lng });
			} catch (e) {
				return toVenueApiError(e);
			}
		});
	}
}

/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { VenueService } from '@/modules/venues/VenueService.js';
import { venueErrors, toVenueApiError } from './_shared.js';

// Reclub GET /venues/autocomplete/select {externalId, sessionToken}: one place → name/address/lat/lng for venues/create.
export const meta = {
	tags: ['venues'],
	requireCredential: true,
	kind: 'read:meets',
	res: { type: 'object', optional: false, nullable: false, properties: {
		externalId: { type: 'string', optional: false, nullable: false },
		name: { type: 'string', optional: false, nullable: false },
		address: { type: 'string', optional: false, nullable: true },
		lat: { type: 'number', optional: false, nullable: false },
		lng: { type: 'number', optional: false, nullable: false },
		country: { type: 'string', optional: false, nullable: true },
		district: { type: 'string', optional: false, nullable: true },
		city: { type: 'string', optional: false, nullable: true },
	} },
	errors: { placesUnconfigured: venueErrors.placesUnconfigured, placesFailed: venueErrors.placesFailed },
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		externalId: { type: 'string', minLength: 1, maxLength: 256 },
		sessionToken: { type: 'string', nullable: true, maxLength: 64 },
	},
	required: ['externalId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private venueService: VenueService) {
		super(meta, paramDef, async (ps) => {
			try {
				return await this.venueService.resolvePlace(ps.externalId, ps.sessionToken);
			} catch (e) {
				return toVenueApiError(e);
			}
		});
	}
}

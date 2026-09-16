/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { VenueService } from '@/modules/venues/VenueService.js';
import { venueErrors, packVenue, toVenueApiError } from './_shared.js';

// VENUE-V1 community path: a signed-in player adds a place (from Places autocomplete or a pin) → Under Review.
export const meta = {
	tags: ['venues'],
	requireCredential: true,
	prohibitMoved: true,
	kind: 'write:meets',
	res: { type: 'object', optional: false, nullable: false, ref: 'Venue' },
	errors: { ...venueErrors },
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		name: { type: 'string', minLength: 1, maxLength: 256 },
		address: { type: 'string', nullable: true, maxLength: 512 },
		lat: { type: 'number', minimum: -90, maximum: 90 },
		lng: { type: 'number', minimum: -180, maximum: 180 },
		externalId: { type: 'string', nullable: true, maxLength: 256 },
		country: { type: 'string', nullable: true, minLength: 2, maxLength: 2 },
		district: { type: 'string', nullable: true, maxLength: 128 },
		city: { type: 'string', nullable: true, maxLength: 128 },
	},
	required: ['name', 'lat', 'lng'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private venueService: VenueService) {
		super(meta, paramDef, async (ps, me) => {
			try {
				return packVenue(await this.venueService.createCommunity(me, ps));
			} catch (e) {
				return toVenueApiError(e);
			}
		});
	}
}

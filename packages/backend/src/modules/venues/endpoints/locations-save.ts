/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { VenueService } from '@/modules/venues/VenueService.js';
import { venueErrors, packLocation, toVenueApiError } from './_shared.js';

// Save a discovery location. home / work replace themselves; favourites accumulate (max 20). radius 1–80 km (Reclub).
export const meta = {
	tags: ['venues'],
	requireCredential: true,
	prohibitMoved: true,
	kind: 'write:account',
	res: { type: 'object', optional: false, nullable: false, ref: 'UserLocation' },
	errors: { tooManyLocations: venueErrors.tooManyLocations },
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		id: { type: 'string', format: 'misskey:id', nullable: true },
		kind: { type: 'string', enum: ['home', 'work', 'favourite'], default: 'favourite' },
		label: { type: 'string', minLength: 1, maxLength: 128 },
		address: { type: 'string', nullable: true, maxLength: 512 },
		lat: { type: 'number', minimum: -90, maximum: 90 },
		lng: { type: 'number', minimum: -180, maximum: 180 },
		radiusKm: { type: 'integer', nullable: true, minimum: 1, maximum: 80 },
	},
	required: ['label', 'lat', 'lng'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private venueService: VenueService) {
		super(meta, paramDef, async (ps, me) => {
			try {
				return packLocation(await this.venueService.saveLocation(me, ps));
			} catch (e) {
				return toVenueApiError(e);
			}
		});
	}
}

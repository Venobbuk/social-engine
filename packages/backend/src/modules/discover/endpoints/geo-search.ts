/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import ms from 'ms';
import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { HttpRequestService } from '@/core/HttpRequestService.js';
import { ApiError } from '@/server/api/error.js';
import { geoSearch } from '@/modules/discover/geocode.js';
import { geoHitSchema, geoErrors } from './_shared.js';

// DISCOVER-W2D: Reclub "Enter location" address predictions (select-location, account/upsert-location, venues/create).
// A pasted map link or "lat, lng" answers at once; an address / place name goes to the geocoder (see ../geocode.ts).
// Public: a signed-out visitor picks a Discover location too. An empty array = "There are no results".
export const meta = {
	tags: ['discover'],
	requireCredential: false,
	limit: { duration: ms('1minute'), max: 60 },
	res: { type: 'array', optional: false, nullable: false, items: geoHitSchema },
	errors: { geocoderFailed: geoErrors.geocoderFailed },
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		query: { type: 'string', minLength: 1, maxLength: 300 },
		lat: { type: 'number', nullable: true, minimum: -90, maximum: 90 },
		lng: { type: 'number', nullable: true, minimum: -180, maximum: 180 },
		language: { type: 'string', nullable: true, maxLength: 10 },
		limit: { type: 'integer', minimum: 1, maximum: 10, default: 6 },
	},
	required: ['query'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private httpRequestService: HttpRequestService) {
		super(meta, paramDef, async (ps) => {
			try {
				return await geoSearch(this.httpRequestService, { query: ps.query, lat: ps.lat, lng: ps.lng, language: ps.language, limit: ps.limit });
			} catch (e) {
				throw new ApiError(geoErrors.geocoderFailed);
			}
		});
	}
}

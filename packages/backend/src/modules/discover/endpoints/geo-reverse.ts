/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import ms from 'ms';
import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { HttpRequestService } from '@/core/HttpRequestService.js';
import { ApiError } from '@/server/api/error.js';
import { geoReverse } from '@/modules/discover/geocode.js';
import { geoHitSchema, geoErrors } from './_shared.js';

// DISCOVER-W2D: Reclub location map picker — the street address under the pin as the map settles (C-map-picker.02).
// null when the point has no address (open sea).
export const meta = {
	tags: ['discover'],
	requireCredential: false,
	limit: { duration: ms('1minute'), max: 60 },
	res: { ...geoHitSchema, nullable: true },
	errors: { geocoderFailed: geoErrors.geocoderFailed },
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		lat: { type: 'number', minimum: -90, maximum: 90 },
		lng: { type: 'number', minimum: -180, maximum: 180 },
		language: { type: 'string', nullable: true, maxLength: 10 },
	},
	required: ['lat', 'lng'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private httpRequestService: HttpRequestService) {
		super(meta, paramDef, async (ps) => {
			try {
				return await geoReverse(this.httpRequestService, { lat: ps.lat, lng: ps.lng, language: ps.language });
			} catch (e) {
				throw new ApiError(geoErrors.geocoderFailed);
			}
		});
	}
}

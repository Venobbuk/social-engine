/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// DISCOVER-W2D — shapes and errors shared by the discover doors (geo/*, clubs/discover, discover/search, social/badges).

export const geoErrors = {
	geocoderFailed: { message: 'Address search is unavailable right now.', code: 'GEOCODER_FAILED', id: '5d7a2c90-3f1e-4b8a-9e61-7a0000000001' },
} as const;

export const geoHitSchema = {
	type: 'object', optional: false, nullable: false,
	properties: {
		label: { type: 'string', optional: false, nullable: false },
		address: { type: 'string', optional: false, nullable: true },
		lat: { type: 'number', optional: false, nullable: false },
		lng: { type: 'number', optional: false, nullable: false },
		source: { type: 'string', optional: false, nullable: false, enum: ['link', 'places', 'photon'] },
		externalId: { type: 'string', optional: false, nullable: true },
		kind: { type: 'string', optional: false, nullable: true },
	},
} as const;

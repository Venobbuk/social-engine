/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export const packedVenueSchema = {
	type: 'object',
	properties: {
		id: { type: 'string', optional: false, nullable: false, format: 'id' },
		name: { type: 'string', optional: false, nullable: false },
		address: { type: 'string', optional: false, nullable: true },
		district: { type: 'string', optional: false, nullable: true },
		city: { type: 'string', optional: false, nullable: true },
		country: { type: 'string', optional: false, nullable: false },
		lat: { type: 'number', optional: false, nullable: true },
		lng: { type: 'number', optional: false, nullable: true },
		externalId: { type: 'string', optional: false, nullable: true },
		source: { type: 'string', optional: false, nullable: false, enum: ['league', 'community'] },
		curatedByTenant: { type: 'string', optional: false, nullable: true },
		status: { type: 'string', optional: false, nullable: false, enum: ['verified', 'under_review', 'closed'] },
		ownerUserId: { type: 'string', optional: false, nullable: true, format: 'id' },
		courtCount: { type: 'number', optional: false, nullable: true },
		distanceKm: { type: 'number', optional: true, nullable: true },
		updatedAt: { type: 'string', optional: false, nullable: false, format: 'date-time' },
	},
} as const;

export const packedUserLocationSchema = {
	type: 'object',
	properties: {
		id: { type: 'string', optional: false, nullable: false, format: 'id' },
		kind: { type: 'string', optional: false, nullable: false, enum: ['home', 'work', 'favourite'] },
		label: { type: 'string', optional: false, nullable: false },
		address: { type: 'string', optional: false, nullable: true },
		lat: { type: 'number', optional: false, nullable: false },
		lng: { type: 'number', optional: false, nullable: false },
		radiusKm: { type: 'number', optional: false, nullable: false },
		updatedAt: { type: 'string', optional: false, nullable: false, format: 'date-time' },
	},
} as const;

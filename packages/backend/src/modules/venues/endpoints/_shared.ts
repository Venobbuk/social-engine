/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { IdentifiableError } from '@/misc/identifiable-error.js';
import { ApiError } from '@/server/api/error.js';
import type { Packed } from '@/misc/json-schema.js';
import type { MiVenue } from '@/modules/venues/models/Venue.js';
import type { MiUserLocation } from '@/modules/venues/models/UserLocation.js';

export const venueErrors = {
	noSuchVenue: { message: 'No such venue.', code: 'NO_SUCH_VENUE', id: '7c2e1b4f-9a52-4d1c-8c8f-2b0000000001' },
	unauthorized: { message: 'Unauthorized.', code: 'ADAPTER_UNAUTHORIZED', id: '7c2e1b4f-9a52-4d1c-8c8f-2b0000000002' },
	unconfigured: { message: 'This door is not configured on this server.', code: 'ADAPTER_UNCONFIGURED', id: '7c2e1b4f-9a52-4d1c-8c8f-2b0000000003' },
	placesUnconfigured: { message: 'Venue search is not configured on this server.', code: 'VENUE_PLACES_UNCONFIGURED', id: '7c2e1b4f-9a52-4d1c-8c8f-2b0000000004' },
	placesFailed: { message: 'Venue search failed.', code: 'VENUE_PLACES_FAILED', id: '7c2e1b4f-9a52-4d1c-8c8f-2b0000000005' },
	tooManyLocations: { message: 'You can save up to 20 locations.', code: 'VENUE_TOO_MANY_LOCATIONS', id: '7c2e1b4f-9a52-4d1c-8c8f-2b0000000006' },
} as const;

const map: Record<string, keyof typeof venueErrors> = {
	'venue:no_such_venue': 'noSuchVenue',
	'venue:places_unconfigured': 'placesUnconfigured',
	'venue:places_failed': 'placesFailed',
	'venue:too_many_locations': 'tooManyLocations',
};

export function toVenueApiError(e: unknown): never {
	if (e instanceof IdentifiableError && map[e.id]) throw new ApiError({ ...venueErrors[map[e.id]], message: e.message || venueErrors[map[e.id]].message });
	throw e;
}

export function packVenue(v: MiVenue & { distanceKm?: number | null }): Packed<'Venue'> {
	return {
		id: v.id,
		name: v.name,
		address: v.address,
		district: v.district,
		city: v.city,
		country: v.country,
		lat: v.lat,
		lng: v.lng,
		externalId: v.externalId,
		source: v.source,
		curatedByTenant: v.curatedByTenant,
		status: v.status,
		ownerUserId: v.ownerUserId,
		courtCount: v.courtCount,
		distanceKm: v.distanceKm ?? null,
		updatedAt: v.updatedAt.toISOString(),
	};
}

export function packLocation(l: MiUserLocation): Packed<'UserLocation'> {
	return { id: l.id, kind: l.kind, label: l.label, address: l.address, lat: l.lat, lng: l.lng, radiusKm: l.radiusKm, updatedAt: l.updatedAt.toISOString() };
}

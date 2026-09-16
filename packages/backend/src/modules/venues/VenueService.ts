/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { DI } from '@/di-symbols.js';
import type { VenuesRepository, UserLocationsRepository, ChannelsRepository } from '@/models/_.js';
import type { MiChannel } from '@/models/Channel.js';
import type { MiVenue } from '@/modules/venues/models/Venue.js';
import type { MiUserLocation } from '@/modules/venues/models/UserLocation.js';
import type { MiUser } from '@/models/User.js';
import { IdService } from '@/core/IdService.js';
import { HttpRequestService } from '@/core/HttpRequestService.js';
import { IdentifiableError } from '@/misc/identifiable-error.js';
import { bindThis } from '@/decorators.js';

// The hkpl ↔ engine server-to-server secret is ONE fact (ADAPTER_HKPL_S2S_SECRET), used in both directions:
// the engine sends it to hkpl (MeetMatchService) and hkpl sends it here (adapter/venues/sync, adapter/clubs/sync).
const S2S_SECRET = process.env.ADAPTER_HKPL_S2S_SECRET ?? '';
// Google Places (New). UNVERIFIED licence for storing name/address/lat/lng of community-added venues beyond the
// 30-day cache window (place ids may be stored indefinitely). Unset key → autocomplete answers 'unconfigured'.
const PLACES_KEY = process.env.GOOGLE_PLACES_API_KEY ?? '';

export type LeagueVenueInput = {
	externalRef: string; name: string; address?: string | null; district?: string | null; city?: string | null;
	country?: string | null; lat?: number | null; lng?: number | null; googlePlaceId?: string | null; amapPlaceId?: string | null;
	courtCount?: number | null; active?: boolean;
};

@Injectable()
export class VenueService {
	constructor(
		@Inject(DI.venuesRepository)
		private venuesRepository: VenuesRepository,

		@Inject(DI.userLocationsRepository)
		private userLocationsRepository: UserLocationsRepository,

		@Inject(DI.channelsRepository)
		private channelsRepository: ChannelsRepository,

		private idService: IdService,
		private httpRequestService: HttpRequestService,
	) {
	}

	private err(id: string, message: string): IdentifiableError {
		return new IdentifiableError(`venue:${id}`, message);
	}

	/** Constant-time check of the S2S header. Unset secret → false (fail closed). */
	@bindThis
	public s2sAuthorized(headers: Record<string, string> | null | undefined): boolean {
		if (!S2S_SECRET) return false;
		const given = headers?.['x-social-secret'] ?? '';
		const a = Buffer.from(given), b = Buffer.from(S2S_SECRET);
		return a.length === b.length && timingSafeEqual(a, b);
	}

	@bindThis
	public s2sConfigured(): boolean { return S2S_SECRET.length > 0; }

	// ------------------------------------------------------------------------------- venues
	@bindThis
	public async show(id: string): Promise<MiVenue | null> {
		return await this.venuesRepository.findOneBy({ id });
	}

	/** Nearby / keyword search. Bounding box + haversine, as meets/list. Verified first, then under review. */
	@bindThis
	public async search(opts: { q?: string | null; lat?: number | null; lng?: number | null; radiusKm?: number | null; includeUnderReview?: boolean; limit?: number }): Promise<(MiVenue & { distanceKm: number | null })[]> {
		const q = this.venuesRepository.createQueryBuilder('v').where('v.status <> :closed', { closed: 'closed' });
		if (!opts.includeUnderReview) q.andWhere('v.status = :verified', { verified: 'verified' });
		if (opts.q) q.andWhere('(v.name ILIKE :kw OR v.address ILIKE :kw OR v.district ILIKE :kw)', { kw: `%${opts.q.replace(/[%_]/g, '')}%` });
		let distanceExpr: string | null = null;
		if (opts.lat != null && opts.lng != null) {
			const radius = opts.radiusKm ?? 20;
			const dLat = radius / 111, dLng = radius / (111 * Math.max(0.1, Math.cos(opts.lat * Math.PI / 180)));
			q.andWhere('v.lat BETWEEN :latMin AND :latMax AND v.lng BETWEEN :lngMin AND :lngMax', { latMin: opts.lat - dLat, latMax: opts.lat + dLat, lngMin: opts.lng - dLng, lngMax: opts.lng + dLng });
			distanceExpr = `(6371 * acos(least(1, cos(radians(${opts.lat})) * cos(radians(v.lat)) * cos(radians(v.lng) - radians(${opts.lng})) + sin(radians(${opts.lat})) * sin(radians(v.lat)))))`;
			q.addSelect(distanceExpr, 'distance_km').andWhere(`${distanceExpr} <= :radius`, { radius }).orderBy('distance_km', 'ASC');
		} else {
			q.orderBy('v.status', 'DESC').addOrderBy('v.name', 'ASC'); // 'verified' > 'under_review' alphabetically
		}
		q.take(Math.min(opts.limit ?? 50, 200));
		const { entities, raw } = await q.getRawAndEntities();
		return entities.map((v, i) => Object.assign(v, { distanceKm: distanceExpr ? Number(raw[i].distance_km) : null }));
	}

	/**
	 * One-way sync from a league tenant (hkpl `Venue` rows, approved + active). Upsert on (league, tenant,
	 * externalRef); an inactive row becomes 'closed'. A league-curated venue is Verified by definition (D13).
	 */
	@bindThis
	public async upsertFromLeague(tenantId: string, rows: LeagueVenueInput[]): Promise<{ created: number; updated: number; closed: number }> {
		const out = { created: 0, updated: 0, closed: 0 };
		for (const r of rows) {
			const existing = await this.venuesRepository.findOneBy({ source: 'league', curatedByTenant: tenantId, externalRef: r.externalRef });
			const status = r.active === false ? 'closed' : 'verified';
			const fields = {
				name: r.name.slice(0, 256),
				address: r.address?.slice(0, 512) ?? null,
				district: r.district?.slice(0, 128) ?? null,
				city: r.city?.slice(0, 128) ?? null,
				country: (r.country ?? 'HK').slice(0, 2).toUpperCase(),
				lat: r.lat ?? null,
				lng: r.lng ?? null,
				externalId: r.googlePlaceId ?? null,
				amapPlaceId: r.amapPlaceId ?? null,
				courtCount: r.courtCount ?? null,
				status,
				updatedAt: new Date(),
			} as const;
			if (existing) {
				await this.venuesRepository.update(existing.id, fields);
				if (status === 'closed') out.closed++; else out.updated++;
			} else {
				await this.venuesRepository.insertOne({ id: this.idService.gen(), source: 'league', curatedByTenant: tenantId, externalRef: r.externalRef, ownerUserId: null, notes: null, createdById: null, createdAt: new Date(), ...fields });
				if (status === 'closed') out.closed++; else out.created++;
			}
		}
		return out;
	}

	/** Community path: a player adds a place → Under Review. Same Google place id → the existing row. */
	@bindThis
	public async createCommunity(user: MiUser, data: { name: string; address?: string | null; lat: number; lng: number; externalId?: string | null; country?: string | null; district?: string | null; city?: string | null }): Promise<MiVenue> {
		if (data.externalId) {
			const dup = await this.venuesRepository.findOneBy({ externalId: data.externalId });
			if (dup) return dup;
		}
		return await this.venuesRepository.insertOne({
			id: this.idService.gen(),
			name: data.name.slice(0, 256),
			address: data.address?.slice(0, 512) ?? null,
			district: data.district?.slice(0, 128) ?? null,
			city: data.city?.slice(0, 128) ?? null,
			country: (data.country ?? 'HK').slice(0, 2).toUpperCase(),
			lat: data.lat,
			lng: data.lng,
			externalId: data.externalId ?? null,
			amapPlaceId: null,
			source: 'community',
			curatedByTenant: null,
			externalRef: null,
			status: 'under_review',
			ownerUserId: null,
			courtCount: null,
			notes: null,
			createdById: user.id,
			createdAt: new Date(),
			updatedAt: new Date(),
		});
	}

	/** Staff: verify / close / assign owner (Reclub venue-owner screen, module 7379). */
	@bindThis
	public async staffUpdate(id: string, patch: { status?: MiVenue['status']; ownerUserId?: string | null; notes?: string | null }): Promise<MiVenue> {
		const v = await this.venuesRepository.findOneBy({ id });
		if (!v) throw this.err('no_such_venue', 'No such venue.');
		await this.venuesRepository.update(id, { ...patch, updatedAt: new Date() });
		return await this.venuesRepository.findOneByOrFail({ id });
	}

	// ------------------------------------------------------------------------------- clubs (W4.6)
	/**
	 * CLUB-SYNC-V1: a league club becomes a channel (Reclub club ≈ Misskey channel: wall + members + meets via
	 * meet_group). Upsert on externalRef hkpl:<tenantId>:<clubId>; an inactive club is archived, not deleted.
	 */
	@bindThis
	public async upsertClubs(tenantId: string, rows: { externalRef: string; name: string; description?: string | null; active?: boolean }[]): Promise<{ created: number; updated: number; archived: number }> {
		const out = { created: 0, updated: 0, archived: 0 };
		for (const r of rows) {
			const ref = `hkpl:${tenantId}:${r.externalRef}`;
			const existing = await this.channelsRepository.findOneBy({ externalRef: ref });
			const isArchived = r.active === false;
			if (existing) {
				await this.channelsRepository.update(existing.id, { name: r.name.slice(0, 128), description: r.description?.slice(0, 2048) ?? null, isArchived });
				if (isArchived) out.archived++; else out.updated++;
			} else {
				await this.channelsRepository.insertOne({
					id: this.idService.gen(),
					userId: null,
					name: r.name.slice(0, 128),
					description: r.description?.slice(0, 2048) ?? null,
					bannerId: null,
					isSensitive: false,
					allowRenoteToExternal: true,
					isArchived,
					externalRef: ref,
				} as MiChannel);
				if (isArchived) out.archived++; else out.created++;
			}
		}
		return out;
	}

	// ------------------------------------------------------------------------------- Google Places (New)
	@bindThis
	public placesConfigured(): boolean { return PLACES_KEY.length > 0; }

	@bindThis
	public async autocomplete(opts: { input: string; sessionToken?: string | null; language?: string | null; country?: string | null; lat?: number | null; lng?: number | null }): Promise<{ externalId: string; primary: string; secondary: string }[]> {
		if (!PLACES_KEY) throw this.err('places_unconfigured', 'Venue search is not configured on this server.');
		const body: Record<string, unknown> = { input: opts.input.slice(0, 200) };
		if (opts.sessionToken) body.sessionToken = opts.sessionToken;
		if (opts.language) body.languageCode = opts.language;
		if (opts.country) body.includedRegionCodes = [opts.country.toLowerCase()];
		if (opts.lat != null && opts.lng != null) body.locationBias = { circle: { center: { latitude: opts.lat, longitude: opts.lng }, radius: 50_000 } };
		const res = await this.httpRequestService.send('https://places.googleapis.com/v1/places:autocomplete', {
			method: 'POST', headers: { 'content-type': 'application/json', 'X-Goog-Api-Key': PLACES_KEY }, body: JSON.stringify(body), timeout: 8_000,
		}, { throwErrorWhenResponseNotOk: false });
		const json = await res.json().catch(() => ({})) as { suggestions?: { placePrediction?: { placeId: string; structuredFormat?: { mainText?: { text?: string }; secondaryText?: { text?: string } }; text?: { text?: string } } }[] };
		if (res.status !== 200) throw this.err('places_failed', `Venue search failed (${res.status}).`);
		return (json.suggestions ?? []).map(s => s.placePrediction).filter((p): p is NonNullable<typeof p> => !!p).map(p => ({
			externalId: p.placeId,
			primary: p.structuredFormat?.mainText?.text ?? p.text?.text ?? '',
			secondary: p.structuredFormat?.secondaryText?.text ?? '',
		}));
	}

	@bindThis
	public async resolvePlace(externalId: string, sessionToken?: string | null): Promise<{ externalId: string; name: string; address: string | null; lat: number; lng: number; country: string | null; district: string | null; city: string | null }> {
		if (!PLACES_KEY) throw this.err('places_unconfigured', 'Venue search is not configured on this server.');
		const url = `https://places.googleapis.com/v1/places/${encodeURIComponent(externalId)}${sessionToken ? `?sessionToken=${encodeURIComponent(sessionToken)}` : ''}`;
		const res = await this.httpRequestService.send(url, {
			headers: { 'X-Goog-Api-Key': PLACES_KEY, 'X-Goog-FieldMask': 'id,displayName,formattedAddress,location,addressComponents' }, timeout: 8_000,
		}, { throwErrorWhenResponseNotOk: false });
		const j = await res.json().catch(() => ({})) as { id?: string; displayName?: { text?: string }; formattedAddress?: string; location?: { latitude: number; longitude: number }; addressComponents?: { longText?: string; shortText?: string; types?: string[] }[] };
		if (res.status !== 200 || !j.location) throw this.err('places_failed', `Venue lookup failed (${res.status}).`);
		const comp = (t: string, short = false) => j.addressComponents?.find(c => c.types?.includes(t))?.[short ? 'shortText' : 'longText'] ?? null;
		return {
			externalId: j.id ?? externalId,
			name: j.displayName?.text ?? '',
			address: j.formattedAddress ?? null,
			lat: j.location.latitude,
			lng: j.location.longitude,
			country: comp('country', true),
			district: comp('sublocality') ?? comp('neighborhood') ?? comp('administrative_area_level_2'),
			city: comp('locality') ?? comp('administrative_area_level_1'),
		};
	}

	// ------------------------------------------------------------------------------- saved locations
	@bindThis
	public async listLocations(user: MiUser): Promise<MiUserLocation[]> {
		return await this.userLocationsRepository.find({ where: { userId: user.id }, order: { kind: 'ASC', updatedAt: 'DESC' } });
	}

	/** home and work are singletons per user; favourites are many. */
	@bindThis
	public async saveLocation(user: MiUser, data: { id?: string | null; kind: MiUserLocation['kind']; label: string; address?: string | null; lat: number; lng: number; radiusKm?: number | null }): Promise<MiUserLocation> {
		const radiusKm = Math.max(1, Math.min(80, Math.round(data.radiusKm ?? 20)));
		let row = data.id ? await this.userLocationsRepository.findOneBy({ id: data.id, userId: user.id }) : null;
		if (!row && data.kind !== 'favourite') row = await this.userLocationsRepository.findOneBy({ userId: user.id, kind: data.kind });
		const fields = { kind: data.kind, label: data.label.slice(0, 128), address: data.address?.slice(0, 512) ?? null, lat: data.lat, lng: data.lng, radiusKm, updatedAt: new Date() };
		if (row) {
			await this.userLocationsRepository.update(row.id, fields);
			return await this.userLocationsRepository.findOneByOrFail({ id: row.id });
		}
		const n = await this.userLocationsRepository.countBy({ userId: user.id });
		if (n >= 20) throw this.err('too_many_locations', 'You can save up to 20 locations.');
		return await this.userLocationsRepository.insertOne({ id: this.idService.gen(), userId: user.id, ...fields });
	}

	@bindThis
	public async deleteLocation(user: MiUser, id: string): Promise<void> {
		await this.userLocationsRepository.delete({ id, userId: user.id });
	}
}

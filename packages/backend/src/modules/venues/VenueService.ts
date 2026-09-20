/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { DI } from '@/di-symbols.js';
import type { DataSource } from 'typeorm';
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

		@Inject(DI.db)
		private db: DataSource,

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

	// INT-BATCH2: the Google Places autocomplete / place-details path lived here (venues/autocomplete, venues/resolve).
	// Deleted — DISCOVER-W2D geo/search + geo/reverse are the ONE place door (map link / "lat, lng" -> Google Places when
	// GOOGLE_PLACES_API_KEY is set -> Photon/OSM without a key), and this one was key-only, so dead on this server.

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
		// DISCOVER-W2D (Reclub E-upsert-location.04 "Already Added — this location is already in your list"): no second
		// saved place on the same spot (within 50 m of another of my rows; the row being edited does not count)
		const others = await this.userLocationsRepository.findBy({ userId: user.id });
		if (others.some((o) => o.id !== row?.id && haversineKm(o.lat, o.lng, data.lat, data.lng) <= 0.05)) throw this.err('location_already_added', 'This location is already in your list.');
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
		// DISCOVER-W2D (Reclub E-locations.05 "Can't delete this location — you need at least one saved location")
		const row = await this.userLocationsRepository.findOneBy({ id, userId: user.id });
		if (!row) return;
		if (await this.userLocationsRepository.countBy({ userId: user.id }) <= 1) throw this.err('last_location', 'You need at least one saved location.');
		await this.userLocationsRepository.delete({ id, userId: user.id });
	}

	// ------------------------------------------------------------------------------- DISCOVER-V3: venue feedback + owner claim
	/**
	 * Reclub's venue feedback form (help:venue_subcategory_*) and the owner claim (Reclub: "Want a Verified Badge? Contact
	 * our Support team" — a claim is a feedback row of category owner_claim that staff resolve with staffUpdate ownerUserId).
	 * Raw SQL on the venue_feedback table (migration 1789060000000): no entity, so no shared registry file changes.
	 */
	@bindThis
	public async createFeedback(user: MiUser, data: { venueId: string; category: VenueFeedbackCategory; body?: string | null; replyRequested?: boolean }): Promise<VenueFeedbackRow> {
		const venue = await this.venuesRepository.findOneBy({ id: data.venueId });
		if (!venue) throw this.err('no_such_venue', 'No such venue.');
		if (data.category === 'owner_claim') {
			// one open claim per (venue, user): a second tap returns the pending one
			const open = await this.db.query('SELECT id FROM venue_feedback WHERE "venueId" = $1 AND "userId" = $2 AND category = $3 AND status = $4 LIMIT 1', [data.venueId, user.id, 'owner_claim', 'open']) as { id: string }[];
			if (open.length) return (await this.listFeedback({ venueId: data.venueId, userId: user.id })).find(r => r.id === open[0].id)!;
		}
		const id = this.idService.gen();
		await this.db.query('INSERT INTO venue_feedback (id, "venueId", "userId", category, body, "replyRequested", status, "createdAt") VALUES ($1, $2, $3, $4, $5, $6, $7, now())',
			[id, data.venueId, user.id, data.category, data.body?.slice(0, 2048) ?? null, !!data.replyRequested, 'open']);
		return (await this.listFeedback({ venueId: data.venueId, userId: user.id })).find(r => r.id === id)!;
	}

	/** My rows for a venue (the app shows "claim pending"), or every row for staff (userId null). */
	@bindThis
	public async listFeedback(opts: { venueId?: string | null; userId?: string | null; status?: string | null; limit?: number }): Promise<VenueFeedbackRow[]> {
		const where: string[] = []; const args: unknown[] = [];
		if (opts.venueId) { args.push(opts.venueId); where.push(`"venueId" = $${args.length}`); }
		if (opts.userId) { args.push(opts.userId); where.push(`"userId" = $${args.length}`); }
		if (opts.status) { args.push(opts.status); where.push(`status = $${args.length}`); }
		args.push(Math.min(opts.limit ?? 50, 200));
		const rows = await this.db.query(`SELECT id, "venueId", "userId", category, body, "replyRequested", status, "createdAt" FROM venue_feedback ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY "createdAt" DESC LIMIT $${args.length}`, args) as { id: string; venueId: string; userId: string; category: VenueFeedbackCategory; body: string | null; replyRequested: boolean; status: string; createdAt: Date }[];
		return rows.map(r => ({ id: r.id, venueId: r.venueId, userId: r.userId, category: r.category, body: r.body, replyRequested: !!r.replyRequested, status: r.status, createdAt: new Date(r.createdAt).toISOString() }));
	}

	/** Staff: close a feedback row. */
	@bindThis
	public async resolveFeedback(id: string): Promise<void> {
		await this.db.query('UPDATE venue_feedback SET status = $2 WHERE id = $1', [id, 'resolved']);
	}
}

/** DISCOVER-W2D: great-circle km between two points (the saved-location duplicate guard). */
function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
	const R = 6371, d2r = Math.PI / 180;
	const dLat = (bLat - aLat) * d2r, dLng = (bLng - aLng) * d2r;
	const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * d2r) * Math.cos(bLat * d2r) * Math.sin(dLng / 2) ** 2;
	return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export const venueFeedbackCategories = ['wrong_details', 'permanently_closed', 'safety_concern', 'incorrect_images', 'suspicious_fraudulent', 'owner_claim', 'other'] as const;
export type VenueFeedbackCategory = typeof venueFeedbackCategories[number];
export interface VenueFeedbackRow { id: string; venueId: string; userId: string; category: VenueFeedbackCategory; body: string | null; replyRequested: boolean; status: string; createdAt: string }

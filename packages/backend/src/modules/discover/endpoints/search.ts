/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DI } from '@/di-symbols.js';
import type { MeetsRepository, UsersRepository } from '@/models/_.js';
import { ChannelEntityService } from '@/core/entities/ChannelEntityService.js';
import { UserEntityService } from '@/core/entities/UserEntityService.js';
import { UserSearchService } from '@/core/UserSearchService.js';
import { MeetEntityService } from '@/modules/meets/MeetEntityService.js';
import { VenueService } from '@/modules/venues/VenueService.js';
import { packVenue } from '@/modules/venues/endpoints/_shared.js';
import { clubsNear } from '@/modules/discover/clubs-near.js';

// INT-BATCH2 × NUKE-COACH-V1: the native role a moderator grants to mark someone a Coach (migration 1789097100003).
const GB_COACH_ROLE_ID = 'arc5w1aagbcoach1';

// DISCOVER-W2D (Reclub triage C-discover.09): the Discover search bar — ONE keyword, ONE read, sectioned answers:
// Players · Clubs · Meets · Competitions · Venues · Coaches (Reclub's order), each capped at `per` rows. Meets, clubs
// and venues honour the chosen place + radius unless `global` (Reclub's "Global" toggle: ignore distance). Players,
// competitions and coaches are not placed. Only what Discover may already show: public upcoming meets (not casual),
// live clubs, open venues, public competitions past draft, active coaches, local users (native user search). Public.
export const meta = {
	tags: ['discover'],
	requireCredential: false,
	res: { type: 'object', optional: false, nullable: false },
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		q: { type: 'string', minLength: 1, maxLength: 128 },
		lat: { type: 'number', nullable: true, minimum: -90, maximum: 90 },
		lng: { type: 'number', nullable: true, minimum: -180, maximum: 180 },
		radiusKm: { type: 'number', nullable: true, minimum: 1, maximum: 500 },
		global: { type: 'boolean', default: false },
		sport: { type: 'string', nullable: true, maxLength: 32 },
		per: { type: 'integer', minimum: 1, maximum: 20, default: 5 },
	},
	required: ['q'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.db) private db: DataSource,
		@Inject(DI.meetsRepository) private meetsRepository: MeetsRepository,
		@Inject(DI.usersRepository) private usersRepository: UsersRepository,
		private channelEntityService: ChannelEntityService,
		private userEntityService: UserEntityService,
		private userSearchService: UserSearchService,
		private meetEntityService: MeetEntityService,
		private venueService: VenueService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const kw = ps.q.trim().replace(/[%_\\]/g, '');
			const empty = { q: ps.q, global: ps.global, players: [], clubs: [], meets: [], competitions: [], venues: [], coaches: [] };
			if (!kw) return empty;
			const like = `%${kw}%`;
			const per = ps.per;
			const placed = !ps.global && ps.lat != null && ps.lng != null;
			const radius = ps.radiusKm ?? 20;
			const sport = ps.sport ?? 'pickleball';

			// G11: players = the NATIVE user search (core/UserSearchService.ts:216 — name / username, active first, muted excluded)
			const players = this.userSearchService.search(kw, me?.id ?? null, { limit: per, origin: 'local' })
				.then((us) => this.userEntityService.packMany(us, me, { schema: 'UserLite' }));

			// review-batch2 #3: the viewer decides which private clubs may appear (an anonymous caller: none)
			const clubs = clubsNear(this.db, { q: kw, lat: placed ? ps.lat : null, lng: placed ? ps.lng : null, radiusKm: radius, limit: per, viewerId: me?.id ?? null })
				.then(async (rows) => {
					const out = [];
					for (const r of rows) { const c = await this.channelEntityService.pack(r.id, me, false).catch(() => null); if (c) out.push({ ...c, level: r.level, visibility: r.visibility, distanceKm: r.distanceKm, upcomingMeets: r.upcomingMeets }); }
					return out;
				});

			const mq = this.meetsRepository.createQueryBuilder('meet')
				.where('meet.status = :active', { active: 'active' })
				.andWhere('meet.visibility = :public', { public: 'public' })
				.andWhere('NOT (:casual = ANY(meet.flags))', { casual: 'casual' })
				.andWhere('meet.sport = :sport', { sport })
				.andWhere('meet.startAt + (meet.durationMinutes * interval \'1 minute\') >= :now', { now: new Date() })
				.andWhere('(meet.name ILIKE :like OR meet.venueName ILIKE :like)', { like });
			let distanceExpr: string | null = null;
			if (placed) {
				const lat = ps.lat as number, lng = ps.lng as number;
				const dLat = radius / 111, dLng = radius / (111 * Math.max(0.1, Math.cos(lat * Math.PI / 180)));
				mq.andWhere('meet.lat BETWEEN :latMin AND :latMax AND meet.lng BETWEEN :lngMin AND :lngMax', { latMin: lat - dLat, latMax: lat + dLat, lngMin: lng - dLng, lngMax: lng + dLng });
				distanceExpr = `(6371 * acos(least(1, cos(radians(${lat})) * cos(radians(meet.lat)) * cos(radians(meet.lng) - radians(${lng})) + sin(radians(${lat})) * sin(radians(meet.lat)))))`;
				mq.addSelect(distanceExpr, 'distance_km').andWhere(`${distanceExpr} <= :radius`, { radius });
			}
			mq.orderBy('meet.startAt', 'ASC').take(per);
			const meets = mq.getRawAndEntities().then(({ entities, raw }) => {
				const d = new Map<string, number>();
				if (distanceExpr) entities.forEach((m, i) => d.set(m.id, Number(raw[i].distance_km)));
				return this.meetEntityService.packMany(entities, me, d);
			});

			const competitions = this.db.query(`
				SELECT c.id, c.name, c."startAt", c."venueName", c.status, c."registrationOpenAt", c."registrationCloseAt", c."maxEntries"
				FROM competition c
				WHERE c.visibility = 'public' AND c.status NOT IN ('draft', 'cancelled') AND c.sport = $1
					AND (c.name ILIKE $2 OR c."venueName" ILIKE $2)
				ORDER BY (c."startAt" >= now() - interval '1 day') DESC, c."startAt" ASC
				LIMIT $3`, [sport, like, per]).then((rows: { id: string; name: string; startAt: Date; venueName: string | null; status: string; registrationOpenAt: Date | null; registrationCloseAt: Date | null; maxEntries: number }[]) =>
				rows.map((r) => ({ id: r.id, name: r.name, startAt: new Date(r.startAt).toISOString(), venueName: r.venueName, status: r.status, registrationOpenAt: r.registrationOpenAt ? new Date(r.registrationOpenAt).toISOString() : null, registrationCloseAt: r.registrationCloseAt ? new Date(r.registrationCloseAt).toISOString() : null, maxEntries: r.maxEntries })));

			const venues = this.venueService.search({ q: kw, lat: placed ? ps.lat : null, lng: placed ? ps.lng : null, radiusKm: Math.min(radius, 80), includeUnderReview: true, limit: per })
				.then((rows) => rows.map(packVenue));

			// INT-BATCH2 × NUKE-COACH-V1 (the coordination note on that commit): a Coach is no longer a self-declared
			// meet_player_level row (coachStatus / coachNotes — those columns are dropped). It is the native Misskey ROLE
			// a moderator grants (arc5w1aagbcoach1), and the details are the native profile fields. So: role holders whose
			// name or username matches, not suspended / deleted, unexpired grant. The role is per account, not per sport,
			// so `sport` no longer narrows this section (only pickleball exists — NUKE-COACH-V1 "Lost, listed").
			const coaches = this.db.query(`
				SELECT ra."userId" FROM role_assignment ra JOIN "user" u ON u.id = ra."userId"
				WHERE ra."roleId" = $1 AND (ra."expiresAt" IS NULL OR ra."expiresAt" > now())
					AND u."isSuspended" = false AND u."isDeleted" = false
					AND (u."usernameLower" ILIKE $2 OR u.name ILIKE $2)
				ORDER BY u."followersCount" DESC LIMIT $3`, [GB_COACH_ROLE_ID, like, per]).then(async (rows: { userId: string }[]) => {
				if (!rows.length) return [];
				const us = await this.usersRepository.findBy(rows.map((r) => ({ id: r.userId })));
				const packed = await this.userEntityService.packMany(us, me, { schema: 'UserLite' });
				const byId = new Map(packed.map((u) => [u.id, u]));
				return rows.map((r) => byId.get(r.userId)).filter((u) => !!u).map((u) => ({ userId: u!.id, user: u }));
			});

			const [p, c, m, co, v, ch] = await Promise.all([players, clubs, meets, competitions, venues, coaches]);
			return { q: ps.q, global: ps.global, players: p, clubs: c, meets: m, competitions: co, venues: v, coaches: ch };
		});
	}
}

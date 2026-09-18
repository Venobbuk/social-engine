/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Brackets } from 'typeorm';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { MeetsRepository, MeetParticipantsRepository } from '@/models/_.js';
import type { MiMeet } from '@/modules/meets/models/Meet.js';
import { DI } from '@/di-symbols.js';
import { MeetEntityService } from '@/modules/meets/MeetEntityService.js';
import { parseIsoDate } from './_shared.js';

// Discover + "my meets". Nearby search uses a bounding box + haversine in SQL (no PostGIS needed at HK scale).
export const meta = {
	tags: ['meets'],
	requireCredential: false,
	kind: 'read:meets',
	res: { type: 'array', optional: false, nullable: false, items: { type: 'object', optional: false, nullable: false, ref: 'Meet' } },
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		scope: { type: 'string', enum: ['discover', 'mine', 'hosting', 'channel'], default: 'discover' },
		seriesId: { type: 'string', format: 'misskey:id', nullable: true },   // SERIES-V1: one schedule's meets
		channelId: { type: 'string', format: 'misskey:id', nullable: true },
		sport: { type: 'string', nullable: true, maxLength: 32 },
		from: { type: 'string', nullable: true, maxLength: 40 },
		to: { type: 'string', nullable: true, maxLength: 40 },
		lat: { type: 'number', nullable: true, minimum: -90, maximum: 90 },
		lng: { type: 'number', nullable: true, minimum: -180, maximum: 180 },
		radiusKm: { type: 'number', nullable: true, minimum: 0.1, maximum: 500 },
		hideFull: { type: 'boolean', default: false },
		// DISCOVER-V3: Reclub filter.tsx — times (mornings 4-11 / afternoons 11-17 / evenings 17-24, the meet's own
		// timezone), friendsOnly (host or a confirmed player is someone I follow), hideEmpty (no confirmed player yet),
		// verifiedOnly (the meet's venue row is Verified)
		times: { type: 'array', items: { type: 'string', enum: ['mornings', 'afternoons', 'evenings'] }, nullable: true },
		friendsOnly: { type: 'boolean', default: false },
		hideEmpty: { type: 'boolean', default: false },
		verifiedOnly: { type: 'boolean', default: false },
		includePast: { type: 'boolean', default: false },
		includeCancelled: { type: 'boolean', default: false },
		// CASUAL-V1: casual games (flag 'casual') are never in Discover; true lists only them (scope mine/hosting)
		casual: { type: 'boolean', default: false },
		limit: { type: 'integer', minimum: 1, maximum: 100, default: 30 },
		offset: { type: 'integer', minimum: 0, default: 0 },
	},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.meetsRepository)
		private meetsRepository: MeetsRepository,
		@Inject(DI.meetParticipantsRepository)
		private meetParticipantsRepository: MeetParticipantsRepository,
		private meetEntityService: MeetEntityService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const q = this.meetsRepository.createQueryBuilder('meet');

			if (!ps.includeCancelled) q.andWhere('meet.status = :active', { active: 'active' });
			q.andWhere(ps.casual ? ':casual = ANY(meet.flags)' : 'NOT (:casual = ANY(meet.flags))', { casual: 'casual' });
			if (ps.seriesId) q.andWhere('meet.seriesId = :seriesId', { seriesId: ps.seriesId });   // SERIES-V1
			if (ps.sport) q.andWhere('meet.sport = :sport', { sport: ps.sport });
			const from = parseIsoDate(ps.from), to = parseIsoDate(ps.to);
			if (from) q.andWhere('meet.startAt >= :from', { from });
			if (to) q.andWhere('meet.startAt <= :to', { to });
			// a meet that has ended is past even inside a from/to window (Discover's day strip passes one): only includePast keeps it
			if (!ps.includePast) q.andWhere('meet.startAt + (meet.durationMinutes * interval \'1 minute\') >= :now', { now: new Date() });

			switch (ps.scope) {
				case 'mine': {
					if (me == null) return [];
					// The parameter is NOT named :active — that name is already bound to the string 'active' by the status filter above, and
					// the array bound here overwrote it, so meet.status = ARRAY matched nothing (found on live 09-16 by the Home tab).
					q.andWhere('EXISTS (SELECT 1 FROM meet_participant mp WHERE mp."meetId" = meet.id AND mp."userId" = :meId AND mp.status IN (:...mineStates))', { meId: me.id, mineStates: ['requested', 'invited', 'confirmed', 'waitlisted', 'hold', 'maybe'] });
					break;
				}
				case 'hosting': {
					if (me == null) return [];
					q.andWhere('meet.hostId = :meId', { meId: me.id });
					break;
				}
				case 'channel': {
					if (!ps.channelId) return [];
					q.andWhere('meet.channelId = :channelId', { channelId: ps.channelId });
					q.andWhere('meet.visibility IN (:...vis)', { vis: ['public', 'club'] });
					break;
				}
				default: {
					q.andWhere('meet.visibility = :public', { public: 'public' });
					if (ps.channelId) q.andWhere('meet.channelId = :channelId', { channelId: ps.channelId });
				}
			}

			let distanceExpr: string | null = null;
			if (ps.lat != null && ps.lng != null) {
				const radius = ps.radiusKm ?? 20;
				const dLat = radius / 111;
				const dLng = radius / (111 * Math.max(0.1, Math.cos(ps.lat * Math.PI / 180)));
				q.andWhere('meet.lat IS NOT NULL AND meet.lng IS NOT NULL');
				q.andWhere('meet.lat BETWEEN :latMin AND :latMax', { latMin: ps.lat - dLat, latMax: ps.lat + dLat });
				q.andWhere('meet.lng BETWEEN :lngMin AND :lngMax', { lngMin: ps.lng - dLng, lngMax: ps.lng + dLng });
				distanceExpr = `(6371 * acos(least(1, cos(radians(${ps.lat})) * cos(radians(meet.lat)) * cos(radians(meet.lng) - radians(${ps.lng})) + sin(radians(${ps.lat})) * sin(radians(meet.lat)))))`;
				q.addSelect(distanceExpr, 'distance_km');
				q.andWhere(`${distanceExpr} <= :radius`, { radius });
			}

			// DISCOVER-V3 filters
			if (ps.times && ps.times.length > 0 && ps.times.length < 3) {
				const bands: string[] = [];
				const hour = 'EXTRACT(HOUR FROM (meet."startAt" AT TIME ZONE meet.timezone))';
				if (ps.times.includes('mornings')) bands.push(`(${hour} >= 4 AND ${hour} < 11)`);
				if (ps.times.includes('afternoons')) bands.push(`(${hour} >= 11 AND ${hour} < 17)`);
				if (ps.times.includes('evenings')) bands.push(`(${hour} >= 17 OR ${hour} < 4)`);
				q.andWhere(`(${bands.join(' OR ')})`);
			}
			if (ps.friendsOnly) {
				if (me == null) return [];
				q.andWhere('(EXISTS (SELECT 1 FROM following f WHERE f."followerId" = :fMe AND f."followeeId" = meet."hostId") OR EXISTS (SELECT 1 FROM meet_participant fp JOIN following f2 ON f2."followeeId" = fp."userId" WHERE fp."meetId" = meet.id AND fp.status IN (\'confirmed\', \'hold\') AND f2."followerId" = :fMe))', { fMe: me.id });
			}
			if (ps.hideEmpty) q.andWhere('EXISTS (SELECT 1 FROM meet_participant ep WHERE ep."meetId" = meet.id AND ep.status = \'confirmed\')');
			if (ps.verifiedOnly) q.andWhere('meet."venueId" IS NOT NULL AND EXISTS (SELECT 1 FROM venue v WHERE v.id = meet."venueId" AND v.status = \'verified\')');
			if (ps.hideFull) {
				q.andWhere(new Brackets(qb => {
					qb.where(`meet.capacity > (SELECT COUNT(*) FROM meet_participant p WHERE p."meetId" = meet.id AND p.status IN ('confirmed', 'hold'))`);
				}));
			}

			q.orderBy('meet.startAt', 'ASC').offset(ps.offset).limit(ps.limit);

			const { entities, raw } = await q.getRawAndEntities();
			const distances = new Map<MiMeet['id'], number>();
			if (distanceExpr) {
				for (const r of raw) if (r.meet_id && r.distance_km != null) distances.set(r.meet_id, Math.round(Number(r.distance_km) * 10) / 10);
			}
			return await this.meetEntityService.packMany(entities, me, distances);
		});
	}
}

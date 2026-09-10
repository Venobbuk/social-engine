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
		channelId: { type: 'string', format: 'misskey:id', nullable: true },
		sport: { type: 'string', nullable: true, maxLength: 32 },
		from: { type: 'string', format: 'date-time', nullable: true },
		to: { type: 'string', format: 'date-time', nullable: true },
		lat: { type: 'number', nullable: true, minimum: -90, maximum: 90 },
		lng: { type: 'number', nullable: true, minimum: -180, maximum: 180 },
		radiusKm: { type: 'number', nullable: true, minimum: 0.1, maximum: 500 },
		hideFull: { type: 'boolean', default: false },
		includePast: { type: 'boolean', default: false },
		includeCancelled: { type: 'boolean', default: false },
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
			if (ps.sport) q.andWhere('meet.sport = :sport', { sport: ps.sport });
			if (ps.from) q.andWhere('meet.startAt >= :from', { from: new Date(ps.from) });
			if (ps.to) q.andWhere('meet.startAt <= :to', { to: new Date(ps.to) });
			if (!ps.includePast && !ps.from) q.andWhere('meet.startAt + (meet.durationMinutes * interval \'1 minute\') >= :now', { now: new Date() });

			switch (ps.scope) {
				case 'mine': {
					if (me == null) return [];
					q.innerJoin('meet_participant', 'mp', 'mp."meetId" = meet.id AND mp."userId" = :meId AND mp.status IN (:...active)', { meId: me.id, active: ['requested', 'invited', 'confirmed', 'waitlisted', 'hold', 'maybe'] });
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

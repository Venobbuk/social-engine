/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Brackets } from 'typeorm';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { QueryService } from '@/core/QueryService.js';
import type { ChannelsRepository } from '@/models/_.js';
import { ChannelEntityService } from '@/core/entities/ChannelEntityService.js';
import { DI } from '@/di-symbols.js';
import { sqlLikeEscape } from '@/misc/sql-like-escape.js';
import type { DataSource } from 'typeorm';
import { clubsNear, clubFacts } from '@/modules/discover/clubs-near.js';

export const meta = {
	tags: ['channels'],

	requireCredential: false,

	res: {
		type: 'array',
		optional: false, nullable: false,
		items: {
			type: 'object',
			optional: false, nullable: false,
			ref: 'Channel',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		query: { type: 'string' },
		type: { type: 'string', enum: ['nameAndDescription', 'nameOnly'], default: 'nameAndDescription' },
		sinceId: { type: 'string', format: 'misskey:id' },
		untilId: { type: 'string', format: 'misskey:id' },
		sinceDate: { type: 'integer' },
		untilDate: { type: 'integer' },
		limit: { type: 'integer', minimum: 1, maximum: 100, default: 5 },
		// DISCOVER-W2D (G11 EXTEND): Reclub Discover › Clubs — "near you" and the club card's facts. With lat/lng the rows are
		// the clubs within radiusKm of that point, nearest first (modules/discover/clubs-near.ts: a club's position is its club
		// venue, else where its meets are); `club: true` adds level / visibility / distanceKm / upcomingMeets to each row.
		lat: { type: 'number', nullable: true, minimum: -90, maximum: 90 },
		lng: { type: 'number', nullable: true, minimum: -180, maximum: 180 },
		radiusKm: { type: 'number', nullable: true, minimum: 1, maximum: 500 },
		club: { type: 'boolean', default: false },
	},
	required: ['query'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.channelsRepository)
		private channelsRepository: ChannelsRepository,
		@Inject(DI.db)
		private db: DataSource,

		private channelEntityService: ChannelEntityService,
		private queryService: QueryService,
	) {
		super(meta, paramDef, async (ps, me) => {
			// DISCOVER-W2D: the place path — clubs near a point, nearest first, each with its club facts
			if (ps.lat != null && ps.lng != null) {
				// review-batch2 #3: a private club is listed only to its own members / admins, never anonymously
				const near = await clubsNear(this.db, { q: ps.query, lat: ps.lat, lng: ps.lng, radiusKm: ps.radiusKm, limit: ps.limit, viewerId: me?.id ?? null });
				const packed = await Promise.all(near.map(r => this.channelEntityService.pack(r.id, me).then(c => ({ ...c, level: r.level, visibility: r.visibility, distanceKm: r.distanceKm, upcomingMeets: r.upcomingMeets }))));
				return packed;
			}

			const query = this.queryService.makePaginationQuery(this.channelsRepository.createQueryBuilder('channel'), ps.sinceId, ps.untilId, ps.sinceDate, ps.untilDate)
				.andWhere('channel.isArchived = FALSE');

			if (ps.query !== '') {
				if (ps.type === 'nameAndDescription') {
					query.andWhere(new Brackets(qb => {
						qb
							.where('channel.name ILIKE :q', { q: `%${ sqlLikeEscape(ps.query) }%` })
							.orWhere('channel.description ILIKE :q', { q: `%${ sqlLikeEscape(ps.query) }%` });
					}));
				} else {
					query.andWhere('channel.name ILIKE :q', { q: `%${ sqlLikeEscape(ps.query) }%` });
				}
			}

			// SEC-CLUB-READ-V1 (2026-09-21, permission-sweep hole 1): this path filtered isArchived and nothing else, so a
			// PRIVATE club was listed to anonymous callers with its name, description and member count. The lat/lng path
			// above already applies the rule (review-batch2 #3, clubs-near.ts notPrivateToThisViewer); this is the same
			// rule in the keyword query, so the two paths cannot disagree. Owner, admins and members still see theirs.
			const viewer = me?.id ?? null;
			query.andWhere(new Brackets(qb => {
				qb.where(`COALESCE((SELECT cs.visibility FROM club_setting cs WHERE cs."channelId" = channel.id), 'public') <> 'private'`)
					.orWhere(viewer == null ? 'FALSE' : `EXISTS (SELECT 1 FROM club_member cm WHERE cm."channelId" = channel.id AND cm."userId" = :viewer)`, { viewer })
					.orWhere(viewer == null ? 'FALSE' : `EXISTS (SELECT 1 FROM club_setting cs2 WHERE cs2."channelId" = channel.id AND :viewer = ANY(cs2."adminIds"))`, { viewer })
					.orWhere(viewer == null ? 'FALSE' : 'channel."userId" = :viewer', { viewer });
			}));

			const channels = await query
				.limit(ps.limit)
				.getMany();

			const packed = await Promise.all(channels.map(x => this.channelEntityService.pack(x, me)));
			if (!ps.club) return packed;
			// DISCOVER-W2D: the club card's facts on the keyword path too
			const facts = await clubFacts(this.db, channels.map(c => c.id), me?.id ?? null);
			return packed.map(c => { const f = facts.get(c.id); return f ? { ...c, level: f.level, visibility: f.visibility, distanceKm: null, upcomingMeets: f.upcomingMeets } : c; });
		});
	}
}

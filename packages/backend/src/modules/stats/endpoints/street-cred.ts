/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DI } from '@/di-symbols.js';
import type { MeetPlayerLevelsRepository } from '@/models/_.js';
import { MeetService } from '@/modules/meets/MeetService.js';
import { UserEntityService } from '@/core/entities/UserEntityService.js';
import { TIMEFRAMES, timeframeWindow, monthWindow } from '../_shared.js';

// DISCOVER-V3 (stats): Reclub GET /leaderboards/street-cred {kudo_dimension_id, country, timeframe} (§8.7): the Street
// Cred leaderboard by dimension × timeframe with the gender filter of the DUPR pane (§8.5 filter-gender feeds the
// rankings panes). Same rows as meets/reviews/leaderboard (MeetService.kudosLeaderboard), plus the timeframes YEAR /
// LAST_YEAR / LAST_6_MONTHS and the gender filter; the viewer's own rank rides along ("Current Rank"). Public.
export const meta = {
	tags: ['stats'],
	requireCredential: false,
	res: { type: 'object', optional: false, nullable: false, properties: {
		timeframe: { type: 'string', optional: false, nullable: false },
		month: { type: 'string', optional: true, nullable: true },   // KUDOS-CHAT-V1
		summary: { type: 'array', optional: true, nullable: false, items: { type: 'object', optional: false, nullable: false } },   // KUDOS-CHAT-V1
		dimension: { type: 'string', optional: false, nullable: true },
		myRank: { type: 'number', optional: false, nullable: true },
		rows: { type: 'array', optional: false, nullable: false, items: { type: 'object', optional: false, nullable: false, properties: {
			rank: { type: 'number', optional: false, nullable: false },
			userId: { type: 'string', optional: false, nullable: false },
			user: { type: 'object', optional: false, nullable: true, ref: 'UserLite' },
			count: { type: 'number', optional: false, nullable: false },
			dims: { type: 'object', optional: false, nullable: false },
		} } },
	} },
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		timeframe: { type: 'string', enum: TIMEFRAMES, default: 'LAST_3_MONTHS' },
		dimension: { type: 'string', nullable: true, maxLength: 64 },
		gender: { type: 'string', nullable: true, enum: ['male', 'female', 'nonbinary'] },
		sport: { type: 'string', minLength: 1, maxLength: 32, default: 'pickleball' },
		limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
		// KUDOS-CHAT-V1 (D-street-cred-leaderboard.02): one Hong Kong month 'YYYY-MM' (Reclub 'MMM YYYY' chips) — wins over timeframe
		month: { type: 'string', nullable: true, pattern: '^[0-9]{4}-(0[1-9]|1[0-2])$' },
		// KUDOS-CHAT-V1 (D-street-cred-leaderboard.01): Reclub's summary — per dimension the top 3 and how many players
		summary: { type: 'boolean', default: false },
	},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.meetPlayerLevelsRepository)
		private meetPlayerLevelsRepository: MeetPlayerLevelsRepository,
		private meetService: MeetService,
		private userEntityService: UserEntityService,
	) {
		super(meta, paramDef, async (ps, me) => {
			// SEC-ANON-FIELDS-V1: the gender filter is itself a gender oracle — an anonymous caller's filter is ignored
			if (me == null) ps.gender = null;
			const [from, to] = (ps.month ? monthWindow(ps.month) : null) ?? timeframeWindow(ps.timeframe);
			// the full ranking (limit 500) so a gender filter and the viewer's rank are computed on every row
			let rows = await this.meetService.kudosLeaderboard(from, to, ps.dimension ?? null, 500);
			if (ps.gender) {
				const ids = rows.map(r => r.userId);
				const lv = ids.length ? await this.meetPlayerLevelsRepository.createQueryBuilder('l').where('l.sport = :sport', { sport: ps.sport }).andWhere('l.gender = :g', { g: ps.gender }).andWhere('l.userId IN (:...ids)', { ids }).getMany() : [];
				const keep = new Set(lv.map(l => l.userId));
				rows = rows.filter(r => keep.has(r.userId));
			}
			if (ps.summary) {
				// one read, every dimension: rank by that dimension's count (ties: overall count), top 3 packed, players counted
				const dimNames = [...new Set(rows.flatMap(r => Object.keys(r.dims)))];
				const summary = [];
				for (const d of dimNames) {
					const ranked = rows.filter(r => (r.dims[d] ?? 0) > 0).sort((a, b) => (b.dims[d] - a.dims[d]) || (b.count - a.count));
					const top = [];
					for (const r of ranked.slice(0, 3)) top.push({ userId: r.userId, user: await this.userEntityService.pack(r.userId, me, { schema: 'UserLite' }).catch(() => null), count: r.dims[d] });
					const mine = me ? ranked.findIndex(r => r.userId === me.id) : -1;
					summary.push({ dimension: d, players: ranked.length, top, myRank: mine >= 0 ? mine + 1 : null });
				}
				summary.sort((a, b) => b.players - a.players);
				return { timeframe: ps.timeframe, month: ps.month ?? null, dimension: null, myRank: null, rows: [], summary };
			}
			const myIdx = me ? rows.findIndex(r => r.userId === me.id) : -1;
			const out = [];
			for (let i = 0; i < Math.min(rows.length, ps.limit); i++) {
				const r = rows[i];
				out.push({ rank: i + 1, userId: r.userId, user: await this.userEntityService.pack(r.userId, me, { schema: 'UserLite' }).catch(() => null), count: r.count, dims: r.dims });
			}
			return { timeframe: ps.timeframe, month: ps.month ?? null, dimension: ps.dimension ?? null, myRank: myIdx >= 0 ? myIdx + 1 : null, rows: out };
		});
	}
}

/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DI } from '@/di-symbols.js';
import type { MeetPlayerLevelsRepository } from '@/models/_.js';
import { UserEntityService } from '@/core/entities/UserEntityService.js';

// DISCOVER-V3 (stats): Reclub GET /statistics/dupr-rankings + /dupr-user-ranking/<userId> (§8.1 "DUPR Rankings" pane:
// country chip, gender filter, sort Singles / Doubles, "Current Rank" card, rows rank · name · singles · doubles, "NR"
// when unrated). The ratings are the engine's meet_player_level rows (synced from hkpl at SSO, LEVELS-V1). Country:
// every player here plays in HK (Reclub lists by the country of the last attended activity); the param is accepted
// and echoed so the UI's chip has a value, no other country exists yet.
export const meta = {
	tags: ['stats'],
	requireCredential: false,
	res: { type: 'object', optional: false, nullable: false, properties: {
		country: { type: 'string', optional: false, nullable: false },
		total: { type: 'number', optional: false, nullable: false },
		myRank: { type: 'number', optional: false, nullable: true },
		rows: { type: 'array', optional: false, nullable: false, items: { type: 'object', optional: false, nullable: false, properties: {
			rank: { type: 'number', optional: false, nullable: false },
			userId: { type: 'string', optional: false, nullable: false },
			user: { type: 'object', optional: false, nullable: true, ref: 'UserLite' },
			singles: { type: 'number', optional: false, nullable: true },
			doubles: { type: 'number', optional: false, nullable: true },
			gender: { type: 'string', optional: false, nullable: true },
		} } },
	} },
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		sport: { type: 'string', minLength: 1, maxLength: 32, default: 'pickleball' },
		sort: { type: 'string', enum: ['doubles', 'singles'], default: 'doubles' },
		gender: { type: 'string', nullable: true, enum: ['male', 'female', 'nonbinary'] },
		country: { type: 'string', nullable: true, minLength: 2, maxLength: 2 },
		limit: { type: 'integer', minimum: 1, maximum: 100, default: 30 },
		offset: { type: 'integer', minimum: 0, default: 0 },
	},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.meetPlayerLevelsRepository)
		private meetPlayerLevelsRepository: MeetPlayerLevelsRepository,
		private userEntityService: UserEntityService,
	) {
		super(meta, paramDef, async (ps, me) => {
			// SEC-ANON-FIELDS-V1: the gender filter is itself a gender oracle — an anonymous caller's filter is ignored
			if (me == null) ps.gender = null;
			const col = ps.sort === 'singles' ? 'duprSingles' : 'duprDoubles';
			const q = this.meetPlayerLevelsRepository.createQueryBuilder('l').where('l.sport = :sport', { sport: ps.sport }).andWhere(`l."${col}" IS NOT NULL`);
			if (ps.gender) q.andWhere('l.gender = :gender', { gender: ps.gender });
			const total = await q.getCount();
			const rows = await q.clone().orderBy(`l."${col}"`, 'DESC').addOrderBy('l.updatedAt', 'ASC').offset(ps.offset).limit(ps.limit).getMany();
			let myRank: number | null = null;
			if (me) {
				const mine = await this.meetPlayerLevelsRepository.findOneBy({ userId: me.id, sport: ps.sport });
				const v = mine ? mine[col] : null;
				if (v != null && (!ps.gender || mine?.gender === ps.gender)) myRank = 1 + await q.clone().andWhere(`l."${col}" > :v`, { v }).getCount();
			}
			// SEC-ANON-FIELDS-V1 (2026-09-20): the ranking (name, singles, doubles) is a public leaderboard, but a
			// player's gender is not — return it only to a signed-in caller.
			const signedIn = me != null;
			const out = [];
			for (let i = 0; i < rows.length; i++) {
				const r = rows[i];
				out.push({ rank: ps.offset + i + 1, userId: r.userId, user: await this.userEntityService.pack(r.userId, me, { schema: 'UserLite' }).catch(() => null), singles: r.duprSingles, doubles: r.duprDoubles, gender: signedIn ? r.gender : null });
			}
			return { country: (ps.country ?? 'HK').toUpperCase(), total, myRank, rows: out };
		});
	}
}

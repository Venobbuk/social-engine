/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DI } from '@/di-symbols.js';
import { UserEntityService } from '@/core/entities/UserEntityService.js';
import { rankingsPage } from '../MatchHistory.js';

// STATS-HISTORY-V1 (W2-S): Reclub Statistics › Rankings (Points · Wins · Matches · Opponents, type Singles / Doubles,
// "Your Rankings", Load more) on GripBat's own rating (GB-RATING-V1 gb_player_rating + gb_rating_log). A player is
// ranked in a type once they have a rated match of that type; Points = the GripBat rating. Aggregated and paged in SQL.
export const meta = {
	tags: ['stats'],
	requireCredential: false,
	kind: 'read:meets',
	res: { type: 'object', optional: false, nullable: false },
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		sport: { type: 'string', minLength: 1, maxLength: 32, default: 'pickleball' },
		type: { type: 'string', enum: ['doubles', 'singles'], default: 'doubles' },
		gender: { type: 'string', nullable: true, enum: ['male', 'female', 'nonbinary'] },
		limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
		offset: { type: 'integer', minimum: 0, maximum: 5000, default: 0 },
	},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.db)
		private db: DataSource,
		private userEntityService: UserEntityService,
	) {
		super(meta, paramDef, async (ps, me) => {
			// SEC-ANON-FIELDS-V1 (master 891697dc1f) - the SAME rule as stats/dupr-rankings and stats/street-cred:
			// gender is a private profile field, so a gender FILTER on a door that answers without a credential is itself
			// a gender oracle (ask twice, diff the rows). An anonymous caller's filter is ignored.
			if (me == null) ps.gender = null;
			const r = await rankingsPage(this.db, { sport: ps.sport, type: ps.type as 'doubles' | 'singles', gender: ps.gender ?? null, limit: ps.limit, offset: ps.offset, viewerId: me?.id ?? null });
			const ids = [...new Set([...r.rows.map((x) => x.userId), ...(r.mine ? [r.mine.userId] : [])])];
			const users = new Map<string, unknown>();
			if (ids.length) for (const u of await this.userEntityService.packMany(ids, me, { schema: 'UserLite' })) users.set(u.id, u);
			const withUser = <T extends { userId: string }>(x: T) => ({ ...x, user: users.get(x.userId) ?? null });
			return { type: ps.type, total: r.total, mine: r.mine ? withUser(r.mine) : null, rows: r.rows.map(withUser) };
		});
	}
}

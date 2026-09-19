/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DI } from '@/di-symbols.js';
import { UserEntityService } from '@/core/entities/UserEntityService.js';
import { pairSummary } from '../MatchHistory.js';

// STATS-HISTORY-V1 (W2-S): Reclub Stats team summary — a fixed pair's record together (matches, wins, points for /
// against) and the opponents it has faced, each with the pair's record against them (tap → pair-vs-pair head-to-head
// via stats/matches {userId: a, partnerId: b, opponentIds}). From GB-RATING-V1's gb_rating_log, grouped in SQL.
export const meta = {
	tags: ['stats'],
	requireCredential: false,
	kind: 'read:meets',
	res: { type: 'object', optional: false, nullable: false },
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		a: { type: 'string', format: 'misskey:id' },
		b: { type: 'string', format: 'misskey:id' },
		sport: { type: 'string', minLength: 1, maxLength: 32, default: 'pickleball' },
		limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
	},
	required: ['a', 'b'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.db)
		private db: DataSource,
		private userEntityService: UserEntityService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const s = await pairSummary(this.db, ps.a, ps.b, ps.sport, ps.limit);
			const ids = [...new Set([ps.a, ps.b, ...s.opponents.flatMap((o) => o.opponentIds)])];
			const users = new Map<string, unknown>();
			for (const u of await this.userEntityService.packMany(ids, me, { schema: 'UserLite' })) users.set(u.id, u);
			return { ...s, a: users.get(ps.a) ?? null, b: users.get(ps.b) ?? null, opponents: s.opponents.map((o) => ({ ...o, users: o.opponentIds.map((id) => users.get(id) ?? null) })) };
		});
	}
}

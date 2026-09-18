/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DI } from '@/di-symbols.js';
import { UserEntityService } from '@/core/entities/UserEntityService.js';
import { scoredMatchesOf, participantsOf, sideOf } from '../_shared.js';

// DISCOVER-V3 (stats): Reclub stats-team head-to-head (§8.9 "H2H Matches": context name, date, round, scores, winner)
// between the signed-in player and one other player — every scored match they were both in, split into "against"
// (opposite sides) and "with" (same side), each with a record.
export const meta = {
	tags: ['stats'],
	requireCredential: true,
	kind: 'read:meets',
	res: { type: 'object', optional: false, nullable: false, properties: {
		user: { type: 'object', optional: false, nullable: true, ref: 'UserLite' },
		against: { type: 'object', optional: false, nullable: false, properties: { matches: { type: 'number', optional: false, nullable: false }, wins: { type: 'number', optional: false, nullable: false }, losses: { type: 'number', optional: false, nullable: false } } },
		with: { type: 'object', optional: false, nullable: false, properties: { matches: { type: 'number', optional: false, nullable: false }, wins: { type: 'number', optional: false, nullable: false }, losses: { type: 'number', optional: false, nullable: false } } },
		matches: { type: 'array', optional: false, nullable: false, items: { type: 'object', optional: false, nullable: false, properties: {
			id: { type: 'string', optional: false, nullable: false },
			meetId: { type: 'string', optional: false, nullable: false },
			meetName: { type: 'string', optional: false, nullable: false },
			startAt: { type: 'string', optional: false, nullable: false },
			round: { type: 'number', optional: false, nullable: true },
			relation: { type: 'string', optional: false, nullable: false, enum: ['against', 'with'] },
			scores: { type: 'array', optional: false, nullable: false, items: { type: 'array', optional: false, nullable: false, items: { type: 'number', optional: false, nullable: false } } },
			won: { type: 'boolean', optional: false, nullable: true },
		} } },
	} },
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		userId: { type: 'string', format: 'misskey:id' },
		sport: { type: 'string', minLength: 1, maxLength: 32, default: 'pickleball' },
		limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
	},
	required: ['userId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.db)
		private db: DataSource,
		private userEntityService: UserEntityService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const all = await scoredMatchesOf(this.db, me.id, ps.sport);
			const parts = await participantsOf(this.db, all);
			const against = { matches: 0, wins: 0, losses: 0 }, withRec = { matches: 0, wins: 0, losses: 0 };
			const matches = [];
			for (const m of all) {
				const mine = sideOf(m, parts, me.id), theirs = sideOf(m, parts, ps.userId);
				if (!mine || !theirs) continue;
				const relation = mine === theirs ? 'with' as const : 'against' as const;
				const won = m.winnerTeam == null ? null : m.winnerTeam === mine;
				// scores from my side: [mine, theirs] per game
				const scores = m.scores.map(([a, b]) => mine === 1 ? [a, b] : [b, a]);
				const rec = relation === 'with' ? withRec : against;
				rec.matches++; if (won === true) rec.wins++; else if (won === false) rec.losses++;
				if (matches.length < ps.limit) matches.push({ id: m.id, meetId: m.meetId, meetName: m.meetName, startAt: m.startAt.toISOString(), round: m.round, relation, scores, won });
			}
			return { user: await this.userEntityService.pack(ps.userId, me, { schema: 'UserLite' }).catch(() => null), against, with: withRec, matches };
		});
	}
}

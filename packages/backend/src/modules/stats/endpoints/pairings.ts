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

// DISCOVER-V3 (stats): Reclub GET /statistics/pairing/<type> — Matchups: Teammates (All / Best Friends > 60 % wins
// together) and Opponents (All / Rivals 40-60 % / Easy Money > 60 % / Challengers < 40 %), each {userId, winPct,
// numMatches} (spec_competition_dupr.md §8.1 PairingCategory copy, PROVEN bands). The signed-in player's own pairings.
export const meta = {
	tags: ['stats'],
	requireCredential: true,
	kind: 'read:meets',
	res: { type: 'array', optional: false, nullable: false, items: { type: 'object', optional: false, nullable: false, properties: {
		userId: { type: 'string', optional: false, nullable: false },
		user: { type: 'object', optional: false, nullable: true, ref: 'UserLite' },
		numMatches: { type: 'number', optional: false, nullable: false },
		wins: { type: 'number', optional: false, nullable: false },
		winPct: { type: 'number', optional: false, nullable: false },
		lastAt: { type: 'string', optional: false, nullable: true },
	} } },
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		type: { type: 'string', enum: ['teammates', 'opponents'], default: 'teammates' },
		category: { type: 'string', enum: ['all', 'best_friends', 'rivals', 'easy', 'challengers'], default: 'all' },
		sport: { type: 'string', minLength: 1, maxLength: 32, default: 'pickleball' },
		limit: { type: 'integer', minimum: 1, maximum: 100, default: 30 },
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
			const matches = await scoredMatchesOf(this.db, me.id, ps.sport);
			const parts = await participantsOf(this.db, matches);
			const by = new Map<string, { numMatches: number; wins: number; lastAt: Date }>();
			for (const m of matches) {
				const side = sideOf(m, parts, me.id);
				if (!side || m.winnerTeam == null) continue;
				const won = m.winnerTeam === side;
				const mine = side === 1 ? m.team1Ids : m.team2Ids, theirs = side === 1 ? m.team2Ids : m.team1Ids;
				for (const pid of (ps.type === 'teammates' ? mine : theirs)) {
					const u = parts.get(pid)?.userId;
					if (!u || u === me.id) continue;
					const e = by.get(u) ?? { numMatches: 0, wins: 0, lastAt: m.startAt };
					e.numMatches++; if (won) e.wins++; if (m.startAt > e.lastAt) e.lastAt = m.startAt;
					by.set(u, e);
				}
			}
			let rows = [...by.entries()].map(([userId, e]) => ({ userId, numMatches: e.numMatches, wins: e.wins, winPct: Math.round(100 * e.wins / e.numMatches), lastAt: e.lastAt }));
			switch (ps.category) {
				case 'best_friends': rows = rows.filter(r => ps.type === 'teammates' && r.winPct > 60); break;
				case 'rivals': rows = rows.filter(r => r.winPct >= 40 && r.winPct <= 60); break;
				case 'easy': rows = rows.filter(r => r.winPct > 60); break;
				case 'challengers': rows = rows.filter(r => r.winPct < 40); break;
			}
			rows.sort((a, b) => b.numMatches - a.numMatches || b.winPct - a.winPct);
			const out = [];
			for (const r of rows.slice(0, ps.limit)) out.push({ ...r, lastAt: r.lastAt.toISOString(), user: await this.userEntityService.pack(r.userId, me, { schema: 'UserLite' }).catch(() => null) });
			return out;
		});
	}
}

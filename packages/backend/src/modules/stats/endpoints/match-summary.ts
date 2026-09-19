/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DI } from '@/di-symbols.js';
import { UserEntityService } from '@/core/entities/UserEntityService.js';
import { matchSummary } from '../MatchHistory.js';

// STATS-HISTORY-V1 (W2-S): Reclub Match summary — one match, read-only: the meet / competition it belongs to, date,
// round / stage, court, the two teams with Winner / Forfeited, set scores, the DUPR submission ("Submitted by …") and
// each player's GripBat rating before → after. null when there is no such match or the caller may not see it.
export const meta = {
	tags: ['stats'],
	requireCredential: false,
	kind: 'read:meets',
	res: { type: 'object', optional: false, nullable: true },
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		source: { type: 'string', enum: ['meet', 'competition', 'openplay'], default: 'meet' },
		matchId: { type: 'string', minLength: 1, maxLength: 64 },
	},
	required: ['matchId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.db)
		private db: DataSource,
		private userEntityService: UserEntityService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const s = await matchSummary(this.db, ps.source as 'meet' | 'competition' | 'openplay', ps.matchId, me?.id ?? null);
			if (!s) return null;
			const ids = [...new Set([...s.teams.flatMap((t) => t.players.map((p) => p.userId)), s.dupr?.submittedById ?? null].filter((x): x is string => !!x))];
			const users = new Map<string, unknown>();
			if (ids.length) for (const u of await this.userEntityService.packMany(ids, me, { schema: 'UserLite' })) users.set(u.id, u);
			return {
				...s,
				teams: s.teams.map((t) => ({ ...t, players: t.players.map((p) => ({ ...p, user: p.userId ? users.get(p.userId) ?? null : null })) })),
				dupr: s.dupr ? { ...s.dupr, submittedBy: s.dupr.submittedById ? users.get(s.dupr.submittedById) ?? null : null } : null,
			};
		});
	}
}

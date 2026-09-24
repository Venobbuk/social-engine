/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DI } from '@/di-symbols.js';
import { UserEntityService } from '@/core/entities/UserEntityService.js';
import { historyPage, communityPage, userIdsOf } from '../MatchHistory.js';

// STATS-HISTORY-V1 (W2-S): Reclub My history › Matches / Statistics › Match history / Player sport › Matches — one page
// of a player's scored matches (meets, casual games, competitions, open play), newest first, paged in SQL.
// userId defaults to the caller; another player's list shows only what the caller may see (public, or shared).
// Filters: contextId (one meet / competition — the player-activity sheet), partnerId + opponentIds (pair head-to-head).
export const meta = {
	tags: ['stats'],
	requireCredential: false,
	kind: 'read:meets',
	res: { type: 'array', optional: false, nullable: false, items: { type: 'object', optional: false, nullable: false } },
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		userId: { type: 'string', format: 'misskey:id', nullable: true },
		sport: { type: 'string', minLength: 1, maxLength: 32, default: 'pickleball' },
		contextId: { type: 'string', format: 'misskey:id', nullable: true },
		partnerId: { type: 'string', format: 'misskey:id', nullable: true },
		opponentIds: { type: 'array', nullable: true, maxItems: 2, items: { type: 'string', format: 'misskey:id' } },
		limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
		offset: { type: 'integer', minimum: 0, maximum: 5000, default: 0 },
		// COMMUNITY-MATCHES-V1 (Reclub Statistics › Match history › Community matches): the community's newest scored
		// matches instead of one player's (userId / contextId / partnerId / opponentIds are ignored). No key = mine.
		scope: { type: 'string', enum: ['mine', 'community'] },
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
			const userId = ps.userId ?? me?.id;
			if (ps.scope !== 'community' && !userId) return [];
			const rows = ps.scope === 'community' ? await communityPage(this.db, { viewerId: me?.id ?? null, sport: ps.sport, limit: ps.limit, offset: ps.offset }) : await historyPage(this.db, { userId: userId!, viewerId: me?.id ?? null, sport: ps.sport, limit: ps.limit, offset: ps.offset, contextId: ps.contextId ?? null, partnerId: ps.partnerId ?? null, opponentIds: ps.opponentIds ?? null });
			const ids = userIdsOf(rows);
			const users = new Map<string, unknown>();
			if (ids.length) for (const u of await this.userEntityService.packMany(ids, me, { schema: 'UserLite' })) users.set(u.id, u);
			const withUser = (p: { userId: string | null; name: string | null }) => ({ ...p, user: p.userId ? users.get(p.userId) ?? null : null });
			return rows.map((r) => ({ ...r, partners: r.partners.map(withUser), opponents: r.opponents.map(withUser) }));
		});
	}
}

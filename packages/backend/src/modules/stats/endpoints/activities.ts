/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DI } from '@/di-symbols.js';
import { activitiesPage } from '../MatchHistory.js';

// STATS-HISTORY-V1 (W2-S): Reclub My history › Meets / Competitions and the player's activity list — past meets and
// competitions a player played in or hosted, newest first, with the player's record in each (matches, W, L). Paged in
// SQL; another player's list shows only public (or shared) activities.
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
		kind: { type: 'string', enum: ['all', 'meet', 'competition'], default: 'all' },
		limit: { type: 'integer', minimum: 1, maximum: 30, default: 15 },
		offset: { type: 'integer', minimum: 0, maximum: 5000, default: 0 },
	},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.db)
		private db: DataSource,
	) {
		super(meta, paramDef, async (ps, me) => {
			const userId = ps.userId ?? me?.id;
			if (!userId) return [];
			return activitiesPage(this.db, { userId, viewerId: me?.id ?? null, sport: ps.sport, kind: ps.kind as 'all' | 'meet' | 'competition', limit: ps.limit, offset: ps.offset });
		});
	}
}

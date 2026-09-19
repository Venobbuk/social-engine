/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DI } from '@/di-symbols.js';
import { UserEntityService } from '@/core/entities/UserEntityService.js';
import { edgeOf } from '../GbRating.js';

// GB-RATING-V1: a player's Edge from their GripBat matches — GripBat rating + 30-day trend, partner chemistry (win rate
// vs what the ratings predicted), clutch (close games ≤ 2 points, deciding games), form (last 10 vs expected), upsets.
export const meta = {
	tags: ['stats'],
	requireCredential: false,
	kind: 'read:meets',
	res: { type: 'object', optional: false, nullable: false },
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		userId: { type: 'string', format: 'misskey:id' },
		sport: { type: 'string', default: 'pickleball', maxLength: 32 },
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
			const e = await edgeOf(this.db, ps.userId, ps.sport) as Record<string, any>;
			if (Array.isArray(e.partners)) {
				// SEC-ANON-FIELDS-V1 (2026-09-20): a negative partner-chemistry score is private to the player. On
				// anyone else's Edge (or an anonymous read) show only the positive-chemistry partners. The subject sees
				// their own full list. (The app must send a session on the viewer's OWN Edge card — see report.)
				const isSubject = me != null && me.id === ps.userId;
				if (!isSubject) e.partners = e.partners.filter((p: { edge: number }) => p.edge >= 0);
				for (const p of e.partners) p.user = await this.userEntityService.pack(p.partnerId, me, { schema: 'UserLite' }).catch(() => null);
			}
			return e;
		});
	}
}

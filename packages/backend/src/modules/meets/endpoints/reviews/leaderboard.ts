/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { MeetService } from '@/modules/meets/MeetService.js';
import { UserEntityService } from '@/core/entities/UserEntityService.js';

// KUDOS-LEADERBOARD-V1 — Reclub "Street Cred" leaderboard (street-creds/kudo-cred-leaderboard-ranking): players
// ranked by public kudos received in a window, optionally for one kudo dimension. Public.
export const meta = {
	tags: ['meets'],
	requireCredential: false,
	res: { type: 'array', optional: false, nullable: false, items: { type: 'object', properties: { user: { type: 'object', optional: false, nullable: true, ref: 'UserLite' }, count: { type: 'number', optional: false, nullable: false }, dims: { type: 'object', optional: false, nullable: false } } } },
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		timeframe: { type: 'string', enum: ['CURRENT_MONTH', 'LAST_MONTH', 'LAST_3_MONTHS', 'YTD', 'ALL_TIME'], default: 'LAST_3_MONTHS' },
		dimension: { type: 'string', nullable: true, maxLength: 64 },
		limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
	},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private meetService: MeetService, private userEntityService: UserEntityService) {
		super(meta, paramDef, async (ps, me) => {
			const now = new Date(); const y = now.getFullYear(), m = now.getMonth();
			const [from, to] = ps.timeframe === 'CURRENT_MONTH' ? [new Date(y, m, 1), new Date(y, m + 1, 1)]
				: ps.timeframe === 'LAST_MONTH' ? [new Date(y, m - 1, 1), new Date(y, m, 1)]
				: ps.timeframe === 'LAST_3_MONTHS' ? [new Date(y, m - 3, 1), new Date(y, m + 1, 1)]
				: ps.timeframe === 'YTD' ? [new Date(y, 0, 1), new Date(y + 1, 0, 1)]
				: [new Date(2000, 0, 1), new Date(2100, 0, 1)];
			const rows = await this.meetService.kudosLeaderboard(from, to, ps.dimension ?? null, ps.limit);
			const out = [];
			for (const r of rows) out.push({ user: await this.userEntityService.pack(r.userId, me, { schema: 'UserLite' }).catch(() => null), count: r.count, dims: r.dims });
			return out;
		});
	}
}

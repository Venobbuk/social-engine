/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DI } from '@/di-symbols.js';
import { UserEntityService } from '@/core/entities/UserEntityService.js';
import { TIMEFRAMES, timeframeWindow } from '../_shared.js';

// DISCOVER-V3 (stats): Reclub Street Cred "By activity" (§8.7: the activities I received kudos in — name, date, kudo
// chips × count) and "By category" (GET /kudos/by-user: per dimension the count, "{n} kudos given by {m} people" and
// the givers). The signed-in player's own kudos, from meet_review endorsements (body = comma list of dimensions).
export const meta = {
	tags: ['stats'],
	requireCredential: true,
	kind: 'read:meets',
	res: { type: 'object', optional: false, nullable: false, properties: {
		timeframe: { type: 'string', optional: false, nullable: false },
		total: { type: 'number', optional: false, nullable: false },
		activities: { type: 'array', optional: false, nullable: false, items: { type: 'object', optional: false, nullable: false, properties: {
			meetId: { type: 'string', optional: false, nullable: true },
			meetName: { type: 'string', optional: false, nullable: true },
			startAt: { type: 'string', optional: false, nullable: true },
			count: { type: 'number', optional: false, nullable: false },
			dims: { type: 'object', optional: false, nullable: false },
			givers: { type: 'array', optional: false, nullable: false, items: { type: 'object', optional: false, nullable: true, ref: 'UserLite' } },
		} } },
		categories: { type: 'array', optional: false, nullable: false, items: { type: 'object', optional: false, nullable: false, properties: {
			dimension: { type: 'string', optional: false, nullable: false },
			count: { type: 'number', optional: false, nullable: false },
			people: { type: 'number', optional: false, nullable: false },
			givers: { type: 'array', optional: false, nullable: false, items: { type: 'object', optional: false, nullable: true, ref: 'UserLite' } },
		} } },
	} },
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		timeframe: { type: 'string', enum: TIMEFRAMES, default: 'LAST_3_MONTHS' },
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
			const [from, to] = timeframeWindow(ps.timeframe);
			const rows = await this.db.query(
				`SELECT r."meetId", r."authorId", r.body, r."createdAt", m.name AS "meetName", m."startAt"
				 FROM meet_review r LEFT JOIN meet m ON m.id = r."meetId"
				 WHERE r."targetUserId" = $1 AND r.type = 'endorsement' AND r."archivedAt" IS NULL AND r."createdAt" >= $2 AND r."createdAt" < $3
				 ORDER BY r."createdAt" DESC`, [me.id, from, to]) as { meetId: string | null; authorId: string; body: string | null; createdAt: Date; meetName: string | null; startAt: Date | null }[];
			const acts = new Map<string, { meetId: string | null; meetName: string | null; startAt: Date | null; count: number; dims: Record<string, number>; givers: Set<string> }>();
			const cats = new Map<string, { count: number; givers: Set<string> }>();
			let total = 0;
			for (const r of rows) {
				const dims = (r.body ?? '').split(',').map(x => x.trim()).filter(Boolean);
				const n = Math.max(1, dims.length); total += n;
				const k = r.meetId ?? 'none';
				const a = acts.get(k) ?? { meetId: r.meetId, meetName: r.meetName, startAt: r.startAt ? new Date(r.startAt) : null, count: 0, dims: {}, givers: new Set<string>() };
				a.count += n; a.givers.add(r.authorId);
				for (const d of dims) { a.dims[d] = (a.dims[d] ?? 0) + 1; const c = cats.get(d) ?? { count: 0, givers: new Set<string>() }; c.count++; c.givers.add(r.authorId); cats.set(d, c); }
				acts.set(k, a);
			}
			const pack = async (ids: Set<string>) => { const out = []; for (const id of [...ids].slice(0, 12)) out.push(await this.userEntityService.pack(id, me, { schema: 'UserLite' }).catch(() => null)); return out; };
			const activities = [];
			for (const a of [...acts.values()].sort((x, y) => (y.startAt?.getTime() ?? 0) - (x.startAt?.getTime() ?? 0)).slice(0, ps.limit)) activities.push({ meetId: a.meetId, meetName: a.meetName, startAt: a.startAt ? a.startAt.toISOString() : null, count: a.count, dims: a.dims, givers: await pack(a.givers) });
			const categories = [];
			for (const [dimension, c] of [...cats.entries()].sort((x, y) => y[1].count - x[1].count)) categories.push({ dimension, count: c.count, people: c.givers.size, givers: await pack(c.givers) });
			return { timeframe: ps.timeframe, total, activities, categories };
		});
	}
}

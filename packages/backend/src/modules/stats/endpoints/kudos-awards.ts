/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DI } from '@/di-symbols.js';
import { ApiError } from '@/server/api/error.js';
import { IdService } from '@/core/IdService.js';
import { UserEntityService } from '@/core/entities/UserEntityService.js';
import { MONTH_RX, monthWindow, monthKey } from '../_shared.js';

// KUDOS-CHAT-V1 (D-award-showcase.01) — Reclub activity:most_street_cred_of_the_month / monthly_street_cred_award:
// "MOST STREET CRED" of a month, overall ('' = all kudos) and per kudos kind, with the kudos count and how many people
// gave them; a popup for the winner, the award on the profile, See leaderboard.
// NEW (GripBat concept; searched: Misskey has no awards, competition_award is per competition — its row shape is the
// pattern here). The row is written the first time a CLOSED month is read (ON CONFLICT DO NOTHING): a closed month's
// kudos no longer change, so the answer equals what a month-end job would have written, with no job to schedule.
// The counts are the Street Cred rows (meet_review endorsements, not archived) — MeetService.kudosLeaderboard's rule.
// Public, like the Street Cred leaderboard it summarises; `unseen` is the caller's own popup queue.
export const meta = {
	tags: ['stats'],
	requireCredential: false,
	res: { type: 'object', optional: false, nullable: false, properties: {
		awards: { type: 'array', optional: false, nullable: false, items: { type: 'object', optional: false, nullable: false, properties: {
			id: { type: 'string', optional: false, nullable: false },
			month: { type: 'string', optional: false, nullable: false },
			dimension: { type: 'string', optional: false, nullable: true },
			userId: { type: 'string', optional: false, nullable: false },
			user: { type: 'object', optional: false, nullable: true, ref: 'UserLite' },
			kudos: { type: 'number', optional: false, nullable: false },
			people: { type: 'number', optional: false, nullable: false },
			seen: { type: 'boolean', optional: true, nullable: false },
		} } },
	} },
	errors: {
		credentialRequired: { message: 'Sign in to see your awards.', code: 'CREDENTIAL_REQUIRED', id: 'd41f0b27-2c4e-4d8a-9a51-0000000000a1' },
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		userId: { type: 'string', format: 'misskey:id', nullable: true },   // a player's awards (profile showcase)
		month: { type: 'string', nullable: true, pattern: '^[0-9]{4}-(0[1-9]|1[0-2])$' },   // one month's winners
		unseen: { type: 'boolean', default: false },   // my awards I have not dismissed yet (the Home popup)
		limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
	},
	required: [],
} as const;

/** How many closed months back are materialised on a read (bounded work per call). */
const MONTHS_BACK = 6;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.db) private db: DataSource,
		private idService: IdService,
		private userEntityService: UserEntityService,
	) {
		super(meta, paramDef, async (ps, me) => {
			if (ps.unseen && !me) throw new ApiError(meta.errors.credentialRequired);
			await this.materialise();
			const where: string[] = []; const args: unknown[] = [];
			if (ps.month && MONTH_RX.test(ps.month)) { args.push(ps.month); where.push(`a.month = $${args.length}`); }
			if (ps.unseen && me) { args.push(me.id); where.push(`a."userId" = $${args.length} AND a."seenAt" IS NULL`); } else if (ps.userId) { args.push(ps.userId); where.push(`a."userId" = $${args.length}`); }
			args.push(ps.limit);
			const rows = await this.db.query(
				`SELECT a.id, a.month, a.dimension, a."userId", a.kudos, a.people, a."seenAt" FROM kudos_award a
				 ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY a.month DESC, a.dimension ASC LIMIT $${args.length}`, args) as { id: string; month: string; dimension: string; userId: string; kudos: number; people: number; seenAt: Date | null }[];
			const awards = [];
			for (const r of rows) {
				awards.push({
					id: r.id, month: r.month, dimension: r.dimension || null, userId: r.userId,
					user: await this.userEntityService.pack(r.userId, me, { schema: 'UserLite' }).catch(() => null),
					kudos: r.kudos, people: r.people,
					...(me && me.id === r.userId ? { seen: r.seenAt != null } : {}),
				});
			}
			return { awards };
		});
	}

	/** Write the winners of the last MONTHS_BACK closed months that have none yet (idempotent). */
	private async materialise(): Promise<void> {
		const now = new Date();
		const current = monthKey(now);
		const [cy, cm] = current.split('-').map(Number);
		const done = new Set((await this.db.query(`SELECT DISTINCT month FROM kudos_award`) as { month: string }[]).map(r => r.month));
		for (let i = 1; i <= MONTHS_BACK; i++) {
			const d = new Date(Date.UTC(cy, cm - 1 - i, 1));
			const month = d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
			if (done.has(month)) continue;
			const win = monthWindow(month); if (!win) continue;
			const rows = await this.db.query(
				`SELECT r."targetUserId" AS "userId", r."authorId", r.body FROM meet_review r
				  WHERE r.type = 'endorsement' AND r."archivedAt" IS NULL AND r."createdAt" >= $1 AND r."createdAt" < $2`, win) as { userId: string; authorId: string; body: string | null }[];
			if (!rows.length) continue;
			// per dimension ('' = all kudos): user → { kudos, givers }
			const by = new Map<string, Map<string, { kudos: number; givers: Set<string> }>>();
			const add = (dim: string, u: string, a: string, n: number) => {
				const m = by.get(dim) ?? new Map(); const e = m.get(u) ?? { kudos: 0, givers: new Set<string>() };
				e.kudos += n; e.givers.add(a); m.set(u, e); by.set(dim, m);
			};
			for (const r of rows) {
				const dims = (r.body ?? '').split(',').map(x => x.trim()).filter(Boolean);
				add('', r.userId, r.authorId, Math.max(1, dims.length));
				for (const dim of dims) add(dim, r.userId, r.authorId, 1);
			}
			for (const [dim, m] of by) {
				// the winner: most kudos, then most distinct givers, then the lower id (stable)
				const [userId, e] = [...m.entries()].sort((x, y) => (y[1].kudos - x[1].kudos) || (y[1].givers.size - x[1].givers.size) || (x[0] < y[0] ? -1 : 1))[0];
				await this.db.query(
					`INSERT INTO kudos_award (id, month, dimension, "userId", kudos, people) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (month, dimension) DO NOTHING`,
					[this.idService.gen(), month, dim.slice(0, 64), userId, e.kudos, e.givers.size]);
			}
		}
	}
}

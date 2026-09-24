/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DI } from '@/di-symbols.js';
import { ApiError } from '@/server/api/error.js';
import { MONTH_RX, monthWindow, monthKey } from '../_shared.js';

// AWARD-SANDBOX-DOOR-V1 (lane fix-S8, D-award-showcase.01) — the monthly "MOST STREET CRED" award is written the first
// time a CLOSED month is read (stats/kudos-awards materialise); the API only ever dates a kudos NOW, so on a sandbox no
// closed month holds kudos and the award path could not be walked except by SQL. This door lets a PROBE date ITS OWN
// kudos into a closed month — and put it back — through the engine, so the award is then produced by the real read path.
// Guards (all must hold, else refused):
//  - sandbox engines only: GB_SANDBOX_MAIL=1 (web-uat ONLY — the same switch as the sandbox mail code; production has none);
//  - the caller WROTE the endorsement, and it belongs to a meet named "[probe] …" (G13 fixture);
//  - dating INTO a month: it is closed, within the 6 months the award read materialises, holds no award row yet and no
//    endorsement outside "[probe]" meets — real data is never disturbed;
//  - putting BACK (month null): the review returns to now, and the award rows of `clearMonth` are removed only when every
//    endorsement still in that month is a "[probe]" one (the next read re-materialises from what is left).
// NEW (searched: Misskey has no clock/backdate door; admin/* has none for reviews; kudos-awards has no month-end job).
export const meta = {
	tags: ['stats'],
	requireCredential: true,
	kind: 'write:meets',
	res: { type: 'object', optional: false, nullable: false, properties: {
		reviewId: { type: 'string', optional: false, nullable: false },
		createdAt: { type: 'string', optional: false, nullable: false },
		clearedAwards: { type: 'number', optional: false, nullable: false },
	} },
	errors: {
		sandboxOnly: { message: 'Only a sandbox engine has this door.', code: 'SANDBOX_ONLY', id: 'f1a8c3d2-5b4e-4f6a-9c7d-0000000000b1', httpStatusCode: 403 },
		noSuchReview: { message: 'No such kudos of yours in a probe meet.', code: 'NO_SUCH_REVIEW', id: 'f1a8c3d2-5b4e-4f6a-9c7d-0000000000b2', httpStatusCode: 404 },
		badMonth: { message: 'Pick a closed month within the last 6.', code: 'BAD_MONTH', id: 'f1a8c3d2-5b4e-4f6a-9c7d-0000000000b3' },
		monthInUse: { message: 'That month holds real kudos or awards.', code: 'MONTH_IN_USE', id: 'f1a8c3d2-5b4e-4f6a-9c7d-0000000000b4', httpStatusCode: 409 },
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		meetId: { type: 'string', format: 'misskey:id' },
		targetUserId: { type: 'string', format: 'misskey:id' },
		month: { type: 'string', pattern: '^[0-9]{4}-(0[1-9]|1[0-2])$' },   // absent = back to now
		clearMonth: { type: 'string', pattern: '^[0-9]{4}-(0[1-9]|1[0-2])$' },
	},
	required: ['meetId', 'targetUserId'],
} as const;

const PROBE = '[probe] %';
const MONTHS_BACK = 6;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.db) private db: DataSource,
	) {
		super(meta, paramDef, async (ps, me) => {
			if (process.env.GB_SANDBOX_MAIL !== '1') throw new ApiError(meta.errors.sandboxOnly);
			const rv = (await this.db.query(`SELECT r.id FROM "meet_review" r JOIN "meet" m ON m.id = r."meetId"
				WHERE r."meetId" = $1 AND r."targetUserId" = $2 AND r."authorId" = $3 AND r.type = 'endorsement' AND m.name LIKE $4 LIMIT 1`,
				[ps.meetId, ps.targetUserId, me.id, PROBE]) as { id: string }[])[0];
			if (!rv) throw new ApiError(meta.errors.noSuchReview);
			const nonProbeIn = async (win: [Date, Date]): Promise<number> => Number((await this.db.query(`SELECT count(*)::int AS n FROM "meet_review" r LEFT JOIN "meet" m ON m.id = r."meetId"
				WHERE r.type = 'endorsement' AND r."createdAt" >= $1 AND r."createdAt" < $2 AND (m.id IS NULL OR m.name NOT LIKE $3)`, [win[0], win[1], PROBE]) as { n: number }[])[0].n);
			if (ps.month) {
				const win = monthWindow(ps.month); const current = monthKey(new Date());
				const [cy, cm] = current.split('-').map(Number); const [y, mo] = ps.month.split('-').map(Number);
				const back = (cy - y) * 12 + (cm - mo);
				if (!win || !MONTH_RX.test(ps.month) || back < 1 || back > MONTHS_BACK) throw new ApiError(meta.errors.badMonth);
				const awards = Number((await this.db.query(`SELECT count(*)::int AS n FROM "kudos_award" WHERE month = $1`, [ps.month]) as { n: number }[])[0].n);
				if (awards > 0 || (await nonProbeIn(win)) > 0) throw new ApiError(meta.errors.monthInUse);
				const at = new Date(win[0].getTime() + 14 * 86400e3 + 12 * 3600e3);   // the 15th, midday Hong Kong
				await this.db.query(`UPDATE "meet_review" SET "createdAt" = $2 WHERE id = $1`, [rv.id, at]);
				return { reviewId: rv.id, createdAt: at.toISOString(), clearedAwards: 0 };
			}
			const now = new Date();
			await this.db.query(`UPDATE "meet_review" SET "createdAt" = $2 WHERE id = $1`, [rv.id, now]);
			let cleared = 0;
			if (ps.clearMonth) {
				const win = monthWindow(ps.clearMonth);
				if (!win) throw new ApiError(meta.errors.badMonth);
				if ((await nonProbeIn(win)) > 0) throw new ApiError(meta.errors.monthInUse);
				const before = Number((await this.db.query(`SELECT count(*)::int AS n FROM "kudos_award" WHERE month = $1`, [ps.clearMonth]) as { n: number }[])[0].n);
				await this.db.query(`DELETE FROM "kudos_award" WHERE month = $1`, [ps.clearMonth]);
				cleared = before;
			}
			return { reviewId: rv.id, createdAt: now.toISOString(), clearedAwards: cleared };
		});
	}
}

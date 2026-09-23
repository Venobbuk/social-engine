/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DI } from '@/di-symbols.js';

// NO-SHOW-HISTORY-V1 (lane meets-fixes, 2026-09-23; matrix A-no-show-history.02 / A-roles-action.03) — Reclub's No Show
// History: the meets a player was tagged "No show" on, newest first. EXTENDED from MeetService.noShowCount (the same rows,
// the count already public as "No showed N times in 30 days") — this returns them instead of counting them.
// G15.5: a meet's name / id is given only when the viewer may read that meet (public, or the viewer hosts or is on it);
// any other row is a date and `private: true`.
export const meta = {
	tags: ['meets'],
	requireCredential: false,
	kind: 'read:meets',
	res: { type: 'object', optional: false, nullable: false, properties: {
		userId: { type: 'string', optional: false, nullable: false },
		count30d: { type: 'number', optional: false, nullable: false },
		rows: { type: 'array', optional: false, nullable: false, items: { type: 'object', optional: false, nullable: false } },
	} },
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		userId: { type: 'string', format: 'misskey:id' },
		limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
	},
	required: ['userId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(@Inject(DI.db) private db: DataSource) {
		super(meta, paramDef, async (ps, me) => {
			const rows = await this.db.query(
				`SELECT m."id", m."name", m."startAt", m."visibility", m."hostId",
				        (m."visibility" = 'public' OR m."hostId" = $2 OR EXISTS (SELECT 1 FROM "meet_participant" v WHERE v."meetId" = m."id" AND v."userId" = $2)) AS "readable"
				   FROM "meet_participant" p JOIN "meet" m ON m."id" = p."meetId"
				  WHERE p."userId" = $1 AND 'noShow' = ANY(p."tags")
				  ORDER BY m."startAt" DESC LIMIT $3`, [ps.userId, me?.id ?? '', ps.limit ?? 50]) as { id: string; name: string; startAt: Date; readable: boolean }[];
			const since = Date.now() - 30 * 86_400_000;
			return {
				userId: ps.userId,
				count30d: rows.filter(r => new Date(r.startAt).getTime() >= since).length,
				rows: rows.map(r => r.readable
					? { meetId: r.id, name: r.name, startAt: new Date(r.startAt).toISOString(), private: false }
					: { meetId: null, name: null, startAt: new Date(r.startAt).toISOString(), private: true }),
			};
		});
	}
}

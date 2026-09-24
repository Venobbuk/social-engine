/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DI } from '@/di-symbols.js';

// KUDOS-CHAT-V1 (D-award-showcase.01): the winner dismissed the "MOST STREET CRED" popup — it stops appearing on Home.
// Only the award's own winner can mark it (anyone else: nothing changes, 0 rows).
export const meta = {
	tags: ['stats'],
	requireCredential: true,
	kind: 'write:account',
	res: { type: 'object', optional: false, nullable: false, properties: { updated: { type: 'number', optional: false, nullable: false } } },
} as const;

export const paramDef = {
	type: 'object',
	properties: { awardIds: { type: 'array', minItems: 1, maxItems: 50, items: { type: 'string', format: 'misskey:id' } } },
	required: ['awardIds'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(@Inject(DI.db) private db: DataSource) {
		super(meta, paramDef, async (ps, me) => {
			const r = await this.db.query(`UPDATE kudos_award SET "seenAt" = now() WHERE id = ANY($1) AND "userId" = $2 AND "seenAt" IS NULL RETURNING id`, [ps.awardIds, me.id]) as unknown[];
			return { updated: Array.isArray(r) ? (Array.isArray(r[0]) ? (r[0] as unknown[]).length : r.length) : 0 };
		});
	}
}

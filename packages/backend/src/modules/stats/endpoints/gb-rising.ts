/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DI } from '@/di-symbols.js';
import { UserEntityService } from '@/core/entities/UserEntityService.js';
import { risingOf } from '../GbRating.js';

// GB-RATING-V1: Rising players — the biggest 30-day GripBat rating gains (≥ 5 rated matches), with their upsets.
export const meta = {
	tags: ['stats'],
	requireCredential: false,
	kind: 'read:meets',
	res: { type: 'array', optional: false, nullable: false, items: { type: 'object', optional: false, nullable: false } },
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		sport: { type: 'string', default: 'pickleball', maxLength: 32 },
		limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
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
			const rows = await risingOf(this.db, ps.sport, ps.limit);
			const out = [];
			for (const r of rows) out.push({ ...r, user: await this.userEntityService.pack(r.userId, me, { schema: 'UserLite' }).catch(() => null) });
			return out;
		});
	}
}

/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DI } from '@/di-symbols.js';
import { expectationsFor } from '../GbRating.js';

// ODDS-ONE-V1 (BENCH-C, lane CLAIMS O5): expected win % per match before play — the rating job's own rule, one source for
// the meet and competition match cards. Sides are user ids (a guest = null → no odds for that match).
export const meta = {
	tags: ['stats'],
	requireCredential: false,
	kind: 'read:meets',
	res: { type: 'array', optional: false, nullable: false, items: { type: 'object', optional: false, nullable: false } },
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		matches: { type: 'array', minItems: 1, maxItems: 80, items: { type: 'object', properties: {
			id: { type: 'string', maxLength: 64 },
			a: { type: 'array', minItems: 1, maxItems: 8, items: { type: 'string', nullable: true, maxLength: 32 } },
			b: { type: 'array', minItems: 1, maxItems: 8, items: { type: 'string', nullable: true, maxLength: 32 } },
		}, required: ['id', 'a', 'b'] } },
		sport: { type: 'string', default: 'pickleball', maxLength: 32 },
	},
	required: ['matches'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.db)
		private db: DataSource,
	) {
		super(meta, paramDef, async (ps, me) => expectationsFor(this.db, ps.matches as { id: string; a: (string | null)[]; b: (string | null)[] }[], ps.sport, me?.id ?? null));
	}
}

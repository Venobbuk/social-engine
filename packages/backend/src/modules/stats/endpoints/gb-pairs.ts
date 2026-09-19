/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DI } from '@/di-symbols.js';
import { pairsOf } from '../GbRating.js';

// GB-RATING-V1: scouting — how each pair has done together in GripBat matches (matches, wins, expected wins).
export const meta = {
	tags: ['stats'],
	requireCredential: false,
	kind: 'read:meets',
	res: { type: 'array', optional: false, nullable: false, items: { type: 'object', optional: false, nullable: false } },
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		pairs: { type: 'array', maxItems: 40, items: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'string', format: 'misskey:id' } } },
		sport: { type: 'string', default: 'pickleball', maxLength: 32 },
	},
	required: ['pairs'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.db)
		private db: DataSource,
	) {
		super(meta, paramDef, async (ps) => pairsOf(this.db, ps.pairs as [string, string][], ps.sport));
	}
}

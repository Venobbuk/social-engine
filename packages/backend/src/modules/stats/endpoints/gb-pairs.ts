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
		super(meta, paramDef, async (ps, me) => {
			// SEC-ANON-CHEM-V1 (2026-09-21, permission-sweep hole 3): a NEGATIVE partner-chemistry score is private to
			// the two players it is about. gb-edge already applies this rule (SEC-ANON-FIELDS-V1) and shows only
			// positive-chemistry partners to anyone else; this door answered the same question in raw form — matches,
			// wins and expected for ANY pair, 40 a call, with no credential — so edge = (wins - expected) / matches
			// was computable for strangers. Scouting keeps what it needs (how often a pair has played, and a pair that
			// is doing WELL); a pair the caller is not in keeps its bad news to itself.
			const rows = await pairsOf(this.db, ps.pairs as [string, string][], ps.sport);
			const meId = me?.id ?? null;
			return rows.map(r => {
				if (meId && (r.a === meId || r.b === meId)) return r;           // your own chemistry, in full
				const edge = r.matches > 0 ? (r.wins - r.expected) / r.matches : 0;
				if (edge >= 0) return r;                                         // positive chemistry is public, as on gb-edge
				return { a: r.a, b: r.b, matches: r.matches, wins: null, expected: null, chemistryHidden: true };
			});
		});
	}
}

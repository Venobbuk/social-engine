/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DI } from '@/di-symbols.js';
import { IdService } from '@/core/IdService.js';
import { ApiError } from '@/server/api/error.js';
import { venueRestErrors, venueRow, MAX_PINS } from '@/modules/venues/VenueExtras.js';

// VENUES-REST-V1 — Reclub venue ⋮ "Pin to home" / "Unpin from home" (pinVenue / unpinVenue, the Home pinned quick bar).
// The same shape as the NATIVE club pin (channels/favorite → channel_favorite (userId, channelId), which the app already
// uses for "Pin to home screen" on a club — lib/social pinClub); a venue is not a channel, so it has its own row.
// `pinned: false` unpins. Idempotent both ways (a second pin is not an error — unlike the native favourite's 500).
export const meta = {
	tags: ['venues'],
	requireCredential: true,
	kind: 'write:account',
	res: { type: 'object', optional: false, nullable: false, properties: { pinned: { type: 'boolean', optional: false, nullable: false } } },
	errors: { noSuchVenue: venueRestErrors.noSuchVenue, tooManyPins: venueRestErrors.tooManyPins },
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		venueId: { type: 'string', format: 'misskey:id' },
		pinned: { type: 'boolean', default: true },
	},
	required: ['venueId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.db) private db: DataSource,
		private idService: IdService,
	) {
		super(meta, paramDef, async (ps, me) => {
			if (!ps.pinned) {
				await this.db.query(`DELETE FROM venue_pin WHERE "userId" = $1 AND "venueId" = $2`, [me.id, ps.venueId]);
				return { pinned: false };
			}
			const v = await venueRow(this.db, ps.venueId);
			if (!v) throw new ApiError(meta.errors.noSuchVenue);
			const n = await this.db.query(`SELECT count(*)::int AS n FROM venue_pin WHERE "userId" = $1 AND "venueId" <> $2`, [me.id, v.id]) as { n: number }[];
			if ((Number(n[0]?.n) || 0) >= MAX_PINS) throw new ApiError(meta.errors.tooManyPins);
			await this.db.query(`INSERT INTO venue_pin (id, "userId", "venueId", "createdAt") VALUES ($1, $2, $3, now()) ON CONFLICT ("userId", "venueId") DO NOTHING`, [this.idService.gen(), me.id, v.id]);
			return { pinned: true };
		});
	}
}

/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { MeetsRepository } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import { ApiError } from '@/server/api/error.js';
import { meetErrors } from './_shared.js';

// MEET-SAVE-V1 (lane meets-fixes, 2026-09-23; matrix A-meet-listings-popup.02, t3 deferred) — Reclub's "Add to My
// Activities" / "Remove from Activities" on a LISTING (the engine refuses an RSVP on one, MeetService.join). NEW: searched
// Misskey first — clips / favorites are note-based, not meet-based. A saved meet is listed by meets/list scope 'mine'.
//   { meetId, on }  save / unsave      { meetId }  read the state
export const meta = {
	tags: ['meets'],
	requireCredential: true,
	kind: 'write:meets',
	res: { type: 'object', optional: false, nullable: false, properties: { saved: { type: 'boolean', optional: false, nullable: false } } },
	errors: { noSuchMeet: meetErrors.noSuchMeet, notListing: { message: 'Only a listing can be saved to your activities.', code: 'MEET_NOT_LISTING', id: '6b1d0a3e-8f41-4c0b-9b7e-1a00000000cb' } },
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		meetId: { type: 'string', format: 'misskey:id' },
		on: { type: 'boolean' },
	},
	required: ['meetId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.meetsRepository) private meetsRepository: MeetsRepository,
		@Inject(DI.db) private db: DataSource,
	) {
		super(meta, paramDef, async (ps, me) => {
			const meet = await this.meetsRepository.findOneBy({ id: ps.meetId });
			if (meet == null || (meet.visibility !== 'public' && meet.hostId !== me.id)) throw new ApiError(meta.errors.noSuchMeet);
			if (ps.on === true) {
				if (meet.type !== 'listing') throw new ApiError(meta.errors.notListing);
				await this.db.query(`INSERT INTO "meet_saved" ("userId", "meetId") VALUES ($1, $2) ON CONFLICT DO NOTHING`, [me.id, meet.id]);
			} else if (ps.on === false) {
				await this.db.query(`DELETE FROM "meet_saved" WHERE "userId" = $1 AND "meetId" = $2`, [me.id, meet.id]);
			}
			const r = await this.db.query(`SELECT 1 FROM "meet_saved" WHERE "userId" = $1 AND "meetId" = $2`, [me.id, meet.id]) as unknown[];
			return { saved: r.length > 0 };
		});
	}
}

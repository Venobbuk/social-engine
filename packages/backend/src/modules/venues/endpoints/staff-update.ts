/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { DI } from '@/di-symbols.js';
import { ApiError } from '@/server/api/error.js';
import { isGripbatStaff, notStaffError } from '@/modules/staff.js';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { VenueService } from '@/modules/venues/VenueService.js';
import { venueErrors, packVenue, toVenueApiError } from './_shared.js';
import { venueRestErrors } from '@/modules/venues/VenueExtras.js';   // VENUES-REST-V1

// Reclub staff: verify / close a venue, assign its owner (module 7379 venue-owner). STAFF-ROLE-V1 (batch-1 review fix):
// holders of the GripBat staff role only (modules/staff.ts), not Misskey moderators.
export const meta = {
	tags: ['venues'],
	requireCredential: true,
	kind: 'write:meets',
	res: { type: 'object', optional: false, nullable: false, ref: 'Venue' },
	errors: { noSuchVenue: venueErrors.noSuchVenue, notStaff: notStaffError, noSuchUser: venueRestErrors.noSuchUser },
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		venueId: { type: 'string', format: 'misskey:id' },
		status: { type: 'string', nullable: true, enum: ['verified', 'under_review', 'closed'] },
		ownerUserId: { type: 'string', format: 'misskey:id', nullable: true },
		notes: { type: 'string', nullable: true, maxLength: 2048 },
		// VENUES-REST-V1: Reclub venue-owner.tsx picks several players — the first is the primary owner, the rest co-owners
		ownerUserIds: { type: 'array', maxItems: 10, uniqueItems: true, items: { type: 'string', format: 'misskey:id' } },
	},
	required: ['venueId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.db) private db: DataSource,
		private venueService: VenueService,
	) {
		super(meta, paramDef, async (ps, me) => {
			if (!(await isGripbatStaff(this.db, me.id))) throw new ApiError(meta.errors.notStaff);
			try {
				const patch: Parameters<VenueService['staffUpdate']>[1] = {};
				if (ps.status != null) patch.status = ps.status;
				if (ps.ownerUserId !== undefined) patch.ownerUserId = ps.ownerUserId;
				if (ps.notes !== undefined) patch.notes = ps.notes;
				if (ps.ownerUserIds !== undefined) {   // VENUES-REST-V1 owners: every id must be a real local user
					const ids = ps.ownerUserIds;
					const found = ids.length ? await this.db.query(`SELECT id FROM "user" WHERE id = ANY($1) AND host IS NULL`, [ids]) as { id: string }[] : [];
					if (found.length !== ids.length) throw new ApiError(venueRestErrors.noSuchUser);
					patch.ownerUserId = ids[0] ?? null;
					await this.db.query(`UPDATE venue SET "coOwnerIds" = $2 WHERE id = $1`, [ps.venueId, ids.slice(1)]);
				}
				return packVenue(await this.venueService.staffUpdate(ps.venueId, patch));
			} catch (e) {
				return toVenueApiError(e);
			}
		});
	}
}

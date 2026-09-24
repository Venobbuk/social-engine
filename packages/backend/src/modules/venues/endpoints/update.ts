/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { VenuesRepository } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import { ApiError } from '@/server/api/error.js';
import { venueRestErrors, venueRow, roleOn } from '@/modules/venues/VenueExtras.js';
import { packVenue } from './_shared.js';

// VENUES-REST-V1 — Reclub owner/staff "Edit Venue" / "Update venue" ("Venue updated successfully!"): the venue's details.
// Owners (primary or co-owner) and GripBat staff. The status (Verified / Under review / Closed) and the owners stay
// staff-only on venues/staff-update — an owner cannot verify their own venue.
export const meta = {
	tags: ['venues'],
	requireCredential: true,
	kind: 'write:meets',
	res: { type: 'object', optional: false, nullable: false, ref: 'Venue' },
	errors: { noSuchVenue: venueRestErrors.noSuchVenue, notManager: venueRestErrors.notManager },
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		venueId: { type: 'string', format: 'misskey:id' },
		name: { type: 'string', minLength: 1, maxLength: 256 },
		address: { type: 'string', nullable: true, maxLength: 512 },
		district: { type: 'string', nullable: true, maxLength: 128 },
		lat: { type: 'number', minimum: -90, maximum: 90 },
		lng: { type: 'number', minimum: -180, maximum: 180 },
		courtCount: { type: 'integer', nullable: true, minimum: 0, maximum: 500 },
		notes: { type: 'string', nullable: true, maxLength: 2048 },
	},
	required: ['venueId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.db) private db: DataSource,
		@Inject(DI.venuesRepository) private venuesRepository: VenuesRepository,
	) {
		super(meta, paramDef, async (ps, me) => {
			const v = await venueRow(this.db, ps.venueId);
			if (!v) throw new ApiError(meta.errors.noSuchVenue);
			if (!(await roleOn(this.db, v, me.id)).manager) throw new ApiError(meta.errors.notManager);
			const patch: Record<string, unknown> = { updatedAt: new Date() };
			if (ps.name !== undefined) patch.name = ps.name.trim().slice(0, 256);
			if (ps.address !== undefined) patch.address = ps.address?.trim().slice(0, 512) || null;
			if (ps.district !== undefined) patch.district = ps.district?.trim().slice(0, 128) || null;
			if (ps.lat !== undefined && ps.lng !== undefined) { patch.lat = ps.lat; patch.lng = ps.lng; }
			if (ps.courtCount !== undefined) patch.courtCount = ps.courtCount;
			if (ps.notes !== undefined) patch.notes = ps.notes?.trim().slice(0, 2048) || null;
			await this.venuesRepository.update(v.id, patch);
			return packVenue(await this.venuesRepository.findOneByOrFail({ id: v.id }));
		});
	}
}

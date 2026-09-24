/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { VenueService } from '@/modules/venues/VenueService.js';
import { packVenue } from './_shared.js';
import { Inject } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import type { DriveFilesRepository } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import { DriveFileEntityService } from '@/core/entities/DriveFileEntityService.js';
import { coversOf } from '@/modules/venues/VenueExtras.js';   // VENUES-REST-V1

// VENUE-V1: nearby / keyword venue search (Reclub Venues pane). Verified only unless includeUnderReview.
export const meta = {
	tags: ['venues'],
	requireCredential: false,
	res: { type: 'array', optional: false, nullable: false, items: { type: 'object', optional: false, nullable: false, ref: 'Venue' } },
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		q: { type: 'string', nullable: true, maxLength: 128 },
		lat: { type: 'number', nullable: true, minimum: -90, maximum: 90 },
		lng: { type: 'number', nullable: true, minimum: -180, maximum: 180 },
		radiusKm: { type: 'number', nullable: true, minimum: 1, maximum: 80 },
		includeUnderReview: { type: 'boolean', default: false },
		limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
	},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private venueService: VenueService,
		@Inject(DI.db) private db: DataSource,
		@Inject(DI.driveFilesRepository) private driveFilesRepository: DriveFilesRepository,
		private driveFileEntityService: DriveFileEntityService,
	) {
		super(meta, paramDef, async (ps) => {
			const rows = await this.venueService.search({ q: ps.q, lat: ps.lat, lng: ps.lng, radiusKm: ps.radiusKm, includeUnderReview: ps.includeUnderReview, limit: ps.limit });
			// VENUES-REST-V1 search: the card's photo carousel (C-discover.23) — up to 5 per venue, one query for the page
			const covers = await coversOf(this.db, this.driveFilesRepository, this.driveFileEntityService, rows.map(r => r.id), 5);
			return rows.map(r => ({ ...packVenue(r), photos: covers[r.id] ?? [] }));
		});
	}
}

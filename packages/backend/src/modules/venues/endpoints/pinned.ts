/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { In } from 'typeorm';
import type { DataSource } from 'typeorm';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { VenuesRepository, DriveFilesRepository } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import { DriveFileEntityService } from '@/core/entities/DriveFileEntityService.js';
import { coversOf } from '@/modules/venues/VenueExtras.js';
import { packVenue } from './_shared.js';

// VENUES-REST-V1 — the venues I pinned to Home (Reclub GET /user/pinned, venue items of the pinned quick bar), in the
// order I pinned them, each with its cover photo (the first of the carousel) when it has one.
export const meta = {
	tags: ['venues'],
	requireCredential: true,
	kind: 'read:account',
	res: { type: 'array', optional: false, nullable: false, items: { type: 'object', optional: false, nullable: false } },
} as const;

export const paramDef = { type: 'object', properties: {}, required: [] } as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.db) private db: DataSource,
		@Inject(DI.venuesRepository) private venuesRepository: VenuesRepository,
		@Inject(DI.driveFilesRepository) private driveFilesRepository: DriveFilesRepository,
		private driveFileEntityService: DriveFileEntityService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const pins = await this.db.query(`SELECT "venueId" FROM venue_pin WHERE "userId" = $1 ORDER BY "createdAt" ASC LIMIT 12`, [me.id]) as { venueId: string }[];
			if (!pins.length) return [];
			const ids = pins.map(p => p.venueId);
			const byId = new Map((await this.venuesRepository.findBy({ id: In(ids) })).map(v => [v.id, v]));
			const covers = await coversOf(this.db, this.driveFilesRepository, this.driveFileEntityService, ids, 1);
			return ids.filter(id => byId.has(id)).map(id => ({ ...packVenue(byId.get(id)!), isPinned: true, cover: covers[id]?.[0]?.thumbnailUrl ?? null }));
		});
	}
}

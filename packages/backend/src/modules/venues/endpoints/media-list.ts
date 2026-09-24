/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { DriveFilesRepository } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import { DriveFileEntityService } from '@/core/entities/DriveFileEntityService.js';
import { ApiError } from '@/server/api/error.js';
import { venueRestErrors, venueRow, roleOn, listMedia } from '@/modules/venues/VenueExtras.js';

// VENUES-REST-V1 — Reclub venue media (7374 GET /media): a venue's photos, pinned first then newest. Public read (a venue
// page is public); canDelete / canPin say what THIS reader may do (the author deletes their own; owners + staff all).
export const meta = {
	tags: ['venues'],
	requireCredential: false,
	res: { type: 'array', optional: false, nullable: false, items: { type: 'object', optional: false, nullable: false } },
	errors: { noSuchVenue: venueRestErrors.noSuchVenue },
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		venueId: { type: 'string', format: 'misskey:id' },
		limit: { type: 'integer', minimum: 1, maximum: 200, default: 100 },
	},
	required: ['venueId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.db) private db: DataSource,
		@Inject(DI.driveFilesRepository) private driveFilesRepository: DriveFilesRepository,
		private driveFileEntityService: DriveFileEntityService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const v = await venueRow(this.db, ps.venueId);
			if (!v) throw new ApiError(meta.errors.noSuchVenue);
			const role = await roleOn(this.db, v, me?.id);
			return await listMedia(this.db, this.driveFilesRepository, this.driveFileEntityService, v.id, me ? { id: me.id, manager: role.manager } : null, ps.limit);
		});
	}
}

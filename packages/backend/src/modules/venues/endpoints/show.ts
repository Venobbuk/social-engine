/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { VenueService } from '@/modules/venues/VenueService.js';
import { ApiError } from '@/server/api/error.js';
import { venueErrors, packVenue } from './_shared.js';
import { Inject } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import type { DriveFilesRepository } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import { DriveFileEntityService } from '@/core/entities/DriveFileEntityService.js';
import { venueRow, roleOn, mediaCount, isPinnedBy, coversOf } from '@/modules/venues/VenueExtras.js';   // VENUES-REST-V1

export const meta = {
	tags: ['venues'],
	requireCredential: false,
	res: { type: 'object', optional: false, nullable: false, ref: 'Venue' },
	errors: { noSuchVenue: venueErrors.noSuchVenue },
} as const;

export const paramDef = {
	type: 'object',
	properties: { venueId: { type: 'string', format: 'misskey:id' } },
	required: ['venueId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private venueService: VenueService,
		@Inject(DI.db) private db: DataSource,
		@Inject(DI.driveFilesRepository) private driveFilesRepository: DriveFilesRepository,
		private driveFileEntityService: DriveFileEntityService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const v = await this.venueService.show(ps.venueId);
			if (!v) throw new ApiError(meta.errors.noSuchVenue);
			// VENUES-REST-V1 show: what THIS reader may do (owner / co-owner / staff), their Home pin, the photos
			const row = await venueRow(this.db, v.id);
			const role = row ? await roleOn(this.db, row, me?.id) : { owner: false, primary: false, staff: false, manager: false };
			const [count, pinned, covers] = await Promise.all([mediaCount(this.db, v.id), isPinnedBy(this.db, v.id, me?.id), coversOf(this.db, this.driveFilesRepository, this.driveFileEntityService, [v.id], 5)]);
			return { ...packVenue(v), coOwnerIds: row?.coOwnerIds ?? [], canManage: role.manager, canDelete: role.staff || (role.primary && v.source === 'community'), canManageOwners: role.staff, isPinned: pinned, mediaCount: count, notes: role.manager ? v.notes : null, cover: covers[v.id]?.[0]?.thumbnailUrl ?? null, photos: covers[v.id] ?? [] };
		});
	}
}

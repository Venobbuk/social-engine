/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { In } from 'typeorm';
import type { DataSource } from 'typeorm';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { DriveFilesRepository } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import { IdService } from '@/core/IdService.js';
import { DriveFileEntityService } from '@/core/entities/DriveFileEntityService.js';
import { ApiError } from '@/server/api/error.js';
import { venueRestErrors, venueRow, roleOn, listMedia, PER_USER_PHOTOS } from '@/modules/venues/VenueExtras.js';

// VENUES-REST-V1 — Reclub venue media Add (7374 POST /media {mediaIds}). The photo is uploaded first through the NATIVE
// drive/files/create (G11 REUSED); this ties up to 4 of MY image files to the venue. Any signed-in player may add
// (Reclub: the venue card's "+ Add photo", the media page's FAB) — a wrong photo is deleted by the owners / staff, and
// players report one through venue feedback "Incorrect venue images". Cap: 40 photos per person per venue.
export const meta = {
	tags: ['venues'],
	requireCredential: true,
	kind: 'write:drive',
	res: { type: 'array', optional: false, nullable: false, items: { type: 'object', optional: false, nullable: false } },
	errors: { noSuchVenue: venueRestErrors.noSuchVenue, noSuchFile: venueRestErrors.noSuchFile, tooManyPhotos: venueRestErrors.tooManyPhotos },
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		venueId: { type: 'string', format: 'misskey:id' },
		fileIds: { type: 'array', minItems: 1, maxItems: 4, uniqueItems: true, items: { type: 'string', format: 'misskey:id' } },
	},
	required: ['venueId', 'fileIds'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.db) private db: DataSource,
		@Inject(DI.driveFilesRepository) private driveFilesRepository: DriveFilesRepository,
		private driveFileEntityService: DriveFileEntityService,
		private idService: IdService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const v = await venueRow(this.db, ps.venueId);
			if (!v) throw new ApiError(meta.errors.noSuchVenue);
			const files = await this.driveFilesRepository.findBy({ id: In(ps.fileIds), userId: me.id });
			if (files.length !== ps.fileIds.length || files.some(f => !f.type.startsWith('image/'))) throw new ApiError(meta.errors.noSuchFile);
			const have = await this.db.query(`SELECT count(*)::int AS n FROM venue_media WHERE "venueId" = $1 AND "userId" = $2`, [v.id, me.id]) as { n: number }[];
			if ((Number(have[0]?.n) || 0) + files.length > PER_USER_PHOTOS) throw new ApiError(meta.errors.tooManyPhotos);
			for (const f of files) {
				await this.db.query(`INSERT INTO venue_media (id, "venueId", "fileId", "userId", "isPinned", "createdAt") VALUES ($1, $2, $3, $4, false, now()) ON CONFLICT ("venueId", "fileId") DO NOTHING`,
					[this.idService.gen(), v.id, f.id, me.id]);
			}
			const role = await roleOn(this.db, v, me.id);
			const all = await listMedia(this.db, this.driveFilesRepository, this.driveFileEntityService, v.id, { id: me.id, manager: role.manager }, 200);
			const want = new Set(ps.fileIds);
			return all.filter(m => want.has(m.fileId));
		});
	}
}

/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DI } from '@/di-symbols.js';
import { ApiError } from '@/server/api/error.js';
import { venueRestErrors, venueRow, roleOn } from '@/modules/venues/VenueExtras.js';

// VENUES-REST-V1 — Reclub venue media select-delete (7374 DELETE /media/<id>, onDeleteSelected) and the gallery's
// "Delete media". All or nothing: every id must be deletable by this reader (its author, a venue owner, or staff).
// The drive file itself stays the author's (native drive/files/delete is theirs); only the tie to the venue goes.
export const meta = {
	tags: ['venues'],
	requireCredential: true,
	kind: 'write:drive',
	res: { type: 'object', optional: false, nullable: false, properties: { deleted: { type: 'integer', optional: false, nullable: false } } },
	errors: { noSuchMedia: venueRestErrors.noSuchMedia, notMediaDeleter: venueRestErrors.notMediaDeleter },
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		mediaIds: { type: 'array', minItems: 1, maxItems: 100, uniqueItems: true, items: { type: 'string', format: 'misskey:id' } },
	},
	required: ['mediaIds'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(@Inject(DI.db) private db: DataSource) {
		super(meta, paramDef, async (ps, me) => {
			const rows = await this.db.query(`SELECT id, "venueId", "userId" FROM venue_media WHERE id = ANY($1)`, [ps.mediaIds]) as { id: string; venueId: string; userId: string }[];
			if (rows.length !== ps.mediaIds.length) throw new ApiError(meta.errors.noSuchMedia);
			const managerOf = new Map<string, boolean>();
			for (const r of rows) {
				if (r.userId === me.id) continue;
				if (!managerOf.has(r.venueId)) { const v = await venueRow(this.db, r.venueId); managerOf.set(r.venueId, !!v && (await roleOn(this.db, v, me.id)).manager); }
				if (!managerOf.get(r.venueId)) throw new ApiError(meta.errors.notMediaDeleter);
			}
			await this.db.query(`DELETE FROM venue_media WHERE id = ANY($1)`, [ps.mediaIds]);
			return { deleted: rows.length };
		});
	}
}

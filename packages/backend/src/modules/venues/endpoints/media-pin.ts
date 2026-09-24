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

// VENUES-REST-V1 — Reclub gallery photo menu "Pin to carousel top" (6263, isVenueOwner / isAdmin; 7374 PUT /media/<id>
// {isPinned}). Venue owners and GripBat staff only.
export const meta = {
	tags: ['venues'],
	requireCredential: true,
	kind: 'write:drive',
	res: { type: 'object', optional: false, nullable: false, properties: { isPinned: { type: 'boolean', optional: false, nullable: false } } },
	errors: { noSuchMedia: venueRestErrors.noSuchMedia, notManager: venueRestErrors.notManager },
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		mediaId: { type: 'string', format: 'misskey:id' },
		isPinned: { type: 'boolean' },
	},
	required: ['mediaId', 'isPinned'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(@Inject(DI.db) private db: DataSource) {
		super(meta, paramDef, async (ps, me) => {
			const r = (await this.db.query(`SELECT id, "venueId" FROM venue_media WHERE id = $1`, [ps.mediaId]) as { id: string; venueId: string }[])[0];
			if (!r) throw new ApiError(meta.errors.noSuchMedia);
			const v = await venueRow(this.db, r.venueId);
			if (!v || !(await roleOn(this.db, v, me.id)).manager) throw new ApiError(meta.errors.notManager);
			await this.db.query(`UPDATE venue_media SET "isPinned" = $2 WHERE id = $1`, [r.id, ps.isPinned]);
			return { isPinned: ps.isPinned };
		});
	}
}

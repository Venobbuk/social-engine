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

// VENUES-REST-V1 — Reclub owner/staff "Delete Venue" ("Are you sure you want to delete this venue?" → "Venue deleted
// successfully!"). GripBat staff may delete any venue; the PRIMARY owner may delete a player-added (community) venue.
// A league venue (synced from the league) is staff's alone — the next sync would bring it back anyway.
// Meets keep their own venue name / address / coordinates (denormalised), so they stay readable; their venueId is
// cleared so no page links to a venue that is gone. Photos (venue_media) and pins (venue_pin) go with it (FK cascade).
export const meta = {
	tags: ['venues'],
	requireCredential: true,
	kind: 'write:meets',
	res: { type: 'object', optional: false, nullable: false, properties: { deleted: { type: 'boolean', optional: false, nullable: false }, meetsDetached: { type: 'integer', optional: false, nullable: false } } },
	errors: { noSuchVenue: venueRestErrors.noSuchVenue, notDeleter: venueRestErrors.notDeleter },
} as const;

export const paramDef = {
	type: 'object',
	properties: { venueId: { type: 'string', format: 'misskey:id' } },
	required: ['venueId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(@Inject(DI.db) private db: DataSource) {
		super(meta, paramDef, async (ps, me) => {
			const v = await venueRow(this.db, ps.venueId);
			if (!v) throw new ApiError(meta.errors.noSuchVenue);
			const role = await roleOn(this.db, v, me.id);
			if (!(role.staff || (role.primary && v.source === 'community'))) throw new ApiError(meta.errors.notDeleter);
			const detached = await this.db.transaction(async (em) => {
				const r = await em.query(`UPDATE meet SET "venueId" = NULL WHERE "venueId" = $1`, [v.id]) as [unknown, number];
				await em.query(`DELETE FROM venue WHERE id = $1`, [v.id]);
				return Array.isArray(r) ? Number(r[1]) || 0 : 0;
			});
			return { deleted: true, meetsDetached: detached };
		});
	}
}

/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { VenueService } from '@/modules/venues/VenueService.js';
import { venueErrors, packVenue, toVenueApiError } from './_shared.js';

// Reclub staff: verify / close a venue, assign its owner (module 7379 venue-owner). Moderators only.
export const meta = {
	tags: ['venues'],
	requireCredential: true,
	requireModerator: true,
	kind: 'write:meets',
	res: { type: 'object', optional: false, nullable: false, ref: 'Venue' },
	errors: { noSuchVenue: venueErrors.noSuchVenue },
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		venueId: { type: 'string', format: 'misskey:id' },
		status: { type: 'string', nullable: true, enum: ['verified', 'under_review', 'closed'] },
		ownerUserId: { type: 'string', format: 'misskey:id', nullable: true },
		notes: { type: 'string', nullable: true, maxLength: 2048 },
	},
	required: ['venueId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private venueService: VenueService) {
		super(meta, paramDef, async (ps) => {
			try {
				const patch: Parameters<VenueService['staffUpdate']>[1] = {};
				if (ps.status != null) patch.status = ps.status;
				if (ps.ownerUserId !== undefined) patch.ownerUserId = ps.ownerUserId;
				if (ps.notes !== undefined) patch.notes = ps.notes;
				return packVenue(await this.venueService.staffUpdate(ps.venueId, patch));
			} catch (e) {
				return toVenueApiError(e);
			}
		});
	}
}

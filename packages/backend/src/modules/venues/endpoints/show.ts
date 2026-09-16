/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { VenueService } from '@/modules/venues/VenueService.js';
import { ApiError } from '@/server/api/error.js';
import { venueErrors, packVenue } from './_shared.js';

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
	constructor(private venueService: VenueService) {
		super(meta, paramDef, async (ps) => {
			const v = await this.venueService.show(ps.venueId);
			if (!v) throw new ApiError(meta.errors.noSuchVenue);
			return packVenue(v);
		});
	}
}

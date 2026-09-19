/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { VenueService } from '@/modules/venues/VenueService.js';
import { venueErrors, toVenueApiError } from './_shared.js';

export const meta = {
	tags: ['venues'],
	requireCredential: true,
	prohibitMoved: true,
	kind: 'write:account',
	errors: { lastLocation: venueErrors.lastLocation },   // DISCOVER-W2D
} as const;

export const paramDef = {
	type: 'object',
	properties: { id: { type: 'string', format: 'misskey:id' } },
	required: ['id'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private venueService: VenueService) {
		super(meta, paramDef, async (ps, me) => { try { await this.venueService.deleteLocation(me, ps.id); } catch (e) { toVenueApiError(e); } });
	}
}

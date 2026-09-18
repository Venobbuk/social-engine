/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { VenueService, venueFeedbackCategories } from '@/modules/venues/VenueService.js';
import { venueErrors, toVenueApiError } from './_shared.js';

// DISCOVER-V3: Reclub's venue feedback form (spec_clubs_discover_home §10.1 — POST /feedback surface Venue: category,
// body, replyRequested). Signed-in players only.
export const meta = {
	tags: ['venues'],
	requireCredential: true,
	prohibitMoved: true,
	kind: 'write:meets',
	res: { type: 'object', optional: false, nullable: false, properties: {
		id: { type: 'string', optional: false, nullable: false },
		venueId: { type: 'string', optional: false, nullable: false },
		category: { type: 'string', optional: false, nullable: false },
		body: { type: 'string', optional: false, nullable: true },
		replyRequested: { type: 'boolean', optional: false, nullable: false },
		status: { type: 'string', optional: false, nullable: false },
		createdAt: { type: 'string', optional: false, nullable: false },
	} },
	errors: { noSuchVenue: venueErrors.noSuchVenue },
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		venueId: { type: 'string', format: 'misskey:id' },
		category: { type: 'string', enum: venueFeedbackCategories },
		body: { type: 'string', nullable: true, maxLength: 2048 },
		replyRequested: { type: 'boolean', default: false },
	},
	required: ['venueId', 'category'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private venueService: VenueService) {
		super(meta, paramDef, async (ps, me) => {
			try {
				const r = await this.venueService.createFeedback(me, { venueId: ps.venueId, category: ps.category, body: ps.body, replyRequested: ps.replyRequested });
				return { id: r.id, venueId: r.venueId, category: r.category, body: r.body, replyRequested: r.replyRequested, status: r.status, createdAt: r.createdAt };
			} catch (e) {
				return toVenueApiError(e);
			}
		});
	}
}

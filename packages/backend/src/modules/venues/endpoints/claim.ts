/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { VenueService } from '@/modules/venues/VenueService.js';
import { venueErrors, toVenueApiError } from './_shared.js';

// DISCOVER-V3: owner claim. Reclub assigns venue owners from a staff screen (venue-owner, module 7379) and tells
// players "Want a Verified Badge? Contact our Support team" — so a claim is a support request: a feedback row of
// category owner_claim, pending until staff set ownerUserId through venues/staff-update. Idempotent per (venue, user).
export const meta = {
	tags: ['venues'],
	requireCredential: true,
	prohibitMoved: true,
	kind: 'write:meets',
	res: { type: 'object', optional: false, nullable: false, properties: {
		venueId: { type: 'string', optional: false, nullable: false },
		status: { type: 'string', optional: false, nullable: false, enum: ['owner', 'pending'] },
		claimId: { type: 'string', optional: false, nullable: true },
		createdAt: { type: 'string', optional: false, nullable: true },
	} },
	errors: { noSuchVenue: venueErrors.noSuchVenue },
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		venueId: { type: 'string', format: 'misskey:id' },
		body: { type: 'string', nullable: true, maxLength: 2048 },
	},
	required: ['venueId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private venueService: VenueService) {
		super(meta, paramDef, async (ps, me) => {
			try {
				const v = await this.venueService.show(ps.venueId);
				if (v && v.ownerUserId === me.id) return { venueId: v.id, status: 'owner' as const, claimId: null, createdAt: null };
				// a missing venue throws venue:no_such_venue inside createFeedback → NO_SUCH_VENUE
				const r = await this.venueService.createFeedback(me, { venueId: ps.venueId, category: 'owner_claim', body: ps.body ?? null, replyRequested: true });
				return { venueId: ps.venueId, status: 'pending' as const, claimId: r.id, createdAt: r.createdAt };
			} catch (e) {
				return toVenueApiError(e);
			}
		});
	}
}

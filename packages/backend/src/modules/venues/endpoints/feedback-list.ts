/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { VenueService } from '@/modules/venues/VenueService.js';
import { RoleService } from '@/core/RoleService.js';

// DISCOVER-V3: my feedback / claim rows for a venue (the venue page shows "claim pending"); a moderator with
// `all: true` reads every row (the curation queue). `resolveId` (moderator) closes one row.
export const meta = {
	tags: ['venues'],
	requireCredential: true,
	kind: 'read:meets',
	res: { type: 'array', optional: false, nullable: false, items: { type: 'object', optional: false, nullable: false, properties: {
		id: { type: 'string', optional: false, nullable: false },
		venueId: { type: 'string', optional: false, nullable: false },
		userId: { type: 'string', optional: false, nullable: false },
		category: { type: 'string', optional: false, nullable: false },
		body: { type: 'string', optional: false, nullable: true },
		replyRequested: { type: 'boolean', optional: false, nullable: false },
		status: { type: 'string', optional: false, nullable: false },
		createdAt: { type: 'string', optional: false, nullable: false },
	} } },
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		venueId: { type: 'string', format: 'misskey:id', nullable: true },
		all: { type: 'boolean', default: false },
		status: { type: 'string', nullable: true, enum: ['open', 'resolved'] },
		resolveId: { type: 'string', format: 'misskey:id', nullable: true },
		limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
	},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private venueService: VenueService, private roleService: RoleService) {
		super(meta, paramDef, async (ps, me) => {
			const staff = ps.all || ps.resolveId ? await this.roleService.isModerator(me) : false;
			if (ps.resolveId && staff) await this.venueService.resolveFeedback(ps.resolveId);
			return await this.venueService.listFeedback({ venueId: ps.venueId, userId: ps.all && staff ? null : me.id, status: ps.status, limit: ps.limit });
		});
	}
}

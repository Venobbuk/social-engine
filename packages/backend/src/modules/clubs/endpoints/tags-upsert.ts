/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ClubService } from '@/modules/clubs/ClubService.js';
import { clubErrors, toApiError } from '@/modules/clubs/endpoints/_shared.js';

// CLUB-V3 — see modules/clubs/ClubService.ts / ClubScheduleService.ts
export const meta = {
	tags: ['clubs'],
	requireCredential: true,
	kind: 'write:channels',
	res: { type: 'object', optional: false, nullable: false },
	errors: clubErrors,
} as const;

export const paramDef = {
	type: 'object',
	properties: { channelId: { type: 'string', format: 'misskey:id' }, tagId: { type: 'string', nullable: true }, name: { type: 'string', nullable: true, maxLength: 32 }, visibility: { type: 'string', enum: ['all', 'admins'], nullable: true }, order: { type: 'integer', nullable: true, minimum: 0, maximum: 200 } },
	required: ["channelId"],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private clubService: ClubService) {
		super(meta, paramDef, async (ps, me) => {
			try {
				// Reclub POST /tags {tag, visibility, order} / PUT /tags/<id> / PUT /tags/update/order
				const c = await this.clubService.channel(ps.channelId);
				const t = await this.clubService.upsertTag(c, me, { tagId: ps.tagId, name: ps.name, visibility: ps.visibility, order: ps.order });
				return { id: t.id, name: t.name, visibility: t.visibility, order: t.order, count: Object.keys(t.members).length };
			} catch (e) {
				return toApiError(e);
			}
		});
	}
}

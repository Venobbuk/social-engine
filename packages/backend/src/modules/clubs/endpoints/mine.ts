/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ClubService } from '@/modules/clubs/ClubService.js';
import { clubErrors, toApiError } from '@/modules/clubs/endpoints/_shared.js';
import { ChannelEntityService } from '@/core/entities/ChannelEntityService.js';

// CLUB-V3 — see modules/clubs/ClubService.ts / ClubScheduleService.ts
export const meta = {
	tags: ['clubs'],
	requireCredential: true,
	kind: 'read:channels',
	res: { type: 'array', optional: false, nullable: false, items: { type: 'object', optional: false, nullable: false } },
	errors: clubErrors,
} as const;

export const paramDef = {
	type: 'object',
	properties: { tier: { type: 'string', enum: ['member', 'all'], default: 'member' } },   // CLUB-TIERS-V1
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private clubService: ClubService, private channelEntityService: ChannelEntityService) {
		super(meta, paramDef, async (ps, me) => {
			try {
				// the clubs I am in (owned or joined), pinned first, each with my state — the Home pinned row and the kebab read this
				const rows = await this.clubService.mine(me, ps.tier === 'all' ? 'all' : 'member');   // CLUB-TIERS-V1: 'all' adds the clubs I follow (role follower)
				const out = [];
				for (const r of rows) out.push({ ...(await this.channelEntityService.pack(r.channel, me, false)), pinned: r.pinned, paused: r.paused, role: r.role, myTags: r.myTags });   // CLUB-MYTAGS-V1
				return out;
			} catch (e) {
				return toApiError(e);
			}
		});
	}
}

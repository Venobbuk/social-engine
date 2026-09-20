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
	properties: { channelId: { type: 'string', format: 'misskey:id' }, paused: { type: 'boolean', nullable: true } },
	required: ["channelId"],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private clubService: ClubService) {
		super(meta, paramDef, async (ps, me) => {
			try {
				// Reclub club kebab: Take a break (PUT /users/<id> {is_active}).
				// NUKE-CLUB-PIN-V1 (G11): "Pin to home screen" is the NATIVE channels/favorite — this door never did it.
				const c = await this.clubService.channel(ps.channelId);
				const st = await this.clubService.updateMyState(c, me, { paused: ps.paused });
				const pinned = (await this.clubService.pinnedChannelIds(me.id, [c.id])).has(c.id);
				return { pinned, paused: !!st.pausedAt, pausedAt: st.pausedAt ? st.pausedAt.toISOString() : null };
			} catch (e) {
				return toApiError(e);
			}
		});
	}
}

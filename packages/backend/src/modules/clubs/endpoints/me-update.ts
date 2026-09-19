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
	// INT-BATCH2: `pinned` is gone (NUKE-CLUB-PIN-V1 — it is the native channels/favorite); `notifyMeets` stays (CLUB-TIERS-V1)
	properties: { channelId: { type: 'string', format: 'misskey:id' }, paused: { type: 'boolean', nullable: true }, notifyMeets: { type: 'boolean', nullable: true } },
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
				// CLUB-TIERS-V1: notifyMeets — 'tell me about new meets' (a follower's or a member's; notification_mute 'clubMeets')
				if (ps.notifyMeets != null) await this.clubService.setMeetsMuted(c, me, !ps.notifyMeets);
				// INT-BATCH2 × NUKE-CLUB-PIN-V1: `paused` alone reaches the state row; a caller that only flips notifyMeets
				// must not be refused for not being a member, so the state row is merely read then. `pinned` is reported
				// from the native channel favourite (channels/favorite is where it is set).
				const st = ps.paused != null ? await this.clubService.updateMyState(c, me, { paused: ps.paused }) : await this.clubService.myState(c.id, me.id);
				const pinned = (await this.clubService.pinnedChannelIds(me.id, [c.id])).has(c.id);
				const notifyMeets = !(await this.clubService.meetsMuted(c.id, me.id));
				return { pinned, paused: !!(st && st.pausedAt), pausedAt: st && st.pausedAt ? st.pausedAt.toISOString() : null, notifyMeets };
			} catch (e) {
				return toApiError(e);
			}
		});
	}
}

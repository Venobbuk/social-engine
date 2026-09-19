/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { ChannelsRepository } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import { ChannelFollowingService } from '@/core/ChannelFollowingService.js';
import { ClubService } from '@/modules/clubs/ClubService.js';
import { clubErrors, toApiError } from '@/modules/clubs/endpoints/_shared.js';
import { IdentifiableError } from '@/misc/identifiable-error.js';
import { ApiError } from '../../error.js';

// CLUB-TIERS-V1 (INT-BATCH2, supersedes CLUB-GATE-V1 INTERIM of batch 1): this stock door is a FOLLOW door again.
// Batch 1 made it the membership door because membership WAS channel_following; CLUB-TIERS-V1 splits the two —
// membership is club_member (clubs/join is the ONE gated door), following is Misskey's own channel_following.
// So the native follow below runs unchanged and NO gate applies; the only GripBat guard is that a private club is
// not followable from outside (Reclub groups:privateTip). G11: EXTEND of the native endpoint — one guard, nothing else.
export const meta = {
	tags: ['channels'],

	requireCredential: true,

	prohibitMoved: true,

	kind: 'write:channels',

	errors: {
		noSuchChannel: {
			message: 'No such channel.',
			code: 'NO_SUCH_CHANNEL',
			id: 'c0031718-d573-4e85-928e-10039f1fbb68',
		},
		alreadyFollowing: {
			message: 'You are already following that channel.',
			code: 'ALREADY_FOLLOWING',
			id: '7db31665-651e-40c1-8e6e-28e9ad829a2d',
		},
		// clubErrors carries clubPrivate (CLUB_PRIVATE, 403) — 'club:private_club' maps onto it in _shared.ts
		...clubErrors,
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		channelId: { type: 'string', format: 'misskey:id' },
	},
	required: ['channelId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.channelsRepository)
		private channelsRepository: ChannelsRepository,
		private channelFollowingService: ChannelFollowingService,
		private clubService: ClubService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const channel = await this.channelsRepository.findOneBy({
				id: ps.channelId,
			});

			if (channel == null) {
				throw new ApiError(meta.errors.noSuchChannel);
			}

			// CLUB-TIERS-V1: the follow stays Misskey's own (below); it no longer makes a member, so no gate applies —
			// only a private club refuses an outsider. Joining is clubs/join.
			await this.clubService.assertMayFollow(channel, me).catch((e: unknown) => toApiError(e));

			try {
				await this.channelFollowingService.follow(me, channel);
			} catch (e) {
				if (e instanceof IdentifiableError && e.id === '6e335e39-0203-4418-a936-b3f2dc987845') throw new ApiError(meta.errors.alreadyFollowing);
				throw e;
			}
		});
	}
}

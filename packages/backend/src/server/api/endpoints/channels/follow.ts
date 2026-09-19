/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { ChannelsRepository } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import { ClubService } from '@/modules/clubs/ClubService.js';
import { clubErrors, toApiError } from '@/modules/clubs/endpoints/_shared.js';
import { IdentifiableError } from '@/misc/identifiable-error.js';
import { ApiError } from '../../error.js';

// CLUB-GATE-V1 (W1, 2026-09-20): every channel is a club and membership IS channel_following, so this stock door is a
// membership door. It used to insert the follow unconditionally — an approval / invite-only club could be joined by
// calling it (the app's onboarding did, for every picked club). It now goes through the ONE gate, ClubService.join:
//   open → member ({status:'member'}); approval → a pending join request, not a member ({status:'requested'});
//   invite-only → CLUB_INVITE_ONLY; the invite-link token (accessToken) seats the person in any gate.
export const meta = {
	tags: ['channels'],

	requireCredential: true,

	prohibitMoved: true,

	kind: 'write:channels',

	res: { type: 'object', optional: false, nullable: false, properties: { status: { type: 'string', optional: false, nullable: false, enum: ['member', 'requested'] } } },

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
		...clubErrors,
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		channelId: { type: 'string', format: 'misskey:id' },
		accessToken: { type: 'string', nullable: true, maxLength: 32 },
		message: { type: 'string', nullable: true, maxLength: 512 },
	},
	required: ['channelId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.channelsRepository)
		private channelsRepository: ChannelsRepository,
		private clubService: ClubService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const channel = await this.channelsRepository.findOneBy({
				id: ps.channelId,
			});

			if (channel == null) {
				throw new ApiError(meta.errors.noSuchChannel);
			}

			if (await this.clubService.isMember(channel.id, me.id)) throw new ApiError(meta.errors.alreadyFollowing);

			try {
				return await this.clubService.join(channel, me, ps.message ?? null, ps.accessToken ?? null);
			} catch (e) {
				if (e instanceof IdentifiableError && e.id === '6e335e39-0203-4418-a936-b3f2dc987845') throw new ApiError(meta.errors.alreadyFollowing);
				return toApiError(e);
			}
		});
	}
}

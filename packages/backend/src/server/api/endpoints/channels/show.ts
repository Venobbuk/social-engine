/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { ChannelsRepository } from '@/models/_.js';
import { ChannelEntityService } from '@/core/entities/ChannelEntityService.js';
import { DI } from '@/di-symbols.js';
import { ApiError } from '../../error.js';
import { ClubService } from '@/modules/clubs/ClubService.js';

export const meta = {
	tags: ['channels'],

	requireCredential: false,

	res: {
		type: 'object',
		optional: false, nullable: false,
		ref: 'Channel',
	},

	errors: {
		noSuchChannel: {
			message: 'No such channel.',
			code: 'NO_SUCH_CHANNEL',
			id: '6f6c314b-7486-4897-8966-c04a66a02923',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		channelId: { type: 'string', format: 'misskey:id' },
		accessToken: { type: 'string', nullable: true },
	},
	required: ['channelId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.channelsRepository)
		private channelsRepository: ChannelsRepository,

		private channelEntityService: ChannelEntityService,
		private clubService: ClubService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const channel = await this.channelsRepository.findOneBy({
				id: ps.channelId,
			});

			if (channel == null) {
				throw new ApiError(meta.errors.noSuchChannel);
			}

			// SEC-CLUB-READ-V1 (2026-09-21, permission-sweep hole 2): a PRIVATE club answered its full packed profile
			// to anyone who knew the id — name, description, member count. channels/timeline was fixed with
			// mayReadClub and its siblings never were. A refused caller gets "no such channel", not "forbidden":
			// telling a stranger the club EXISTS is the disclosure.
			if (!(await this.clubService.mayReadClub(channel.id, me?.id ?? null, ps.accessToken ?? null))) {
				throw new ApiError(meta.errors.noSuchChannel);
			}

			// INVITE-ACCESS-V1: the same token that just opened the door tells the packer the counts are not a leak here
			// (SEC-CLUB-COUNTS-V1 knows membership only). Asked of ClubService, never taken on trust from the parameter.
			const accessProven = await this.clubService.clubTokenGrants(channel.id, ps.accessToken ?? null);
			return await this.channelEntityService.pack(channel, me, true, { accessProven });
		});
	}
}

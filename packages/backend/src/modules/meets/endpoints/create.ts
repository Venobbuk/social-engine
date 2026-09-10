/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import ms from 'ms';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { ChannelsRepository } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import { MeetService } from '@/modules/meets/MeetService.js';
import { MeetEntityService } from '@/modules/meets/MeetEntityService.js';
import { ApiError } from '@/server/api/error.js';
import { meetErrors, meetParamProps, toApiError } from './_shared.js';

export const meta = {
	tags: ['meets'],
	requireCredential: true,
	prohibitMoved: true,
	kind: 'write:meets',
	limit: { duration: ms('1hour'), max: 30 },
	res: { type: 'object', optional: false, nullable: false, ref: 'Meet' },
	errors: {
		noSuchChannel: { message: 'No such channel.', code: 'NO_SUCH_CHANNEL', id: '6b1d0a3e-8f41-4c0b-9b7e-1a0000000010' },
		startInPast: { message: 'Meet date and time cannot be in the past.', code: 'MEET_START_IN_PAST', id: '6b1d0a3e-8f41-4c0b-9b7e-1a0000000011' },
		...meetErrors,
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: meetParamProps,
	required: ['name', 'startAt', 'durationMinutes', 'capacity'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.channelsRepository)
		private channelsRepository: ChannelsRepository,
		private meetService: MeetService,
		private meetEntityService: MeetEntityService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const startAt = new Date(ps.startAt);
			if (startAt.getTime() < Date.now()) throw new ApiError(meta.errors.startInPast);
			if (ps.channelId) {
				const channel = await this.channelsRepository.findOneBy({ id: ps.channelId });
				if (channel == null) throw new ApiError(meta.errors.noSuchChannel);
			}
			try {
				const { startAt: _ignored, ...rest } = ps;
				const meet = await this.meetService.create(me, { ...rest, startAt });
				return await this.meetEntityService.pack(meet, me, { detailed: true });
			} catch (e) {
				return toApiError(e);
			}
		});
	}
}

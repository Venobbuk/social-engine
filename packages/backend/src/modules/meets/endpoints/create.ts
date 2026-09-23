/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import ms from 'ms';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { ChannelsRepository, VenuesRepository } from '@/models/_.js';
import type { MiMeet } from '@/modules/meets/models/Meet.js';
import { DI } from '@/di-symbols.js';
import { MeetService } from '@/modules/meets/MeetService.js';
import { MeetEntityService } from '@/modules/meets/MeetEntityService.js';
import { ClubService } from '@/modules/clubs/ClubService.js';
import { ApiError } from '@/server/api/error.js';
import { meetErrors, meetParamProps, parseIsoDate, pickMeetFields, toApiError } from './_shared.js';

export const meta = {
	tags: ['meets'],
	requireCredential: true,
	prohibitMoved: true,
	kind: 'write:meets',
	limit: { duration: ms('1hour'), max: 30 },
	res: { type: 'object', optional: false, nullable: false, ref: 'Meet' },
	errors: {
		noSuchChannel: { message: 'No such channel.', code: 'NO_SUCH_CHANNEL', id: '6b1d0a3e-8f41-4c0b-9b7e-1a0000000010' },
		// CLUB-TIERS-V1 (Reclub meets:no_club_note): a club meet needs an admin, or a member where members may create meets
		notClubMember: { message: 'Only the club admins — or its members, when the club allows it — can create meets for this club.', code: 'CLUB_NOT_MEMBER', id: 'c1b00000-0000-4000-8000-000000000011' },
		startInPast: { message: 'Meet date and time cannot be in the past.', code: 'MEET_START_IN_PAST', id: '6b1d0a3e-8f41-4c0b-9b7e-1a0000000011' },
		invalidDate: { message: 'Invalid date.', code: 'MEET_INVALID_DATE', id: '6b1d0a3e-8f41-4c0b-9b7e-1a0000000013' },
		...meetErrors,
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		...meetParamProps,
		// SERIES-V1: a weekly / daily schedule (Reclub upsert-schedule) — the same meet repeated
		repeat: { type: 'object', nullable: true, properties: { every: { type: 'string', enum: ['day', 'week'] }, count: { type: 'integer', minimum: 2, maximum: 26 } }, required: ['every', 'count'] },
	},
	required: ['name', 'startAt', 'durationMinutes', 'capacity'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.channelsRepository)
		private channelsRepository: ChannelsRepository,
		@Inject(DI.venuesRepository)
		private venuesRepository: VenuesRepository,
		private meetService: MeetService,
		private meetEntityService: MeetEntityService,
		private clubService: ClubService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const startAt = parseIsoDate(ps.startAt);
			if (startAt == null) throw new ApiError(meta.errors.invalidDate);
			if (startAt.getTime() < Date.now()) throw new ApiError(meta.errors.startInPast);
			if (ps.channelId) {
				const channel = await this.channelsRepository.findOneBy({ id: ps.channelId });
				if (channel == null) throw new ApiError(meta.errors.noSuchChannel);
				if (!(await this.clubService.canCreateMeet(channel, me.id))) throw new ApiError(meta.errors.notClubMember);   // CLUB-TIERS-V1
			}
			try {
				const fields = pickMeetFields(ps as Record<string, unknown>) as Partial<MiMeet>;
				// T3-MEET-FORM: a venue id is kept only when that venue exists (the display name/address stay as sent)
				if (fields.venueId && !(await this.venuesRepository.exists({ where: { id: fields.venueId } }))) fields.venueId = null;
				const data = { ...fields, name: ps.name, durationMinutes: ps.durationMinutes, capacity: ps.capacity, startAt };
				if (ps.repeat) {
					const series = await this.meetService.createSeries(me, data, { every: ps.repeat.every, count: ps.repeat.count });
					if (series[0]) void this.clubService.notifyNewMeet(series[0]).catch(() => undefined);   // CLUB-TIERS-V1: once per series
					const first = await this.meetEntityService.pack(series[0], me, { detailed: true });
					return { ...first, seriesCount: series.length } as typeof first;
				}
				const meet = await this.meetService.create(me, data);
				void this.clubService.notifyNewMeet(meet).catch(() => undefined);   // CLUB-TIERS-V1: members (+ followers for a public meet)
				return await this.meetEntityService.pack(meet, me, { detailed: true });
			} catch (e) {
				return toApiError(e);
			}
		});
	}
}

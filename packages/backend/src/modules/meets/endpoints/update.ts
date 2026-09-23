/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { MeetsRepository, VenuesRepository } from '@/models/_.js';
import type { MiMeet } from '@/modules/meets/models/Meet.js';
import { DI } from '@/di-symbols.js';
import { MeetService } from '@/modules/meets/MeetService.js';
import { MeetEntityService } from '@/modules/meets/MeetEntityService.js';
import { ClubService } from '@/modules/clubs/ClubService.js';
import { ApiError } from '@/server/api/error.js';
import { IdentifiableError } from '@/misc/identifiable-error.js';
import { meetErrors, meetParamProps, parseIsoDate, pickMeetFields, toApiError } from './_shared.js';

export const meta = {
	tags: ['meets'],
	requireCredential: true,
	prohibitMoved: true,
	kind: 'write:meets',
	res: { type: 'object', optional: false, nullable: false, ref: 'Meet' },
	errors: { invalidDate: { message: 'Invalid date.', code: 'MEET_INVALID_DATE', id: '6b1d0a3e-8f41-4c0b-9b7e-1a0000000014' }, notClubMember: { message: 'Only the club admins — or its members, when the club allows it — can put meets in this club.', code: 'CLUB_NOT_MEMBER', id: 'c1b00000-0000-4000-8000-000000000011' }, ...meetErrors },   // CLUB-TIERS-V1: notClubMember
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		meetId: { type: 'string', format: 'misskey:id' },
		...meetParamProps,
	},
	required: ['meetId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.meetsRepository)
		private meetsRepository: MeetsRepository,
		@Inject(DI.venuesRepository)
		private venuesRepository: VenuesRepository,
		private meetService: MeetService,
		private meetEntityService: MeetEntityService,
		private clubService: ClubService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const meet = await this.meetsRepository.findOneBy({ id: ps.meetId });
			if (meet == null) throw new ApiError(meta.errors.noSuchMeet);
			try {
				await this.meetService.assertHost(meet, me);
				const start = ps.startAt !== undefined ? parseIsoDate(ps.startAt) : undefined;
				if (ps.startAt !== undefined && start == null) throw new ApiError(meta.errors.invalidDate);
				// SEC-CASUAL-CONSENT-V1: a logged casual game keeps the date it was played — moving it (into the future,
				// where seat claims and the invite sweep live) would reopen the consent bypass.
				if (start && (meet.flags ?? []).includes('casual')) throw new IdentifiableError('meet:invalid_transition', 'The date of a logged casual game cannot be changed.');
				const fields = pickMeetFields(ps as Record<string, unknown>) as Partial<MiMeet>;
				delete (fields as Record<string, unknown>).startAt;
				if (fields.venueId && !(await this.venuesRepository.exists({ where: { id: fields.venueId } }))) fields.venueId = null;   // T3-MEET-FORM
				// CLUB-TIERS-V1: moving a meet into a club needs the same right as creating one there
				if (fields.channelId && fields.channelId !== meet.channelId && !(await this.clubService.canCreateMeet(await this.clubService.channel(fields.channelId), me.id))) throw new ApiError(meta.errors.notClubMember);
				const updated = await this.meetService.update(meet, { ...fields, ...(start ? { startAt: start } : {}) });
				return await this.meetEntityService.pack(updated, me, { detailed: true });
			} catch (e) {
				return toApiError(e);
			}
		});
	}
}

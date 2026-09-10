/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { MeetsRepository, MeetParticipantsRepository } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import { MeetService } from '@/core/MeetService.js';
import { MeetEntityService } from '@/core/entities/MeetEntityService.js';
import { ApiError } from '../../../error.js';
import { meetErrors, toApiError } from '../_shared.js';

// Host-side roster action: status change (confirm / waitlist / hold / decline / remove / invite), roles, tags, team, court.
export const meta = {
	tags: ['meets'],
	requireCredential: true,
	prohibitMoved: true,
	kind: 'write:meets',
	res: { type: 'object', optional: false, nullable: false, ref: 'Meet' },
	errors: { ...meetErrors },
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		meetId: { type: 'string', format: 'misskey:id' },
		participantId: { type: 'string', format: 'misskey:id' },
		status: { type: 'string', enum: ['confirmed', 'waitlisted', 'hold', 'declined', 'removed', 'invited'], nullable: true },
		holdMinutes: { type: 'integer', nullable: true, minimum: 5, maximum: 20160 },
		isHost: { type: 'boolean', nullable: true },
		isCoach: { type: 'boolean', nullable: true },
		isReferee: { type: 'boolean', nullable: true },
		isPaymentCollector: { type: 'boolean', nullable: true },
		tags: { type: 'array', nullable: true, items: { type: 'string', enum: ['paid', 'unpaid', 'cash', 'digital', 'membership', 'punch', 'feeWaived', 'refunded', 'checkedIn', 'noShow', 'late', 'excused', 'guest'] } },
		teamKey: { type: 'string', nullable: true, maxLength: 32 },
		courtIndex: { type: 'integer', nullable: true, minimum: 0, maximum: 64 },
		displayName: { type: 'string', nullable: true, maxLength: 128 },
		declaredLevel: { type: 'number', nullable: true, minimum: 0, maximum: 10 },
	},
	required: ['meetId', 'participantId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.meetsRepository)
		private meetsRepository: MeetsRepository,
		@Inject(DI.meetParticipantsRepository)
		private meetParticipantsRepository: MeetParticipantsRepository,
		private meetService: MeetService,
		private meetEntityService: MeetEntityService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const meet = await this.meetsRepository.findOneBy({ id: ps.meetId });
			if (meet == null) throw new ApiError(meta.errors.noSuchMeet);
			const participant = await this.meetParticipantsRepository.findOneBy({ id: ps.participantId, meetId: meet.id });
			if (participant == null) throw new ApiError(meta.errors.noSuchParticipant);
			try {
				await this.meetService.assertHost(meet, me);
				const patch: Record<string, unknown> = {};
				for (const k of ['isHost', 'isCoach', 'isReferee', 'isPaymentCollector', 'tags', 'teamKey', 'courtIndex', 'displayName', 'declaredLevel'] as const) {
					if (ps[k] !== undefined && ps[k] !== null) patch[k] = ps[k];
				}
				if (ps.teamKey === null) patch.teamKey = null;
				if (ps.courtIndex === null) patch.courtIndex = null;
				let current = participant;
				if (Object.keys(patch).length > 0) current = await this.meetService.hostUpdateParticipant(meet, current, patch);
				if (ps.status) await this.meetService.hostSetStatus(meet, current, ps.status, ps.holdMinutes ?? undefined);
				return await this.meetEntityService.pack(meet.id, me, { detailed: true });
			} catch (e) {
				return toApiError(e);
			}
		});
	}
}

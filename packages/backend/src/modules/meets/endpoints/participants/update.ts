/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { MeetsRepository, MeetParticipantsRepository } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import { MeetService } from '@/modules/meets/MeetService.js';
import { MeetEntityService } from '@/modules/meets/MeetEntityService.js';
import { ApiError } from '@/server/api/error.js';
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
		// MEET-V4: Reclub states. 'remove' DELETES the row (User/Reserved/PlusOne) — Reclub fn#75239. hold is manual, no minutes.
		status: { type: 'string', enum: ['confirmed', 'waitlisted', 'hold', 'declined', 'invited', 'spectator', 'remove'], nullable: true },
		isHost: { type: 'boolean', nullable: true },
		isCoach: { type: 'boolean', nullable: true },
		isReferee: { type: 'boolean', nullable: true },
		isPaymentCollector: { type: 'boolean', nullable: true },
		tags: { type: 'array', nullable: true, items: { type: 'string', enum: ['paid', 'unpaid', 'paidClaim', 'cash', 'digital', 'membership', 'punch', 'feeWaived', 'refunded', 'checkedIn', 'noShow', 'late', 'excused', 'guest', 'dropper'] } },   // PLAYER-PAYS-V1
		teamKey: { type: 'string', nullable: true, maxLength: 32 },
		courtIndex: { type: 'integer', nullable: true, minimum: 0, maximum: 64 },
		displayName: { type: 'string', nullable: true, maxLength: 128 },
		declaredLevel: { type: 'number', nullable: true, minimum: 0, maximum: 10 },
		extGender: { type: 'string', nullable: true, maxLength: 8 },
		extAge: { type: 'string', nullable: true, maxLength: 8 },
		positionId: { type: 'string', nullable: true, maxLength: 32 },
		forceSkill: { type: 'number', nullable: true, minimum: 0, maximum: 10 },
		forcePosition: { type: 'string', nullable: true, maxLength: 32 },
		bib: { type: 'string', nullable: true, maxLength: 8 },   // MEETS-FIXES-V1 (A-generate-teams.04): Reclub bib / jersey number
		paymentType: { type: 'string', nullable: true, enum: ['cash'] },
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
				for (const k of ['isHost', 'isCoach', 'isReferee', 'isPaymentCollector', 'tags', 'teamKey', 'courtIndex', 'displayName', 'declaredLevel', 'extGender', 'extAge', 'positionId', 'forceSkill', 'forcePosition', 'paymentType', 'bib'] as const) {
					if (ps[k] !== undefined && ps[k] !== null) patch[k] = ps[k];
				}
				if (ps.teamKey === null) patch.teamKey = null;
				if (ps.courtIndex === null) patch.courtIndex = null;
				if (Object.keys(patch).length > 0) await this.meetService.hostUpdateParticipant(meet, participant.id, patch);
				if (ps.status) await this.meetService.hostSetStatus(meet, participant.id, ps.status);
				return await this.meetEntityService.pack(meet.id, me, { detailed: true });
			} catch (e) {
				return toApiError(e);
			}
		});
	}
}

/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { IsNull } from 'typeorm';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { MeetsRepository, UsersRepository } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import { MeetService } from '@/modules/meets/MeetService.js';
import { MeetEntityService } from '@/modules/meets/MeetEntityService.js';
import { ApiError } from '@/server/api/error.js';
import { meetErrors, toApiError } from '../_shared.js';

// MEET-SWAP-V1 (lane mop-up, 2026-09-24): Reclub's "Swap" — a confirmed player hands their own seat to another player
// (MeetService.swapSeat holds the rules). NEW: Misskey has no seat concept; the meet module's own lock/claim helpers are reused.
export const meta = {
	tags: ['meets'],
	requireCredential: true,
	prohibitMoved: true,
	kind: 'write:meets',
	res: { type: 'object', optional: false, nullable: false, ref: 'Meet' },
	errors: {
		noSuchUser: { message: 'No such user.', code: 'NO_SUCH_USER', id: '6b1d0a3e-8f41-4c0b-9b7e-1a00000000d1' },
		...meetErrors,
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		meetId: { type: 'string', format: 'misskey:id' },
		userId: { type: 'string', format: 'misskey:id' },
		// FIX-S5 HOST-SWAP-V1 (Reclub A-roles-action.12 participant sheet › Swap): the host names the seat to hand over
		participantId: { type: 'string', format: 'misskey:id' },
	},
	required: ['meetId', 'userId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.meetsRepository)
		private meetsRepository: MeetsRepository,
		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,
		private meetService: MeetService,
		private meetEntityService: MeetEntityService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const meet = await this.meetsRepository.findOneBy({ id: ps.meetId });
			if (meet == null) throw new ApiError(meta.errors.noSuchMeet);
			const taker = await this.usersRepository.findOneBy({ id: ps.userId, host: IsNull() });
			if (taker == null || taker.isSuspended || taker.isDeleted) throw new ApiError(meta.errors.noSuchUser);
			const giver = await this.usersRepository.findOneByOrFail({ id: me.id });
			try {
				if (ps.participantId) await this.meetService.hostSwapSeat(meet, giver, ps.participantId, taker);   // FIX-S5 HOST-SWAP-V1
				else await this.meetService.swapSeat(meet, giver, taker);
				const fresh = await this.meetsRepository.findOneByOrFail({ id: meet.id });
				return await this.meetEntityService.pack(fresh, me, { detailed: true });
			} catch (e) {
				return toApiError(e);
			}
		});
	}
}

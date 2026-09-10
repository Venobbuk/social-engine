/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { MeetsRepository, MeetParticipantsRepository } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import { MeetEntityService } from '@/modules/meets/MeetEntityService.js';
import { ApiError } from '@/server/api/error.js';
import { meetErrors } from './_shared.js';

export const meta = {
	tags: ['meets'],
	requireCredential: false,
	kind: 'read:meets',
	res: { type: 'object', optional: false, nullable: false, ref: 'Meet' },
	errors: { ...meetErrors },
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		meetId: { type: 'string', format: 'misskey:id' },
		referenceCode: { type: 'string', minLength: 1, maxLength: 16 },
		accessToken: { type: 'string', nullable: true, maxLength: 32 },
	},
	anyOf: [{ required: ['meetId'] }, { required: ['referenceCode'] }],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.meetsRepository)
		private meetsRepository: MeetsRepository,
		@Inject(DI.meetParticipantsRepository)
		private meetParticipantsRepository: MeetParticipantsRepository,
		private meetEntityService: MeetEntityService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const meet = ps.meetId
				? await this.meetsRepository.findOneBy({ id: ps.meetId })
				: await this.meetsRepository.findOneBy({ referenceCode: ps.referenceCode ?? '' });
			if (meet == null) throw new ApiError(meta.errors.noSuchMeet);
			if (meet.visibility === 'private' && meet.accessToken) {
				const isOnMeet = me != null && (meet.hostId === me.id || await this.meetParticipantsRepository.existsBy({ meetId: meet.id, userId: me.id }));
				if (ps.accessToken !== meet.accessToken && !isOnMeet) throw new ApiError(meta.errors.accessDenied);
			}
			return await this.meetEntityService.pack(meet, me, { detailed: true });
		});
	}
}

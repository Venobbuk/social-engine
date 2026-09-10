/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import ms from 'ms';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { MeetsRepository } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import { MeetService } from '@/core/MeetService.js';
import { MeetEntityService } from '@/core/entities/MeetEntityService.js';
import { ApiError } from '../../error.js';
import { meetErrors, toApiError } from './_shared.js';

export const meta = {
	tags: ['meets'],
	requireCredential: true,
	prohibitMoved: true,
	kind: 'write:meets',
	limit: { duration: ms('1hour'), max: 60 },
	res: { type: 'object', optional: false, nullable: false, ref: 'Meet' },
	errors: { ...meetErrors },
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		meetId: { type: 'string', format: 'misskey:id' },
		accessToken: { type: 'string', nullable: true, maxLength: 32 },
		guests: { type: 'integer', minimum: 0, maximum: 5, default: 0 },
	},
	required: ['meetId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.meetsRepository)
		private meetsRepository: MeetsRepository,
		private meetService: MeetService,
		private meetEntityService: MeetEntityService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const meet = await this.meetsRepository.findOneBy({ id: ps.meetId });
			if (meet == null) throw new ApiError(meta.errors.noSuchMeet);
			try {
				await this.meetService.join(meet, me, { accessToken: ps.accessToken ?? null, guests: ps.guests });
				return await this.meetEntityService.pack(meet.id, me, { detailed: true });
			} catch (e) {
				return toApiError(e);
			}
		});
	}
}

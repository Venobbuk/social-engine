/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { MeetsRepository } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import { MeetService } from '@/modules/meets/MeetService.js';
import { MeetEntityService } from '@/modules/meets/MeetEntityService.js';
import { ApiError } from '@/server/api/error.js';
import { meetErrors, meetParamProps, parseIsoDate, toApiError } from './_shared.js';

export const meta = {
	tags: ['meets'],
	requireCredential: true,
	prohibitMoved: true,
	kind: 'write:meets',
	res: { type: 'object', optional: false, nullable: false, ref: 'Meet' },
	errors: { invalidDate: { message: 'Invalid date.', code: 'MEET_INVALID_DATE', id: '6b1d0a3e-8f41-4c0b-9b7e-1a0000000014' }, ...meetErrors },
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
		private meetService: MeetService,
		private meetEntityService: MeetEntityService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const meet = await this.meetsRepository.findOneBy({ id: ps.meetId });
			if (meet == null) throw new ApiError(meta.errors.noSuchMeet);
			try {
				await this.meetService.assertHost(meet, me);
				const { meetId: _ignored, startAt, ...rest } = ps;
				const start = startAt !== undefined ? parseIsoDate(startAt) : undefined;
				if (startAt !== undefined && start == null) throw new ApiError(meta.errors.invalidDate);
				const updated = await this.meetService.update(meet, { ...rest, ...(start ? { startAt: start } : {}) });
				return await this.meetEntityService.pack(updated, me, { detailed: true });
			} catch (e) {
				return toApiError(e);
			}
		});
	}
}

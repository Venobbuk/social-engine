/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { MeetsRepository } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import { MeetService } from '@/modules/meets/MeetService.js';
import { MeetMatchService } from '@/modules/meets/MeetMatchService.js';
import { MeetEntityService } from '@/modules/meets/MeetEntityService.js';
import { ApiError } from '@/server/api/error.js';
import { meetErrors } from '../_shared.js';

// MEET-MATCH-V1: the Matches pane. Private meets need a seat or the access token, as meets/show.
export const meta = {
	tags: ['meets'],
	requireCredential: false,
	kind: 'read:meets',
	res: { type: 'array', optional: false, nullable: false, items: { type: 'object', optional: false, nullable: false, ref: 'MeetMatch' } },
	errors: { ...meetErrors },
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		meetId: { type: 'string', format: 'misskey:id' },
		accessToken: { type: 'string', nullable: true, maxLength: 32 },
		eligibility: { type: 'boolean', default: false },
	},
	required: ['meetId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.meetsRepository)
		private meetsRepository: MeetsRepository,
		private meetService: MeetService,
		private meetMatchService: MeetMatchService,
		private meetEntityService: MeetEntityService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const meet = await this.meetsRepository.findOneBy({ id: ps.meetId });
			if (meet == null) throw new ApiError(meta.errors.noSuchMeet);
			if (!(await this.meetService.mayViewPrivate(meet, me?.id ?? null, ps.accessToken))) throw new ApiError(meta.errors.accessDenied);
			const rows = await this.meetMatchService.list(meet);
			return await Promise.all(rows.map(m => this.meetEntityService.packMatch(m, meet, me, { eligibility: ps.eligibility })));
		});
	}
}

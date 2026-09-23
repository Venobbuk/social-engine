/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { MeetsRepository } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import { MeetService } from '@/modules/meets/MeetService.js';
import { ApiError } from '@/server/api/error.js';
import { meetErrors, toApiError } from './_shared.js';

// T3-MEET-HOST-V1 (Reclub triage A-meet-detail.07): the host deletes a meet nothing has happened on yet
// (MeetService.deleteMeet holds the rules). Anything with a roster or matches is cancelled instead (meets/cancel).
export const meta = {
	tags: ['meets'],
	requireCredential: true,
	prohibitMoved: true,
	kind: 'write:meets',
	res: { type: 'object', optional: false, nullable: false, properties: { deleted: { type: 'boolean', optional: false, nullable: false } } },
	errors: { ...meetErrors },
} as const;

export const paramDef = {
	type: 'object',
	properties: { meetId: { type: 'string', format: 'misskey:id' } },
	required: ['meetId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.meetsRepository)
		private meetsRepository: MeetsRepository,
		private meetService: MeetService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const meet = await this.meetsRepository.findOneBy({ id: ps.meetId });
			if (meet == null) throw new ApiError(meta.errors.noSuchMeet);
			try {
				await this.meetService.deleteMeet(meet, me);
				return { deleted: true };
			} catch (e) {
				return toApiError(e);
			}
		});
	}
}

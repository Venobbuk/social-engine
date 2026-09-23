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

// T3-MEET-HOST-V1 (Reclub triage A-meet-detail.10): "Refresh meet chat" — a host (or co-host) puts every confirmed
// player and co-host who is missing from the meet's native chat room back in (MeetService.refreshRoom).
export const meta = {
	tags: ['meets'],
	requireCredential: true,
	prohibitMoved: true,
	kind: 'write:meets',
	res: { type: 'object', optional: false, nullable: false, properties: { added: { type: 'number', optional: false, nullable: false } } },
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
				await this.meetService.assertHost(meet, me);
				return await this.meetService.refreshRoom(meet);
			} catch (e) {
				return toApiError(e);
			}
		});
	}
}

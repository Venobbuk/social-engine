/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ClubService } from '@/modules/clubs/ClubService.js';
import { clubErrors, toApiError } from '@/modules/clubs/endpoints/_shared.js';
import { ApiError } from '@/server/api/error.js';
import { ClubScheduleService } from '@/modules/clubs/ClubScheduleService.js';

// CLUB-V3 — see modules/clubs/ClubService.ts / ClubScheduleService.ts
export const meta = {
	tags: ['clubs'],
	requireCredential: false,
	res: { type: 'object', optional: false, nullable: false },
	errors: clubErrors,
} as const;

export const paramDef = {
	type: 'object',
	properties: { scheduleId: { type: 'string', format: 'misskey:id' } },
	required: ["scheduleId"],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private clubService: ClubService, private clubScheduleService: ClubScheduleService) {
		super(meta, paramDef, async (ps, me) => {
			try {
				const s = await this.clubScheduleService.get(ps.scheduleId);
				// SEC-CLUB-READ-V1: the sibling of schedules/list — the same slot, reached by schedule id instead of
				// club id. Guarding only the list would leave the door open one hop further along.
				if (!(await this.clubService.mayReadClub(s.channelId, me?.id ?? null))) throw new ApiError(clubErrors.noSuchClub);
				return await this.clubScheduleService.pack(s, me ?? null);
			} catch (e) {
				return toApiError(e);
			}
		});
	}
}

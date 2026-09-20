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
	res: { type: 'array', optional: false, nullable: false, items: { type: 'object', optional: false, nullable: false } },
	errors: clubErrors,
} as const;

export const paramDef = {
	type: 'object',
	properties: { channelId: { type: 'string', format: 'misskey:id' } },
	required: ["channelId"],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private clubService: ClubService, private clubScheduleService: ClubScheduleService) {
		super(meta, paramDef, async (ps, me) => {
			try {
				// Reclub club-schedules/<groupId>: the club's weekly slots (public, like the club page's REGULAR SCHEDULE block)
				const c = await this.clubService.channel(ps.channelId);
				// SEC-CLUB-READ-V1 (2026-09-21, permission-sweep holes 6-7): the weekly slots say WHEN and WHERE a club
				// plays, with the venue and its coordinates. For a private club that is the most sensitive thing it owns,
				// and this door had no gate at all. Same refusal shape as the club itself: no such club.
				if (!(await this.clubService.mayReadClub(c.id, me?.id ?? null))) throw new ApiError(clubErrors.noSuchClub);
				const rows = await this.clubScheduleService.list(c);
				const out = [];
				for (const s of rows) out.push(await this.clubScheduleService.pack(s, me ?? null));
				return out;
			} catch (e) {
				return toApiError(e);
			}
		});
	}
}

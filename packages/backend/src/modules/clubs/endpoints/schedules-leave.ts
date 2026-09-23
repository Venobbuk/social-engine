/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { clubErrors, toApiError } from '@/modules/clubs/endpoints/_shared.js';
import { ClubScheduleService } from '@/modules/clubs/ClubScheduleService.js';

// SCHEDULE-LEAVE-V1 (lane meets-fixes, 2026-09-23; matrix A-schedule-detail.04) — Reclub's member option "Leave schedule"
// ("Are you sure you want to leave this schedule?"). The member stays in the club; the schedule's sweep no longer
// invites them to the meets it creates (club_schedule.optOutUserIds). leave:false = join the schedule again.
export const meta = {
	tags: ['clubs'],
	requireCredential: true,
	kind: 'write:channels',
	res: { type: 'object', optional: false, nullable: false },
	errors: clubErrors,
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		scheduleId: { type: 'string', format: 'misskey:id' },
		leave: { type: 'boolean', default: true },
	},
	required: ['scheduleId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private clubScheduleService: ClubScheduleService) {
		super(meta, paramDef, async (ps, me) => {
			try {
				const s = await this.clubScheduleService.get(ps.scheduleId);
				const out = await this.clubScheduleService.setOptOut(s, me, ps.leave !== false);
				return await this.clubScheduleService.pack(out, me);
			} catch (e) {
				return toApiError(e);
			}
		});
	}
}

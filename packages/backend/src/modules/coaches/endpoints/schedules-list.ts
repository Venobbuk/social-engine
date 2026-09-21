/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { CoachScheduleService } from '@/modules/coaches/CoachScheduleService.js';
import { coachErrors, toApiError } from './_shared.js';

// COACHING-V1 — my own lesson schedules (the coach's list).
export const meta = { tags: ['coaches'], requireCredential: true, kind: 'read:account', res: { type: 'array', optional: false, nullable: false, items: { type: 'object', optional: false, nullable: false } }, errors: coachErrors } as const;
export const paramDef = { type: 'object', properties: {}, required: [] } as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private coachScheduleService: CoachScheduleService) {
		super(meta, paramDef, async (ps, me) => {
			try {
				const rows = await this.coachScheduleService.listMine(me.id);
				return await Promise.all(rows.map(s => this.coachScheduleService.packSchedule(s, me)));
			} catch (e) { return toApiError(e); }
		});
	}
}

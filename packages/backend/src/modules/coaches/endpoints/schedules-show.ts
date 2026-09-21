/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { CoachScheduleService } from '@/modules/coaches/CoachScheduleService.js';
import { ClubService } from '@/modules/clubs/ClubService.js';
import { IdentifiableError } from '@/misc/identifiable-error.js';
import { coachErrors, toApiError } from './_shared.js';

// COACHING-V1 — one lesson slot. A private slot is shown only to the owner or a member of its club (privacy parity).
export const meta = { tags: ['coaches'], requireCredential: false, res: { type: 'object', optional: false, nullable: false }, errors: coachErrors } as const;
export const paramDef = { type: 'object', properties: { scheduleId: { type: 'string', format: 'misskey:id' } }, required: ['scheduleId'] } as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private coachScheduleService: CoachScheduleService, private clubService: ClubService) {
		super(meta, paramDef, async (ps, me) => {
			try {
				const s = await this.coachScheduleService.get(ps.scheduleId);
				if (s.visibility !== 'public') {
					const ok = !!me && (me.id === s.ownerUserId || await this.clubService.isMember(s.channelId, me.id).catch(() => false));
					if (!ok) throw new IdentifiableError('coach:no_such_schedule', 'No such lesson schedule.');
				}
				return await this.coachScheduleService.packSchedule(s, me ?? null);
			} catch (e) { return toApiError(e); }
		});
	}
}

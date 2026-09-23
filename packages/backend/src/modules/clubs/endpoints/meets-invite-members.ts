/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { clubErrors, toApiError } from '@/modules/clubs/endpoints/_shared.js';
import { ClubScheduleService } from '@/modules/clubs/ClubScheduleService.js';

// MEET-CLUB-INVITE-V1 (W1 lane B1, triage A-meet-form.03) — the meet form's club section: invite the club's members
// (all, or the chosen tags) to a one-off club meet the caller hosts. preview = the count only. See
// ClubScheduleService.inviteMembersToMeet (the same member rule as a schedule's auto-invite).
export const meta = {
	tags: ['clubs'],
	requireCredential: true,
	kind: 'write:meets',
	res: { type: 'object', optional: false, nullable: false, properties: {
		eligible: { type: 'number', optional: false, nullable: false },
		invited: { type: 'number', optional: false, nullable: false },
	} },
	errors: clubErrors,
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		meetId: { type: 'string', format: 'misskey:id' },
		tagIds: { type: 'array', items: { type: 'string', maxLength: 64 }, maxItems: 20, default: [] },
		preview: { type: 'boolean', default: false },
		audience: { type: 'string', enum: ['members', 'all'], default: 'members' },   // MEETS-FIXES-V1: 'all' = members + followers
	},
	required: ['meetId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private clubScheduleService: ClubScheduleService) {
		super(meta, paramDef, async (ps, me) => {
			try {
				return await this.clubScheduleService.inviteMembersToMeet(ps.meetId, me, ps.tagIds ?? [], !!ps.preview, ps.audience === 'all' ? 'all' : 'members');
			} catch (e) {
				return toApiError(e);
			}
		});
	}
}

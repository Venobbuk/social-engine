/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ClubService } from '@/modules/clubs/ClubService.js';
import { clubErrors, toApiError } from '@/modules/clubs/endpoints/_shared.js';
import { ChannelEntityService } from '@/core/entities/ChannelEntityService.js';
import { IdentifiableError } from '@/misc/identifiable-error.js';

// CLUB-V3 — see modules/clubs/ClubService.ts / ClubScheduleService.ts
export const meta = {
	tags: ['clubs'],
	requireCredential: false,
	res: { type: 'object', optional: false, nullable: false },
	errors: clubErrors,
} as const;

export const paramDef = {
	type: 'object',
	properties: { code: { type: 'string', minLength: 4, maxLength: 8 } },
	required: ["code"],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private clubService: ClubService, private channelEntityService: ChannelEntityService) {
		super(meta, paramDef, async (ps, me) => {
			try {
				// Reclub GET /groups/by-code/<code> (onboard/club-code): the club behind a six-char code; a wrong code is NO_SUCH_CLUB
				const r = await this.clubService.byCode(ps.code);
				if (!r) throw new IdentifiableError('club:no_such_club', 'The code you\'ve entered is invalid. Please try again');
				// INVITE-ACCESS-V1: reaching this line means the caller produced the club's OWN ref code — that is the
				// join preview's whole premise (CLUB-V3 / Reclub quick-join). "0 members" on that screen is worse than no
				// number, so the packer is told access is proven rather than by-code counting anything itself.
				return { ...(await this.channelEntityService.pack(r.channel, me ?? null, false, { accessProven: true })), gateType: r.settings.gateType, visibility: r.settings.visibility, sport: r.settings.sport, level: r.settings.level, refCode: r.settings.refCode };
			} catch (e) {
				return toApiError(e);
			}
		});
	}
}

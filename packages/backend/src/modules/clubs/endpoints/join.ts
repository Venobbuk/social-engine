/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ClubService } from '@/modules/clubs/ClubService.js';
import { clubErrors, toApiError } from './_shared.js';

// CLUB-ADMIN-V1 — see modules/clubs/ClubService.ts. CLUB-GATE-V1 (W1): the shared club error catalogue (CLUB_INVITE_ONLY, …),
// the same answers channels/follow gives.
export const meta = {
	tags: ['clubs'],
	requireCredential: true,
	kind: 'write:channels',
	res: { type: 'object', optional: false, nullable: false, properties: { status: { type: 'string', optional: false, nullable: false } } },
	errors: clubErrors,
} as const;

export const paramDef = {
	type: 'object',
	properties: { channelId: { type: 'string', format: 'misskey:id' }, message: { type: 'string', nullable: true, maxLength: 512 }, accessToken: { type: 'string', nullable: true, maxLength: 32 } },
	required: ['channelId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private clubService: ClubService) {
		super(meta, paramDef, async (ps, me) => {
			try {
				const c = await this.clubService.channel(ps.channelId);
			return await this.clubService.join(c, me, ps.message ?? null, ps.accessToken ?? null); // CLUB-V3: ?at= token
			} catch (e) {
				return toApiError(e);
			}
		});
	}
}

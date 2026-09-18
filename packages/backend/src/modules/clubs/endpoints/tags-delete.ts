/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ClubService } from '@/modules/clubs/ClubService.js';
import { clubErrors, toApiError } from '@/modules/clubs/endpoints/_shared.js';

// CLUB-V3 — see modules/clubs/ClubService.ts / ClubScheduleService.ts
export const meta = {
	tags: ['clubs'],
	requireCredential: true,
	kind: 'write:channels',
	res: { type: 'object', optional: false, nullable: false },
	errors: clubErrors,
} as const;

export const paramDef = {
	type: 'object',
	properties: { channelId: { type: 'string', format: 'misskey:id' }, tagId: { type: 'string' } },
	required: ["channelId","tagId"],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private clubService: ClubService) {
		super(meta, paramDef, async (ps, me) => {
			try {
				const c = await this.clubService.channel(ps.channelId);
				await this.clubService.deleteTag(c, me, ps.tagId);
				return { ok: true };
			} catch (e) {
				return toApiError(e);
			}
		});
	}
}

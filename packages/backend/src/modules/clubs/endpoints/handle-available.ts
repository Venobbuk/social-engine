/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ClubService } from '@/modules/clubs/ClubService.js';
import { clubErrors, toApiError } from '@/modules/clubs/endpoints/_shared.js';
import { handleProblem, normalizeHandle } from '@/modules/clubs/club-post-rules.js';

/*
 * CLUB-HANDLE-V1 (lane club-posts-links, Reclub B-set-profile.03 "reclub.co/clubs/@… with live availability") — NEW: is a
 * club handle free? Modelled on Misskey's native username/available (server/api/endpoints/username/available.ts), which
 * answers the same question for a person's @name; a club is a GripBat concept (channel + club_setting), so it gets its own
 * door. `channelId` = the club asking (its own current handle reads as available). Answers why not: invalid | reserved | taken.
 */
export const meta = {
	tags: ['clubs'],
	requireCredential: true,
	kind: 'read:channels',
	limit: { duration: 60_000, max: 120 },
	res: {
		type: 'object', optional: false, nullable: false,
		properties: {
			handle: { type: 'string', optional: false, nullable: false },
			available: { type: 'boolean', optional: false, nullable: false },
			reason: { type: 'string', optional: false, nullable: true },
		},
	},
	errors: clubErrors,
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		handle: { type: 'string', minLength: 1, maxLength: 31 },
		channelId: { type: 'string', format: 'misskey:id' },
	},
	required: ['handle'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private clubService: ClubService) {
		super(meta, paramDef, async (ps) => {
			try {
				const handle = normalizeHandle(ps.handle);
				const why = handleProblem(handle);
				if (why) return { handle, available: false, reason: why };
				const owner = await this.clubService.handleOwner(handle);
				const free = !owner || (ps.channelId != null && owner === ps.channelId);
				return { handle, available: free, reason: free ? null : 'taken' };
			} catch (e) {
				return toApiError(e);
			}
		});
	}
}

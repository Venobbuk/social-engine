/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DI } from '@/di-symbols.js';
import type { MeetPlayerLevelsRepository } from '@/models/_.js';
import { UserEntityService } from '@/core/entities/UserEntityService.js';
import { packCoach } from '../_shared.js';

// DISCOVER-V3 (coach): Reclub GET /coaches {sport_ids, status} — the Discover › People › Coaches list: every active
// coach profile for a sport with the UserLite beside it. Public.
export const meta = {
	tags: ['coaches'],
	requireCredential: false,
	res: { type: 'array', optional: false, nullable: false, items: { type: 'object', optional: false, nullable: false, properties: {
		userId: { type: 'string', optional: false, nullable: false },
		sport: { type: 'string', optional: false, nullable: false },
		status: { type: 'string', optional: false, nullable: false },
		experience: { type: 'string', optional: false, nullable: true },
		rate: { type: 'string', optional: false, nullable: true },
		notes: { type: 'string', optional: false, nullable: true },
		updatedAt: { type: 'string', optional: false, nullable: true },
		user: { type: 'object', optional: false, nullable: true, ref: 'UserLite' },
	} } },
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		sport: { type: 'string', minLength: 1, maxLength: 32, default: 'pickleball' },
		limit: { type: 'integer', minimum: 1, maximum: 100, default: 30 },
	},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.meetPlayerLevelsRepository)
		private meetPlayerLevelsRepository: MeetPlayerLevelsRepository,
		private userEntityService: UserEntityService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const rows = await this.meetPlayerLevelsRepository.find({ where: { sport: ps.sport, coachStatus: 'active' }, order: { coachUpdatedAt: 'DESC' }, take: ps.limit });
			const out = [];
			for (const r of rows) {
				const c = packCoach(r);
				if (!c) continue;
				out.push({ ...c, user: await this.userEntityService.pack(r.userId, me, { schema: 'UserLite' }).catch(() => null) });
			}
			return out;
		});
	}
}

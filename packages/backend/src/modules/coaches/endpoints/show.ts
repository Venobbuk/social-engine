/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DI } from '@/di-symbols.js';
import type { MeetPlayerLevelsRepository } from '@/models/_.js';
import { packedCoachSchema, packCoach } from '../_shared.js';

// DISCOVER-V3 (coach): Reclub GET /coaches/<id> — one player's coach profile for a sport (the profile Coaching tab and
// the public coach card). null when the player has no profile; an inactive profile is visible only to its owner.
export const meta = {
	tags: ['coaches'],
	requireCredential: false,
	res: packedCoachSchema,
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		userId: { type: 'string', format: 'misskey:id' },
		sport: { type: 'string', minLength: 1, maxLength: 32, default: 'pickleball' },
	},
	required: ['userId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.meetPlayerLevelsRepository)
		private meetPlayerLevelsRepository: MeetPlayerLevelsRepository,
	) {
		super(meta, paramDef, async (ps, me) => {
			const l = await this.meetPlayerLevelsRepository.findOneBy({ userId: ps.userId, sport: ps.sport });
			if (!l) return null;
			const c = packCoach(l);
			if (!c) return null;
			if (c.status !== 'active' && (!me || me.id !== ps.userId)) return null;
			return c;
		});
	}
}

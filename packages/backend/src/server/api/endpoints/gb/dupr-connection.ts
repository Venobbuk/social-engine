/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import * as Redis from 'ioredis';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DI } from '@/di-symbols.js';
import { DuprSubmitService } from '@/core/DuprSubmitService.js';
import { MeetLevelService } from '@/modules/meets/MeetLevelService.js';

/*
 * GRIPBAT-ACCOUNTS-V1 (spec §7) — gb/dupr/connection: is THIS GripBat account linked to a DUPR player, and when may it
 * resync. NEW beside the NEW connect door (hkpl GET /api/v1/dupr/connection read an hkpl user). Reads the engine's own
 * record (meet_player_level via MeetLevelService.getLevel, REUSED) — no hkpl call, no DUPR call.
 */
export const RESYNC_PREFIX = 'gb:dupr-resync:';
export const RESYNC_COOLDOWN_SEC = 60 * 60;

export const meta = {
	tags: ['dupr'],
	requireCredential: true,
	kind: 'read:account',
	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			connected: { type: 'boolean', optional: false, nullable: false },
			duprId: { type: 'string', optional: false, nullable: true },
			doubles: { type: 'number', optional: false, nullable: true },
			singles: { type: 'number', optional: false, nullable: true },
			source: { type: 'string', optional: false, nullable: true },
			sandbox: { type: 'boolean', optional: false, nullable: false },
			resyncAvailableAt: { type: 'string', optional: false, nullable: true },
		},
	},
} as const;

export const paramDef = { type: 'object', properties: {}, required: [] } as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.redis)
		private redisClient: Redis.Redis,

		private duprSubmitService: DuprSubmitService,
		private meetLevelService: MeetLevelService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const lv = await this.meetLevelService.getLevel(me.id, 'pickleball');
			const ttl = await this.redisClient.ttl(RESYNC_PREFIX + me.id);
			return {
				connected: lv?.duprId != null,
				duprId: lv?.duprId ?? null,
				doubles: lv?.duprDoubles ?? null,
				singles: lv?.duprSingles ?? null,
				source: lv?.source ?? null,
				sandbox: this.duprSubmitService.cageMode() !== 'live',
				resyncAvailableAt: ttl > 0 ? new Date(Date.now() + ttl * 1000).toISOString() : null,
			};
		});
	}
}

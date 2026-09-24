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
import { ApiError } from '@/server/api/error.js';
import { RESYNC_COOLDOWN_SEC, RESYNC_PREFIX } from './dupr-connection.js';

/*
 * GRIPBAT-ACCOUNTS-V1 (spec §7) — gb/dupr/resync: Reclub's "Resync ratings", once an hour, for THIS account's linked
 * DUPR player. The rating read is hkpl's partner-API-only read (lib/dupr/hybrid.ratingsViaApi — "never touches the
 * reader", G15.1) through the S2S door POST /api/v1/social/dupr/ratings; the hour is claimed in Redis BEFORE the call
 * (SET NX), as hkpl's DUPR-RESYNC-ATOMIC-V1 claims it, so a failing DUPR is not hammered and a double press cannot pass.
 * The new numbers land on meet_player_level (MeetLevelService.upsertLevel, REUSED).
 */
export const meta = {
	tags: ['dupr'],
	requireCredential: true,
	kind: 'write:account',
	errors: {
		notLinked: { message: 'Link your DUPR first.', code: 'DUPR_NOT_LINKED', id: 'f5a1b2c3-0d4e-4f60-8a7b-9c0d1e2f3a21' },
		cooldown: { message: 'You can resync once an hour.', code: 'DUPR_RESYNC_COOLDOWN', id: 'f5a1b2c3-0d4e-4f60-8a7b-9c0d1e2f3a22' },
		doorNotLive: { message: 'DUPR resync is not available yet. Please try again later.', code: 'DUPR_DOOR_NOT_LIVE', id: 'f5a1b2c3-0d4e-4f60-8a7b-9c0d1e2f3a23' },
		unavailable: { message: 'Could not reach DUPR right now.', code: 'DUPR_UNAVAILABLE', id: 'f5a1b2c3-0d4e-4f60-8a7b-9c0d1e2f3a24' },
		notConsented: { message: 'DUPR has not granted GripBat access to this player.', code: 'NOT_CONSENTED', id: 'f5a1b2c3-0d4e-4f60-8a7b-9c0d1e2f3a25' },
	},
	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			doubles: { type: 'number', optional: false, nullable: true },
			singles: { type: 'number', optional: false, nullable: true },
			resyncAvailableAt: { type: 'string', optional: false, nullable: false },
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
			if (lv?.duprId == null) throw new ApiError(meta.errors.notLinked);
			const claimed = await this.redisClient.set(RESYNC_PREFIX + me.id, '1', 'EX', RESYNC_COOLDOWN_SEC, 'NX');
			if (claimed !== 'OK') throw new ApiError(meta.errors.cooldown);
			const next = new Date(Date.now() + RESYNC_COOLDOWN_SEC * 1000).toISOString();
			if (lv.source === 'dupr-sandbox') return { doubles: lv.duprDoubles ?? null, singles: lv.duprSingles ?? null, resyncAvailableAt: next };

			const r = await this.duprSubmitService.connectDoor('ratings', { gb_user: me.id, duprId: lv.duprId });
			if (r.status === 0 || r.status === 404) { await this.redisClient.del(RESYNC_PREFIX + me.id); throw new ApiError(meta.errors.doorNotLive); }
			if (r.status === 409) throw new ApiError(meta.errors.notConsented);
			if (r.status !== 200 || r.json.ok !== true) throw new ApiError(meta.errors.unavailable);
			const ratings = (r.json.ratings ?? {}) as { doubles?: unknown; singles?: unknown };
			const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n > 0 && n < 9 ? n : null; };
			const doubles = num(ratings.doubles);
			const singles = num(ratings.singles);
			await this.meetLevelService.upsertLevel(me.id, 'pickleball', { ...(doubles != null ? { duprDoubles: doubles } : {}), ...(singles != null ? { duprSingles: singles } : {}) });
			return { doubles: doubles ?? lv.duprDoubles ?? null, singles: singles ?? lv.duprSingles ?? null, resyncAvailableAt: next };
		});
	}
}

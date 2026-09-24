/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DI } from '@/di-symbols.js';
import type { UserProfilesRepository } from '@/models/_.js';
import { DuprSubmitService } from '@/core/DuprSubmitService.js';
import { MeetLevelService } from '@/modules/meets/MeetLevelService.js';
import { isReservedTestAddress } from '@/misc/gb-accounts.js';
import { ApiError } from '@/server/api/error.js';

/*
 * GRIPBAT-ACCOUNTS-V1 (spec §7, G15.15) — gb/dupr/connect: link the DUPR player who consented to GripBat's partner
 * integration to THIS GripBat account. NEW (searched endpoint-list.ts: only meets/level {unlinkDupr} and the submit
 * path touch DUPR; the connect flow lived on hkpl's user, which a GripBat account no longer has).
 *
 * The trust anchor stays hkpl's (routes/dupr-consent.js: partner.getPlayer(duprId) answers 200 only for a player who
 * completed DUPR's consent for our integration, + IDENTITY-BIND-V1 on the DUPR JWT), reached through the S2S door
 * POST /api/v1/social/dupr/verify keyed by the GripBat user (DuprSubmitService.connectDoor). The verified id and rating
 * are kept on the engine where every DUPR reader already looks: meet_player_level (MeetLevelService.upsertLevel, REUSED),
 * source 'dupr-partner'. One DUPR player → one GripBat account (DUPR_ID_TAKEN). Partner API only — never the reader.
 *
 * UAT cage (UAT-DUPR-CAGE-V1): on the caged engine a TEST account (reserved-domain email) is linked locally with source
 * 'dupr-sandbox' and no hkpl call; a real tester on UAT still goes through the (read-only) consent check.
 */
export const meta = {
	tags: ['dupr'],
	requireCredential: true,
	kind: 'write:account',
	limit: { duration: 60 * 60 * 1000, max: 20 },
	errors: {
		badId: { message: 'That does not look like a DUPR ID.', code: 'BAD_DUPR_ID', id: 'f5a1b2c3-0d4e-4f60-8a7b-9c0d1e2f3a01' },
		taken: { message: 'Another GripBat account is already linked to this DUPR player.', code: 'DUPR_ID_TAKEN', id: 'f5a1b2c3-0d4e-4f60-8a7b-9c0d1e2f3a02' },
		notConsented: { message: 'DUPR has not granted GripBat access to this player yet. Finish the consent step in the DUPR window, then try again.', code: 'NOT_CONSENTED', id: 'f5a1b2c3-0d4e-4f60-8a7b-9c0d1e2f3a03' },
		mismatch: { message: 'Your DUPR login does not match this DUPR ID.', code: 'IDENTITY_MISMATCH', id: 'f5a1b2c3-0d4e-4f60-8a7b-9c0d1e2f3a04' },
		doorNotLive: { message: 'DUPR linking is not available yet. Please try again later.', code: 'DUPR_DOOR_NOT_LIVE', id: 'f5a1b2c3-0d4e-4f60-8a7b-9c0d1e2f3a05' },
		unavailable: { message: 'Could not reach DUPR right now. Please try again shortly.', code: 'DUPR_UNAVAILABLE', id: 'f5a1b2c3-0d4e-4f60-8a7b-9c0d1e2f3a06' },
		caged: { message: 'This test server cannot link DUPR.', code: 'DUPR_CAGED', id: 'f5a1b2c3-0d4e-4f60-8a7b-9c0d1e2f3a07' },
	},
	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			linked: { type: 'boolean', optional: false, nullable: false },
			duprId: { type: 'string', optional: false, nullable: false },
			name: { type: 'string', optional: false, nullable: true },
			doubles: { type: 'number', optional: false, nullable: true },
			singles: { type: 'number', optional: false, nullable: true },
			sandbox: { type: 'boolean', optional: false, nullable: false },
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		duprId: { type: 'string', minLength: 4, maxLength: 16 },
		userToken: { type: 'string', maxLength: 8192 },
		duprUserId: { type: 'string', maxLength: 64 },
	},
	required: ['duprId'],
} as const;

function rating(v: unknown): number | null {
	const n = Number(v);
	return Number.isFinite(n) && n > 0 && n < 9 ? n : null;
}

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.db)
		private db: DataSource,

		@Inject(DI.userProfilesRepository)
		private userProfilesRepository: UserProfilesRepository,

		private duprSubmitService: DuprSubmitService,
		private meetLevelService: MeetLevelService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const duprId = String(ps.duprId).trim().toUpperCase();
			if (!/^[A-Z0-9]{5,12}$/.test(duprId)) throw new ApiError(meta.errors.badId);

			const holder = await this.db.query(`SELECT "userId" FROM "meet_player_level" WHERE "sport" = 'pickleball' AND UPPER("duprId") = $1 AND "userId" <> $2 LIMIT 1`, [duprId, me.id]) as { userId: string }[];
			if (holder.length > 0) throw new ApiError(meta.errors.taken);

			const mode = this.duprSubmitService.cageMode();
			if (mode !== 'live') {
				const profile = await this.userProfilesRepository.findOneByOrFail({ userId: me.id });
				if (mode === 'refuse') throw new ApiError(meta.errors.caged);
				if (isReservedTestAddress(profile.email)) {
					await this.meetLevelService.upsertLevel(me.id, 'pickleball', { duprId, source: 'dupr-sandbox' });
					return { linked: true, duprId, name: null, doubles: null, singles: null, sandbox: true };
				}
			}

			const r = await this.duprSubmitService.connectDoor('verify', { gb_user: me.id, duprId, userToken: ps.userToken ?? null, dupr_user_id: ps.duprUserId ?? null });
			const reason = String(r.json.reason ?? '');
			if (r.status === 0 || r.status === 404) throw new ApiError(meta.errors.doorNotLive);
			if (r.status === 409 && reason === 'not_consented') throw new ApiError(meta.errors.notConsented);
			if (r.status === 403 && reason === 'identity_mismatch') throw new ApiError(meta.errors.mismatch);
			if (r.status !== 200 || r.json.ok !== true) throw new ApiError(meta.errors.unavailable);

			const ratings = (r.json.ratings ?? {}) as { doubles?: unknown; singles?: unknown };
			const doubles = rating(ratings.doubles);
			const singles = rating(ratings.singles);
			await this.meetLevelService.upsertLevel(me.id, 'pickleball', {
				duprId,
				source: 'dupr-partner',
				...(doubles != null ? { duprDoubles: doubles } : {}),
				...(singles != null ? { duprSingles: singles } : {}),
			});
			return { linked: true, duprId, name: typeof r.json.name === 'string' ? r.json.name : null, doubles, singles, sandbox: false };
		});
	}
}

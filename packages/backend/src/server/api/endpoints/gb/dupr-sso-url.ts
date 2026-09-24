/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DuprSubmitService } from '@/core/DuprSubmitService.js';
import { ApiError } from '@/server/api/error.js';

/*
 * GRIPBAT-ACCOUNTS-V1 (spec §7) — gb/dupr/sso-url: the address of DUPR's own consent window ("Login with DUPR"). The
 * partner client key stays on hkpl, which builds the URL (routes/dupr-consent.js partner.ssoUrl(), REUSED through the
 * S2S door GET /api/v1/social/dupr/sso-url). NEW only as the engine's side of that door.
 */
export const meta = {
	tags: ['dupr'],
	requireCredential: true,
	kind: 'read:account',
	limit: { duration: 60 * 1000, max: 20 },
	errors: {
		doorNotLive: { message: 'DUPR linking is not available yet. Please try again later.', code: 'DUPR_DOOR_NOT_LIVE', id: 'f5a1b2c3-0d4e-4f60-8a7b-9c0d1e2f3a11' },
		notConfigured: { message: 'DUPR linking is not set up yet.', code: 'DUPR_NOT_CONFIGURED', id: 'f5a1b2c3-0d4e-4f60-8a7b-9c0d1e2f3a12' },
	},
	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			url: { type: 'string', optional: false, nullable: false },
			origins: { type: 'array', optional: false, nullable: false, items: { type: 'string', optional: false, nullable: false } },
		},
	},
} as const;

export const paramDef = { type: 'object', properties: {}, required: [] } as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private duprSubmitService: DuprSubmitService,
	) {
		super(meta, paramDef, async () => {
			const r = await this.duprSubmitService.connectDoor('sso-url', null);
			if (r.status === 503) throw new ApiError(meta.errors.notConfigured);
			if (r.status !== 200 || typeof r.json.url !== 'string') throw new ApiError(meta.errors.doorNotLive);
			const origins = Array.isArray(r.json.origins) ? (r.json.origins as unknown[]).map(String) : [];
			return { url: r.json.url, origins };
		});
	}
}

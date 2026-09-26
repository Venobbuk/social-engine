/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { AccessTokensRepository, UserProfilesRepository, UsersRepository } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import { GlobalEventService } from '@/core/GlobalEventService.js';
import { GB_SANDBOX_MAIL, normalizeEmail, rotateNativeToken } from '@/misc/gb-accounts.js';
import { ROLE_PERSONAS } from './role-door.js';
import { ApiError } from '../../error.js';

/*
 * GB-SIGNOUT-V1 (lane L6-SIGNIN, 2026-09-26) — gb/auth/signout: sign-out ENDS the session on the server.
 *
 * MEASURED 2026-09-26 (uat.gripbat.com, 390x844, Chromium + WebKit, EN + 繁, real taps): More › Sign out dropped the
 * credential on the device, but POST /api/i with the dropped credential still answered 200 — the app's GripBat sign-out
 * (hkpl-taro-branch src/lib/auth.ts signout, gbMode) never told the engine. FRONTEND_UAT_STANDARD 5J / OWASP ASVS L1: a
 * sign-out must end the session server-side.
 *
 * WHAT IT ENDS. A GripBat sign-in returns the account's ONE native token (SigninService: `i: user.token`) — Misskey has no
 * per-device native session. So:
 *   - called with the native token → the token is ROTATED (REUSED rotateNativeToken: the same rotation a password reset
 *     does) — this signs the account out on EVERY device. Answer { ended: true, everyDevice: true }.
 *   - called with an access token (an app credential) → only that token is revoked, as i/revoke-token does.
 *     Answer { ended: true, everyDevice: false }.
 *   - EXCEPTION, UAT only: the six shared role-door personas (gb/role-door ROLE_PERSONAS, GB_SANDBOX_MAIL=1) are NOT
 *     rotated — several testers share each one at once and a rotation would sign the others out (role-door's own rule).
 *     Answer { ended: false, shared: true }; the app still drops the credential on the device.
 * Per-device sessions (a token per sign-in) would end only this device; that is a change to how every GripBat sign-in
 * mints its credential and is the operator's call (lane note /root/gen/l6-scope/lane-notes/l6-signin.md).
 *
 * No requireCredential in meta, for the same reason as i/revoke-token: an access token must be able to revoke itself, and
 * ApiCallService refuses a token on a requireCredential endpoint without `kind`. The credential is checked here.
 */
export const meta = {
	tags: ['account'],
	errors: {
		credentialRequired: { message: 'Credential required.', code: 'CREDENTIAL_REQUIRED', id: '3c9e1f47-6a2b-4d8e-9f15-7b0c2e4a6d93', httpStatusCode: 401 },
	},
	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			ended: { type: 'boolean', optional: false, nullable: false },
			everyDevice: { type: 'boolean', optional: false, nullable: false },
			shared: { type: 'boolean', optional: false, nullable: false },
		},
	},
} as const;

export const paramDef = { type: 'object', properties: {}, required: [] } as const;

const SHARED = new Set<string>(Object.values(ROLE_PERSONAS).map(e => normalizeEmail(e)));

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,

		@Inject(DI.userProfilesRepository)
		private userProfilesRepository: UserProfilesRepository,

		@Inject(DI.accessTokensRepository)
		private accessTokensRepository: AccessTokensRepository,

		private globalEventService: GlobalEventService,
	) {
		super(meta, paramDef, async (ps, me, token) => {
			if (me == null) throw new ApiError(meta.errors.credentialRequired);
			if (token != null) {
				await this.accessTokensRepository.delete({ id: token.id, userId: me.id });
				return { ended: true, everyDevice: false, shared: false };
			}
			if (GB_SANDBOX_MAIL) {
				const prof = await this.userProfilesRepository.findOneBy({ userId: me.id });
				if (prof && SHARED.has(normalizeEmail(prof.email))) return { ended: false, everyDevice: false, shared: true };
			}
			await rotateNativeToken(this.usersRepository, this.globalEventService, me.id);
			return { ended: true, everyDevice: true, shared: false };
		});
	}
}

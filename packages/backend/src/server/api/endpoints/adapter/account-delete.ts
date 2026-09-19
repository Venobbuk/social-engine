/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import * as Redis from 'ioredis';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DI } from '@/di-symbols.js';
import type { UsersRepository, UsedUsernamesRepository } from '@/models/_.js';
import { DeleteAccountService } from '@/core/DeleteAccountService.js';
import { LoggerService } from '@/core/LoggerService.js';
import type Logger from '@/logger.js';
import { ApiError } from '@/server/api/error.js';
import { verifyJwt, usernameFor } from '@/server/api/endpoints/adapter/sso.js';

// ACCOUNT-DELETE-V1 (PDPO, Reclub settings › delete account): an account minted by the host SSO has a password
// nobody knows (adapter/sso), so i/delete-account's password check can never pass for it. This door deletes the
// CALLER's own account. Only for host-minted accounts (adapter/sso usernameFor: <iss>_<12 hex>); anyone else uses
// i/delete-account.
//
// SEC-ACCOUNT-DELETE-REAUTH-V1 (2026-09-20): deleting an account is irreversible, so the caller's ordinary app
// credential should not be enough on its own. A `proof` is a PURPOSE-BOUND re-authentication: a JWT with
// purpose 'account-delete', minted only by hkpl's explicit re-auth route (POST /api/v1/auth/sso/social/delete-proof:
// password, or a sign-in in the last few minutes), verified exactly as a login (signature, audience, mandatory iat,
// ≤ 5-min TTL, mandatory single-use jti) and resolving to the SAME account. A login token is refused as a proof, and
// adapter/sso refuses a proof as a login.
//
// ROLLOUT SWITCH (PDPO: the right to delete must never be switched off): ADAPTER_ACCOUNT_DELETE_REQUIRE_PROOF.
//   unset / '0' (DEFAULT) — today's behaviour: the app credential alone deletes; a proof, if sent, is still verified.
//   '1'                   — a proof is REQUIRED. Turn on only once the app that mints the proof has shipped.
// The door is rate-limited and every deletion is logged either way.
const REQUIRE_PROOF = process.env.ADAPTER_ACCOUNT_DELETE_REQUIRE_PROOF === '1';
const PROOF_PURPOSE = 'account-delete';
export const meta = {
	tags: ['account'],
	requireCredential: true,
	// not `secure`: the SSO issues a first-party APP credential (S4), and secure endpoints admit only native tokens
	kind: 'write:account',
	// SEC-ACCOUNT-DELETE-REAUTH-V1: rate-limit — a handful of attempts a minute is ample for a real deletion
	limit: { duration: 60 * 1000, max: 5 },
	errors: {
		reauthRequired: { message: 'A fresh sign-in is required to delete your account.', code: 'REAUTH_REQUIRED', id: '8c2d0e5a-1b7c-4e1a-9c0e-5a0c3a1d2f10' },
		reauthMismatch: { message: 'The re-authentication does not match this account.', code: 'REAUTH_MISMATCH', id: '8c2d0e5a-1b7c-4e1a-9c0e-5a0c3a1d2f11' },
		reauthReplayed: { message: 'This re-authentication has already been used.', code: 'REAUTH_REPLAYED', id: '8c2d0e5a-1b7c-4e1a-9c0e-5a0c3a1d2f12' },
	},
	res: { type: 'object', optional: false, nullable: false, properties: { deleted: { type: 'boolean', optional: false, nullable: false } } },
} as const;

export const paramDef = {
	type: 'object',
	// SEC-ACCOUNT-DELETE-REAUTH-V1: `proof` is a purpose-bound hkpl re-auth JWT. Optional in the schema so today's app
	// (which sends {}) keeps working; REQUIRED at run time only when ADAPTER_ACCOUNT_DELETE_REQUIRE_PROOF=1.
	properties: { proof: { type: 'string', minLength: 20, maxLength: 8192, nullable: true } },
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	private logger: Logger;

	constructor(
		@Inject(DI.redis)
		private redisClient: Redis.Redis,
		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,
		@Inject(DI.usedUsernamesRepository)
		private usedUsernamesRepository: UsedUsernamesRepository,
		private deleteAccountService: DeleteAccountService,
		private loggerService: LoggerService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const user = await this.usersRepository.findOneByOrFail({ id: me.id });
			if (user.isDeleted) return { deleted: true };
			if (!/^[a-z0-9-]+_[0-9a-f]{12}$/.test(user.username)) throw new Error('use i/delete-account');   // adapter/sso usernameFor(): <iss>_<12 hex>

			// SEC-ACCOUNT-DELETE-REAUTH-V1: a purpose-bound, single-use, identity-matched re-auth proof — required only
			// when the rollout switch is on; verified whenever one is sent.
			let how = 'app credential (proof not required: ADAPTER_ACCOUNT_DELETE_REQUIRE_PROOF off)';
			if (ps.proof) {
				let claims;
				try {
					claims = verifyJwt(ps.proof);
				} catch (e) {
					this.logger.warn(`account deletion proof refused user=${user.id}: ${e instanceof ApiError ? e.code : (e instanceof Error ? e.message : String(e))}`);
					if (e instanceof ApiError) throw e;               // unconfigured / unknown issuer
					throw new ApiError(meta.errors.reauthRequired);   // bad signature / expired / no iat / no aud / bad ttl
				}
				// purpose-bound: an ordinary login token is not a re-authentication
				if (claims.purpose !== PROOF_PURPOSE) throw new ApiError(meta.errors.reauthRequired);
				if (typeof claims.jti !== 'string' || claims.jti.length < 8) throw new ApiError(meta.errors.reauthRequired);
				// the proof must be for THIS account (same host identity → same deterministic username)
				if (usernameFor(claims.iss, claims.sub) !== user.username) throw new ApiError(meta.errors.reauthMismatch);
				// single use: redeem the jti once, in the same namespace adapter/sso uses
				const ttl = Math.max(1, Math.min(300, (claims.exp - Math.floor(Date.now() / 1000)) + 5));
				const first = await this.redisClient.set(`sso:jti:${claims.iss}:${claims.jti}`, '1', 'EX', ttl, 'NX');
				if (first !== 'OK') throw new ApiError(meta.errors.reauthReplayed);
				how = `re-auth proof (iss=${claims.iss})`;
			} else if (REQUIRE_PROOF) {
				throw new ApiError(meta.errors.reauthRequired);
			}

			const uname = user.username;   // captured before the deletion job touches the row
			this.logger.info(`account deletion user=${user.id} username=${uname} via ${how}`);
			await this.deleteAccountService.deleteAccount(me);
			// the row stays as a tombstone (federation), so free the deterministic SSO username: the person's NEXT sign-in
			// mints a fresh account instead of colliding with the deleted one (found by probes/safety-v1 7b: remint 500)
			const freed = uname + '_x' + Date.now().toString(36);
			await this.usersRepository.update(user.id, { username: freed, usernameLower: freed.toLowerCase() });
			// the deletion job also parks the name in used_username (no reuse by strangers); for a host-minted name the
			// only possible re-user IS the same person, so release it
			await this.usedUsernamesRepository.delete({ username: uname.toLowerCase() });
			return { deleted: true };
		});

		this.logger = this.loggerService.getLogger('adapter:account-delete');
	}
}

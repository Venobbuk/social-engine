/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import * as Redis from 'ioredis';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DI } from '@/di-symbols.js';
import type { UsersRepository, UserProfilesRepository } from '@/models/_.js';
import bcrypt from 'bcryptjs';   // GRIPBAT-ACCOUNTS-V1: a native account confirms with its password
import type { DataSource } from 'typeorm';
import { GlobalEventService } from '@/core/GlobalEventService.js';
import { scheduleDeletion } from '@/modules/account/deletion.js';   // ACCOUNT-GRACE-V1
import { LoggerService } from '@/core/LoggerService.js';
import type Logger from '@/logger.js';
import { ApiError } from '@/server/api/error.js';
import { verifyJwt, usernameFor } from '@/server/api/endpoints/adapter/sso.js';
import { SSO_HANDLE_KEY } from '@/misc/gb-accounts.js';   // ACCOUNT-DELETE-SSO-V1: the seam handle of a renamed SSO account

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
		incorrectPassword: { message: 'That password is not right.', code: 'INCORRECT_PASSWORD', id: '8c2d0e5a-1b7c-4e1a-9c0e-5a0c3a1d2f13' },   // GRIPBAT-ACCOUNTS-V1
		reauthRequired: { message: 'A fresh sign-in is required to delete your account.', code: 'REAUTH_REQUIRED', id: '8c2d0e5a-1b7c-4e1a-9c0e-5a0c3a1d2f10' },
		reauthMismatch: { message: 'The re-authentication does not match this account.', code: 'REAUTH_MISMATCH', id: '8c2d0e5a-1b7c-4e1a-9c0e-5a0c3a1d2f11' },
		reauthReplayed: { message: 'This re-authentication has already been used.', code: 'REAUTH_REPLAYED', id: '8c2d0e5a-1b7c-4e1a-9c0e-5a0c3a1d2f12' },
		passwordRequired: { message: 'Enter your password to delete your account.', code: 'PASSWORD_REQUIRED', id: '8c2d0e5a-1b7c-4e1a-9c0e-5a0c3a1d2f14' },   // ACCOUNT-DELETE-SSO-V1
	},
	// ACCOUNT-GRACE-V1: `deleted` stays true — the account is CLOSED now (signed out everywhere, hidden from search); the minute
	// sweep purges it at `purgeAt` (7 days) unless the person signs in and restores it (adapter/account/restore).
	res: { type: 'object', optional: false, nullable: false, properties: {
		deleted: { type: 'boolean', optional: false, nullable: false },
		scheduled: { type: 'boolean', optional: false, nullable: false },
		purgeAt: { type: 'string', optional: false, nullable: true },
	} },
} as const;

export const paramDef = {
	type: 'object',
	// SEC-ACCOUNT-DELETE-REAUTH-V1: `proof` is a purpose-bound hkpl re-auth JWT. Optional in the schema so today's app
	// (which sends {}) keeps working; REQUIRED at run time only when ADAPTER_ACCOUNT_DELETE_REQUIRE_PROOF=1.
	properties: {
		proof: { type: 'string', minLength: 20, maxLength: 8192, nullable: true },
		// GRIPBAT-ACCOUNTS-V1 (G15.15): a GripBat (native) account confirms its deletion with its own password; it then gets the
		// same 7-day grace as a host-minted one (ACCOUNT-GRACE-V1) — i/delete-account would delete it at once, with no way back.
		password: { type: 'string', minLength: 1, maxLength: 256 },
	},
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

		@Inject(DI.userProfilesRepository)
		private userProfilesRepository: UserProfilesRepository,
		@Inject(DI.db)
		private db: DataSource,
		private globalEventService: GlobalEventService,
		private loggerService: LoggerService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const user = await this.usersRepository.findOneByOrFail({ id: me.id });
			if (user.isDeleted) return { deleted: true, scheduled: false, purgeAt: null };
			// GRIPBAT-ACCOUNTS-V1: with a password, ANY local account (a native GripBat one) schedules its deletion here
			let nativeHow: string | null = null;
			if (typeof ps.password === 'string') {
				const prof = await this.userProfilesRepository.findOneByOrFail({ userId: user.id });
				if (!prof.password || !(await bcrypt.compare(ps.password, prof.password))) throw new ApiError(meta.errors.incorrectPassword);
				nativeHow = 'account password';
			}
			/* ACCOUNT-DELETE-SSO-V1 (was: a username that is not "<iss>_<12 hex>" threw a plain Error → 500 — every SSO account
			 * renamed by SSO-ONE-TAP). The seam handle is the username, or the registry alias the rename kept (SSO_HANDLE_KEY). */
			let seamHandle: string | null = /^[a-z0-9-]+_[0-9a-f]{12}$/.test(user.username) ? user.username : null;
			if (!seamHandle) {
				const rows = await this.db.query('SELECT value FROM registry_item WHERE "userId" = $1 AND key = $2 AND domain IS NULL LIMIT 1', [user.id, SSO_HANDLE_KEY]) as { value: unknown }[];
				const v = rows[0] ? rows[0].value : null;
				seamHandle = typeof v === 'string' && v ? v : null;
			}
			// an account the SSO door made (it has a seam handle) has only a random password nobody knows (sso.ts); every other account
			// confirms with its own password
			if (!nativeHow && !seamHandle) throw new ApiError(meta.errors.passwordRequired);

			// SEC-ACCOUNT-DELETE-REAUTH-V1: a purpose-bound, single-use, identity-matched re-auth proof — required only
			// when the rollout switch is on; verified whenever one is sent.
			let how = 'app credential (proof not required: ADAPTER_ACCOUNT_DELETE_REQUIRE_PROOF off)';
			if (nativeHow) {
				how = nativeHow;
			} else if (ps.proof) {
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
				if (usernameFor(claims.iss, claims.sub) !== (seamHandle ?? user.username)) throw new ApiError(meta.errors.reauthMismatch);   // ACCOUNT-DELETE-SSO-V1
				// single use: redeem the jti once, in the same namespace adapter/sso uses
				const ttl = Math.max(1, Math.min(300, (claims.exp - Math.floor(Date.now() / 1000)) + 5));
				const first = await this.redisClient.set(`sso:jti:${claims.iss}:${claims.jti}`, '1', 'EX', ttl, 'NX');
				if (first !== 'OK') throw new ApiError(meta.errors.reauthReplayed);
				how = `re-auth proof (iss=${claims.iss})`;
			} else if (REQUIRE_PROOF) {
				throw new ApiError(meta.errors.reauthRequired);
			}

			// ACCOUNT-GRACE-V1 (was: DeleteAccountService.deleteAccount at once + free the SSO username — both now run at purge
			// time, modules/account/deletion.ts purgeDue, from the minute sweep)
			this.logger.info(`account deletion SCHEDULED user=${user.id} username=${user.username} via ${how}`);
			const st = await scheduleDeletion(this.db, user.id, how, {
				tokenRegenerated: (oldToken, newToken) => {
					this.globalEventService.publishInternalEvent('userTokenRegenerated', { id: user.id, oldToken, newToken });
					this.globalEventService.publishMainStream(user.id, 'myTokenRegenerated');
				},
			});
			return { deleted: true, scheduled: true, purgeAt: st.purgeAt };
		});

		this.logger = this.loggerService.getLogger('adapter:account-delete');
	}
}

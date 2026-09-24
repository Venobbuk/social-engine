/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { IsNull } from 'typeorm';
import * as Redis from 'ioredis';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DI } from '@/di-symbols.js';
import type { UsersRepository, UserProfilesRepository, SigninsRepository } from '@/models/_.js';
import { IdService } from '@/core/IdService.js';
import { NotificationService } from '@/core/NotificationService.js';
import { SIGNIN_CODE_PREFIX, normalizeEmail } from '@/misc/gb-accounts.js';
import { ApiError } from '@/server/api/error.js';
import { hashSigninCode } from './auth-code.js';

/*
 * GRIPBAT-ACCOUNTS-V1 (spec §1) — gb/auth/code/verify: redeem the emailed 6-digit code → signed in.
 * Answers exactly what the native sign-in answers (SigninService.signin: { finished, id, i } — the account's native
 * token, so the secure account doors (i/change-password, i/update-email) work for the person), records the sign-in in
 * `signin` and raises the native 'login' notification, as SigninService does. SigninService itself lives in the server
 * module (fastify request/reply), out of reach of an endpoint, so these three steps are repeated here — nothing else.
 * A wrong code counts; the 5th wrong try burns it. 30 attempts an hour per IP (endpoint limit).
 */
export const meta = {
	tags: ['auth'],
	requireCredential: false,
	limit: { duration: 60 * 60 * 1000, max: 30 },
	errors: {
		invalid: { message: 'That code is wrong or has expired.', code: 'CODE_INVALID', id: 'e3b1f2a4-6c5d-4e7f-8a9b-0c1d2e3f4a51' },
		suspended: { message: 'This account is suspended.', code: 'ACCOUNT_SUSPENDED', id: 'e3b1f2a4-6c5d-4e7f-8a9b-0c1d2e3f4a52' },
	},
	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			finished: { type: 'boolean', optional: false, nullable: false },
			id: { type: 'string', optional: false, nullable: false },
			i: { type: 'string', optional: false, nullable: false },
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		email: { type: 'string', minLength: 3, maxLength: 320 },
		code: { type: 'string', minLength: 1, maxLength: 16 },
	},
	required: ['email', 'code'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.redis)
		private redisClient: Redis.Redis,

		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,

		@Inject(DI.userProfilesRepository)
		private userProfilesRepository: UserProfilesRepository,

		@Inject(DI.signinsRepository)
		private signinsRepository: SigninsRepository,

		private idService: IdService,
		private notificationService: NotificationService,
	) {
		super(meta, paramDef, async (ps, _me, _token, _file, _cleanup, ip, headers) => {
			const email = normalizeEmail(ps.email);
			const code = String(ps.code).replace(/\D/g, '');
			const profile = await this.userProfilesRepository.createQueryBuilder('p')
				.where('p.emailVerified = true')
				.andWhere('LOWER(p.email) = :e', { e: email })
				.getOne();
			const user = profile ? await this.usersRepository.findOneBy({ id: profile.userId, host: IsNull() }) : null;
			if (user == null || user.isDeleted || code.length !== 6) throw new ApiError(meta.errors.invalid);

			const key = SIGNIN_CODE_PREFIX + user.id;
			const raw = await this.redisClient.get(key);
			if (!raw) throw new ApiError(meta.errors.invalid);
			const entry = JSON.parse(raw) as { h: string; tries: number };
			const want = Buffer.from(entry.h, 'hex');
			const got = Buffer.from(hashSigninCode(user.id, code), 'hex');
			if (want.length !== got.length || !timingSafeEqual(want, got)) {
				const tries = (entry.tries ?? 0) + 1;
				if (tries >= 5) await this.redisClient.del(key);
				else await this.redisClient.set(key, JSON.stringify({ h: entry.h, tries }), 'KEEPTTL');
				throw new ApiError(meta.errors.invalid);
			}
			await this.redisClient.del(key);
			if (user.isSuspended) throw new ApiError(meta.errors.suspended);

			// what SigninService.signin does, minus the "new sign-in" mail (the person just proved they read that inbox)
			this.notificationService.createNotification(user.id, 'login', {});
			await this.signinsRepository.insert({
				id: this.idService.gen(),
				userId: user.id,
				ip: ip ?? '',
				headers: (headers ?? {}) as never,
				success: true,
			});
			return { finished: true, id: user.id, i: user.token! };
		});
	}
}

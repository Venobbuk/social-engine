/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { randomInt, createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { IsNull } from 'typeorm';
import * as Redis from 'ioredis';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DI } from '@/di-symbols.js';
import type { Config } from '@/config.js';
import type { UsersRepository, UserProfilesRepository } from '@/models/_.js';
import { EmailService } from '@/core/EmailService.js';
import { GB_PUBLIC_ORIGIN, SIGNIN_CODE_PREFIX, mailCopy, normalizeEmail, sandboxReveal } from '@/misc/gb-accounts.js';

/*
 * GRIPBAT-ACCOUNTS-V1 (spec §1) — gb/auth/code: email me a 6-digit sign-in code (no password needed).
 * NEW: Misskey signs in by password, TOTP, passkey or miauth app-auth — no emailed one-time code (searched
 * endpoint-list.ts, server/api/*Service.ts, endpoints/auth/*, miauth/*). The enhancement over Reclub (password only) is
 * recorded in the spec: every GripBat tester to date signed in this way (hkpl claim/start), and a player at the court who
 * forgot a password gets in without a reset round-trip.
 *
 * Same answer whether or not the address has an account (no enumeration): with an account the code is mailed; without
 * one, a "no account uses this address — create one" mail. The code: 6 digits, stored hashed in Redis for 10 minutes,
 * 5 wrong tries burn it (gb/auth/code/verify). 5 requests an hour per IP (endpoint limit) and one live code per account.
 * UAT sandbox: a reserved test address on the GB_SANDBOX_MAIL container gets the code back (_dev_code).
 */
export const meta = {
	tags: ['auth'],
	requireCredential: false,
	limit: { duration: 60 * 60 * 1000, max: 5 },
	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			sent: { type: 'boolean', optional: false, nullable: false },
			_dev_code: { type: 'string', optional: true, nullable: false },
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		email: { type: 'string', minLength: 3, maxLength: 320 },
		lang: { type: 'string', maxLength: 12 },
	},
	required: ['email'],
} as const;

export function hashSigninCode(userId: string, code: string): string {
	return createHash('sha256').update(`${userId}:${code}`).digest('hex');
}

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.config)
		private config: Config,

		@Inject(DI.redis)
		private redisClient: Redis.Redis,

		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,

		@Inject(DI.userProfilesRepository)
		private userProfilesRepository: UserProfilesRepository,

		private emailService: EmailService,
	) {
		super(meta, paramDef, async (ps) => {
			const email = normalizeEmail(ps.email);
			if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { sent: true };
			const profile = await this.userProfilesRepository.createQueryBuilder('p')
				.where('p.emailVerified = true')
				.andWhere('LOWER(p.email) = :e', { e: email })
				.getOne();
			const user = profile ? await this.usersRepository.findOneBy({ id: profile.userId, host: IsNull() }) : null;
			if (user == null || user.isDeleted) {
				const origin = GB_PUBLIC_ORIGIN || this.config.url.replace(/\/+$/, '');
				const m = mailCopy('noAccount', ps.lang, { link: `${origin}/app/pages/signin/index?signup=1` });
				this.emailService.sendEmail(email, m.subject, m.html, m.text).catch(() => { /* logged by EmailService */ });
				return { sent: true };
			}
			if (user.isSuspended) return { sent: true };

			const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
			await this.redisClient.set(SIGNIN_CODE_PREFIX + user.id, JSON.stringify({ h: hashSigninCode(user.id, code), tries: 0 }), 'EX', 10 * 60);
			const m = mailCopy('signinCode', ps.lang ?? profile!.lang, { code });
			this.emailService.sendEmail(profile!.email!, m.subject, m.html, m.text).catch(() => { /* logged by EmailService */ });
			return sandboxReveal(email) ? { sent: true, _dev_code: code } : { sent: true };
		});
	}
}

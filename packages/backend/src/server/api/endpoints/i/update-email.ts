/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import ms from 'ms';
import bcrypt from 'bcryptjs';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { MiMeta, UserProfilesRepository } from '@/models/_.js';
import { UserEntityService } from '@/core/entities/UserEntityService.js';
import { EmailService } from '@/core/EmailService.js';
import type { Config } from '@/config.js';
import { DI } from '@/di-symbols.js';
import { L_CHARS, secureRndstr } from '@/misc/secure-rndstr.js';
import { UserAuthService } from '@/core/UserAuthService.js';
import { GlobalEventService } from '@/core/GlobalEventService.js';
import { appLink, mailCopy, normalizeEmail, sandboxReveal, EMAIL_CHANGE_PREFIX } from '@/misc/gb-accounts.js'; // GRIPBAT-ACCOUNTS-V1
import * as Redis from 'ioredis';
import { ApiError } from '../../error.js';

export const meta = {
	requireCredential: true,

	secure: true,

	limit: {
		duration: ms('1hour'),
		max: 3,
	},

	errors: {
		incorrectPassword: {
			message: 'Incorrect password.',
			code: 'INCORRECT_PASSWORD',
			id: 'e54c1d7e-e7d6-4103-86b6-0a95069b4ad3',
		},

		unavailable: {
			message: 'Unavailable email address.',
			code: 'UNAVAILABLE',
			id: 'a2defefb-f220-8849-0af6-17f816099323',
		},

		emailRequired: {
			message: 'Email address is required.',
			code: 'EMAIL_REQUIRED',
			id: '324c7a88-59f2-492f-903f-89134f93e47e',
		},
	},

	res: {
		type: 'object',
		ref: 'MeDetailed',
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		password: { type: 'string' },
		email: { type: 'string', nullable: true },
		token: { type: 'string', nullable: true },
	},
	required: ['password'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.config)
		private config: Config,

		@Inject(DI.meta)
		private serverSettings: MiMeta,

		@Inject(DI.redis)
		private redisClient: Redis.Redis,

		@Inject(DI.userProfilesRepository)
		private userProfilesRepository: UserProfilesRepository,

		private userEntityService: UserEntityService,
		private emailService: EmailService,
		private userAuthService: UserAuthService,
		private globalEventService: GlobalEventService, // eslint-disable-line @typescript-eslint/no-unused-vars -- verify-email publishes meUpdated now
	) {
		super(meta, paramDef, async (ps, me) => {
			const token = ps.token;
			const profile = await this.userProfilesRepository.findOneByOrFail({ userId: me.id });

			if (profile.twoFactorEnabled) {
				if (token == null) {
					throw new Error('authentication failed');
				}

				try {
					await this.userAuthService.twoFactorAuthenticate(profile, token);
				} catch (_) {
					throw new Error('authentication failed');
				}
			}

			const passwordMatched = await bcrypt.compare(ps.password, profile.password!);
			if (!passwordMatched) {
				throw new ApiError(meta.errors.incorrectPassword);
			}

			/* GRIPBAT-ACCOUNTS-V1 (spec §4) — EXTEND: the CURRENT address keeps working until the new one is proven.
			 * Native wrote the new address at once, unverified — one typo and the person could neither sign in by email nor
			 * reset. The new address and its code now wait in Redis (24 h); verify-email swaps it in. Mail + link are
			 * GripBat's (server-configured origin, G15.13); a UAT test address gets the code back (_dev_code). */
			if (ps.email == null) {
				if (this.serverSettings.emailRequiredForSignup) throw new ApiError(meta.errors.emailRequired);
				throw new ApiError(meta.errors.unavailable);
			}
			const email = normalizeEmail(ps.email);
			const res = await this.emailService.validateEmailForAccount(email);
			if (!res.available) {
				throw new ApiError(meta.errors.unavailable);
			}

			const code = secureRndstr(16, { chars: L_CHARS });
			await this.redisClient.set(EMAIL_CHANGE_PREFIX + code, JSON.stringify({ userId: me.id, email }), 'EX', 24 * 60 * 60);

			const m = mailCopy('emailChange', profile.lang, { code, link: appLink('email', code, this.config.url) });
			this.emailService.sendEmail(email, m.subject, m.html, m.text).catch(() => { /* logged by EmailService */ });

			const iObj = await this.userEntityService.pack(me.id, me, {
				schema: 'MeDetailed',
				includeSecrets: true,
			});

			return Object.assign(iObj, sandboxReveal(email) ? { _dev_code: code } : {});
		});
	}
}

/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import * as Redis from 'ioredis';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { UserProfilesRepository } from '@/models/_.js';
import { UserEntityService } from '@/core/entities/UserEntityService.js';
import { EmailService } from '@/core/EmailService.js';
import { DI } from '@/di-symbols.js';
import { GlobalEventService } from '@/core/GlobalEventService.js';
import { EMAIL_CHANGE_PREFIX } from '@/misc/gb-accounts.js';
import { ApiError } from '../error.js';

export const meta = {
	requireCredential: false,

	tags: ['account'],

	limit: {
		duration: 60 * 60 * 1000,
		max: 30,
	},

	errors: {
		noSuchCode: {
			message: 'No such code.',
			code: 'NO_SUCH_CODE',
			id: '97c1f576-e4b8-4b8a-a6dc-9cb65e7f6f85',
		},
		emailTaken: {
			message: 'Another account now uses that email.',
			code: 'EMAIL_TAKEN',
			id: 'c2b7f0d4-5a8e-4f61-9b3a-7d1e0c6f2a31',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		code: { type: 'string' },
	},
	required: ['code'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.userProfilesRepository)
		private userProfilesRepository: UserProfilesRepository,

		@Inject(DI.redis)
		private redisClient: Redis.Redis,

		private userEntityService: UserEntityService,
		private emailService: EmailService,
		private globalEventService: GlobalEventService,
	) {
		super(meta, paramDef, async (ps) => {
			const code = String(ps.code).trim();

			/* GRIPBAT-ACCOUNTS-V1 (spec §4): an email CHANGE waits in Redis (i/update-email) and is swapped in here, so the
			 * old address kept working until now. Re-checked at redeem time: another account may have taken it meanwhile. */
			const pending = code ? await this.redisClient.get(EMAIL_CHANGE_PREFIX + code) : null;
			if (pending) {
				const { userId, email } = JSON.parse(pending) as { userId: string; email: string };
				if (!(await this.emailService.validateEmailForAccount(email)).available) throw new ApiError(meta.errors.emailTaken);
				await this.userProfilesRepository.update({ userId }, { email, emailVerified: true, emailVerifyCode: null });
				await this.redisClient.del(EMAIL_CHANGE_PREFIX + code);
				this.globalEventService.publishMainStream(userId, 'meUpdated', await this.userEntityService.pack(userId, { id: userId }, {
					schema: 'MeDetailed',
					includeSecrets: true,
				}));
				return;
			}

			const profile = code ? await this.userProfilesRepository.findOneBy({
				emailVerifyCode: code,
			}) : null;

			if (profile == null) {
				throw new ApiError(meta.errors.noSuchCode);
			}

			await this.userProfilesRepository.update({ userId: profile.userId }, {
				emailVerified: true,
				emailVerifyCode: null,
			});

			this.globalEventService.publishMainStream(profile.userId, 'meUpdated', await this.userEntityService.pack(profile.userId, { id: profile.userId }, {
				schema: 'MeDetailed',
				includeSecrets: true,
			}));
		});
	}
}

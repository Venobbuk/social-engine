/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import bcrypt from 'bcryptjs';
import { Inject, Injectable } from '@nestjs/common';
import type { UserProfilesRepository, PasswordResetRequestsRepository, UsersRepository } from '@/models/_.js';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DI } from '@/di-symbols.js';
import { IdService } from '@/core/IdService.js';
import { GlobalEventService } from '@/core/GlobalEventService.js';
import { PASSWORD_MIN, rotateNativeToken } from '@/misc/gb-accounts.js';
import { ApiError } from '../error.js';

/* GRIPBAT-ACCOUNTS-V1 (spec §3) — EXTEND of the native reset:
 *  - an unknown / used / expired link answers RESET_EXPIRED (native: findOneByOrFail + `throw new Error()` = a 500);
 *  - the new password must have PASSWORD_MIN characters (PASSWORD_TOO_SHORT);
 *  - success signs the account out of EVERY device (the native master token is rotated — the same event as
 *    i/regenerate-token): a person resets because someone else may be in;
 *  - the address is marked verified — following the mailed link proved it. */
export const meta = {
	tags: ['reset password'],

	requireCredential: false,

	description: 'Complete the password reset that was previously requested.',

	limit: {
		duration: 60 * 60 * 1000,
		max: 20,
	},

	errors: {
		resetExpired: {
			message: 'This reset link has expired or was already used. Ask for a new one.',
			code: 'RESET_EXPIRED',
			id: '6f4c2a51-3d0e-4b8e-9d8a-1e5a0c9b7f21',
		},
		passwordTooShort: {
			message: 'Use at least 8 characters.',
			code: 'PASSWORD_TOO_SHORT',
			id: '6f4c2a51-3d0e-4b8e-9d8a-1e5a0c9b7f22',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		token: { type: 'string' },
		password: { type: 'string' },
	},
	required: ['token', 'password'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.passwordResetRequestsRepository)
		private passwordResetRequestsRepository: PasswordResetRequestsRepository,

		@Inject(DI.userProfilesRepository)
		private userProfilesRepository: UserProfilesRepository,

		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,

		private idService: IdService,
		private globalEventService: GlobalEventService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const req = await this.passwordResetRequestsRepository.findOneBy({
				token: String(ps.token).trim(),
			});
			if (req == null) throw new ApiError(meta.errors.resetExpired);

			// 発行してから30分以上経過していたら無効
			if (Date.now() - this.idService.parse(req.id).date.getTime() > 1000 * 60 * 30) {
				throw new ApiError(meta.errors.resetExpired);
			}

			if (ps.password.length < PASSWORD_MIN) throw new ApiError(meta.errors.passwordTooShort);

			// Generate hash of password
			const salt = await bcrypt.genSalt(8);
			const hash = await bcrypt.hash(ps.password, salt);

			await this.userProfilesRepository.update(req.userId, {
				password: hash,
				emailVerified: true,
			});

			await this.passwordResetRequestsRepository.delete({ userId: req.userId });
			await rotateNativeToken(this.usersRepository, this.globalEventService, req.userId);
		});
	}
}

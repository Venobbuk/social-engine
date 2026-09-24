/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import bcrypt from 'bcryptjs';
import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { UserProfilesRepository, UsersRepository } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import { UserAuthService } from '@/core/UserAuthService.js';
import { GlobalEventService } from '@/core/GlobalEventService.js';
import { PASSWORD_MIN, rotateNativeToken } from '@/misc/gb-accounts.js';
import { ApiError } from '../../error.js';

/* GRIPBAT-ACCOUNTS-V1 (spec §3) — EXTEND of the native change: a wrong current password answers INCORRECT_PASSWORD
 * (native threw a bare Error = a 500 the app could not word); the new one needs PASSWORD_MIN characters; the other
 * devices are signed out (the native master token rotates, as i/regenerate-token) and the NEW token is returned so
 * the device that changed it stays signed in. */
export const meta = {
	requireCredential: true,

	secure: true,

	limit: {
		duration: 60 * 60 * 1000,
		max: 10,
	},

	errors: {
		incorrectPassword: {
			message: 'Incorrect password.',
			code: 'INCORRECT_PASSWORD',
			id: '3d5c1c77-9a3f-4f0b-8f7e-2b9f6f1c0a11',
		},
		passwordTooShort: {
			message: 'Use at least 8 characters.',
			code: 'PASSWORD_TOO_SHORT',
			id: '3d5c1c77-9a3f-4f0b-8f7e-2b9f6f1c0a12',
		},
	},

	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			token: { type: 'string', optional: false, nullable: false },
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		currentPassword: { type: 'string' },
		newPassword: { type: 'string', minLength: 1 },
		token: { type: 'string', nullable: true },
	},
	required: ['currentPassword', 'newPassword'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.userProfilesRepository)
		private userProfilesRepository: UserProfilesRepository,

		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,

		private userAuthService: UserAuthService,
		private globalEventService: GlobalEventService,
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

			const passwordMatched = await bcrypt.compare(ps.currentPassword, profile.password!);

			if (!passwordMatched) {
				throw new ApiError(meta.errors.incorrectPassword);
			}

			if (ps.newPassword.length < PASSWORD_MIN) throw new ApiError(meta.errors.passwordTooShort);

			// Generate hash of password
			const salt = await bcrypt.genSalt(8);
			const hash = await bcrypt.hash(ps.newPassword, salt);

			await this.userProfilesRepository.update(me.id, {
				password: hash,
			});

			return { token: await rotateNativeToken(this.usersRepository, this.globalEventService, me.id) };
		});
	}
}

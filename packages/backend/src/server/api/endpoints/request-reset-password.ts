/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import ms from 'ms';
import { IsNull } from 'typeorm';
import { Inject, Injectable } from '@nestjs/common';
import type { PasswordResetRequestsRepository, UserProfilesRepository, UsersRepository } from '@/models/_.js';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { IdService } from '@/core/IdService.js';
import type { Config } from '@/config.js';
import { DI } from '@/di-symbols.js';
import { EmailService } from '@/core/EmailService.js';
import { L_CHARS, secureRndstr } from '@/misc/secure-rndstr.js';
import { appLink, mailCopy, normalizeEmail, sandboxReveal } from '@/misc/gb-accounts.js'; // GRIPBAT-ACCOUNTS-V1

export const meta = {
	tags: ['reset password'],

	requireCredential: false,

	description: 'Request a users password to be reset.',

	limit: {
		duration: ms('1hour'),
		max: 3,
	},

	errors: {

	},

	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			_dev_code: { type: 'string', optional: true, nullable: false },
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		username: { type: 'string' }, // GRIPBAT-ACCOUNTS-V1: optional — Reclub asks the email only
		email: { type: 'string' },
		lang: { type: 'string', maxLength: 12 },
	},
	required: ['email'],
} as const;

/* GRIPBAT-ACCOUNTS-V1 (spec §3) — EXTEND of the native request:
 *  - the email alone finds the account (its VERIFIED address, any letter case); a username, when sent, must match too;
 *  - the answer is the same whether or not the address has an account (no enumeration through this door);
 *  - the mail is GripBat's, in the reader's language, and links the GripBat app (server-configured origin, G15.13);
 *  - UAT sandbox: a reserved test address on the GB_SANDBOX_MAIL container gets the token back (_dev_code). */
@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.config)
		private config: Config,

		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,

		@Inject(DI.userProfilesRepository)
		private userProfilesRepository: UserProfilesRepository,

		@Inject(DI.passwordResetRequestsRepository)
		private passwordResetRequestsRepository: PasswordResetRequestsRepository,

		private idService: IdService,
		private emailService: EmailService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const email = normalizeEmail(ps.email);
			const profile = await this.userProfilesRepository.createQueryBuilder('p')
				.where('p.emailVerified = true')
				.andWhere('LOWER(p.email) = :e', { e: email })
				.getOne();
			// 合致するメアドが登録されていなかったら無視 (same answer as a sent mail)
			if (profile == null) return {};
			const user = await this.usersRepository.findOneBy({ id: profile.userId, host: IsNull() });
			if (user == null || user.isSuspended || user.isDeleted) return {};
			if (ps.username != null && ps.username !== '' && user.usernameLower !== ps.username.toLowerCase()) return {};

			const token = secureRndstr(64, { chars: L_CHARS });

			await this.passwordResetRequestsRepository.insert({
				id: this.idService.gen(),
				userId: profile.userId,
				token,
			});

			const m = mailCopy('reset', ps.lang ?? profile.lang, { link: appLink('reset', token, this.config.url) });
			this.emailService.sendEmail(profile.email!, m.subject, m.html, m.text).catch(() => { /* logged by EmailService */ });
			return sandboxReveal(email) ? { _dev_code: token } : {};
		});
	}
}

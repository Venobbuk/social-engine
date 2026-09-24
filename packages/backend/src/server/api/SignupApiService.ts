/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { IsNull } from 'typeorm';
import { DI } from '@/di-symbols.js';
import type { RegistrationTicketsRepository, UsedUsernamesRepository, UserPendingsRepository, UserProfilesRepository, UsersRepository, MiRegistrationTicket, MiMeta } from '@/models/_.js';
import type { Config } from '@/config.js';
import { CaptchaService } from '@/core/CaptchaService.js';
import { IdService } from '@/core/IdService.js';
import { SignupService } from '@/core/SignupService.js';
import { UserEntityService } from '@/core/entities/UserEntityService.js';
import { EmailService } from '@/core/EmailService.js';
import { MiLocalUser } from '@/models/User.js';
import { FastifyReplyError } from '@/misc/fastify-reply-error.js';
import { bindThis } from '@/decorators.js';
import { L_CHARS, secureRndstr } from '@/misc/secure-rndstr.js';
import { getIpHash } from '@/misc/get-ip-hash.js';

/* PROBE-RL-EXEMPT-V1 (2026-09-24): every probe on the box reaches the engine from ONE address, so the per-IP sign-in /
 * sign-up limits (10/hour) throttled every lane's proof. GB_RATE_LIMIT_EXEMPT_IPS (set on web-uat ONLY, compose.uat.yml)
 * lists addresses exempt from these two limiters. request.ip is not client-settable here: trustProxy only trusts
 * private ranges and takes the nearest untrusted hop (measured: a spoofed X-Forwarded-For stayed limited). Prod: unset. */
import { GB_RL_EXEMPT } from '@/misc/gb-accounts.js'; // PROBE-RL-EXEMPT-V1: the one helper
import { PASSWORD_MIN, appLink, mailCopy, normalizeEmail, placeholderUsername, sandboxReveal, usernameProblem } from '@/misc/gb-accounts.js'; // GRIPBAT-ACCOUNTS-V1
import { SigninService } from './SigninService.js';
import { RateLimiterService } from './RateLimiterService.js';
import type { FastifyRequest, FastifyReply } from 'fastify';

@Injectable()
export class SignupApiService {
	constructor(
		@Inject(DI.config)
		private config: Config,

		@Inject(DI.meta)
		private meta: MiMeta,

		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,

		@Inject(DI.userProfilesRepository)
		private userProfilesRepository: UserProfilesRepository,

		@Inject(DI.userPendingsRepository)
		private userPendingsRepository: UserPendingsRepository,

		@Inject(DI.usedUsernamesRepository)
		private usedUsernamesRepository: UsedUsernamesRepository,

		@Inject(DI.registrationTicketsRepository)
		private registrationTicketsRepository: RegistrationTicketsRepository,

		private userEntityService: UserEntityService,
		private idService: IdService,
		private captchaService: CaptchaService,
		private signupService: SignupService,
		private signinService: SigninService,
		private emailService: EmailService,
		private rateLimiterService: RateLimiterService,
	) {
	}

	/* GRIPBAT-ACCOUNTS-V1 — a refusal the app can word (Misskey answered most sign-up refusals with a bare 400 and no
	 * body, so a taken address and a bad password read the same). Misskey's own error envelope. */
	private refuse(reply: FastifyReply, status: number, code: string, message: string) {
		reply.code(status);
		return { error: { code, message, id: `gb-signup-${code.toLowerCase()}` } };
	}

	@bindThis
	public async signup(
		request: FastifyRequest<{
			Body: {
				username: string;
				password: string;
				host?: string;
				invitationCode?: string;
				emailAddress?: string;
				'hcaptcha-response'?: string;
				'g-recaptcha-response'?: string;
				'turnstile-response'?: string;
				'm-captcha-response'?: string;
				'testcaptcha-response'?: string;
			}
		}>,
		reply: FastifyReply,
	) {
		const body = request.body;

		// Verify *Captcha
		// ただしテスト時はこの機構は障害となるため無効にする
		if (process.env.NODE_ENV !== 'test') {
			if (this.meta.enableHcaptcha && this.meta.hcaptchaSecretKey) {
				await this.captchaService.verifyHcaptcha(this.meta.hcaptchaSecretKey, body['hcaptcha-response']).catch(err => {
					throw new FastifyReplyError(400, err);
				});
			}

			if (this.meta.enableMcaptcha && this.meta.mcaptchaSecretKey && this.meta.mcaptchaSitekey && this.meta.mcaptchaInstanceUrl) {
				await this.captchaService.verifyMcaptcha(this.meta.mcaptchaSecretKey, this.meta.mcaptchaSitekey, this.meta.mcaptchaInstanceUrl, body['m-captcha-response']).catch(err => {
					throw new FastifyReplyError(400, err);
				});
			}

			if (this.meta.enableRecaptcha && this.meta.recaptchaSecretKey) {
				await this.captchaService.verifyRecaptcha(this.meta.recaptchaSecretKey, body['g-recaptcha-response']).catch(err => {
					throw new FastifyReplyError(400, err);
				});
			}

			if (this.meta.enableTurnstile && this.meta.turnstileSecretKey) {
				await this.captchaService.verifyTurnstile(this.meta.turnstileSecretKey, body['turnstile-response']).catch(err => {
					throw new FastifyReplyError(400, err);
				});
			}

			if (this.meta.enableTestcaptcha) {
				await this.captchaService.verifyTestcaptcha(body['testcaptcha-response']).catch(err => {
					throw new FastifyReplyError(400, err);
				});
			}
		}

		/* GRIPBAT-ACCOUNTS-V1 (spec §1a). EXTEND of the native sign-up, email-required branch:
		 *  - the username is NOT asked at sign-up: a placeholder gb_<12 hex> is issued and the person chooses the real one in
		 *    onboarding (gb/account/username). A username the client does send must pass the same rules. Never email-derived.
		 *  - password >= PASSWORD_MIN; the address is normalised (one address = one account, any letter case);
		 *  - refusals carry a code (EMAIL_INVALID / EMAIL_TAKEN / PASSWORD_TOO_SHORT / USERNAME_* / REGISTRATION_CLOSED);
		 *  - 10 sign-ups an hour per IP (Misskey had no limit on this route; RateLimiterService is the native limiter). */
		if (process.env.NODE_ENV !== 'test' && !GB_RL_EXEMPT.has(request.ip)) {
			const rl = await this.rateLimiterService.limit({ key: 'gb-signup', duration: 60 * 60 * 1000, max: 10 }, getIpHash(request.ip));
			if (rl != null) return this.refuse(reply, 429, 'RATE_LIMITED', 'Too many sign-ups from this network. Try again later.');
		}
		const askedUsername = typeof body['username'] === 'string' && body['username'] !== '' ? body['username'] : null;
		if (askedUsername != null) {
			const p = usernameProblem(askedUsername, this.meta.preservedUsernames);
			if (p) return this.refuse(reply, 400, p, 'That username cannot be used.');
		}
		let username = askedUsername ?? placeholderUsername();
		const password = body['password'];
		const host: string | null = process.env.NODE_ENV === 'test' ? (body['host'] ?? null) : null;
		const invitationCode = body['invitationCode'];
		const emailAddress = typeof body['emailAddress'] === 'string' ? normalizeEmail(body['emailAddress']) : body['emailAddress'];
		const lang = typeof (body as { lang?: unknown }).lang === 'string' ? String((body as { lang?: string }).lang).slice(0, 12) : null;

		if (typeof password !== 'string' || password.length < PASSWORD_MIN) return this.refuse(reply, 400, 'PASSWORD_TOO_SHORT', `Use at least ${PASSWORD_MIN} characters.`);

		if (this.meta.emailRequiredForSignup) {
			if (emailAddress == null || typeof emailAddress !== 'string') {
				return this.refuse(reply, 400, 'EMAIL_INVALID', 'Enter a valid email address.');
			}

			const res = await this.emailService.validateEmailForAccount(emailAddress);
			if (!res.available) {
				return res.reason === 'used'
					? this.refuse(reply, 400, 'EMAIL_TAKEN', 'An account with that email already exists.')
					: this.refuse(reply, 400, 'EMAIL_INVALID', 'Enter a valid email address.');
			}
		}
		// a placeholder that happens to exist already: draw again (48 bits — practically never)
		for (let i = 0; askedUsername == null && i < 3 && await this.usersRepository.exists({ where: { usernameLower: username, host: IsNull() } }); i++) username = placeholderUsername();

		let ticket: MiRegistrationTicket | null = null;

		// テスト時はこの機構は障害となるため無効にする
		if (process.env.NODE_ENV !== 'test' && this.meta.disableRegistration) {
			if (invitationCode == null || typeof invitationCode !== 'string') {
				return this.refuse(reply, 403, 'REGISTRATION_CLOSED', 'Sign-up is closed right now.');
			}

			ticket = await this.registrationTicketsRepository.findOneBy({
				code: invitationCode,
			});

			if (ticket == null || ticket.usedById != null) {
				reply.code(400);
				return;
			}

			if (ticket.expiresAt && ticket.expiresAt < new Date()) {
				reply.code(400);
				return;
			}

			// メアド認証が有効の場合
			if (this.meta.emailRequiredForSignup) {
				// メアド認証済みならエラー
				if (ticket.usedBy) {
					reply.code(400);
					return;
				}

				// 認証しておらず、メール送信から30分以内ならエラー
				if (ticket.usedAt && ticket.usedAt.getTime() + (1000 * 60 * 30) > Date.now()) {
					reply.code(400);
					return;
				}
			} else if (ticket.usedAt) {
				reply.code(400);
				return;
			}
		}

		if (this.meta.emailRequiredForSignup) {
			if (await this.usersRepository.exists({ where: { usernameLower: username.toLowerCase(), host: IsNull() } })) {
				throw new FastifyReplyError(400, 'DUPLICATED_USERNAME');
			}

			// Check deleted username duplication
			if (await this.usedUsernamesRepository.exists({ where: { username: username.toLowerCase() } })) {
				throw new FastifyReplyError(400, 'USED_USERNAME');
			}

			const isPreserved = this.meta.preservedUsernames.map(x => x.toLowerCase()).includes(username.toLowerCase());
			if (isPreserved) {
				throw new FastifyReplyError(400, 'DENIED_USERNAME');
			}

			const code = secureRndstr(16, { chars: L_CHARS });

			// Generate hash of password
			const salt = await bcrypt.genSalt(8);
			const hash = await bcrypt.hash(password, salt);

			const pendingUser = await this.userPendingsRepository.insertOne({
				id: this.idService.gen(),
				code,
				email: emailAddress!,
				username: username,
				password: hash,
			});

			// GRIPBAT-ACCOUNTS-V1: the link opens the GripBat app (server-configured origin, G15.13), not the engine's stock
			// client; the mail is GripBat's, in the reader's language, and carries the code for pasting too.
			const link = appLink('verify', code, this.config.url);
			const m = mailCopy('signup', lang, { code, link });
			this.emailService.sendEmail(emailAddress!, m.subject, m.html, m.text).catch(() => { /* logged by EmailService */ });

			if (ticket) {
				await this.registrationTicketsRepository.update(ticket.id, {
					usedAt: new Date(),
					pendingUserId: pendingUser.id,
				});
			}

			// GRIPBAT-ACCOUNTS-V1 UAT sandbox: a reserved test address on the GB_SANDBOX_MAIL container gets the code back
			if (sandboxReveal(emailAddress)) return { pending: true, _dev_code: code };
			reply.code(204);
			return;
		} else {
			try {
				const { account, secret } = await this.signupService.signup({
					username, password, host,
				});

				const res = await this.userEntityService.pack(account, account, {
					schema: 'MeDetailed',
					includeSecrets: true,
				});

				if (ticket) {
					await this.registrationTicketsRepository.update(ticket.id, {
						usedAt: new Date(),
						usedBy: account,
						usedById: account.id,
					});
				}

				return {
					...res,
					token: secret,
				};
			} catch (err) {
				throw new FastifyReplyError(400, typeof err === 'string' ? err : (err as Error).toString());
			}
		}
	}

	@bindThis
	public async signupPending(request: FastifyRequest<{ Body: { code: string; } }>, reply: FastifyReply) {
		const body = request.body;

		// GRIPBAT-ACCOUNTS-V1: a pasted code may carry spaces; unknown / expired / already-used answer a code the app words
		const code = String(body['code'] ?? '').trim();
		const pendingFound = code ? await this.userPendingsRepository.findOneBy({ code }) : null;
		if (pendingFound == null) return this.refuse(reply, 400, 'CODE_INVALID', 'That code is not valid. Sign up again to get a new one.');
		if (this.idService.parse(pendingFound.id).date.getTime() + (1000 * 60 * 30) < Date.now()) return this.refuse(reply, 400, 'CODE_EXPIRED', 'That code has expired. Sign up again to get a new one.');
		// two sign-ups with one address: the first redeemed wins, the other can no longer make a second account
		if (!(await this.emailService.validateEmailForAccount(pendingFound.email)).available) return this.refuse(reply, 400, 'EMAIL_TAKEN', 'An account with that email already exists. Sign in instead.');

		try {
			const pendingUser = pendingFound;

			const { account } = await this.signupService.signup({
				username: pendingUser.username,
				passwordHash: pendingUser.password,
			});

			this.userPendingsRepository.delete({
				id: pendingUser.id,
			});

			const profile = await this.userProfilesRepository.findOneByOrFail({ userId: account.id });

			await this.userProfilesRepository.update({ userId: profile.userId }, {
				email: pendingUser.email,
				emailVerified: true,
				emailVerifyCode: null,
				emailNotificationTypes: [], // GRIPBAT-ACCOUNTS-V1: GripBat mails only about the account itself (notices go in-app / push)
			});
			// GRIPBAT-ACCOUNTS-V1: CHAT-SCOPE-V1 — a member can message anyone (Reclub inbox), as adapter/sso accounts could
			await this.usersRepository.update(account.id, { chatScope: 'everyone' });
			// the other pending sign-ups for this address are spent
			await this.userPendingsRepository.delete({ email: pendingUser.email });

			const ticket = await this.registrationTicketsRepository.findOneBy({ pendingUserId: pendingUser.id });
			if (ticket) {
				await this.registrationTicketsRepository.update(ticket.id, {
					usedBy: account,
					usedById: account.id,
					pendingUserId: null,
				});
			}

			return this.signinService.signin(request, reply, account as MiLocalUser);
		} catch (err) {
			throw new FastifyReplyError(400, typeof err === 'string' ? err : (err as Error).toString());
		}
	}
}

/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { randomBytes } from 'node:crypto';
import { isReservedClubName } from '@/modules/clubs/club-names.js';
import { generateNativeUserToken } from '@/misc/token.js';
import type { UsersRepository } from '@/models/_.js';
import type { GlobalEventService } from '@/core/GlobalEventService.js';

/** Sign the account out of every device: a new native token, announced exactly as Misskey's own i/regenerate-token
 *  does (the auth caches drop the old one on 'userTokenRegenerated'). Returns the new token. REUSED logic, one home. */
export async function rotateNativeToken(users: UsersRepository, events: GlobalEventService, userId: string): Promise<string> {
	const fresh = await users.findOneByOrFail({ id: userId });
	const oldToken = fresh.token!;
	const newToken = generateNativeUserToken();
	await users.update(userId, { token: newToken });
	events.publishInternalEvent('userTokenRegenerated', { id: userId, oldToken, newToken });
	events.publishMainStream(userId, 'myTokenRegenerated');
	return newToken;
}

/*
 * GRIPBAT-ACCOUNTS-V1 (2026-09-23, GLOBAL_CONTRACT G15.15) — GripBat owns its accounts. Spec: /root/gen/GRIPBAT_ACCOUNTS_SPEC.md.
 * The ONE home for the account rules the native Misskey doors are EXTENDED with (signup, signin-flow, reset, email
 * change, username/available, gb/account/username, gb/auth/code): where a mailed link points, which addresses are test
 * addresses, the password floor, the username rules and the mail copy in the three languages.
 *
 * WHERE LINKS POINT (G15.13). A mailed link must land on the GripBat app on the host the person uses — gripbat.com on
 * production, uat.gripbat.com on UAT — never on the engine's stock web client (config.url = *.social.silkvo.com). The
 * origin is SERVER CONFIG (env GB_PUBLIC_ORIGIN, one value per container), never a request header: a client-settable
 * value deciding where a sign-in link points is an account takeover (measured on hkpl 2026-09-23).
 *
 * UAT SANDBOX (GB_SANDBOX_MAIL=1, web-uat ONLY). A tester or a probe on a reserved test domain (RFC 2606: .test,
 * .invalid, .example, .localhost, example.com/net/org) has no inbox. For those addresses — and only on the container
 * that sets the env — the answer carries the code itself (`_dev_code`). Production has no such env and never does.
 * No mail is ever sent to a reserved test address, on any host.
 */

export const GB_PUBLIC_ORIGIN = (process.env.GB_PUBLIC_ORIGIN ?? '').trim().replace(/\/+$/, '');
export const GB_SANDBOX_MAIL = process.env.GB_SANDBOX_MAIL === '1';
export const PASSWORD_MIN = 8;
/* PROBE-RL-EXEMPT-V1 (orchestrator 2026-09-24) — the ONE helper: every probe on the box reaches the engine from one address,
 * so per-IP limits throttled every lane's proof. GB_RATE_LIMIT_EXEMPT_IPS is set on web-uat ONLY (compose.uat.yml); prod
 * has none. request.ip is not client-settable (trustProxy = private ranges; a spoofed X-Forwarded-For stayed limited).
 * Used by the sign-in / sign-up limiters and, for the ANONYMOUS account doors below only, by the endpoint limiter. */
export const GB_RL_EXEMPT = new Set((process.env.GB_RATE_LIMIT_EXEMPT_IPS ?? '').split(',').map(x => x.trim()).filter(Boolean));
export const GB_RL_EXEMPT_ENDPOINTS = new Set(['request-reset-password', 'reset-password', 'verify-email', 'gb/auth/code', 'gb/auth/code/verify']);
/* Where a reply to any GripBat mail goes (G2). MEASURED 2026-09-23 17:05 HKT: the box's relay (SiteGround,
 * c1113206.sgvps.net) refuses a MAIL FROM on gripbat.com (550 "not hosted on this server") and accepts the relay's own
 * mailbox — so the From: is "GripBat <relay mailbox>" (meta.email) until gripbat.com mail is hosted (operator, spec §12),
 * and every reply lands at the brand address. */
export const GB_REPLY_TO = 'info@gripbat.com';
/** Redis key prefix of a pending email change (i/update-email writes, verify-email redeems). */
export const EMAIL_CHANGE_PREFIX = 'gb:email-change:';
/** registry_item key holding an hkpl-SSO account's former seam handle after the person chose a username. */
export const SSO_HANDLE_KEY = 'gbSsoHandle';
/** Redis key prefix of an account's live emailed sign-in code (gb/auth/code writes, gb/auth/code/verify redeems). */
export const SIGNIN_CODE_PREFIX = 'gb:signin-code:';

/** The app page a mailed link opens. `fallbackUrl` (config.url) only when the env is missing — logged by the caller. */
export function appLink(kind: 'verify' | 'reset' | 'email', code: string, fallbackUrl: string): string {
	const origin = GB_PUBLIC_ORIGIN || String(fallbackUrl).replace(/\/+$/, '');
	return `${origin}/app/pages/signin/index?${kind}=${encodeURIComponent(code)}`;
}

/** What people type is not what they mean: trim + lower-case, so Amy@X.com and amy@x.com are one account. */
export function normalizeEmail(e: unknown): string {
	return String(e ?? '').trim().toLowerCase();
}

/** RFC 2606 / 6761 reserved names — no inbox exists behind them. */
export function isReservedTestAddress(e: unknown): boolean {
	const d = normalizeEmail(e).split('@')[1] ?? '';
	if (!d) return false;
	return /\.(test|invalid|example|localhost)$/.test(d) || /^(.*\.)?example\.(com|net|org)$/.test(d);
}

/** True when this answer may carry the code (UAT container + test address). */
export function sandboxReveal(e: unknown): boolean {
	return GB_SANDBOX_MAIL && isReservedTestAddress(e);
}

/** A sign-up's handle until the person chooses one (never derived from the email). */
export function placeholderUsername(): string {
	return `gb_${randomBytes(6).toString('hex')}`;
}

/** The two machine handle shapes: a sign-up placeholder, and an account made by the retired hkpl SSO seam. */
export function isPlaceholderUsername(u: unknown): boolean {
	return /^(gb|hkpl)_[0-9a-f]{12}$/i.test(String(u ?? ''));
}

export type UsernameProblem = 'USERNAME_INVALID' | 'USERNAME_TOO_SHORT' | 'USERNAME_RESERVED';
/** The username rules (spec §2). Availability (taken / used before) is the caller's database question. */
export function usernameProblem(u: unknown, preserved: string[]): UsernameProblem | null {
	const s = String(u ?? '');
	if (s.length < 3) return 'USERNAME_TOO_SHORT';
	if (!/^[A-Za-z0-9_]{3,20}$/.test(s)) return 'USERNAME_INVALID';
	const lower = s.toLowerCase();
	if (/^(gb|hkpl)_/.test(lower)) return 'USERNAME_RESERVED';
	if (isReservedClubName(s) || isReservedClubName(s.replace(/_/g, ' '))) return 'USERNAME_RESERVED';
	if (preserved.map(x => x.toLowerCase()).includes(lower)) return 'USERNAME_RESERVED';
	return null;
}

// ------------------------------------------------------------------------------------------------------------- mail copy
export type MailLang = 'en' | 'zh_Hant' | 'zh_Hans';
export function mailLang(lang: unknown): MailLang {
	const l = String(lang ?? '').toLowerCase().replace('-', '_');
	if (/^zh_(hans|cn|sg)/.test(l)) return 'zh_Hans';
	if (/^zh/.test(l)) return 'zh_Hant';
	return 'en';
}

type Kind = 'signup' | 'reset' | 'emailChange' | 'signinCode' | 'noAccount' | 'newLogin';
const COPY: Record<Kind, Record<MailLang, { subject: string; lines: string[]; button?: string }>> = {
	signup: {
		en: { subject: 'Confirm your email for GripBat', lines: ['Welcome to GripBat. Tap the button to confirm this is your email and finish creating your account.', 'Or enter this code in the app: {code}', 'The link and the code work for 30 minutes. If you did not sign up, ignore this email.'], button: 'Confirm my email' },
		zh_Hant: { subject: '確認你的 GripBat 電郵', lines: ['歡迎加入 GripBat。按下面的按鈕確認這是你的電郵，完成建立帳戶。', '或在 App 輸入此驗證碼：{code}', '連結和驗證碼 30 分鐘內有效。如果你沒有註冊，請忽略此電郵。'], button: '確認我的電郵' },
		zh_Hans: { subject: '确认你的 GripBat 邮箱', lines: ['欢迎加入 GripBat。点下面的按钮确认这是你的邮箱，完成创建账户。', '或在 App 输入此验证码：{code}', '链接和验证码 30 分钟内有效。如果你没有注册，请忽略此邮件。'], button: '确认我的邮箱' },
	},
	reset: {
		en: { subject: 'Reset your GripBat password', lines: ['Someone asked to reset the password of your GripBat account. Tap the button to choose a new one.', 'The link works for 30 minutes. If it was not you, ignore this email — your password stays the same.'], button: 'Choose a new password' },
		zh_Hant: { subject: '重設你的 GripBat 密碼', lines: ['有人要求重設你的 GripBat 帳戶密碼。按下面的按鈕設定新密碼。', '連結 30 分鐘內有效。如果不是你，請忽略此電郵，你的密碼不會改變。'], button: '設定新密碼' },
		zh_Hans: { subject: '重设你的 GripBat 密码', lines: ['有人要求重设你的 GripBat 账户密码。点下面的按钮设置新密码。', '链接 30 分钟内有效。如果不是你，请忽略此邮件，你的密码不会改变。'], button: '设置新密码' },
	},
	emailChange: {
		en: { subject: 'Confirm your new email for GripBat', lines: ['Tap the button to use this address for your GripBat account.', 'Or enter this code in the app: {code}', 'Until you confirm, your account keeps its current email. The link works for 24 hours.'], button: 'Use this email' },
		zh_Hant: { subject: '確認你的 GripBat 新電郵', lines: ['按下面的按鈕，把這個地址用作你的 GripBat 帳戶電郵。', '或在 App 輸入此驗證碼：{code}', '確認之前，帳戶會繼續使用現有電郵。連結 24 小時內有效。'], button: '使用此電郵' },
		zh_Hans: { subject: '确认你的 GripBat 新邮箱', lines: ['点下面的按钮，把这个地址用作你的 GripBat 账户邮箱。', '或在 App 输入此验证码：{code}', '确认之前，账户会继续使用现有邮箱。链接 24 小时内有效。'], button: '使用此邮箱' },
	},
	signinCode: {
		en: { subject: 'Your GripBat sign-in code: {code}', lines: ['Your sign-in code is {code}.', 'It works for 10 minutes. If you did not ask for it, ignore this email.'] },
		zh_Hant: { subject: '你的 GripBat 登入碼：{code}', lines: ['你的登入碼是 {code}。', '10 分鐘內有效。如果不是你要求的，請忽略此電郵。'] },
		zh_Hans: { subject: '你的 GripBat 登录码：{code}', lines: ['你的登录码是 {code}。', '10 分钟内有效。如果不是你请求的，请忽略此邮件。'] },
	},
	noAccount: {
		en: { subject: 'Sign in to GripBat', lines: ['Someone asked for a GripBat sign-in code for this address, but no GripBat account uses it yet.', 'Tap the button to create one. If it was not you, ignore this email.'], button: 'Create my account' },
		zh_Hant: { subject: '登入 GripBat', lines: ['有人用這個地址要求 GripBat 登入碼，但目前沒有 GripBat 帳戶使用此地址。', '按下面的按鈕建立帳戶。如果不是你，請忽略此電郵。'], button: '建立帳戶' },
		zh_Hans: { subject: '登录 GripBat', lines: ['有人用这个地址请求 GripBat 登录码，但目前没有 GripBat 账户使用此地址。', '点下面的按钮创建账户。如果不是你，请忽略此邮件。'], button: '创建账户' },
	},
	newLogin: {
		en: { subject: 'New sign-in to your GripBat account', lines: ['Your GripBat account was just signed in to.', 'If this was not you, reset your password now from the sign-in screen (Forgot password?) — that also signs out every device.'] },
		zh_Hant: { subject: '你的 GripBat 帳戶有新登入', lines: ['你的 GripBat 帳戶剛剛有新登入。', '如果不是你，請立即在登入畫面按「忘記密碼？」重設密碼，所有裝置都會一併登出。'] },
		zh_Hans: { subject: '你的 GripBat 账户有新登录', lines: ['你的 GripBat 账户刚刚有新登录。', '如果不是你，请立即在登录页面点「忘记密码？」重设密码，所有设备都会一并退出。'] },
	},
};

function esc(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** { subject, html, text } for EmailService.sendEmail (which wraps the html in the GripBat frame). */
export function mailCopy(kind: Kind, lang: unknown, vars: { code?: string; link?: string } = {}): { subject: string; html: string; text: string } {
	const c = COPY[kind][mailLang(lang)];
	const fill = (s: string) => s.replace(/\{code\}/g, vars.code ?? '');
	const subject = fill(c.subject);
	const lines = c.lines.map(fill);
	// EmailService sanitises the body (sanitize-html strips style/class), so the look lives in the frame's <style>
	// (juice inlines it): `article a` is the coral button, `article b` the big code, `article small` the raw link.
	const html = lines.map(l => `<p>${vars.code ? esc(l).split(esc(vars.code)).join(`<b>${esc(vars.code)}</b>`) : esc(l)}</p>`).join('')
		+ (vars.link && c.button ? `<p><a href="${esc(vars.link)}">${esc(c.button)}</a></p><p><small>${esc(vars.link)}</small></p>` : '');
	const text = lines.join('\n\n') + (vars.link ? `\n\n${vars.link}` : '');
	return { subject, html, text };
}

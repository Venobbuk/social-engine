/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * adapter/sso — host single sign-on (spec §2b item 1, §6 A1).
 * A host (hkpl today, pyke next) mints a short-lived RS256 JWT for its signed-in member; this endpoint verifies
 * it against the host's public key, finds-or-creates the matching local account (username derived from the
 * host id + external id, so the mapping is deterministic and needs no schema change), refreshes the display
 * name, and returns a credential for the client to log in with. No password is ever set that anyone knows;
 * these accounts can only be entered through the host.
 *
 * SSO-SEAM-V2 (2026-09-16) — four changes from the dry run of 2026-09-12:
 *   S3  REPLAY. The JWT carries a `jti`. It is redeemed exactly once: SET NX with the token's own TTL in
 *       Redis; a second presentation of the same JWT is refused. Before this a captured token (they travelled
 *       in URLs — S2, fixed at the mint) could be redeemed until expiry.
 *   S4  CREDENTIAL. The 120-second handoff was exchanged for `user.token` — the account's PERMANENT master
 *       token, unrevocable short of regenerating it. It now issues an `access_token` row: per-login, named,
 *       scoped to first-party user permissions (never admin), revocable by deleting the row, and sweepable
 *       by `lastUsedAt`. Not a TTL token — Misskey has none — but no longer the master key.
 *   S6  LANG. The host sends the member's language; it was declared on the claims type and dropped. It is
 *       now returned to the client, which owns language (the Taro app uses hkpl's dictionary).
 *   S7  RATING. A failed rating sync was swallowed, so a strict level gate could not tell "unrated" from
 *       "the sync failed" and refused real players silently. The failure is now logged and surfaced as
 *       `ratingSynced: false`; the gate-side distinction lands with the meet module rewrite.
 *   Also: `sub` is now the PERSON id (hkpl lib/identity), so a shadow account or a second-league row no
 *   longer creates a second social identity (S9/G4). The mint sends `row` for audit; it is never keyed on.
 */
import { createPublicKey, createVerify, randomBytes, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Inject, Injectable } from '@nestjs/common';
import * as Redis from 'ioredis';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { UsersRepository, AccessTokensRepository } from '@/models/_.js';
import { SignupService } from '@/core/SignupService.js';
import { IdService } from '@/core/IdService.js';
import { MeetService } from '@/modules/meets/MeetService.js';
import { secureRndstr } from '@/misc/secure-rndstr.js';
import { DI } from '@/di-symbols.js';
import { ApiError } from '@/server/api/error.js';
import type Logger from '@/logger.js';
import { LoggerService } from '@/core/LoggerService.js';

export const meta = {
	tags: ['adapter'],
	requireCredential: false,
	limit: { duration: 60 * 1000, max: 60 },
	errors: {
		invalidToken: { message: 'Invalid or expired SSO token.', code: 'ADAPTER_SSO_INVALID', id: '4b2d0e5a-1b7c-4e1a-9c0e-5a0c3a1d2f01' },
		unknownIssuer: { message: 'Unknown SSO issuer.', code: 'ADAPTER_SSO_UNKNOWN_ISSUER', id: '4b2d0e5a-1b7c-4e1a-9c0e-5a0c3a1d2f02' },
		unconfigured: { message: 'SSO is not configured on this server.', code: 'ADAPTER_SSO_UNCONFIGURED', id: '4b2d0e5a-1b7c-4e1a-9c0e-5a0c3a1d2f03' },
		replayed: { message: 'This SSO token has already been used.', code: 'ADAPTER_SSO_REPLAYED', id: '4b2d0e5a-1b7c-4e1a-9c0e-5a0c3a1d2f04' },
	},
	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			token: { type: 'string', optional: false, nullable: false },
			userId: { type: 'string', optional: false, nullable: false },
			username: { type: 'string', optional: false, nullable: false },
			created: { type: 'boolean', optional: false, nullable: false },
			lang: { type: 'string', optional: false, nullable: true },
			ratingSynced: { type: 'boolean', optional: false, nullable: false },
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		jwt: { type: 'string', minLength: 20, maxLength: 8192 },
	},
	required: ['jwt'],
} as const;

// issuer → public key file. Extend here when pyke (or any host) is mounted.
const ISSUERS: Record<string, string> = {
	hkpl: process.env.ADAPTER_SSO_PUBKEY_HKPL ?? '/misskey/.config/hkpl-sso-rs256.pub',
};
const AUDIENCE = process.env.ADAPTER_SSO_AUDIENCE ?? 'social.silkvo.com';
const MAX_TTL_SEC = 300;

// First-party USER scope for the SSO credential. Every non-admin permission in misskey-js consts plus the
// meet module's own. Admin scopes are deliberately absent: an SSO token must never be able to moderate.
const SSO_PERMISSIONS: string[] = [
	'read:account', 'write:account', 'read:blocks', 'write:blocks', 'read:drive', 'write:drive',
	'read:favorites', 'write:favorites', 'read:following', 'write:following', 'read:messaging', 'write:messaging',
	'read:mutes', 'write:mutes', 'write:notes', 'read:notifications', 'write:notifications', 'read:reactions',
	'write:reactions', 'write:votes', 'read:pages', 'write:pages', 'write:page-likes', 'read:page-likes',
	'read:user-groups', 'write:user-groups', 'read:channels', 'write:channels', 'read:gallery', 'write:gallery',
	'read:gallery-likes', 'write:gallery-likes', 'read:flash', 'write:flash', 'read:flash-likes', 'write:flash-likes',
	'write:invite-codes', 'read:invite-codes', 'write:clip-favorite', 'read:clip-favorite', 'read:federation',
	'write:report-abuse', 'write:chat', 'read:chat',
	'read:meets', 'write:meets',
];

function b64urlToBuf(s: string): Buffer {
	return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

type Claims = { iss: string; aud: string; sub: string; exp: number; iat?: number; jti?: string; row?: string; tenant?: string; name?: string | null; avatar?: string | null; role?: string | null; dupr_id?: string | null; dupr_rating?: number | null; home_club_id?: number | null; lang?: string };

function verifyJwt(token: string): Claims {
	const parts = token.split('.');
	if (parts.length !== 3) throw new Error('shape');
	const header = JSON.parse(b64urlToBuf(parts[0]).toString('utf8'));
	const payload = JSON.parse(b64urlToBuf(parts[1]).toString('utf8')) as Claims;
	if (header.alg !== 'RS256') throw new Error('alg');
	const pemPath = ISSUERS[payload.iss];
	if (!pemPath) throw new ApiError(meta.errors.unknownIssuer);
	let pem: string;
	try { pem = readFileSync(pemPath, 'utf8'); } catch { throw new ApiError(meta.errors.unconfigured); }
	const verifier = createVerify('RSA-SHA256');
	verifier.update(`${parts[0]}.${parts[1]}`);
	if (!verifier.verify(createPublicKey(pem), b64urlToBuf(parts[2]))) throw new Error('sig');
	const now = Math.floor(Date.now() / 1000);
	if (payload.aud !== AUDIENCE) throw new Error('aud');
	if (typeof payload.exp !== 'number' || payload.exp < now) throw new Error('exp');
	if (typeof payload.iat === 'number' && payload.exp - payload.iat > MAX_TTL_SEC) throw new Error('ttl');
	if (typeof payload.sub !== 'string' || payload.sub.length < 4) throw new Error('sub');
	return payload;
}

// deterministic local username: <issuer>_<12 hex of sha256(external id)> — ≤ 20 chars, [a-z0-9_]
function usernameFor(iss: string, sub: string): string {
	return `${iss}_${createHash('sha256').update(`${iss}:${sub}`).digest('hex').slice(0, 12)}`.toLowerCase();
}

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	private logger: Logger;

	constructor(
		@Inject(DI.redis)
		private redisClient: Redis.Redis,

		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,

		@Inject(DI.accessTokensRepository)
		private accessTokensRepository: AccessTokensRepository,

		private signupService: SignupService,
		private idService: IdService,
		private meetService: MeetService,
		private loggerService: LoggerService,
	) {
		super(meta, paramDef, async (ps) => {
			let claims: Claims;
			try {
				claims = verifyJwt(ps.jwt);
			} catch (e) {
				if (e instanceof ApiError) throw e;
				throw new ApiError(meta.errors.invalidToken);
			}

			// S3 — single redemption. A JWT without a jti is a pre-V2 mint. DEPLOY ORDER: the mint must ship
			// before this becomes strict, or every live SSO breaks. ADAPTER_SSO_JTI_OPTIONAL=1 is the transition
			// window: a missing jti is logged and admitted WITHOUT replay protection; a present jti is always
			// checked. Unset the flag once hkpl's IDENTITY-PERSON-V1 mint is live. Default: required.
			if (typeof claims.jti !== 'string' || claims.jti.length < 8) {
				if (process.env.ADAPTER_SSO_JTI_OPTIONAL !== '1') throw new ApiError(meta.errors.invalidToken);
				this.logger.warn(`admitting a jti-less SSO token from ${claims.iss} (transition flag set; no replay protection)`);
			} else {
				const ttl = Math.max(1, Math.min(MAX_TTL_SEC, (claims.exp - Math.floor(Date.now() / 1000)) + 5));
				const first = await this.redisClient.set(`sso:jti:${claims.iss}:${claims.jti}`, '1', 'EX', ttl, 'NX');
				if (first !== 'OK') throw new ApiError(meta.errors.replayed);
			}

			const username = usernameFor(claims.iss, claims.sub);
			const displayName = (claims.name ?? '').toString().slice(0, 50) || null;
			const lang = typeof claims.lang === 'string' && claims.lang.length <= 12 ? claims.lang : null;

			const existing = await this.usersRepository.findOneBy({ usernameLower: username, host: null as never });
			if (existing) {
				if (displayName && existing.name !== displayName) {
					await this.usersRepository.update(existing.id, { name: displayName });
				}
				const ratingSynced = await this.syncLevel(existing.id, claims);
				const token = await this.issueCredential(existing.id, claims);
				return { token, userId: existing.id, username: existing.username, created: false, lang, ratingSynced };
			}

			// first sign-in from this host: create the account with a password nobody knows (host-only entry).
			// The signup secret (the master token) is NOT returned — S4.
			const { account } = await this.signupService.signup({
				username,
				password: randomBytes(24).toString('base64url'),
				ignorePreservedUsernames: true,
			});
			if (displayName) await this.usersRepository.update(account.id, { name: displayName });
			const ratingSynced = await this.syncLevel(account.id, claims);
			const token = await this.issueCredential(account.id, claims);
			return { token, userId: account.id, username: account.username, created: true, lang, ratingSynced };
		});

		this.logger = this.loggerService.getLogger('adapter:sso');
	}

	// S4 — a per-login, named, first-party-scoped, revocable credential instead of the account master token.
	// Matched by AuthenticateService on `token` (the miauth path); `session` records which handoff issued it.
	private async issueCredential(userId: string, claims: Claims): Promise<string> {
		const now = new Date();
		const accessToken = secureRndstr(32);
		await this.accessTokensRepository.insert({
			id: this.idService.gen(now.getTime()),
			lastUsedAt: now,
			session: `sso:${claims.iss}:${claims.jti}`,
			userId,
			token: accessToken,
			hash: accessToken,
			name: `SSO · ${claims.iss}`,
			description: claims.row ? `host row ${claims.row}` : null,
			permission: SSO_PERMISSIONS,
		});
		return accessToken;
	}

	// Host-provided rating feeds the meet gates (DUPR doubles is the value hkpl carries; singles unknown).
	// S7 — returns whether the sync succeeded; a failure is logged, not swallowed. Login still proceeds.
	private async syncLevel(userId: string, claims: Claims): Promise<boolean> {
		if (claims.dupr_rating == null && claims.dupr_id == null) return true; // nothing to sync is not a failure
		try {
			await this.meetService.upsertLevel(userId, 'pickleball', {
				...(claims.dupr_rating != null ? { duprDoubles: Number(claims.dupr_rating) } : {}),
				...(claims.dupr_id != null ? { duprId: String(claims.dupr_id) } : {}),
				source: claims.iss,
			});
			return true;
		} catch (e) {
			this.logger.warn(`rating sync failed for user ${userId} from ${claims.iss}: ${e instanceof Error ? e.message : String(e)}`);
			return false;
		}
	}
}

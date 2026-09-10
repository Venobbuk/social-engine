/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * adapter/sso — host single sign-on (spec §2b item 1, §6 A1).
 * A host (hkpl today, pyke next) mints a short-lived RS256 JWT for its signed-in member; this endpoint verifies
 * it against the host's public key, finds-or-creates the matching local account (username derived from the
 * host id + external id, so the mapping is deterministic and needs no schema change), refreshes the display
 * name, and returns the account's native token for the client to log in with. No password is ever set that
 * anyone knows; these accounts can only be entered through the host.
 */
import { createPublicKey, createVerify, randomBytes, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { UsersRepository } from '@/models/_.js';
import { SignupService } from '@/core/SignupService.js';
import { MeetService } from '@/modules/meets/MeetService.js';
import { DI } from '@/di-symbols.js';
import { ApiError } from '@/server/api/error.js';

export const meta = {
	tags: ['adapter'],
	requireCredential: false,
	limit: { duration: 60 * 1000, max: 60 },
	errors: {
		invalidToken: { message: 'Invalid or expired SSO token.', code: 'ADAPTER_SSO_INVALID', id: '4b2d0e5a-1b7c-4e1a-9c0e-5a0c3a1d2f01' },
		unknownIssuer: { message: 'Unknown SSO issuer.', code: 'ADAPTER_SSO_UNKNOWN_ISSUER', id: '4b2d0e5a-1b7c-4e1a-9c0e-5a0c3a1d2f02' },
		unconfigured: { message: 'SSO is not configured on this server.', code: 'ADAPTER_SSO_UNCONFIGURED', id: '4b2d0e5a-1b7c-4e1a-9c0e-5a0c3a1d2f03' },
	},
	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			token: { type: 'string', optional: false, nullable: false },
			userId: { type: 'string', optional: false, nullable: false },
			username: { type: 'string', optional: false, nullable: false },
			created: { type: 'boolean', optional: false, nullable: false },
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

function b64urlToBuf(s: string): Buffer {
	return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

type Claims = { iss: string; aud: string; sub: string; exp: number; iat?: number; tenant?: string; name?: string | null; avatar?: string | null; role?: string | null; dupr_id?: string | null; dupr_rating?: number | null; home_club_id?: number | null; lang?: string };

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
	constructor(
		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,

		private signupService: SignupService,
		private meetService: MeetService,
	) {
		super(meta, paramDef, async (ps) => {
			let claims: Claims;
			try {
				claims = verifyJwt(ps.jwt);
			} catch (e) {
				if (e instanceof ApiError) throw e;
				throw new ApiError(meta.errors.invalidToken);
			}

			const username = usernameFor(claims.iss, claims.sub);
			const displayName = (claims.name ?? '').toString().slice(0, 50) || null;

			const existing = await this.usersRepository.findOneBy({ usernameLower: username, host: null as never });
			if (existing) {
				if (displayName && existing.name !== displayName) {
					await this.usersRepository.update(existing.id, { name: displayName });
				}
				// token can only be null for remote users; local accounts always carry one
				await this.syncLevel(existing.id, claims);
				const token = existing.token ?? (await this.usersRepository.findOneByOrFail({ id: existing.id })).token!;
				return { token, userId: existing.id, username: existing.username, created: false };
			}

			// first sign-in from this host: create the account with a password nobody knows (host-only entry)
			const { account, secret } = await this.signupService.signup({
				username,
				password: randomBytes(24).toString('base64url'),
				ignorePreservedUsernames: true,
			});
			if (displayName) await this.usersRepository.update(account.id, { name: displayName });
			await this.syncLevel(account.id, claims);
			return { token: secret, userId: account.id, username: account.username, created: true };
		});
	}

	// Host-provided rating feeds the meet gates (DUPR doubles is the value hkpl carries; singles unknown).
	private async syncLevel(userId: string, claims: Claims): Promise<void> {
		if (claims.dupr_rating == null && claims.dupr_id == null) return;
		try {
			await this.meetService.upsertLevel(userId, 'pickleball', {
				...(claims.dupr_rating != null ? { duprDoubles: Number(claims.dupr_rating) } : {}),
				...(claims.dupr_id != null ? { duprId: String(claims.dupr_id) } : {}),
				source: claims.iss,
			});
		} catch {
			// level sync is best-effort; login must not fail because of it
		}
	}
}

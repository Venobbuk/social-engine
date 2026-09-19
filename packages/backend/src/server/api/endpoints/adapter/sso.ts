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
 *
 * STAFF-ROLE-V1 (W1, 2026-09-20, review-w0 HIGH): the engine's staff doors (requireModerator: clubs/claims/list|decide,
 *   venues/staff-update) had NOBODY behind them — 0 moderator roles on live and sandbox, only the root account passed.
 *   The people who run GripBat are the host's admins, and the host says so in the JWT (`role`, `tenant`). Each sign-in
 *   now syncs ONE engine role, "GripBat staff" (manual, not public, fixed id STAFF_ROLE_ID): an hkpl SUPER_ADMIN, or a
 *   TENANT_ADMIN of a GripBat tenant (ADAPTER_SSO_STAFF_TENANTS; default "boyau" — the UAT container sets "boyau-uat"
 *   for itself; a production engine must never list the UAT tenant), holds it; a sign-in through a GripBat tenant with
 *   any other role drops it (demotion follows the host). A sign-in through another tenant (the league) says nothing
 *   and changes nothing.
 *   Batch-1 review fix: the role is PLAIN — isModerator false, no Misskey moderator or admin power (no DM read, no
 *   instance-wide note delete, no channel edit). It opens only the doors that check it by id (modules/staff.ts):
 *   clubs/claims/list|decide and venues/staff-update.
 */
import { createPublicKey, createVerify, randomBytes, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Inject, Injectable } from '@nestjs/common';
import * as Redis from 'ioredis';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { UsersRepository, AccessTokensRepository, RolesRepository, RoleAssignmentsRepository, MiRole } from '@/models/_.js';
import { RoleService } from '@/core/RoleService.js';
import { GlobalEventService } from '@/core/GlobalEventService.js';
import { isDuplicateKeyValueError } from '@/misc/is-duplicate-key-value-error.js';
import { STAFF_ROLE_ID } from '@/modules/staff.js';
import { SignupService } from '@/core/SignupService.js';
import { IdService } from '@/core/IdService.js';
import { MeetLevelService } from '@/modules/meets/MeetLevelService.js';
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
			staff: { type: 'boolean', optional: false, nullable: true }, // STAFF-ROLE-V1: true/false when this sign-in decided it, null when it said nothing
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
// SEC-SSO-AUD-V1 (2026-09-20): the token's audience MUST equal the audience configured for THIS engine instance, and
// there is no default — an unset ADAPTER_SSO_AUDIENCE fails closed. Step (a), safe with TODAY's single key and today's
// mint (which stamps 'social.silkvo.com' for every host): BOTH compose files set it explicitly — web 'social.silkvo.com',
// web-uat ALSO 'social.silkvo.com' for now. Step (b), the key split (/root/gen/sso-split.sh), gives UAT its own key and
// the mint a per-tenant audience, then flips web-uat to 'uat.social.silkvo.com'. ADAPTER_SSO_TENANT is an optional
// second binding and is deliberately NOT set in step (a) (an hkpl row of tenant 'uat' signs in to prod today).
const AUDIENCE = process.env.ADAPTER_SSO_AUDIENCE ?? null;
const EXPECTED_TENANT = process.env.ADAPTER_SSO_TENANT ?? null; // optional second binding; unset = not enforced
// STAFF-ROLE-V1: the one engine role the host's admins hold (fixed id so every worker converges on one row). Default
// tenant list is production's ("boyau") only; the UAT container sets ADAPTER_SSO_STAFF_TENANTS=boyau-uat.
const STAFF_TENANTS = (process.env.ADAPTER_SSO_STAFF_TENANTS ?? 'boyau').split(',').map(x => x.trim()).filter(Boolean);
const MAX_TTL_SEC = 300;
const CLOCK_SKEW_SEC = 60; // tolerate a minute of clock drift between the mint and this box

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

type Claims = { iss: string; aud: string; sub: string; exp: number; iat?: number; jti?: string; row?: string; tenant?: string; name?: string | null; avatar?: string | null; role?: string | null; dupr_id?: string | null; dupr_rating?: number | null; home_club_id?: number | null; lang?: string; purpose?: string };

// SEC-ACCOUNT-DELETE-REAUTH-V1: exported so adapter/account/delete can demand a FRESH hkpl-signed proof (same
// verification: signature, audience, mandatory iat, ≤ 5-min TTL, mandatory jti) before it destroys an account.
export function verifyJwt(token: string): Claims {
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
	// SEC-SSO-AUD-V1: fail closed if this engine has no audience configured, and require the token to name THIS engine.
	if (!AUDIENCE) throw new ApiError(meta.errors.unconfigured);
	if (payload.aud !== AUDIENCE) throw new Error('aud');
	if (EXPECTED_TENANT != null && payload.tenant !== EXPECTED_TENANT) throw new Error('tenant');
	if (typeof payload.exp !== 'number' || payload.exp < now) throw new Error('exp');
	// SEC-SSO-HYGIENE-V1 (2026-09-20): iat is MANDATORY. Without it the 5-minute lifetime cap cannot be enforced, so a
	// captured token with a far-future exp would live indefinitely. Require it, reject a future-dated iat (small skew),
	// and cap the lifetime at MAX_TTL_SEC. hkpl's mint has always sent iat (jsonwebtoken expiresIn ⇒ iat + exp).
	if (typeof payload.iat !== 'number') throw new Error('iat');
	if (payload.iat > now + CLOCK_SKEW_SEC) throw new Error('iat_future');
	if (payload.exp - payload.iat > MAX_TTL_SEC) throw new Error('ttl');
	if (typeof payload.sub !== 'string' || payload.sub.length < 4) throw new Error('sub');
	return payload;
}

// deterministic local username: <issuer>_<12 hex of sha256(external id)> — ≤ 20 chars, [a-z0-9_]
// SEC-ACCOUNT-DELETE-REAUTH-V1: exported so adapter/account/delete can prove a re-auth proof maps to the same account.
export function usernameFor(iss: string, sub: string): string {
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

		@Inject(DI.rolesRepository)
		private rolesRepository: RolesRepository,

		@Inject(DI.roleAssignmentsRepository)
		private roleAssignmentsRepository: RoleAssignmentsRepository,

		private roleService: RoleService,
		private globalEventService: GlobalEventService,

		private signupService: SignupService,
		private idService: IdService,
		private meetLevelService: MeetLevelService,
		private loggerService: LoggerService,
	) {
		super(meta, paramDef, async (ps) => {
			let claims: Claims;
			try {
				claims = verifyJwt(ps.jwt);
			} catch (e) {
				// SEC-SSO-HYGIENE-V1: log WHY a token was refused (aud / tenant / iat / ttl / exp / sig …) with its
				// iss/aud/tenant — never the token itself — so a misconfigured fail-closed deploy is diagnosable.
				let hint = '';
				try { const p = JSON.parse(b64urlToBuf(ps.jwt.split('.')[1] ?? '').toString('utf8')); hint = ` iss=${String(p.iss)} aud=${String(p.aud)} tenant=${String(p.tenant)}`; } catch { hint = ' (payload unreadable)'; }
				this.logger.warn(`SSO token refused: ${e instanceof ApiError ? e.code : (e instanceof Error ? e.message : String(e))}${hint} (engine audience=${String(AUDIENCE)})`);
				if (e instanceof ApiError) throw e;
				throw new ApiError(meta.errors.invalidToken);
			}
			// SEC-ACCOUNT-DELETE-REAUTH-V1: a purpose-bound token (e.g. purpose 'account-delete', minted by hkpl's re-auth
			// route) is NOT a login token — refuse it here so a deletion proof can never double as a sign-in.
			if (claims.purpose != null) {
				this.logger.warn(`SSO token refused: purpose-bound token (${String(claims.purpose)}) presented to login iss=${claims.iss}`);
				throw new ApiError(meta.errors.invalidToken);
			}

			// S3 — single redemption. SEC-SSO-HYGIENE-V1 (2026-09-20): the jti (replay id) is now MANDATORY and the
			// replay check ALWAYS runs. The old ADAPTER_SSO_JTI_OPTIONAL transition window (which admitted jti-less
			// tokens with NO replay protection) is removed — hkpl's IDENTITY-PERSON-V1 mint sends a jti, so a token
			// without one is rejected outright. The token is redeemable exactly once within its own TTL.
			if (typeof claims.jti !== 'string' || claims.jti.length < 8) throw new ApiError(meta.errors.invalidToken);
			const ttl = Math.max(1, Math.min(MAX_TTL_SEC, (claims.exp - Math.floor(Date.now() / 1000)) + 5));
			const first = await this.redisClient.set(`sso:jti:${claims.iss}:${claims.jti}`, '1', 'EX', ttl, 'NX');
			if (first !== 'OK') throw new ApiError(meta.errors.replayed);

			const username = usernameFor(claims.iss, claims.sub);
			const displayName = (claims.name ?? '').toString().slice(0, 50) || null;
			const lang = typeof claims.lang === 'string' && claims.lang.length <= 12 ? claims.lang : null;

			// SEC-SSO-HYGIENE-V1: link by the hkpl IDENTITY, not a mutable name. `username` is a pure, one-way function
			// of (iss, sub) where sub is hkpl's immutable PERSON id (IDENTITY-LINKS-V1), so this lookup already binds
			// the account to the identity — a display-name change never re-points it, and there is no username-rename
			// path for these password-unknown accounts. (Defense-in-depth follow-up: a dedicated (iss,sub)→userId link
			// table, so a tombstoned/renamed row can never be mismatched. Left out here to avoid colliding with the
			// engine-batch1 entity-list edits; see report.)
			const existing = await this.usersRepository.findOneBy({ usernameLower: username, host: null as never });
			if (existing) {
				if (displayName && existing.name !== displayName) {
					await this.usersRepository.update(existing.id, { name: displayName });
				}
				const ratingSynced = await this.syncLevel(existing.id, claims);
				const staff = await this.syncStaffRole(existing.id, claims);
				const token = await this.issueCredential(existing.id, claims);
				return { token, userId: existing.id, username: existing.username, created: false, lang, ratingSynced, staff };
			}

			// first sign-in from this host: create the account with a password nobody knows (host-only entry).
			// The signup secret (the master token) is NOT returned — S4.
			const { account } = await this.signupService.signup({
				username,
				password: randomBytes(24).toString('base64url'),
				ignorePreservedUsernames: true,
			});
			// CHAT-SCOPE-V1: a Reclub member can message anyone in the app (Reclub inbox → any player). Misskey's default
			// 'mutual' (both must follow) made every first message 'recipient is cannot chat'; a person can still narrow it
			// in i/update. Existing accounts were moved to 'everyone' by SQL on 2026-09-17.
			await this.usersRepository.update(account.id, { chatScope: 'everyone', ...(displayName ? { name: displayName } : {}) });
			const ratingSynced = await this.syncLevel(account.id, claims);
			const staff = await this.syncStaffRole(account.id, claims);
			const token = await this.issueCredential(account.id, claims);
			return { token, userId: account.id, username: account.username, created: true, lang, ratingSynced, staff };
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

	// STAFF-ROLE-V1 — see the header. Returns true / false when this sign-in decided staff, null when it said nothing (or the
	// sync failed: logged; sign-in proceeds and the previous assignment stands).
	private async syncStaffRole(userId: string, claims: Claims): Promise<boolean | null> {
		const superAdmin = claims.role === 'SUPER_ADMIN';
		if (!superAdmin && !(claims.tenant && STAFF_TENANTS.includes(claims.tenant))) return null;
		const staff = superAdmin || claims.role === 'TENANT_ADMIN';
		try {
			await this.ensureStaffRole();
			const has = await this.roleAssignmentsRepository.existsBy({ roleId: STAFF_ROLE_ID, userId });
			if (staff && !has) await this.roleService.assign(userId, STAFF_ROLE_ID);
			if (!staff && has) await this.roleService.unassign(userId, STAFF_ROLE_ID);
			return staff;
		} catch (e) {
			this.logger.warn(`staff role sync failed for user ${userId} from ${claims.iss}: ${e instanceof Error ? e.message : String(e)}`);
			return null;
		}
	}

	private async ensureStaffRole(): Promise<void> {
		const existing = await this.rolesRepository.findOneBy({ id: STAFF_ROLE_ID });
		if (existing) {
			// batch-1 review fix: a row made by an earlier build as a moderator role is demoted to a plain role
			if (existing.isModerator || existing.isAdministrator) {
				await this.rolesRepository.update(STAFF_ROLE_ID, { isModerator: false, isAdministrator: false, updatedAt: new Date() });
				this.globalEventService.publishInternalEvent('roleUpdated', await this.rolesRepository.findOneByOrFail({ id: STAFF_ROLE_ID }));
			}
			return;
		}
		const now = new Date();
		try {
			const created = await this.rolesRepository.insertOne({
				id: STAFF_ROLE_ID, updatedAt: now, lastUsedAt: now, name: 'GripBat staff',
				description: 'The host\'s admins (hkpl SUPER_ADMIN, or TENANT_ADMIN of a GripBat tenant), synced at every SSO sign-in (STAFF-ROLE-V1). A plain role: it opens only the club-claim queue and venue verification (modules/staff.ts), no moderator power.',
				color: null, iconUrl: null, target: 'manual', condFormula: {} as MiRole['condFormula'], isPublic: false, asBadge: false,
				isModerator: false, isAdministrator: false, isExplorable: false, preserveAssignmentOnMoveAccount: false, canEditMembersByModerator: false,
				displayOrder: 0, policies: {},
			});
			this.globalEventService.publishInternalEvent('roleCreated', created);
		} catch (e) {
			if (!isDuplicateKeyValueError(e)) throw e; // another worker created it first
		}
	}

	// Host-provided rating feeds the meet gates (DUPR doubles is the value hkpl carries; singles unknown).
	// S7 — returns whether the sync succeeded; a failure is logged, not swallowed. Login still proceeds.
	private async syncLevel(userId: string, claims: Claims): Promise<boolean> {
		// DUPR-UNLINK-SYNC-V1 (W2-S 2026-09-20): the host says this player has no DUPR link any more (hkpl's disconnect =
		// PATCH /me/profile {dupr_id: null}) - forget the DUPR id THIS host gave us, so GripBat stops calling them connected.
		// Only a row the same host wrote (source = iss) that still holds an id is touched; the rating stays, as it does on hkpl.
		if (Object.prototype.hasOwnProperty.call(claims, 'dupr_id') && claims.dupr_id == null) {
			await this.meetLevelService.clearHostDuprId(userId, 'pickleball', claims.iss).catch((e: unknown) => this.logger.warn(`dupr unlink sync failed for user ${userId}: ${e instanceof Error ? e.message : String(e)}`));
		}
		if (claims.dupr_rating == null && claims.dupr_id == null) return true; // nothing to sync is not a failure
		try {
			await this.meetLevelService.upsertLevel(userId, 'pickleball', {
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

/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { IsNull } from 'typeorm';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DI } from '@/di-symbols.js';
import type { MiMeta, UsersRepository, UsedUsernamesRepository, RegistryItemsRepository } from '@/models/_.js';
import { GlobalEventService } from '@/core/GlobalEventService.js';
import { IdService } from '@/core/IdService.js';
import { isDuplicateKeyValueError } from '@/misc/is-duplicate-key-value-error.js';
import { isPlaceholderUsername, usernameProblem, SSO_HANDLE_KEY } from '@/misc/gb-accounts.js';
import { ApiError } from '@/server/api/error.js';

/*
 * GRIPBAT-ACCOUNTS-V1 (spec §2) — gb/account/username: the person CHOOSES their username (first time in onboarding,
 * later in Settings — Reclub's update-profile lets a member edit it). NEW: Misskey never renames a local user (a
 * username is fixed for federation, which this fork runs without). Searched first: i/update paramDef, every
 * endpoints/i/*, admin/*, SignupService — no rename anywhere.
 *
 * Rules: gb-accounts.usernameProblem (3–20 letters/digits/_, not gb_/hkpl_, not the brand, not preserved) + not taken,
 * not used before (used_username). The old handle, when it was a real chosen one, is reserved in used_username so
 * nobody else can pick it up and be mistaken for this person; a machine placeholder is not reserved. An account made by
 * the retired hkpl SSO seam keeps its seam handle as a registry alias (SSO_HANDLE_KEY), so a probe still signing in
 * through adapter/sso during the transition lands on the SAME account, never a new one. Caches: the native
 * 'localUserUpdated' event (CacheService) — the same event i/update sends.
 */
export const meta = {
	tags: ['account'],
	requireCredential: true,
	kind: 'write:account',
	limit: { duration: 60 * 60 * 1000, max: 10 },
	errors: {
		invalid: { message: 'Use 3 to 20 letters, numbers or underscores.', code: 'USERNAME_INVALID', id: 'd1a7c3e0-4b2f-4e8a-9c61-0f5b2a7d3e01' },
		tooShort: { message: 'Use at least 3 characters.', code: 'USERNAME_TOO_SHORT', id: 'd1a7c3e0-4b2f-4e8a-9c61-0f5b2a7d3e02' },
		reserved: { message: 'That username is reserved.', code: 'USERNAME_RESERVED', id: 'd1a7c3e0-4b2f-4e8a-9c61-0f5b2a7d3e03' },
		taken: { message: 'That username is taken.', code: 'USERNAME_TAKEN', id: 'd1a7c3e0-4b2f-4e8a-9c61-0f5b2a7d3e04' },
	},
	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			username: { type: 'string', optional: false, nullable: false },
			changed: { type: 'boolean', optional: false, nullable: false },
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		username: { type: 'string', minLength: 1, maxLength: 64 },
	},
	required: ['username'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.meta)
		private serverSettings: MiMeta,

		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,

		@Inject(DI.usedUsernamesRepository)
		private usedUsernamesRepository: UsedUsernamesRepository,

		@Inject(DI.registryItemsRepository)
		private registryItemsRepository: RegistryItemsRepository,

		private globalEventService: GlobalEventService,
		private idService: IdService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const wanted = String(ps.username).trim();
			const problem = usernameProblem(wanted, this.serverSettings.preservedUsernames);
			if (problem === 'USERNAME_TOO_SHORT') throw new ApiError(meta.errors.tooShort);
			if (problem === 'USERNAME_INVALID') throw new ApiError(meta.errors.invalid);
			if (problem === 'USERNAME_RESERVED') throw new ApiError(meta.errors.reserved);

			const fresh = await this.usersRepository.findOneByOrFail({ id: me.id });
			const old = fresh.username;
			if (old === wanted) return { username: old, changed: false };
			const sameName = old.toLowerCase() === wanted.toLowerCase(); // a letter-case edit of one's own handle

			if (!sameName) {
				if (await this.usersRepository.exists({ where: { usernameLower: wanted.toLowerCase(), host: IsNull() } })) throw new ApiError(meta.errors.taken);
				if (await this.usedUsernamesRepository.exists({ where: { username: wanted.toLowerCase() } })) throw new ApiError(meta.errors.taken);
			}

			// an hkpl SSO account keeps its seam handle as an alias (adapter/sso finds it by that)
			if (/^hkpl_[0-9a-f]{12}$/i.test(old)) {
				const has = await this.registryItemsRepository.exists({ where: { userId: me.id, key: SSO_HANDLE_KEY, domain: IsNull() } });
				if (!has) {
					await this.registryItemsRepository.insert({
						id: this.idService.gen(), updatedAt: new Date(), userId: me.id, key: SSO_HANDLE_KEY, scope: ['gripbat'], domain: null, value: old.toLowerCase() as never,
					});
				}
			}

			try {
				await this.usersRepository.update(me.id, { username: wanted, usernameLower: wanted.toLowerCase() });
			} catch (e) {
				if (isDuplicateKeyValueError(e)) throw new ApiError(meta.errors.taken);
				throw e;
			}
			if (!sameName && !isPlaceholderUsername(old)) {
				await this.usedUsernamesRepository.insert({ username: old.toLowerCase(), createdAt: new Date() }).catch(() => { /* already reserved */ });
			}

			this.globalEventService.publishInternalEvent('localUserUpdated', { id: me.id });
			return { username: wanted, changed: true };
		});
	}
}

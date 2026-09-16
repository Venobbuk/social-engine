/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DI } from '@/di-symbols.js';
import type { UsersRepository } from '@/models/_.js';
import { DeleteAccountService } from '@/core/DeleteAccountService.js';

// ACCOUNT-DELETE-V1 (PDPO, Reclub settings › delete account): an account minted by the host SSO has a password
// nobody knows (adapter/sso), so i/delete-account's password check can never pass for it. This door deletes the
// CALLER's own account on the strength of the credential alone — the same credential that could post, chat and
// join as them. Only for host-minted accounts (adapter/sso usernameFor: <iss>_<12 hex>); anyone else uses i/delete-account.
export const meta = {
	tags: ['account'],
	requireCredential: true,
	// not `secure`: the SSO issues a first-party APP credential (S4), and secure endpoints admit only native tokens
	kind: 'write:account',
	res: { type: 'object', optional: false, nullable: false, properties: { deleted: { type: 'boolean', optional: false, nullable: false } } },
} as const;

export const paramDef = { type: 'object', properties: {}, required: [] } as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,
		private deleteAccountService: DeleteAccountService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const user = await this.usersRepository.findOneByOrFail({ id: me.id });
			if (user.isDeleted) return { deleted: true };
			if (!/^[a-z0-9-]+_[0-9a-f]{12}$/.test(user.username)) throw new Error('use i/delete-account');   // adapter/sso usernameFor(): <iss>_<12 hex>
			await this.deleteAccountService.deleteAccount(me);
			// the row stays as a tombstone (federation), so free the deterministic SSO username: the person's NEXT sign-in
			// mints a fresh account instead of colliding with the deleted one (found by probes/safety-v1 7b: remint 500)
			const freed = user.username + '_x' + Date.now().toString(36);
			await this.usersRepository.update(user.id, { username: freed, usernameLower: freed.toLowerCase() });
			return { deleted: true };
		});
	}
}

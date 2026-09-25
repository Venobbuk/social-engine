/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DI } from '@/di-symbols.js';
import type { UserProfilesRepository } from '@/models/_.js';
import { isGripbatStaff } from '@/modules/staff.js';
import { isPlaceholderUsername } from '@/misc/gb-accounts.js';

/*
 * GRIPBAT-ACCOUNTS-V1 (spec §9) — gb/account/me: the account facts the app needs that `i` does not carry.
 *  - staff: holds the "GripBat staff" role (modules/staff.ts). The role is private by design (isPublic false), so `i`
 *    never lists it; with hkpl's JWT gone the app had no other way to know. Searched: `i` / MeDetailed packs public
 *    roles only; `roles/*` list public roles; admin/roles/* need a moderator.
 *  - needsUsername: the handle is still a machine placeholder (sign-up gb_<hex>, or an hkpl SSO account's hkpl_<hex>),
 *    so onboarding asks the person to choose one.
 *  - email / emailVerified: from the profile, for any credential (native `i` shows them to a native token only).
 */
export const meta = {
	tags: ['account'],
	requireCredential: true,
	kind: 'read:account',
	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			id: { type: 'string', optional: false, nullable: false },
			username: { type: 'string', optional: false, nullable: false },
			staff: { type: 'boolean', optional: false, nullable: false },
			needsUsername: { type: 'boolean', optional: false, nullable: false },
			email: { type: 'string', optional: false, nullable: true },
			emailVerified: { type: 'boolean', optional: false, nullable: false },
			hasPassword: { type: 'boolean', optional: false, nullable: false },   // ACCOUNT-DELETE-SSO-V1: the app asks for a password only when there is one
		},
	},
} as const;

export const paramDef = { type: 'object', properties: {}, required: [] } as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.db)
		private db: DataSource,

		@Inject(DI.userProfilesRepository)
		private userProfilesRepository: UserProfilesRepository,
	) {
		super(meta, paramDef, async (ps, me) => {
			const profile = await this.userProfilesRepository.findOneByOrFail({ userId: me.id });
			return {
				id: me.id,
				username: me.username,
				staff: await isGripbatStaff(this.db, me.id),
				needsUsername: isPlaceholderUsername(me.username),
				email: profile.email ?? null,
				emailVerified: !!profile.emailVerified,
				hasPassword: !!profile.password,   // ACCOUNT-DELETE-SSO-V1
			};
		});
	}
}

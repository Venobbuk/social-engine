/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { IsNull } from 'typeorm';
import { Inject, Injectable } from '@nestjs/common';
import type { MiMeta, UsedUsernamesRepository, UsersRepository } from '@/models/_.js';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { localUsernameSchema } from '@/models/User.js';
import { DI } from '@/di-symbols.js';
import { usernameProblem } from '@/misc/gb-accounts.js'; // GRIPBAT-ACCOUNTS-V1

export const meta = {
	tags: ['users'],

	requireCredential: false,

	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			available: {
				type: 'boolean',
				optional: false, nullable: false,
			},
			reason: { type: 'string', optional: true, nullable: true }, // GRIPBAT-ACCOUNTS-V1
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		username: localUsernameSchema,
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
	) {
		super(meta, paramDef, async (ps, me) => {
			const exist = await this.usersRepository.countBy({
				host: IsNull(),
				usernameLower: ps.username.toLowerCase(),
			});

			const exist2 = await this.usedUsernamesRepository.countBy({ username: ps.username.toLowerCase() });

			const isPreserved = this.serverSettings.preservedUsernames.map(x => x.toLowerCase()).includes(ps.username.toLowerCase());
			// GRIPBAT-ACCOUNTS-V1 (spec §2): the one username rule (gb-accounts.usernameProblem) — length, machine prefixes,
			// the brand — answers here too, with its reason, so the onboarding field can say why before the person submits.
			const problem = usernameProblem(ps.username, this.serverSettings.preservedUsernames);
			const taken = exist !== 0 || exist2 !== 0;

			return {
				available: !taken && !isPreserved && problem == null,
				reason: problem ?? (taken ? 'USERNAME_TAKEN' : isPreserved ? 'USERNAME_RESERVED' : null),
			};
		});
	}
}

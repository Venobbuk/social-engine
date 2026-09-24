/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DI } from '@/di-symbols.js';
import { ApiError } from '@/server/api/error.js';
import { restoreDeletion } from '@/modules/account/deletion.js';

// ACCOUNT-GRACE-V1 (Reclub "Request reactivation"): take back MY pending deletion while the 7-day grace runs. After purgeAt
// the sweep owns the account and this answers NOT_PENDING.
export const meta = {
	tags: ['account'],
	requireCredential: true,
	kind: 'write:account',
	limit: { duration: 60 * 1000, max: 10 },
	errors: {
		notPending: { message: 'This account is not marked for deletion.', code: 'NOT_PENDING', id: '8c2d0e5a-1b7c-4e1a-9c0e-5a0c3a1d2f20' },
	},
	res: { type: 'object', optional: false, nullable: false, properties: { restored: { type: 'boolean', optional: false, nullable: false } } },
} as const;

export const paramDef = { type: 'object', properties: {}, required: [] } as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(@Inject(DI.db) private db: DataSource) {
		super(meta, paramDef, async (ps, me) => {
			if (!(await restoreDeletion(this.db, me.id))) throw new ApiError(meta.errors.notPending);
			return { restored: true };
		});
	}
}

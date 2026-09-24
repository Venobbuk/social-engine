/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DI } from '@/di-symbols.js';
import { deletionOf } from '@/modules/account/deletion.js';

// ACCOUNT-GRACE-V1 (Reclub E-marked-deletion.01): is MY account marked for deletion? The app asks once after sign-in and,
// when it is, shows the gate "This account is marked for deletion" with Restore my account / Sign out.
export const meta = {
	tags: ['account'],
	requireCredential: true,
	kind: 'read:account',
	res: { type: 'object', optional: false, nullable: false, properties: {
		pending: { type: 'boolean', optional: false, nullable: false },
		requestedAt: { type: 'string', optional: false, nullable: true },
		purgeAt: { type: 'string', optional: false, nullable: true },
	} },
} as const;

export const paramDef = { type: 'object', properties: {}, required: [] } as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(@Inject(DI.db) private db: DataSource) {
		super(meta, paramDef, async (ps, me) => deletionOf(this.db, me.id));
	}
}

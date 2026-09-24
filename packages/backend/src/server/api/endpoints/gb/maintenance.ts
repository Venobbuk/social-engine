/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import * as Redis from 'ioredis';
import type { DataSource } from 'typeorm';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DI } from '@/di-symbols.js';
import { ApiError } from '@/server/api/error.js';
import { isGripbatStaff, notStaffError } from '@/modules/staff.js';
import { MAINTENANCE_KEY, parseMaintenance } from './status.js';

// GB-MAINTENANCE-V1: GripBat staff switch the maintenance gate on (with an optional "back at" time and a note) or off.
// Staff = the STAFF-ROLE-V1 engine role (modules/staff.ts), exactly like venues/staff-update. Everyone else: 403.
export const meta = {
	tags: ['meta'],
	requireCredential: true,
	kind: 'write:meets',
	errors: {
		notStaff: notStaffError,
		badUntil: { message: 'until must be an ISO date-time.', code: 'BAD_UNTIL', id: '8c2d0e5a-1b7c-4e1a-9c0e-5a0c3a1d2f21' },
	},
	res: { type: 'object', optional: false, nullable: false },
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		on: { type: 'boolean' },
		until: { type: 'string', maxLength: 40, nullable: true },   // plain string: format 'date-time' crashes boot (AGENT_RULES)
		message: { type: 'string', maxLength: 280, nullable: true },
	},
	required: ['on'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(@Inject(DI.redis) private redisClient: Redis.Redis, @Inject(DI.db) private db: DataSource) {
		super(meta, paramDef, async (ps, me) => {
			if (!(await isGripbatStaff(this.db, me.id))) throw new ApiError(meta.errors.notStaff);
			if (!ps.on) { await this.redisClient.del(MAINTENANCE_KEY); return { maintenance: parseMaintenance(null) }; }
			if (ps.until && Number.isNaN(Date.parse(ps.until))) throw new ApiError(meta.errors.badUntil);
			const v = { on: true, until: ps.until ? new Date(ps.until).toISOString() : null, message: ps.message ?? null, at: new Date().toISOString(), by: me.id };
			await this.redisClient.set(MAINTENANCE_KEY, JSON.stringify(v));
			return { maintenance: parseMaintenance(JSON.stringify(v)) };
		});
	}
}

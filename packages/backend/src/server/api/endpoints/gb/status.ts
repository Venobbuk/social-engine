/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import * as Redis from 'ioredis';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DI } from '@/di-symbols.js';

/* GB-MAINTENANCE-V1 (lane account-rest, Reclub E-maintenance.01 "under maintenance — back in {duration}" + Retry).
 * The public status door the app reads before it draws a page — the shape of hkpl's public feature door
 * GET /api/v1/public/feature/bug-widget (REUSED as the pattern), kept in the ENGINE per G15.15. Anonymous, no token.
 * State lives in this engine's own redis (key gb:maintenance), set by GripBat staff through gb/maintenance. Searched first
 * (G11): Misskey has no maintenance mode (meta carries none; announcements are dismissible notes, not a gate). */
export const MAINTENANCE_KEY = 'gb:maintenance';
export type Maintenance = { on: boolean; until: string | null; message: string | null; at: string | null };
export function parseMaintenance(raw: string | null): Maintenance {
	try {
		const j = raw ? JSON.parse(raw) as Partial<Maintenance> : null;
		if (j && j.on === true) return { on: true, until: typeof j.until === 'string' ? j.until : null, message: typeof j.message === 'string' ? j.message : null, at: typeof j.at === 'string' ? j.at : null };
	} catch { /* unreadable = not in maintenance */ }
	return { on: false, until: null, message: null, at: null };
}

export const meta = {
	tags: ['meta'],
	requireCredential: false,
	res: { type: 'object', optional: false, nullable: false, properties: {
		maintenance: { type: 'object', optional: false, nullable: false, properties: {
			on: { type: 'boolean', optional: false, nullable: false },
			until: { type: 'string', optional: false, nullable: true },
			message: { type: 'string', optional: false, nullable: true },
			at: { type: 'string', optional: false, nullable: true },
		} },
	} },
} as const;

export const paramDef = { type: 'object', properties: {}, required: [] } as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(@Inject(DI.redis) private redisClient: Redis.Redis) {
		super(meta, paramDef, async () => ({ maintenance: parseMaintenance(await this.redisClient.get(MAINTENANCE_KEY)) }));
	}
}

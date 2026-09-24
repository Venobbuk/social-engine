/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DI } from '@/di-symbols.js';

// LAST-ACTIVE-OPTIN-V1 (lane fix-S8, E-chat-room.01) — who may see WHEN I was last active.
// Reclub prints "Active 2h ago" for everyone, always. GripBat (G15.0, BETTER-THAN-RECLUB with privacy in mind): a player
// looking for a game should not broadcast their exact comings and goings to strangers by default, so the default is
// Misskey's own buckets ("Active now" < 10 min, "Active in the last few days" < 3 days); the exact time is shown only when
// the member turns it on here; the native i/update hideOnlineStatus still hides presence altogether (REUSED, untouched).
// NEW (a GripBat preference Misskey lacks — searched: MiUser/MiUserProfile have only hideOnlineStatus; the registry
// (i/registry) is per-client and not readable by users/show). Show = no params; update = pass lastActiveExact.
export const meta = {
	tags: ['account'],
	requireCredential: true,
	kind: 'write:account',
	res: { type: 'object', optional: false, nullable: false, properties: {
		lastActiveExact: { type: 'boolean', optional: false, nullable: false },
		hideOnlineStatus: { type: 'boolean', optional: false, nullable: false },
	} },
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		lastActiveExact: { type: 'boolean' },
	},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.db) private db: DataSource,
	) {
		super(meta, paramDef, async (ps, me) => {
			if (typeof ps.lastActiveExact === 'boolean') {
				await this.db.query(`INSERT INTO "gb_user_pref" ("userId", "lastActiveExact", "updatedAt") VALUES ($1, $2, now())
					ON CONFLICT ("userId") DO UPDATE SET "lastActiveExact" = EXCLUDED."lastActiveExact", "updatedAt" = now()`, [me.id, ps.lastActiveExact]);
			}
			const rows = await this.db.query(`SELECT COALESCE(p."lastActiveExact", false) AS "lastActiveExact", u."hideOnlineStatus" AS "hide"
				FROM "user" u LEFT JOIN "gb_user_pref" p ON p."userId" = u.id WHERE u.id = $1`, [me.id]) as { lastActiveExact: boolean; hide: boolean }[];
			return { lastActiveExact: !!(rows[0] && rows[0].lastActiveExact), hideOnlineStatus: !!(rows[0] && rows[0].hide) };
		});
	}
}

/** LAST-ACTIVE-OPTIN-V1: the exact last-active time of a member who allows it (and does not hide presence), else null. */
export async function lastActiveIfAllowed(db: DataSource, userId: string): Promise<string | null> {
	const rows = await db.query(`SELECT u."lastActiveDate" AS "at" FROM "user" u JOIN "gb_user_pref" p ON p."userId" = u.id
		WHERE u.id = $1 AND p."lastActiveExact" = true AND u."hideOnlineStatus" = false AND u."lastActiveDate" IS NOT NULL`, [userId]) as { at: Date }[];
	return rows.length ? new Date(rows[0].at).toISOString() : null;
}

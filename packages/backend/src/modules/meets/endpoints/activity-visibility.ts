/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DI } from '@/di-symbols.js';

// ACTIVITY-SCOPE-V1 (lane meets-fixes, 2026-09-23; matrix E-network.04 / E-network.06 / E-player.07) — Reclub's per-friend
// "Show my activities" switch. NEW: searched Misskey first — following has notify / withReplies only, mute and block
// act in the other direction (what *I* see), user lists are the viewer's own grouping; nothing lets me hide MY meets
// from ONE follower. Row = "userId hides their activities from hiddenFromId" (gb_activity_hide).
//   { userId, show }  set my switch for that person      { }  read only
// Answer: iHideFrom (people who cannot see my activities) and hidingFromMe (people whose activities I cannot see).
// Enforced where a friend's participation is surfaced: meets/list friendsOnly (engine) and the meet page's
// "X and N more friends are joining" + the player page's activities (app, from hidingFromMe).
export const meta = {
	tags: ['meets'],
	requireCredential: true,
	kind: 'write:following',
	res: { type: 'object', optional: false, nullable: false, properties: {
		iHideFrom: { type: 'array', optional: false, nullable: false, items: { type: 'string' } },
		hidingFromMe: { type: 'array', optional: false, nullable: false, items: { type: 'string' } },
	} },
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		userId: { type: 'string', format: 'misskey:id' },
		show: { type: 'boolean' },
	},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(@Inject(DI.db) private db: DataSource) {
		super(meta, paramDef, async (ps, me) => {
			if (ps.userId && ps.userId !== me.id && ps.show !== undefined) {
				if (ps.show) await this.db.query(`DELETE FROM "gb_activity_hide" WHERE "userId" = $1 AND "hiddenFromId" = $2`, [me.id, ps.userId]);
				else await this.db.query(`INSERT INTO "gb_activity_hide" ("userId", "hiddenFromId") VALUES ($1, $2) ON CONFLICT DO NOTHING`, [me.id, ps.userId]);
			}
			const mine = await this.db.query(`SELECT "hiddenFromId" AS id FROM "gb_activity_hide" WHERE "userId" = $1`, [me.id]) as { id: string }[];
			const theirs = await this.db.query(`SELECT "userId" AS id FROM "gb_activity_hide" WHERE "hiddenFromId" = $1`, [me.id]) as { id: string }[];
			return { iHideFrom: mine.map(r => r.id), hidingFromMe: theirs.map(r => r.id) };
		});
	}
}

/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DI } from '@/di-symbols.js';
import { IdService } from '@/core/IdService.js';

// DISCOVER-W2D (Reclub triage C-app-shell.02 / C-home.07 / C-feed.05): Reclub GET /user/badges. G11: the counts Misskey
// already keeps come from the NATIVE `i` (MeDetailed: unreadNotificationsCount, hasUnreadChatMessages,
// hasPendingReceivedFollowRequest — core/entities/UserEntityService.ts:607-614); this door adds only the two GripBat counts
// Misskey has no notion of:
//   clubRequests  join requests waiting in the clubs I own or admin (club_join_request — CLUB-V3)
//   feed          posts since `feedSince` (the last time this person opened the Feed — the app keeps it and passes it,
//                 Reclub resetFeedBadges) in the clubs I follow and from the people I follow, not my own; capped at 99.
//                 null when the app sends no feedSince (never opened the Feed on this device: no count to show).
export const meta = {
	tags: ['discover', 'account'],
	requireCredential: true,
	kind: 'read:account',
	res: {
		type: 'object', optional: false, nullable: false,
		properties: {
			clubRequests: { type: 'integer', optional: false, nullable: false },
			feed: { type: 'integer', optional: false, nullable: true },
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		feedSince: { type: 'string', nullable: true, maxLength: 40 },
	},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.db) private db: DataSource,
		private idService: IdService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const since = ps.feedSince ? new Date(ps.feedSince) : null;
			const sinceOk = since != null && !Number.isNaN(since.getTime()) && since.getTime() <= Date.now();
			const [clubRequests, feed] = await Promise.all([
				this.db.query(`
					SELECT count(*)::int AS n FROM club_join_request r
					JOIN channel c ON c.id = r."channelId"
					LEFT JOIN club_setting cs ON cs."channelId" = c.id
					WHERE r.status = 'pending' AND c."isArchived" = false AND (c."userId" = $1 OR $1 = ANY(cs."adminIds"))`, [me.id])
					.then((r: { n: number }[]) => Number(r[0]?.n) || 0),
				sinceOk ? this.db.query(`
					SELECT count(*)::int AS n FROM (
						SELECT n.id FROM note n
						WHERE n.id > $2 AND n."userId" <> $1 AND n."replyId" IS NULL AND (
							(n."channelId" IS NOT NULL AND n."channelId" IN (SELECT cf."followeeId" FROM channel_following cf WHERE cf."followerId" = $1))
							OR (n."channelId" IS NULL AND n.visibility IN ('public', 'home') AND n."userId" IN (SELECT f."followeeId" FROM following f WHERE f."followerId" = $1))
						)
						LIMIT 99
					) x`, [me.id, this.idService.gen(since!.getTime())]).then((r: { n: number }[]) => Number(r[0]?.n) || 0) : Promise.resolve(null),
			]);
			return { clubRequests, feed };
		});
	}
}

/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { MeetsRepository } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import { ApiError } from '@/server/api/error.js';
import { MeetService } from '@/modules/meets/MeetService.js';
import { meetErrors, toApiError } from '@/modules/meets/endpoints/_shared.js';

// MEET-CLUB-INVITE-V2 (lane meets-fixes, 2026-09-23; matrix A-meet-detail.41 / .43) — Reclub's "Invited clubs" section on a
// meet: the clubs whose people were invited (clubs/meets/invite-members records the club in meet_club_invite), each with
// Cancel invitation. EXTENDED: the invite door already existed; this reads its record and undoes it — cancelling removes
// the club's record and the invitations still unanswered (status 'invited') of that club's members / followers.
// Host only (MeetService.assertHost — co-hosts included).
export const meta = {
	tags: ['clubs'],
	requireCredential: true,
	kind: 'write:meets',
	res: { type: 'object', optional: false, nullable: false, properties: {
		clubs: { type: 'array', optional: false, nullable: false, items: { type: 'object', optional: false, nullable: false } },
		removed: { type: 'number', optional: false, nullable: false },
	} },
	errors: meetErrors,
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		meetId: { type: 'string', format: 'misskey:id' },
		cancelChannelId: { type: 'string', format: 'misskey:id' },
	},
	required: ['meetId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.meetsRepository) private meetsRepository: MeetsRepository,
		@Inject(DI.db) private db: DataSource,
		private meetService: MeetService,
	) {
		super(meta, paramDef, async (ps, me) => {
			try {
				const meet = await this.meetsRepository.findOneBy({ id: ps.meetId });
				if (meet == null) throw new ApiError(meetErrors.noSuchMeet);
				await this.meetService.assertHost(meet, me);
				let removed = 0;
				if (ps.cancelChannelId) {
					// SELECT first, then DELETE: pg DELETE … RETURNING answers [rows, count] through TypeORM's query()
					const inv = await this.db.query(`SELECT "audience" FROM "meet_club_invite" WHERE "meetId" = $1 AND "channelId" = $2`, [meet.id, ps.cancelChannelId]) as { audience: string }[];
					if (inv.length) {
						const followers = inv[0].audience === 'all' ? `OR EXISTS (SELECT 1 FROM "channel_following" f WHERE f."followeeId" = $2 AND f."followerId" = p."userId")` : '';
						const where = `p."meetId" = $1 AND p."status" = 'invited' AND p."isHost" = false AND p."isCoach" = false
							AND (EXISTS (SELECT 1 FROM "club_member" m WHERE m."channelId" = $2 AND m."userId" = p."userId") ${followers})`;
						removed = Number((await this.db.query(`SELECT count(*)::int AS n FROM "meet_participant" p WHERE ${where}`, [meet.id, ps.cancelChannelId]) as { n: number }[])[0]?.n ?? 0);
						await this.db.query(`DELETE FROM "meet_participant" p WHERE ${where}`, [meet.id, ps.cancelChannelId]);
						await this.db.query(`DELETE FROM "meet_club_invite" WHERE "meetId" = $1 AND "channelId" = $2`, [meet.id, ps.cancelChannelId]);
					}
				}
				const clubs = await this.db.query(`SELECT i."channelId", c."name", i."audience", i."createdAt" FROM "meet_club_invite" i JOIN "channel" c ON c."id" = i."channelId" WHERE i."meetId" = $1 ORDER BY i."createdAt"`, [meet.id]) as { channelId: string; name: string; audience: string; createdAt: Date }[];
				return { clubs: clubs.map(c => ({ channelId: c.channelId, name: c.name, audience: c.audience, invitedAt: new Date(c.createdAt).toISOString() })), removed };
			} catch (e) {
				return toApiError(e);
			}
		});
	}
}

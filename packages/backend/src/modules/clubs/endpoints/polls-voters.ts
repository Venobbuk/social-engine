/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DI } from '@/di-symbols.js';
import { UserEntityService } from '@/core/entities/UserEntityService.js';
import { ApiError } from '@/server/api/error.js';
import { clubErrors } from '@/modules/clubs/endpoints/_shared.js';
import { memberExistsSql, adminExistsSql } from '@/modules/clubs/club-tiers.js';

// T3-CLUBS-V1 (Reclub triage B-poll-voter.01): "{x} votes" — who voted for each option of a CLUB poll. Reclub shows a club
// poll's voters to the club; Misskey keeps poll votes (native poll_vote) but never lists them, which is right for a public
// timeline and wrong for a club deciding "who is coming Saturday". So this door answers ONLY for a poll posted in a club,
// and ONLY to that club's members and admins (the club_member / channel owner / adminIds rules of club-tiers.ts) — a
// follower of a public club, or anyone else, gets CLUB_NOT_MEMBER. Read-only; the vote itself stays native (notes/polls/vote).
export const meta = {
	tags: ['clubs'],
	requireCredential: true,
	kind: 'read:channels',
	res: { type: 'array', optional: false, nullable: false, items: { type: 'object', optional: false, nullable: false } },
	errors: clubErrors,
} as const;

export const paramDef = {
	type: 'object',
	properties: { noteId: { type: 'string', format: 'misskey:id' } },
	required: ['noteId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.db) private db: DataSource,
		private userEntityService: UserEntityService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const note = (await this.db.query(`SELECT n."channelId" FROM "note" n JOIN "poll" p ON p."noteId" = n."id" WHERE n."id" = $1`, [ps.noteId]) as { channelId: string | null }[])[0];
			if (!note || !note.channelId) throw new ApiError(clubErrors.noSuchNote);
			const ok = (await this.db.query(`SELECT (${memberExistsSql('$1', '$2')} OR ${adminExistsSql('$1', '$2')}) AS ok`, [note.channelId, me.id]) as { ok: boolean }[])[0];
			if (!ok || !ok.ok) throw new ApiError(clubErrors.notMember);
			const votes = await this.db.query(`SELECT "userId", "choice" FROM "poll_vote" WHERE "noteId" = $1 ORDER BY "id" ASC LIMIT 500`, [ps.noteId]) as { userId: string; choice: number }[];
			const users = await this.userEntityService.packMany([...new Set(votes.map((v) => v.userId))], me, { schema: 'UserLite' });
			const byId = new Map(users.map((u) => [u.id, u]));
			const choices = new Map<number, unknown[]>();
			for (const v of votes) { const u = byId.get(v.userId); if (!u) continue; const list = choices.get(v.choice) ?? []; list.push(u); choices.set(v.choice, list); }
			return [...choices.entries()].sort((a, b) => a[0] - b[0]).map(([choice, voters]) => ({ choice, count: voters.length, voters }));
		});
	}
}

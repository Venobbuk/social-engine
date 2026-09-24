/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { MeetsRepository } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import { UserEntityService } from '@/core/entities/UserEntityService.js';
import { ApiError } from '@/server/api/error.js';
import { meetErrors } from '../_shared.js';
import { MeetService, reviewAuthorKnown } from '@/modules/meets/MeetService.js';

// MEET-KUDOS-V1 — the Kudos tab on a past meet (triage A-meet-detail.65): per dimension, who was kudos'd in THIS
// meet, plus what I received and what I gave here.
//
// COPIED FROM modules/stats/endpoints/kudos-by-activity.ts — the same SELECT over meet_review, the same
// `body.split(',')` dimension parse, the same pack-the-givers shape. Two differences, both deliberate:
//   * that endpoint groups the CALLER's received kudos BY meet; this one takes one meet and groups by dimension
//     across everyone, which is what the tab shows.
//   * it reports RECIPIENTS per dimension as well as givers — "who got Great partner here".
//
// Visibility: endorsements only. MeetService.reviewsVisibleTo:743 makes an endorsement public to everyone, so a
// per-meet endorsement roll-up widens nothing. feedback and warning are NEVER read here — they are private to the
// pair (:744) and to the 5-author threshold (:745), and a per-meet view would leak them by elimination.
//
// Every number below is a COUNT over the rows this query just read. Nothing is stored or incremented.
export const meta = {
	tags: ['meets'],
	requireCredential: false,
	// res is deliberately untyped, exactly as the sibling reviews/list.ts:32 does: the schema-inference
	// path adds nothing here (the app hand-writes this shape either way) and every strict-mode mismatch
	// would only surface in CI, which is the one place this repo can compile.
	res: { type: 'object', optional: false, nullable: false },
	errors: { ...meetErrors },
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		meetId: { type: 'string', format: 'misskey:id', nullable: true },
		// KUDOS-CHAT-V1: the same roll-up for an ended competition (Reclub Competition Results → Kudos pane)
		competitionId: { type: 'string', format: 'misskey:id', nullable: true },
		limit: { type: 'integer', minimum: 1, maximum: 100, default: 30 },
	},
	required: [],
} as const;

type Row = { authorId: string; targetUserId: string; body: string | null };

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.db)
		private db: DataSource,
		@Inject(DI.meetsRepository)
		private meetsRepository: MeetsRepository,
		private userEntityService: UserEntityService,
		private meetService: MeetService,
	) {
		super(meta, paramDef, async (ps, me) => {
			// KUDOS-CHAT-V1: a competition's kudos (competitionId) or a meet's; one of the two
			let ref: { col: 'meetId' | 'competitionId'; id: string };
			if (ps.competitionId) {
				// G15.5: a private competition's kudos name its people — readable only by its host and its entrants (the
				// CompetitionService.assertVisible rule, without the invite-token / referee doors: stricter, never wider)
				const c = await this.db.query(
					`SELECT c.id FROM "competition" c WHERE c.id = $1 AND (c.visibility = 'public' OR c."hostId" = $2
					   OR EXISTS (SELECT 1 FROM "competition_entry" e WHERE e."competitionId" = c.id AND $2 = ANY(e."userIds")))`,
					[ps.competitionId, me ? me.id : '']) as { id: string }[];
				if (!c.length) throw new ApiError(meta.errors.noSuchMeet);
				ref = { col: 'competitionId', id: c[0].id };
			} else {
				const meet = ps.meetId ? await this.meetsRepository.findOneBy({ id: ps.meetId }) : null;
				if (meet == null) throw new ApiError(meta.errors.noSuchMeet);
				// SEC-REVIEW-AUTHOR-V1 (G15.5): a private meet's kudos name its people — the ONE private-meet rule
				// (MeetService.mayViewPrivate, as meets/show) decides, and a refusal reads like a missing meet.
				if (!(await this.meetService.mayViewPrivate(meet, me?.id ?? null))) throw new ApiError(meta.errors.noSuchMeet);
				ref = { col: 'meetId', id: meet.id };
			}

			// kudos-by-activity.ts:60 — endorsements only, archived excluded, one live query.
			const rows = await this.db.query(
				`SELECT r."authorId", r."targetUserId", r.body
				 FROM meet_review r
				 WHERE r."${ref.col}" = $1 AND r.type = 'endorsement' AND r."archivedAt" IS NULL`,
				[ref.id]) as Row[];

			const cats = new Map<string, { count: number; recipients: Set<string>; givers: Set<string>; byGiver: Map<string, number>; byRecipient: Map<string, number> }>();
			const people = new Set<string>();
			const myReceived: string[] = [];
			const myGiven = new Map<string, string[]>();
			let total = 0;
			for (const r of rows) {
				const dims = (r.body ?? '').split(',').map(x => x.trim()).filter(Boolean);
				total += Math.max(1, dims.length);
				people.add(r.targetUserId);
				if (me && r.targetUserId === me.id) for (const d of dims) myReceived.push(d);
				if (me && r.authorId === me.id) myGiven.set(r.targetUserId, dims);
				for (const d of dims) {
					const c = cats.get(d) ?? { count: 0, recipients: new Set<string>(), givers: new Set<string>(), byGiver: new Map<string, number>(), byRecipient: new Map<string, number>() };
					c.count++; c.recipients.add(r.targetUserId);
					// SEC-REVIEW-AUTHOR-V1: who GAVE a kudos is named only to its giver and its recipient (MeetService.reviewAuthorKnown)
					if (reviewAuthorKnown({ ...r, type: 'endorsement' }, me?.id)) { c.givers.add(r.authorId); c.byGiver.set(r.authorId, (c.byGiver.get(r.authorId) ?? 0) + 1); }
					c.byRecipient.set(r.targetUserId, (c.byRecipient.get(r.targetUserId) ?? 0) + 1);
					cats.set(d, c);
				}
			}

			// kudos-by-activity.ts:79 — pack at most 12 faces per row, never fail the payload on one bad user
			const pack = async (ids: Set<string>) => {
				const out = [];
				for (const id of [...ids].slice(0, 12)) out.push(await this.userEntityService.pack(id, me, { schema: 'UserLite' }).catch(() => null));
				return out;
			};
			const dims = [];
			for (const [dimension, c] of [...cats.entries()].sort((x, y) => y[1].count - x[1].count).slice(0, ps.limit)) {
				// KUDOS-CHAT-V1 (A-kudo-detail.01): Reclub's tap-a-dimension list — each giver / recipient with their ×count
				const counted = async (m: Map<string, number>) => { const out = []; for (const [id, n] of [...m.entries()].sort((x, y) => y[1] - x[1]).slice(0, 50)) out.push({ user: await this.userEntityService.pack(id, me, { schema: 'UserLite' }).catch(() => null), count: n }); return out; };
				dims.push({ dimension, count: c.count, recipients: await pack(c.recipients), givers: await pack(c.givers), givenBy: await counted(c.byGiver), receivedBy: await counted(c.byRecipient) });
			}

			return {
				meetId: ref.col === 'meetId' ? ref.id : null,
				competitionId: ref.col === 'competitionId' ? ref.id : null,
				total,
				people: people.size,
				dims,
				mine: { received: myReceived, given: [...myGiven.entries()].map(([userId, d]) => ({ userId, dims: d })) },
			};
		});
	}
}

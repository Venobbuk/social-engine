/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { In } from 'typeorm';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DI } from '@/di-symbols.js';
import type { MeetsRepository, MeetReviewsRepository } from '@/models/_.js';
import { MeetService } from '@/modules/meets/MeetService.js';
import { UserEntityService } from '@/core/entities/UserEntityService.js';
import { ApiError } from '@/server/api/error.js';
import { WARNING_PUBLIC_THRESHOLD } from '@/modules/meets/models/MeetReview.js';
import type { MiMeetReview } from '@/modules/meets/models/MeetReview.js';

// REVIEWS-LIST-V1 (W2-F, Reclub view-player-review 6.8: "Your Reviews" / "{{whose}}'s Reviews", Community + By you tabs).
// received: the reviews OF `userId` the viewer may see — the same rule as meets/reviews/show (MeetService.reviewsVisibleTo:
//   endorsements public; feedback to the person and its author; warnings to their author and the person until
//   WARNING_PUBLIC_THRESHOLD distinct people have warned, then public). Archived rows are the person's own business:
//   only the person sees them, and only with archived=true (Reclub's archived toggle).
// given: the reviews the signed-in viewer WROTE (Reclub "By you"), every type, newest first — nobody else's.
// Each row carries its id, type, the endorsement's kudo dimensions, the meet it came from, and what the viewer may do
// with it (canDelete = I wrote it; canArchive = it is about me and not a warning — a warning is a safety signal the
// person cannot hide). `dims` totals the visible endorsements per dimension with the distinct givers
// ("{{num}} kudos given by {{people}} people").
export const meta = {
	tags: ['meets'],
	requireCredential: false,
	res: { type: 'object', optional: false, nullable: false },
	errors: {
		credentialRequired: { message: 'Sign in to see the reviews you wrote.', code: 'CREDENTIAL_REQUIRED', id: 'b7a1c2d3-0f00-4a00-8000-0000000000a1' },
		noUser: { message: 'userId is required when signed out.', code: 'NO_USER', id: 'b7a1c2d3-0f00-4a00-8000-0000000000a2' },
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		userId: { type: 'string', format: 'misskey:id', nullable: true },
		direction: { type: 'string', enum: ['received', 'given'], default: 'received' },
		type: { type: 'string', enum: ['endorsement', 'feedback', 'warning'], nullable: true },
		archived: { type: 'boolean', default: false },
		limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
		offset: { type: 'integer', minimum: 0, default: 0 },
	},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.meetsRepository) private meetsRepository: MeetsRepository,
		@Inject(DI.meetReviewsRepository) private meetReviewsRepository: MeetReviewsRepository,
		private meetService: MeetService,
		private userEntityService: UserEntityService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const given = ps.direction === 'given';
			if (given && !me) throw new ApiError(meta.errors.credentialRequired);
			const userId = given ? me!.id : (ps.userId ?? (me ? me.id : null));
			if (!userId) throw new ApiError(meta.errors.noUser);
			const self = !!me && me.id === userId;

			let rows: MiMeetReview[];
			let warningCount = 0; let warningsPublic = false;
			if (given) {
				rows = await this.meetReviewsRepository.find({ where: { authorId: userId }, order: { createdAt: 'DESC' } });
			} else {
				const v = await this.meetService.reviewsVisibleTo(userId, me ? me.id : null);
				rows = v.reviews.filter(r => ps.archived ? self && r.archivedAt != null : r.archivedAt == null);
				warningCount = v.warningCount; warningsPublic = v.warningsPublic;
			}
			// the dimension totals are over the visible, unarchived endorsements (before the type filter and the page)
			const dims: Record<string, { count: number; people: number }> = {};
			if (!given) {
				const givers: Record<string, Set<string>> = {};
				for (const r of rows) {
					if (r.type !== 'endorsement' || !r.body || r.archivedAt) continue;
					for (const k of r.body.split(',').map(x => x.trim()).filter(Boolean)) {
						dims[k] = dims[k] ?? { count: 0, people: 0 }; dims[k].count++;
						(givers[k] = givers[k] ?? new Set()).add(r.authorId);
					}
				}
				for (const k of Object.keys(dims)) dims[k].people = givers[k].size;
			}
			const counts = { endorsement: 0, feedback: 0, warning: 0 };
			for (const r of rows) counts[r.type]++;
			if (ps.type) rows = rows.filter(r => r.type === ps.type);
			const total = rows.length;
			const page = rows.slice(ps.offset, ps.offset + ps.limit);

			const meetIds = Array.from(new Set(page.map(r => r.meetId).filter((x): x is string => !!x)));
			const meets = meetIds.length ? await this.meetsRepository.find({ where: { id: In(meetIds) }, select: { id: true, name: true, startAt: true } }) : [];
			const meetById = new Map(meets.map(m => [m.id, m]));
			// a target's own warning count (for the author's "visible to you only until N" hint on the By-you tab)
			const targetWarn = new Map<string, number>();
			if (given) {
				const tids = Array.from(new Set(page.filter(r => r.type === 'warning').map(r => r.targetUserId)));
				for (const t of tids) {
					const ws = await this.meetReviewsRepository.find({ where: { targetUserId: t, type: 'warning' }, select: { authorId: true, archivedAt: true } });
					targetWarn.set(t, new Set(ws.filter(w => !w.archivedAt).map(w => w.authorId)).size);
				}
			}
			const out = [];
			for (const r of page) {
				const other = given ? r.targetUserId : r.authorId;
				const m = r.meetId ? meetById.get(r.meetId) : undefined;
				const isPublic = r.type === 'endorsement' ? true : r.type === 'feedback' ? false : given ? (targetWarn.get(r.targetUserId) ?? 0) >= WARNING_PUBLIC_THRESHOLD : warningsPublic;
				out.push({
					id: r.id,
					type: r.type,
					body: r.body,
					dims: r.type === 'endorsement' && r.body ? r.body.split(',').map(x => x.trim()).filter(Boolean) : [],
					createdAt: r.createdAt.toISOString(),
					archived: r.archivedAt != null,
					public: isPublic,
					user: await this.userEntityService.pack(other, me, { schema: 'UserLite' }).catch(() => null),
					meet: m ? { id: m.id, name: m.name, startAt: new Date(m.startAt).toISOString() } : null,
					canDelete: !!me && r.authorId === me.id,
					canArchive: !!me && r.targetUserId === me.id && r.type !== 'warning',
				});
			}
			return { userId, direction: ps.direction, total, counts, dims, warningCount, warningsPublic, warningThreshold: WARNING_PUBLIC_THRESHOLD, rows: out };
		});
	}
}

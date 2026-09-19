/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DI } from '@/di-symbols.js';
import type { MeetReviewsRepository } from '@/models/_.js';
import { ApiError } from '@/server/api/error.js';

// REVIEWS-LIST-V1 (W2-F, Reclub E-reviews.03 `PUT /reviews/archive {is_archived}`): the person REVIEWED archives (hides)
// or restores a review about them. An archived row leaves their list and the public view (MeetService.reviewsVisibleTo
// already shows archived rows to the person only) and stops counting in the kudos boards. A warning cannot be
// archived: it is the community's safety signal, and hiding it would let a player reset the public threshold.
// The author editing the review keeps it archived (MeetService.review leaves archivedAt alone).
export const meta = {
	tags: ['meets'],
	requireCredential: true,
	prohibitMoved: true,
	kind: 'write:meets',
	res: { type: 'object', optional: false, nullable: false },
	errors: {
		// review-batch2 (found by scripts/check_error_ids.js, the guard added for #4): the SAME error as reviews/delete's
		// noSuchReview - one code, one id. It used ...c1, so NO_SUCH_REVIEW answered two ids.
		noSuchReview: { message: 'No such review.', code: 'NO_SUCH_REVIEW', id: 'b7a1c2d3-0f00-4a00-8000-0000000000b1' },
		notTarget: { message: 'Only the person reviewed can archive a review.', code: 'REVIEW_NOT_TARGET', id: 'b7a1c2d3-0f00-4a00-8000-0000000000c2' },
		warning: { message: 'A warning cannot be archived.', code: 'REVIEW_WARNING_NOT_ARCHIVABLE', id: 'b7a1c2d3-0f00-4a00-8000-0000000000c3' },
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: { reviewId: { type: 'string', format: 'misskey:id' }, archived: { type: 'boolean' } },
	required: ['reviewId', 'archived'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(@Inject(DI.meetReviewsRepository) private meetReviewsRepository: MeetReviewsRepository) {
		super(meta, paramDef, async (ps, me) => {
			const r = await this.meetReviewsRepository.findOneBy({ id: ps.reviewId });
			if (r == null) throw new ApiError(meta.errors.noSuchReview);
			if (r.targetUserId !== me.id) throw new ApiError(meta.errors.notTarget);
			if (r.type === 'warning') throw new ApiError(meta.errors.warning);
			await this.meetReviewsRepository.update(r.id, { archivedAt: ps.archived ? new Date() : null });
			return { id: r.id, archived: ps.archived };
		});
	}
}

/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DI } from '@/di-symbols.js';
import type { MeetReviewsRepository } from '@/models/_.js';
import { ApiError } from '@/server/api/error.js';

// REVIEWS-LIST-V1 (W2-F, Reclub E-reviews.05 "Update or delete my review"): the AUTHOR removes a review they wrote —
// endorsement, feedback or warning. Nobody else can (the person reviewed archives instead: meets/reviews/archive).
// A deleted warning stops counting toward the public threshold at once (reviewsVisibleTo counts live rows).
export const meta = {
	tags: ['meets'],
	requireCredential: true,
	prohibitMoved: true,
	kind: 'write:meets',
	errors: {
		noSuchReview: { message: 'No such review.', code: 'NO_SUCH_REVIEW', id: 'b7a1c2d3-0f00-4a00-8000-0000000000b1' },
		notAuthor: { message: 'Only the author can delete a review.', code: 'REVIEW_NOT_AUTHOR', id: 'b7a1c2d3-0f00-4a00-8000-0000000000b2' },
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: { reviewId: { type: 'string', format: 'misskey:id' } },
	required: ['reviewId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(@Inject(DI.meetReviewsRepository) private meetReviewsRepository: MeetReviewsRepository) {
		super(meta, paramDef, async (ps, me) => {
			const r = await this.meetReviewsRepository.findOneBy({ id: ps.reviewId });
			if (r == null) throw new ApiError(meta.errors.noSuchReview);
			if (r.authorId !== me.id) throw new ApiError(meta.errors.notAuthor);
			await this.meetReviewsRepository.delete(r.id);
		});
	}
}

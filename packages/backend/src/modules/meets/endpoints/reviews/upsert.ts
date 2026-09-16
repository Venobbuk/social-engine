/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DI } from '@/di-symbols.js';
import type { MeetsRepository } from '@/models/_.js';
import { MeetService } from '@/modules/meets/MeetService.js';
import { UserEntityService } from '@/core/entities/UserEntityService.js';
import { ApiError } from '@/server/api/error.js';
import { meetErrors, toApiError } from '@/modules/meets/endpoints/_shared.js';

// SAFETY-V1 (W3.7): Reclub's player review in one door — endorsement (public kudos), feedback (private to the person),
// warning (private until 5 distinct people have warned). Written by a confirmed participant of the meet about
// another confirmed participant; the service already enforces one row per (author, target, type). meetId is kept
// for context. Returns what the author now sees about the target.
export const meta = {
	tags: ['meets'],
	requireCredential: true,
	prohibitMoved: true,
	kind: 'write:meets',
	res: { type: 'object', optional: false, nullable: false, ref: 'PlayerReviews' },
	errors: { ...meetErrors },
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		meetId: { type: 'string', format: 'misskey:id' },
		targetUserId: { type: 'string', format: 'misskey:id' },
		type: { type: 'string', enum: ['endorsement', 'feedback', 'warning'] },
		body: { type: 'string', nullable: true, maxLength: 2048 },
	},
	required: ['meetId', 'targetUserId', 'type'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.meetsRepository)
		private meetsRepository: MeetsRepository,
		private meetService: MeetService,
		private userEntityService: UserEntityService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const meet = await this.meetsRepository.findOneBy({ id: ps.meetId });
			if (meet == null) throw new ApiError(meta.errors.noSuchMeet);
			try {
				await this.meetService.assertPlayedTogether(meet, me.id, ps.targetUserId);
				await this.meetService.review(me, ps.targetUserId, ps.type, ps.body ?? null, meet.id);
				return await this.meetService.packReviews(ps.targetUserId, me.id, this.userEntityService);
			} catch (e) {
				return toApiError(e);
			}
		});
	}
}

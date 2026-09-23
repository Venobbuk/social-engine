/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { DI } from '@/di-symbols.js';
import type { MeetsRepository } from '@/models/_.js';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { CoachScheduleService } from '@/modules/coaches/CoachScheduleService.js';
import { MeetEntityService } from '@/modules/meets/MeetEntityService.js';
import { ApiError } from '@/server/api/error.js';
import { toApiError } from '@/modules/meets/endpoints/_shared.js';
import { IdentifiableError } from '@/misc/identifiable-error.js';
import { coachErrors, toApiError as coachApiError } from './_shared.js';

// COACHING-V1 — book a SINGLE lesson. Reuses the NATIVE meet join (gate + atomic seat claim), then locks the price
// the student agreed to onto their row (research #2). Cancelling one lesson is the native meets/leave.
export const meta = {
	tags: ['coaches'],
	requireCredential: true,
	prohibitMoved: true,
	kind: 'write:meets',
	res: { type: 'object', optional: false, nullable: false, ref: 'MeetParticipant' },
	errors: { ...coachErrors, noSuchMeet: { message: 'No such lesson.', code: 'NO_SUCH_MEET', id: 'c0ac0000-0000-4000-8000-000000000021' } },
} as const;
export const paramDef = { type: 'object', properties: { meetId: { type: 'string', format: 'misskey:id' }, accessToken: { type: 'string', nullable: true }, quotedPrice: { type: 'integer', nullable: true, minimum: 0 } }, required: ['meetId'] } as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.meetsRepository) private meetsRepository: MeetsRepository,
		private coachScheduleService: CoachScheduleService,
		private meetEntityService: MeetEntityService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const meet = await this.meetsRepository.findOneBy({ id: ps.meetId });
			if (meet == null || !meet.coachScheduleId) throw new ApiError(meta.errors.noSuchMeet);
			try {
				const p = await this.coachScheduleService.bookSingle(meet, me, ps.accessToken ?? null, ps.quotedPrice ?? null);   // GROUP-PRICE-V1: the price the confirm sheet showed
				return await this.meetEntityService.packParticipant(p, meet, me);
			} catch (e) {
				// the service's own coach:* refusals (price_changed, not_a_lesson, not_available) speak the coach catalogue; the
				// native join's meet:* refusals keep the meet one
				if (e instanceof IdentifiableError && e.id.startsWith('coach:')) return coachApiError(e);
				return toApiError(e);
			}
		});
	}
}

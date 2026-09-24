/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DI } from '@/di-symbols.js';
import type { MeetsRepository } from '@/models/_.js';
import { MeetService } from '@/modules/meets/MeetService.js';
import { UserEntityService } from '@/core/entities/UserEntityService.js';
import { ApiError } from '@/server/api/error.js';
import { meetErrors, toApiError } from '@/modules/meets/endpoints/_shared.js';
import { MAX_KUDOS_PER_REVIEW } from '@/modules/meets/models/MeetReview.js';
import { competedTogether } from '@/modules/meets/kudos-ref.js';
import { NotificationService } from '@/core/NotificationService.js';
import { socialMuted } from '@/modules/account/social-mute.js';   // SOCIAL-NOTIF-V1 (account-rest)

// SAFETY-V1 (W3.7): Reclub's player review in one door — endorsement (public kudos), feedback (private to the person),
// warning (private until 5 distinct people have warned). Written by a confirmed participant of the meet about
// another confirmed participant; the service already enforces one row per (author, target, type). meetId is kept
// for context. Returns what the author now sees about the target.
// KUDOS-CHAT-V1 (EXTENDED): an endorsement is per ACTIVITY — a meet (meetId) or an ended competition (competitionId,
// Reclub give-competition-kudos; both players on a confirmed entry). At most MAX_KUDOS_PER_REVIEW dimensions (the
// app's 3-cap, now also enforced here), and an optional public note ("Any additional notes?").
export const meta = {
	tags: ['meets'],
	requireCredential: true,
	prohibitMoved: true,
	kind: 'write:meets',
	res: { type: 'object', optional: false, nullable: false, ref: 'PlayerReviews' },
	errors: {
		...meetErrors,
		noReference: { message: 'Say which meet or competition this review is about.', code: 'REVIEW_NO_REFERENCE', id: 'c2d0a6f1-7a51-4d39-9c3e-0000000000c1' },
		competitionNotEnded: { message: 'Kudos open when the competition has ended.', code: 'COMPETITION_NOT_ENDED', id: 'c2d0a6f1-7a51-4d39-9c3e-0000000000c2' },
		noSuchCompetition: { message: 'No such competition.', code: 'NO_SUCH_COMPETITION', id: 'c2d0a6f1-7a51-4d39-9c3e-0000000000c3' },
		tooManyKudos: { message: 'Pick up to 3 kudos.', code: 'TOO_MANY_KUDOS', id: 'c2d0a6f1-7a51-4d39-9c3e-0000000000c4' },
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		meetId: { type: 'string', format: 'misskey:id', nullable: true },
		competitionId: { type: 'string', format: 'misskey:id', nullable: true },   // KUDOS-CHAT-V1
		targetUserId: { type: 'string', format: 'misskey:id' },
		type: { type: 'string', enum: ['endorsement', 'feedback', 'warning'] },
		body: { type: 'string', nullable: true, maxLength: 2048 },
		note: { type: 'string', nullable: true, maxLength: 512 },   // KUDOS-CHAT-V1: endorsement only
	},
	required: ['targetUserId', 'type'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.db)
		private db: DataSource,
		@Inject(DI.meetsRepository)
		private meetsRepository: MeetsRepository,
		private meetService: MeetService,
		private userEntityService: UserEntityService,
		private notificationService: NotificationService,   // SOCIAL-NOTIF-V1
	) {
		super(meta, paramDef, async (ps, me) => {
			/* SOCIAL-NOTIF-V1 (lane account-rest, Reclub E-notif-settings.04): a NEW kudos / feedback tells the person unless
			 * Settings › Social is off; an edit of an existing one does not ping again (MeetService.review keeps the row's
			 * createdAt); a warning never notifies — its author is anonymous to the person warned (G15.4). */
			const t0 = Date.now();
			const tell = (row: { createdAt: Date }, target: string, type: string, where: string) => {
				if (type === 'warning' || new Date(row.createdAt).getTime() < t0 - 1000) return;
				const who = me.name ?? me.username;
				void socialMuted(this.db, target).then((muted) => {
					if (muted) return;
					this.notificationService.createNotification(target, 'app', type === 'endorsement'
						? { customHeader: 'Kudos', customBody: `${who} gave you kudos after ${where}.`, customIcon: null, appAccessTokenId: null, customLink: 'reviews:' + target }
						: { customHeader: 'Feedback', customBody: `${who} left you feedback after ${where}.`, customIcon: null, appAccessTokenId: null, customLink: 'reviews:' + target }, me.id);
				});
			};
			if (ps.type === 'endorsement' && ps.body && ps.body.split(',').map(x => x.trim()).filter(Boolean).length > MAX_KUDOS_PER_REVIEW) throw new ApiError(meta.errors.tooManyKudos);
			const note = ps.type === 'endorsement' && ps.note && ps.note.trim() ? ps.note.trim() : null;
			if (ps.competitionId) {
				// a competition carries kudos only (an endorsement); feedback / warning stay on a meet the pair played
				if (ps.type !== 'endorsement') throw new ApiError(meta.errors.noReference);
				if (ps.targetUserId === me.id) throw new ApiError(meta.errors.invalidTransition);
				const ok = await competedTogether(this.db, ps.competitionId, me.id, ps.targetUserId);
				if (!ok.ok) throw new ApiError(ok.code === 'no_such_competition' ? meta.errors.noSuchCompetition : ok.code === 'not_ended' ? meta.errors.competitionNotEnded : meta.errors.notParticipant);
				try {
					const rv = await this.meetService.review(me, ps.targetUserId, 'endorsement', ps.body ?? null, null, { competitionId: ps.competitionId, note });
					const cn = (await this.db.query('SELECT name FROM "competition" WHERE id = $1', [ps.competitionId]) as { name: string }[])[0];
					tell(rv, ps.targetUserId, 'endorsement', cn ? cn.name : 'a competition');
					return await this.meetService.packReviews(ps.targetUserId, me.id, this.userEntityService, { competitionId: ps.competitionId });
				} catch (e) {
					return toApiError(e);
				}
			}
			if (!ps.meetId) throw new ApiError(meta.errors.noReference);
			const meet = await this.meetsRepository.findOneBy({ id: ps.meetId });
			if (meet == null) throw new ApiError(meta.errors.noSuchMeet);
			try {
				await this.meetService.assertPlayedTogether(meet, me.id, ps.targetUserId);
				const rv = await this.meetService.review(me, ps.targetUserId, ps.type, ps.body ?? null, meet.id, { note });
				tell(rv, ps.targetUserId, ps.type, meet.name);
				return await this.meetService.packReviews(ps.targetUserId, me.id, this.userEntityService, { meetId: meet.id });
			} catch (e) {
				return toApiError(e);
			}
		});
	}
}

/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { In } from 'typeorm';
import { DI } from '@/di-symbols.js';
import type { MeetsRepository, MeetParticipantsRepository, MeetPlayerLevelsRepository, UsersRepository } from '@/models/_.js';
import type { Packed } from '@/misc/json-schema.js';
import type { MiUser } from '@/models/User.js';
import type { MiMeet } from '@/modules/meets/models/Meet.js';
import type { MiMeetParticipant } from '@/modules/meets/models/MeetParticipant.js';
import type { MiMeetMatch } from '@/modules/meets/models/MeetMatch.js';
import { bindThis } from '@/decorators.js';
import { IdService } from '@/core/IdService.js';
import { MeetService } from '@/modules/meets/MeetService.js';
import { MeetLevelService } from '@/modules/meets/MeetLevelService.js';
import { MeetMatchService } from '@/modules/meets/MeetMatchService.js';
import { UserEntityService } from '@/core/entities/UserEntityService.js';
import { ChannelEntityService } from '@/core/entities/ChannelEntityService.js';

const ACTIVE_STATUSES = ['requested', 'invited', 'confirmed', 'waitlisted', 'hold', 'maybe'];

@Injectable()
export class MeetEntityService {
	constructor(
		@Inject(DI.meetsRepository)
		private meetsRepository: MeetsRepository,
		@Inject(DI.meetParticipantsRepository)
		private meetParticipantsRepository: MeetParticipantsRepository,
		@Inject(DI.meetPlayerLevelsRepository)
		private meetPlayerLevelsRepository: MeetPlayerLevelsRepository,
		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,
		private userEntityService: UserEntityService,
		private channelEntityService: ChannelEntityService,
		private meetService: MeetService,
		private meetLevelService: MeetLevelService,
		private meetMatchService: MeetMatchService,
		private idService: IdService,
	) {
	}

	@bindThis
	public async packParticipant(p: MiMeetParticipant, meet: MiMeet, me?: { id: MiUser['id'] } | null): Promise<Packed<'MeetParticipant'>> {
		const user = p.userId ? await this.userEntityService.pack(p.userId, me) : null;
		const level = p.userId ? await this.meetPlayerLevelsRepository.findOneBy({ userId: p.userId, sport: meet.sport }) : null;
		return {
			id: p.id,
			meetId: p.meetId,
			userId: p.userId,
			user,
			kind: p.kind,
			sponsorId: p.sponsorId,
			displayName: p.displayName ?? user?.name ?? user?.username ?? null,
			declaredLevel: p.declaredLevel,
			status: p.status,
			waitlistRank: p.waitlistRank,
			extGender: p.extGender ?? null,
			extAge: p.extAge ?? null,
			positionId: p.positionId ?? null,
			paymentType: p.paymentType ?? null,
			isHost: p.isHost,
			isCoach: p.isCoach,
			isReferee: p.isReferee,
			isPaymentCollector: p.isPaymentCollector,
			tags: p.tags,
			teamKey: p.teamKey,
			courtIndex: p.courtIndex,
			level: p.declaredLevel ?? this.meetLevelService.levelValue(level, meet.levelBasis),
			statusChangedAt: p.statusChangedAt?.toISOString() ?? null,
			checkedInAt: p.checkedInAt?.toISOString() ?? null,
		};
	}

	@bindThis
	public async pack(
		src: MiMeet['id'] | MiMeet,
		me?: { id: MiUser['id'] } | null | undefined,
		opts?: { detailed?: boolean; distanceKm?: number | null },
	): Promise<Packed<'Meet'>> {
		const meet = typeof src === 'object' ? src : await this.meetsRepository.findOneByOrFail({ id: src });
		const counts = await this.meetService.counts(meet.id);
		const spotsLeft = Math.max(0, meet.capacity - meet.confirmed); // MEET-V4: the counter is the fact; hold never held a seat

		let myStatus: Packed<'Meet'>['myStatus'] = null;
		let myGate: Packed<'Meet'>['myGate'] = null;
		let isHost = false;
		if (me) {
			const mine = await this.meetParticipantsRepository.findOneBy({ meetId: meet.id, userId: me.id });
			myStatus = mine?.status ?? null;
			isHost = meet.hostId === me.id || (mine?.isHost ?? false);
			const level = await this.meetPlayerLevelsRepository.findOneBy({ userId: me.id, sport: meet.sport });
			myGate = this.meetLevelService.gateVerdict(meet, level);
		}

		const host = await this.userEntityService.pack(meet.hostId, me);
		const channel = meet.channelId ? await this.channelEntityService.pack(meet.channelId, me) : null;

		let participants: Packed<'MeetParticipant'>[] | undefined = undefined;
		if (opts?.detailed) {
			const rows = await this.meetParticipantsRepository.find({
				where: { meetId: meet.id, status: In(ACTIVE_STATUSES) },
				order: { isHost: 'DESC', statusChangedAt: 'ASC' },
			});
			participants = await Promise.all(rows.map(r => this.packParticipant(r, meet, me)));
		}

		return {
			id: meet.id,
			createdAt: this.idService.parse(meet.id).date.toISOString(),
			referenceCode: meet.referenceCode,
			hostId: meet.hostId,
			host,
			channelId: meet.channelId,
			channel,
			chatRoomId: (me && (isHost || myStatus === 'confirmed')) ? meet.chatRoomId : null,
			type: meet.type,
			sport: meet.sport,
			format: meet.format,
			name: meet.name,
			notes: meet.notes,
			startAt: meet.startAt.toISOString(),
			endAt: new Date(meet.startAt.getTime() + meet.durationMinutes * 60_000).toISOString(),
			durationMinutes: meet.durationMinutes,
			timezone: meet.timezone,
			venueName: meet.venueName,
			venueAddress: meet.venueAddress,
			lat: meet.lat,
			lng: meet.lng,
			venueRef: meet.venueRef,
			distanceKm: opts?.distanceKm ?? null,
			capacity: meet.capacity,
			hostPlays: meet.hostPlays,
			visibility: meet.visibility,
			status: meet.status,
			isPast: this.meetService.isPast(meet),
			autoApprove: meet.autoApprove,
			allowPlusOne: meet.allowPlusOne,
			feeType: meet.feeType,
			feeAmount: meet.feeAmount,
			feeCurrency: meet.feeCurrency,
			paymentInfo: (me && (isHost || myStatus === 'confirmed' || myStatus === 'hold')) ? meet.paymentInfo : null,
			confirmed: meet.confirmed,
			duprAccountGate: meet.duprAccountGate,
			repeatInterval: meet.repeatInterval,
			repeatCount: meet.repeatCount,
			blindTeamsMinutes: meet.blindTeamsMinutes,
			allowPlayerScoring: meet.allowPlayerScoring,
			sendNotifications: meet.sendNotifications,
			rosterVisibility: meet.rosterVisibility,
			flags: meet.flags,
			venueId: meet.venueId,
			cancellationFreezeHours: meet.cancellationFreezeHours,
			gateType: meet.gateType,
			levelBasis: meet.levelBasis,
			minLevel: meet.minLevel,
			maxLevel: meet.maxLevel,
			gender: meet.gender,
			ageGroup: meet.ageGroup,
			submitMatches: meet.submitMatches,
			seriesId: meet.seriesId,
			confirmedCount: counts.confirmed,
			waitlistedCount: counts.waitlisted,
			requestedCount: counts.requested,
			spotsLeft,
			myStatus,
			myGate,
			isHost,
			participants,
			safety: me ? await this.meetService.safetyContext(meet, me.id).catch(() => null) : null,
		};
	}

	/** MEET-MATCH-V1: Reclub match card — isPending, winner by games won, canManage/canUpdateScore, DUPR badge. */
	@bindThis
	public async packMatch(m: MiMeetMatch, meet: MiMeet, me?: MiUser | null, opts: { eligibility?: boolean } = {}): Promise<Packed<'MeetMatch'>> {
		const isHost = me ? await this.meetMatchService.isHost(meet, me) : false;
		const canUpdateScore = me ? (isHost || await this.meetMatchService.canUpdateScore(meet, m, me)) : false;
		let w1 = 0, w2 = 0;
		for (const [a, b] of m.scores) { if (a > b) w1++; else if (b > a) w2++; }
		const winnerTeam = m.scores.length === 0 || w1 === w2 ? null : (w1 > w2 ? 1 : 2);
		return {
			id: m.id,
			meetId: m.meetId,
			round: m.round,
			courtIndex: m.courtIndex,
			team1Ids: m.team1Ids,
			team2Ids: m.team2Ids,
			scores: m.scores,
			isPending: m.scores.length === 0,
			winnerTeam,
			canUpdateScore: canUpdateScore && m.duprStatus !== 'submitted',
			canManage: isHost,
			duprStatus: m.duprStatus,
			duprSubmittedBy: m.duprSubmittedById ? await this.userEntityService.pack(m.duprSubmittedById, me, { schema: 'UserLite' }).catch(() => null) : null,
			duprSubmittedAt: m.duprSubmittedAt ? m.duprSubmittedAt.toISOString() : null,
			duprRef: m.duprRef,
			duprError: m.duprError,
			duprEligibility: opts.eligibility ? await this.meetMatchService.eligibility(meet, m).then(e => ({ isEligible: e.isEligible, errors: e.errors })) : undefined,
			updatedAt: m.updatedAt.toISOString(),
		};
	}

	@bindThis
	public async packMany(meets: MiMeet[], me?: { id: MiUser['id'] } | null | undefined, distances?: Map<MiMeet['id'], number>): Promise<Packed<'Meet'>[]> {
		return await Promise.all(meets.map(m => this.pack(m, me, { detailed: false, distanceKm: distances?.get(m.id) ?? null })));
	}
}

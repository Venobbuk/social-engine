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
import { bindThis } from '@/decorators.js';
import { IdService } from '@/core/IdService.js';
import { MeetService } from '@/modules/meets/MeetService.js';
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
			holdExpiresAt: p.holdExpiresAt?.toISOString() ?? null,
			isHost: p.isHost,
			isCoach: p.isCoach,
			isReferee: p.isReferee,
			isPaymentCollector: p.isPaymentCollector,
			tags: p.tags,
			teamKey: p.teamKey,
			courtIndex: p.courtIndex,
			level: p.declaredLevel ?? this.meetService.levelValue(level, meet.levelBasis),
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
		const spotsLeft = Math.max(0, meet.capacity - counts.confirmed - counts.hold);

		let myStatus: Packed<'Meet'>['myStatus'] = null;
		let myGate: Packed<'Meet'>['myGate'] = null;
		let isHost = false;
		if (me) {
			const mine = await this.meetParticipantsRepository.findOneBy({ meetId: meet.id, userId: me.id });
			myStatus = mine?.status ?? null;
			isHost = meet.hostId === me.id || (mine?.isHost ?? false);
			const level = await this.meetPlayerLevelsRepository.findOneBy({ userId: me.id, sport: meet.sport });
			myGate = this.meetService.gateVerdict(meet, level);
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
			guestsPerMember: meet.guestsPerMember,
			feeType: meet.feeType,
			feeAmount: meet.feeAmount,
			feeCurrency: meet.feeCurrency,
			paymentInfo: (me && (isHost || myStatus === 'confirmed' || myStatus === 'hold')) ? meet.paymentInfo : null,
			payByMinutes: meet.payByMinutes,
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
		};
	}

	@bindThis
	public async packMany(meets: MiMeet[], me?: { id: MiUser['id'] } | null | undefined, distances?: Map<MiMeet['id'], number>): Promise<Packed<'Meet'>[]> {
		return await Promise.all(meets.map(m => this.pack(m, me, { detailed: false, distanceKm: distances?.get(m.id) ?? null })));
	}
}

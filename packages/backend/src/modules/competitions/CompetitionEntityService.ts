/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { In } from 'typeorm';
import { DI } from '@/di-symbols.js';
import type { CompetitionEntriesRepository, CompetitionMatchesRepository, UsersRepository } from '@/models/_.js';
import type { MiUser } from '@/models/User.js';
import { bindThis } from '@/decorators.js';
import { IdService } from '@/core/IdService.js';
import { UserEntityService } from '@/core/entities/UserEntityService.js';
import { CompetitionService } from './CompetitionService.js';
import type { MiCompetition } from './models/Competition.js';
import type { MiCompetitionEntry } from './models/CompetitionEntry.js';
import type { MiCompetitionMatch } from './models/CompetitionMatch.js';
import type { MiCompetitionAward } from './models/CompetitionAward.js';

/** TOURNAMENT-V1 — the API shapes of a competition, its entries, matches and awards. Loose objects (no Packed schema). */
@Injectable()
export class CompetitionEntityService {
	constructor(
		@Inject(DI.competitionEntriesRepository)
		private entriesRepository: CompetitionEntriesRepository,
		@Inject(DI.competitionMatchesRepository)
		private matchesRepository: CompetitionMatchesRepository,
		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,
		private userEntityService: UserEntityService,
		private competitionService: CompetitionService,
		private idService: IdService,
	) {}

	private async usersLite(ids: string[], me?: { id: MiUser['id'] } | null): Promise<Record<string, unknown>[]> {
		if (!ids.length) return [];
		const users = await this.usersRepository.findBy({ id: In(ids) });
		const packed = await this.userEntityService.packMany(users, me, { schema: 'UserLite' });
		const byId = new Map(packed.map((u) => [u.id, u]));
		return ids.map((id) => byId.get(id)).filter((u): u is NonNullable<typeof u> => u != null) as Record<string, unknown>[];
	}

	@bindThis
	public async packEntry(e: MiCompetitionEntry, me?: { id: MiUser['id'] } | null): Promise<Record<string, unknown>> {
		return {
			id: e.id, competitionId: e.competitionId, name: e.name, captainId: e.captainId, userIds: e.userIds,
			users: await this.usersLite(e.userIds, me),
			seed: e.seed, pool: e.pool, status: e.status, isPaid: e.isPaid, notes: e.notes,
			isMine: !!me && e.userIds.includes(me.id),
			createdAt: e.createdAt.toISOString(), statusChangedAt: e.statusChangedAt.toISOString(),
		};
	}

	@bindThis
	public async packEntries(es: MiCompetitionEntry[], me?: { id: MiUser['id'] } | null): Promise<Record<string, unknown>[]> {
		return await Promise.all(es.map((e) => this.packEntry(e, me)));
	}

	@bindThis
	public async packMatch(m: MiCompetitionMatch, c: MiCompetition, me?: { id: MiUser['id'] } | null): Promise<Record<string, unknown>> {
		return {
			id: m.id, competitionId: m.competitionId, stage: m.stage, pool: m.pool, round: m.round, number: m.number,
			bracketId: m.bracketId, bracketGroup: m.bracketGroup,
			entry1Id: m.entry1Id, entry2Id: m.entry2Id, entry1Status: m.entry1Status, entry2Status: m.entry2Status,
			status: m.status, scores: m.scores, result: m.result, courtIndex: m.courtIndex,
			startAt: m.startAt?.toISOString() ?? null, notes: m.notes, isExtra: m.isExtra,
			canScore: c.status === 'inProgress' && m.entry1Id != null && m.entry2Id != null && m.entry1Status !== 'bye' && m.entry2Status !== 'bye' && await this.competitionService.canScore(c, m, me?.id),
			updatedAt: m.updatedAt.toISOString(),
		};
	}

	@bindThis
	public async packAward(a: MiCompetitionAward, me?: { id: MiUser['id'] } | null): Promise<Record<string, unknown>> {
		const entry = a.entryId ? await this.entriesRepository.findOneBy({ id: a.entryId }) : null;
		return {
			id: a.id, competitionId: a.competitionId, type: a.type, name: a.name, description: a.description,
			entryId: a.entryId, entry: entry ? await this.packEntry(entry, me) : null, userIds: a.userIds, enabled: a.enabled,
			awardedAt: a.awardedAt?.toISOString() ?? null, createdAt: a.createdAt.toISOString(),
		};
	}

	@bindThis
	public async pack(c: MiCompetition, me?: MiUser | null, opts: { detailed?: boolean } = {}): Promise<Record<string, unknown>> {
		const isHost = this.competitionService.isHost(c, me?.id);
		const counts = await this.entriesRepository.createQueryBuilder('e').select('e.status', 'status').addSelect('COUNT(*)', 'n').where('e."competitionId" = :cid', { cid: c.id }).groupBy('e.status').getRawMany<{ status: string; n: string }>();
		const n = (s: string) => Number(counts.find((r) => r.status === s)?.n ?? 0);
		const myEntry = me ? await this.competitionService.myEntry(c, me.id) : null;
		const hasDraw = await this.matchesRepository.existsBy({ competitionId: c.id });
		const now = Date.now();
		const registrationOpen = c.status === 'open' && !c.lockRegistration && !(c.registrationOpenAt && c.registrationOpenAt.getTime() > now) && !(c.registrationCloseAt && c.registrationCloseAt.getTime() < now);
		const base: Record<string, unknown> = {
			id: c.id, referenceCode: c.referenceCode, hostId: c.hostId,
			host: await this.userEntityService.pack(c.hostId, me, { schema: 'UserLite' }).catch(() => null),
			channelId: c.channelId, chatRoomId: (isHost || myEntry) ? c.chatRoomId : null,
			sport: c.sport, name: c.name, notes: c.notes, format: c.format, participantType: c.participantType,
			teamMinSize: c.teamMinSize, teamMaxSize: c.teamMaxSize, maxEntries: c.maxEntries,
			registrationOpenAt: c.registrationOpenAt?.toISOString() ?? null, registrationCloseAt: c.registrationCloseAt?.toISOString() ?? null,
			earlyBirdAt: c.earlyBirdAt?.toISOString() ?? null, lockRegistration: c.lockRegistration,
			startAt: c.startAt.toISOString(), durationDays: c.durationDays, timezone: c.timezone,
			venueName: c.venueName, venueAddress: c.venueAddress, lat: c.lat, lng: c.lng, venueId: c.venueId,
			feeType: c.feeType, feeAmount: c.feeAmount, feeEarlyBirdAmount: c.feeEarlyBirdAmount, feeCurrency: c.feeCurrency,
			paymentInfo: (isHost || myEntry) ? c.paymentInfo : null,
			visibility: c.visibility, accessToken: isHost ? c.accessToken : null, status: c.status,
			minLevel: c.minLevel, maxLevel: c.maxLevel, gender: c.gender, ageGroup: c.ageGroup,
			numGroups: c.numGroups, numContinue: c.numContinue, thirdPlaceMatch: c.thirdPlaceMatch, setsPerMatch: c.setsPerMatch, forfeitWinScore: c.forfeitWinScore,
			pointCalculationType: c.pointCalculationType, standardWinPoint: c.standardWinPoint, standardLossPoint: c.standardLossPoint, drawPoint: c.drawPoint,
			tiebreakerWinPoint: c.tiebreakerWinPoint, tiebreakerLossPoint: c.tiebreakerLossPoint, tiebreakers: c.tiebreakers,
			revealDraw: c.revealDraw, showSeeds: c.showSeeds, manualSeeding: c.manualSeeding, autoApprove: c.autoApprove,
			entriesCount: n('confirmed') + n('forfeit'), pendingCount: n('pending'), spotsLeft: Math.max(0, c.maxEntries - n('confirmed') - n('pending') - n('forfeit')),
			isHost, myEntry: myEntry ? await this.packEntry(myEntry, me) : null, hasDraw, registrationOpen,
			drawVisible: isHost || c.revealDraw || c.status === 'inProgress' || c.status === 'done',
			isPast: c.status === 'done' || c.status === 'cancelled',
			startedAt: c.startedAt?.toISOString() ?? null, endedAt: c.endedAt?.toISOString() ?? null, cancelledAt: c.cancelledAt?.toISOString() ?? null,
			createdAt: this.idService.parse(c.id).date.toISOString(), updatedAt: c.updatedAt?.toISOString() ?? null,
		};
		return base;
	}

	@bindThis
	public async packMany(cs: MiCompetition[], me?: MiUser | null): Promise<Record<string, unknown>[]> {
		return await Promise.all(cs.map((c) => this.pack(c, me)));
	}
}

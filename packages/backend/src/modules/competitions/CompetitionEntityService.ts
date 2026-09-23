/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { In } from 'typeorm';
import { DI } from '@/di-symbols.js';
import type { CompetitionEntriesRepository, CompetitionMatchesRepository, UsersRepository, DriveFilesRepository } from '@/models/_.js';
import type { MiUser } from '@/models/User.js';
import { bindThis } from '@/decorators.js';
import { IdService } from '@/core/IdService.js';
import { UserEntityService } from '@/core/entities/UserEntityService.js';
import { DriveFileEntityService } from '@/core/entities/DriveFileEntityService.js';   // COMP-T3-V1: the team avatar URL
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
		@Inject(DI.driveFilesRepository)
		private driveFilesRepository: DriveFilesRepository,
		private driveFileEntityService: DriveFileEntityService,
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

	/** COMP-T3-V1: the public URL of a team avatar (null when unset or the file is gone). */
	private async avatarUrlOf(fileId: string | null | undefined): Promise<string | null> {
		if (!fileId) return null;
		const f = await this.driveFilesRepository.findOneBy({ id: fileId });
		return f ? this.driveFileEntityService.getPublicUrl(f, 'avatar') : null;
	}

	@bindThis
	public async packEntry(e: MiCompetitionEntry, me?: { id: MiUser['id'] } | null, comp?: MiCompetition | null, elig?: { ineligibleUserIds: string[]; reasons: Record<string, string> } | null): Promise<Record<string, unknown>> {
		// COMP-W1B4: consent + open places — invited partners (not seated yet), players asking to join, completeness
		const c = comp ?? await this.competitionService.get(e.competitionId).catch(() => null);
		const invited = e.invitedUserIds ?? [], requested = e.requestedUserIds ?? [];
		// COMP-T3-V1: eligibility (batched by packEntries; a single entry computes its own) + the team avatar
		const el = elig ?? (c && e.userIds.length ? (await this.competitionService.eligibilityOf(c, [e])).get(e.id) ?? null : null);
		// the tag is public (Reclub shows "Ineligible" on the roster); WHY (a rating above the cap, no rating…) is for the
		// managers and the team's own members only
		const why = !!me && !!c && (this.competitionService.isHost(c, me.id) || e.userIds.includes(me.id));
		return {
			avatarUrl: await this.avatarUrlOf(e.avatarFileId),
			ineligibleUserIds: el ? el.ineligibleUserIds : [], eligibilityReasons: el && why ? el.reasons : {}, eligibilityOverrides: why ? (e.eligibility ?? {}) : {},
			spectator: e.status === 'spectator',
			reserved: e.reserved ?? null, positions: e.positions ?? {},   // COMP-FIXES-A
			id: e.id, competitionId: e.competitionId, name: e.name, captainId: e.captainId, userIds: e.userIds,
			users: await this.usersLite(e.userIds, me),
			invitedUserIds: invited, invitedUsers: await this.usersLite(invited, me),
			requestedUserIds: requested, requestedUsers: await this.usersLite(requested, me),
			complete: c ? this.competitionService.isComplete(c, e) : true, openSlots: c ? this.competitionService.openSlots(c, e) : 0,
			freeAgent: e.status === 'freeAgent',
			seed: e.seed, pool: e.pool, status: e.status, isPaid: e.isPaid, notes: e.notes,
			isMine: !!me && e.userIds.includes(me.id), isCaptain: !!me && e.captainId === me.id,
			isInvited: !!me && invited.includes(me.id), hasRequested: !!me && requested.includes(me.id),
			createdAt: e.createdAt.toISOString(), statusChangedAt: e.statusChangedAt.toISOString(),
		};
	}

	@bindThis
	public async packEntries(es: MiCompetitionEntry[], me?: { id: MiUser['id'] } | null, comp?: MiCompetition | null): Promise<Record<string, unknown>[]> {
		const c = comp ?? (es[0] ? await this.competitionService.get(es[0].competitionId).catch(() => null) : null);
		const elig = c ? await this.competitionService.eligibilityOf(c, es) : new Map();   // COMP-T3-V1: one levels read for the list
		// COMP-FIXES-A: invitations / spectator requests for the host, Hide roster, the gender mix
		const vis = c ? this.visibleEntriesA(c, es, me) : es;
		const packed = await Promise.all(vis.map((e) => this.packEntry(e, me, c, elig.get(e.id) ?? { ineligibleUserIds: [], reasons: {} })));
		return c ? await this.postPackA(c, vis, packed, me) : packed;
	}

	@bindThis
	public async packMatch(m: MiCompetitionMatch, c: MiCompetition, me?: { id: MiUser['id'] } | null): Promise<Record<string, unknown>> {
		// COMP-T3-V1: the match's own referees and its availability — the availability is for the people of the match
		// (its players, its referees, the managers); anyone else reads none
		const refs = m.refereeIds ?? [];
		let insider = !!me && (this.competitionService.isHost(c, me.id) || this.competitionService.isReferee(c, me.id) || refs.includes(me.id));
		if (me && !insider && (m.entry1Id || m.entry2Id)) insider = await this.entriesRepository.createQueryBuilder('e').where('e.id IN (:...ids)', { ids: [m.entry1Id, m.entry2Id].filter((x): x is string => !!x) }).andWhere(':uid = ANY(e."userIds")', { uid: me.id }).getExists();
		const availability = insider ? (m.availability ?? {}) : {};
		return {
			refereeIds: refs, referees: await this.usersLite(refs, me), isMyRef: !!me && refs.includes(me.id),
			availability, myAvailability: me ? ((m.availability ?? {})[me.id] ?? null) : null,
			id: m.id, competitionId: m.competitionId, stage: m.stage, pool: m.pool, round: m.round, number: m.number,
			bracketId: m.bracketId, bracketGroup: m.bracketGroup,
			entry1Id: m.entry1Id, entry2Id: m.entry2Id, entry1Status: m.entry1Status, entry2Status: m.entry2Status,
			status: m.status, scores: m.scores, result: m.result, courtIndex: m.courtIndex,
			startAt: m.startAt?.toISOString() ?? null, notes: m.notes, isExtra: m.isExtra,
			// COMP-DUPR-V1: the DUPR receipt, exactly as the meet's packMatch carries it
			duprStatus: m.duprStatus ?? null, duprSubmittedById: m.duprSubmittedById ?? null,
			duprSubmittedAt: m.duprSubmittedAt?.toISOString() ?? null, duprRef: m.duprRef ?? null, duprError: m.duprError ?? null,
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
		// COMP-W1B4: staff, announcements, my invitation / free-agent row
		const isReferee = this.competitionService.isReferee(c, me?.id);
		const myInvitation = me ? await this.competitionService.invitationIn(c, me.id) : null;
		const myFreeAgent = me ? await this.entriesRepository.findOneBy({ competitionId: c.id, status: 'freeAgent', captainId: me.id }) : null;
		const announcements = c.announcements ?? [];
		const authors = await this.usersLite(Array.from(new Set(announcements.map((a) => a.userId))), me);
		const authorOf = new Map(authors.map((u) => [u.id as string, u]));
		const hasDraw = await this.matchesRepository.existsBy({ competitionId: c.id });
		const now = Date.now();
		const registrationOpen = c.status === 'open' && !c.lockRegistration && !(c.registrationOpenAt && c.registrationOpenAt.getTime() > now) && !(c.registrationCloseAt && c.registrationCloseAt.getTime() < now);
		const base: Record<string, unknown> = {
			id: c.id, referenceCode: c.referenceCode, hostId: c.hostId,
			host: await this.userEntityService.pack(c.hostId, me, { schema: 'UserLite' }).catch(() => null),
			channelId: c.channelId, chatRoomId: (isHost || isReferee || myEntry) ? c.chatRoomId : null,
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
			isHost, myEntry: myEntry ? await this.packEntry(myEntry, me, c) : null, hasDraw, registrationOpen,
			isOwner: this.competitionService.isOwner(c, me?.id), isReferee,
			adminIds: c.adminIds ?? [], refereeIds: c.refereeIds ?? [],
			staff: { admins: await this.usersLite(c.adminIds ?? [], me), referees: await this.usersLite(c.refereeIds ?? [], me) },
			announcements: announcements.map((a) => ({ id: a.id, userId: a.userId, user: authorOf.get(a.userId) ?? null, text: a.text, createdAt: a.createdAt })),
			myInvitation: myInvitation ? await this.packEntry(myInvitation, me, c) : null,
			myFreeAgent: myFreeAgent ? await this.packEntry(myFreeAgent, me, c) : null,
			freeAgentsCount: n('freeAgent'),
			// COMP-T3-V1 — t3 marks an engine that carries this batch (the app shows these controls only when it is present)
			t3: 1, courtLabels: c.courtLabels ?? [], roundRobinCycles: c.roundRobinCycles ?? 1,
			feeFreeAgentAmount: c.feeFreeAgentAmount ?? null, feeFreeAgentEarlyBirdAmount: c.feeFreeAgentEarlyBirdAmount ?? null,
			membersOnly: c.membersOnly ?? false, mayJoinMembersOnly: await this.competitionService.passesMembersOnly(c, me?.id),
			stageNames: c.stageNames ?? {}, matchRules: c.matchRules ?? null,
			spectatorsCount: n('spectator'), mySpectator: me ? await this.competitionService.mySpectator(c, me.id).then((s) => (s ? { id: s.id } : null)) : null,
			...(await this.packFixesA(c, me, isHost, myEntry)),   // COMP-FIXES-A
			drawVisible: isHost || c.revealDraw || c.status === 'inProgress' || c.status === 'done',
			isPast: c.status === 'done' || c.status === 'cancelled',
			startedAt: c.startedAt?.toISOString() ?? null, endedAt: c.endedAt?.toISOString() ?? null, cancelledAt: c.cancelledAt?.toISOString() ?? null,
			createdAt: this.idService.parse(c.id).date.toISOString(), updatedAt: c.updatedAt?.toISOString() ?? null,
		};
		return base;
	}

	// ================================================================================ COMP-FIXES-A (2026-09-23)
	/** Rows a reader may see in the entries list: a host invitation or a spectator request is the host's business (and
	 *  the invitee's own). Everything else is listed as before. */
	private visibleEntriesA(c: MiCompetition, es: MiCompetitionEntry[], me?: { id: MiUser['id'] } | null): MiCompetitionEntry[] {
		const manager = !!me && this.competitionService.isHost(c, me.id);
		return es.filter((e) => (e.status !== 'invited' && e.status !== 'spectatorPending') || manager || (!!me && e.captainId === me.id));
	}

	/** Reclub "Hide roster" (a saved setting): a player sees each team's name and size, not its members — the managers,
	 *  the referees and the team's own members still see them. + the team's gender mix for the Reclub sort by gender. */
	private async postPackA(c: MiCompetition, es: MiCompetitionEntry[], packed: Record<string, unknown>[], me?: { id: MiUser['id'] } | null): Promise<Record<string, unknown>[]> {
		const insider = !!me && (this.competitionService.isHost(c, me.id) || this.competitionService.isReferee(c, me.id));
		const genders = await this.competitionService.gendersOf(c, es.flatMap((e) => e.userIds));
		return packed.map((p, i) => {
			const e = es[i];
			const gs = e.userIds.map((u) => genders.get(u) ?? null);
			const genderMix = !gs.length || gs.some((g) => g == null) ? null : gs.every((g) => g === 'female') ? 'female' : gs.every((g) => g === 'male') ? 'male' : 'mixed';
			const out: Record<string, unknown> = { ...p, genderMix, rosterCount: e.userIds.length };
			if (c.hideRoster && !insider && !(me && e.userIds.includes(me.id)) && c.participantType !== 'singles') {
				Object.assign(out, { users: [], userIds: [], invitedUsers: [], invitedUserIds: [], requestedUsers: [], requestedUserIds: [], positions: {}, rosterHidden: true, ineligibleUserIds: [] });
			}
			return out;
		});
	}

	/** The competition's COMP-FIXES-A fields: covers, saved settings, the reader's rooms / invitation / spectator request. */
	private async packFixesA(c: MiCompetition, me: MiUser | null | undefined, isHost: boolean, myEntry: MiCompetitionEntry | null): Promise<Record<string, unknown>> {
		const ids = c.coverFileIds ?? [];
		const files = ids.length ? await this.driveFilesRepository.findBy({ id: In(ids) }) : [];
		const byId = new Map(files.map((f) => [f.id, f]));
		const covers = ids.map((fid) => byId.get(fid)).filter((f): f is NonNullable<typeof f> => !!f).map((f) => ({ id: f.id, url: this.driveFileEntityService.getPublicUrl(f), thumbnailUrl: this.driveFileEntityService.getThumbnailUrl(f) }));
		const invitation = me ? await this.competitionService.hostInvitationOf(c, me.id) : null;
		const request = me ? await this.competitionService.mySpectatorRequest(c, me.id) : null;
		const counts = isHost ? await this.entriesRepository.createQueryBuilder('e').select('e.status', 'status').addSelect('COUNT(*)', 'n').where('e."competitionId" = :cid', { cid: c.id }).andWhere('e.status IN (:...st)', { st: ['invited', 'spectatorPending'] }).groupBy('e.status').getRawMany<{ status: string; n: string }>() : [];
		const n = (s: string) => Number(counts.find((r) => r.status === s)?.n ?? 0);
		return {
			fixesA: 1,
			hideRoster: c.hideRoster ?? false, spectatorAutoApprove: c.spectatorAutoApprove ?? true,
			covers, coverUrl: covers[0] ? covers[0].url : null,
			chatKinds: me ? await this.competitionService.chatKindsOf(c, me.id, myEntry) : [],
			myHostInvitation: invitation ? { id: invitation.id, invitedById: invitation.createdById, createdAt: invitation.createdAt.toISOString() } : null,
			mySpectatorRequest: request ? { id: request.id } : null,
			invitedCount: n('invited'), spectatorRequestsCount: n('spectatorPending'),
		};
	}

	@bindThis
	public async packMany(cs: MiCompetition[], me?: MiUser | null): Promise<Record<string, unknown>[]> {
		return await Promise.all(cs.map((c) => this.pack(c, me)));
	}
}

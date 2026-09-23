/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { In } from 'typeorm';
import type { DataSource } from 'typeorm';
import { DI } from '@/di-symbols.js';
import type { CompetitionsRepository, CompetitionEntriesRepository, CompetitionMatchesRepository, CompetitionAwardsRepository, UsersRepository, BlockingsRepository, DriveFilesRepository, MeetPlayerLevelsRepository } from '@/models/_.js';
import { memberExistsSql } from '@/modules/clubs/club-tiers.js';   // COMP-T3-V1: the ONE club-member rule, raw-SQL form
import type { MiUser } from '@/models/User.js';
import { IdService } from '@/core/IdService.js';
import { ChatService } from '@/core/ChatService.js';
import { NotificationService } from '@/core/NotificationService.js';
import { bindThis } from '@/decorators.js';
import { secureRndstr, L_CHARS } from '@/misc/secure-rndstr.js';
import { IdentifiableError } from '@/misc/identifiable-error.js';
import { generate as generateRoundRobin, LIMITS as RR_LIMITS } from '@/modules/meets/MeetMatchGenerator.js';
import type { MiCompetition, CompetitionFormat, CompetitionAnnouncement } from './models/Competition.js';
import type { MiCompetitionEntry } from './models/CompetitionEntry.js';
import type { MiCompetitionMatch, CompetitionScoreSet } from './models/CompetitionMatch.js';
import type { MiCompetitionAward } from './models/CompetitionAward.js';
import { computeStandings, decideResult, setsWon } from './CompetitionStandings.js';
import type { StandingsRow } from './CompetitionStandings.js';
import { createKnockoutStage, reportBracketMatch, resetBracketMatch, viewStage, bracketFinalStandings } from './CompetitionBracket.js';
import type { BracketDb, BracketMatchView } from './CompetitionBracket.js';

export type CompetitionErrorId =
	| 'not_found' | 'not_host' | 'private' | 'invalid_transition' | 'registration_closed' | 'full' | 'already_entered'
	| 'not_entered' | 'started' | 'bad_team' | 'draw_exists' | 'not_enough_entries' | 'too_many_entries' | 'no_such_match'
	| 'no_such_entry' | 'needs_winner' | 'bracket_locked' | 'stage_incomplete' | 'no_such_award' | 'forbidden'
	| 'blocked' | 'no_such_invitation' | 'team_full' | 'no_such_announcement' // COMP-W1B4
	| 'bad_timeline' | 'members_only' | 'cannot_delete' | 'no_such_file'; // COMP-T3-V1

export type StatusAction = 'publish' | 'lock' | 'reopen' | 'start' | 'finish' | 'reopenEnded' | 'reset';

export interface StandingsResult {
	pools: { pool: number | null; rows: StandingsRow[] }[];
	placements: { entryId: string; rank: number }[] | null;
	stageComplete: boolean;
}

const ENTRY_ACTIVE = ['pending', 'confirmed'] as const;

/**
 * TOURNAMENT-V1 — the competition state machine (Reclub competition lifecycle, spec_competition_dupr.md §Y.1):
 *   draft → (publish) open → (lock) closed → (start) inProgress → (finish) done;  reopen: closed → open;
 *   reopenEnded: done → inProgress;  reset: inProgress → closed (matches wiped);  cancel from any live state.
 * Entries: self sign-up while open (autoApprove decides confirmed vs pending), host add / approve / seed / pool /
 * withdraw. Draw: round robin and pool stages through the meets generator (circle method), knockout stages through
 * brackets-manager (CompetitionBracket). Results: score sets + forfeits decide a match; a knockout result is reported
 * to the bracket which advances the winner. Standings: CompetitionStandings. Awards: written at finish from the
 * placements (1st–4th) and editable by the host; a profile reads them through users/show `placements`.
 */
@Injectable()
export class CompetitionService {
	constructor(
		@Inject(DI.competitionsRepository)
		private competitionsRepository: CompetitionsRepository,
		@Inject(DI.competitionEntriesRepository)
		private entriesRepository: CompetitionEntriesRepository,
		@Inject(DI.competitionMatchesRepository)
		private matchesRepository: CompetitionMatchesRepository,
		@Inject(DI.competitionAwardsRepository)
		private awardsRepository: CompetitionAwardsRepository,
		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,
		@Inject(DI.blockingsRepository)
		private blockingsRepository: BlockingsRepository,   // COMP-W1B4: partner consent is block-aware
		@Inject(DI.db)
		private db: DataSource,   // COMP-T3-V1: club membership (memberExistsSql) + the publish audience
		@Inject(DI.driveFilesRepository)
		private driveFilesRepository: DriveFilesRepository,   // COMP-T3-V1: the team avatar is a drive file of its setter
		@Inject(DI.meetPlayerLevelsRepository)
		private meetPlayerLevelsRepository: MeetPlayerLevelsRepository,   // COMP-T3-V1: automatic eligibility reads the meets' levels
		private idService: IdService,
		private chatService: ChatService,
		private notificationService: NotificationService,
	) {}

	private err(id: CompetitionErrorId, message: string): IdentifiableError { return new IdentifiableError(`competition:${id}`, message); }

	// ------------------------------------------------------------------------------------------------ reads
	@bindThis
	public async get(id: string): Promise<MiCompetition> {
		const c = await this.competitionsRepository.findOneBy({ id });
		if (!c) throw this.err('not_found', 'No such competition.');
		return c;
	}

	@bindThis
	// COMP-W1B4: a co-admin (Reclub competition Admins) manages the competition exactly like its host, so every host gate
	// below admits them; isOwner is the creator alone (staff changes cannot remove the owner).
	public isHost(c: MiCompetition, userId: string | null | undefined): boolean { return !!userId && (c.hostId === userId || (c.adminIds ?? []).includes(userId)); }

	@bindThis
	public isOwner(c: MiCompetition, userId: string | null | undefined): boolean { return !!userId && c.hostId === userId; }

	/** COMP-W1B4: a referee (Reclub competition Referees) may score and finalize any match. */
	@bindThis
	public isReferee(c: MiCompetition, userId: string | null | undefined): boolean { return !!userId && (c.refereeIds ?? []).includes(userId); }

	@bindThis
	public async myEntry(c: MiCompetition, userId: string | null | undefined): Promise<MiCompetitionEntry | null> {
		if (!userId) return null;
		const rows = await this.entriesRepository.createQueryBuilder('e')
			.where('e."competitionId" = :cid', { cid: c.id })
			.andWhere(':uid = ANY(e."userIds")', { uid: userId })
			.andWhere('e.status IN (:...st)', { st: ['pending', 'confirmed', 'forfeit'] })
			.orderBy('e."createdAt"', 'DESC').getMany();
		return rows[0] ?? null;
	}

	/** Visibility gate (Reclub "This competition is private / Only participants can access."). */
	@bindThis
	public async assertVisible(c: MiCompetition, me: MiUser | null, accessToken?: string | null): Promise<void> {
		if (c.visibility === 'public') return;
		if (me && this.isHost(c, me.id)) return;
		if (accessToken && c.accessToken && accessToken === c.accessToken) return;
		if (me && await this.myEntry(c, me.id)) return;
		if (me && (this.isReferee(c, me.id) || await this.hasPendingRole(c, me.id))) return;   // COMP-W1B4
		throw this.err('private', 'This competition is private, only invited people and participants can see.');
	}

	@bindThis
	public async entries(c: MiCompetition): Promise<MiCompetitionEntry[]> {
		return await this.entriesRepository.find({ where: { competitionId: c.id }, order: { seed: 'ASC', createdAt: 'ASC' } });
	}

	@bindThis
	public async confirmedEntries(c: MiCompetition): Promise<MiCompetitionEntry[]> {
		const all = await this.entries(c);
		// COMP-W1B4: an incomplete team (an invited partner has not accepted) is not drawn
		const confirmed = all.filter((e) => (e.status === 'confirmed' || e.status === 'forfeit') && this.isComplete(c, e));
		// seeded first (1..n), then unseeded in sign-up order
		return confirmed.sort((a, b) => (a.seed ?? 1e9) - (b.seed ?? 1e9) || a.createdAt.getTime() - b.createdAt.getTime());
	}

	@bindThis
	public async matches(c: MiCompetition): Promise<MiCompetitionMatch[]> {
		return await this.matchesRepository.find({ where: { competitionId: c.id }, order: { stage: 'ASC', pool: 'ASC', round: 'ASC', number: 'ASC' } });
	}

	@bindThis
	public async awards(c: MiCompetition): Promise<MiCompetitionAward[]> {
		return await this.awardsRepository.find({ where: { competitionId: c.id }, order: { createdAt: 'ASC' } });
	}

	@bindThis
	public async list(me: MiUser | null, q: { scope: 'discover' | 'mine' | 'hosting' | 'club'; channelId?: string | null; includePast?: boolean; includeDraft?: boolean; limit: number; offset: number }): Promise<MiCompetition[]> {
		const qb = this.competitionsRepository.createQueryBuilder('c');
		if (q.scope === 'discover') {
			qb.where('c.visibility = :v', { v: 'public' }).andWhere('c.status IN (:...st)', { st: q.includePast ? ['open', 'closed', 'inProgress', 'done'] : ['open', 'closed', 'inProgress'] });
		} else if (q.scope === 'hosting') {
			if (!me) return [];
			qb.where('(c."hostId" = :me OR :me = ANY(c."adminIds"))', { me: me.id });   // COMP-W1B4: co-admins
			if (!q.includePast) qb.andWhere('c.status NOT IN (:...st)', { st: ['done', 'cancelled'] });
		} else if (q.scope === 'mine') {
			if (!me) return [];
			qb.where('(c."hostId" = :me OR EXISTS (SELECT 1 FROM competition_entry e WHERE e."competitionId" = c.id AND :me = ANY(e."userIds") AND e.status IN (\'pending\',\'confirmed\',\'forfeit\')))', { me: me.id });
			if (!q.includePast) qb.andWhere('c.status NOT IN (:...st)', { st: ['done', 'cancelled'] });
		} else {
			qb.where('c."channelId" = :ch', { ch: q.channelId ?? '' }).andWhere('c.status IN (:...st)', { st: q.includePast ? ['open', 'closed', 'inProgress', 'done'] : ['open', 'closed', 'inProgress'] });
		}
		return await qb.orderBy('c."startAt"', 'ASC').addOrderBy('c.id', 'ASC').take(q.limit).skip(q.offset).getMany();
	}

	// ------------------------------------------------------------------------------------------ lifecycle
	@bindThis
	public async create(host: MiUser, data: Partial<MiCompetition> & Pick<MiCompetition, 'name' | 'startAt'>): Promise<MiCompetition> {
		this.assertTimeline(data);   // COMP-T3-V1
		if (data.courtLabels) data.courtLabels = this.cleanLabels(data.courtLabels);
		const id = this.idService.gen();
		let referenceCode = secureRndstr(8, { chars: L_CHARS });
		while (await this.competitionsRepository.existsBy({ referenceCode })) referenceCode = secureRndstr(8, { chars: L_CHARS });
		const room = await this.chatService.createRoom(host, { name: data.name, description: 'Competition chat' });
		const sizes = this.teamSizes(data.participantType ?? 'singles', data.teamMinSize, data.teamMaxSize);
		return await this.competitionsRepository.insertOne({
			id, referenceCode, hostId: host.id, chatRoomId: room.id, accessToken: secureRndstr(16), status: 'draft', bracketData: null,
			...data, ...sizes, updatedAt: new Date(),
		});
	}

	private teamSizes(type: MiCompetition['participantType'], min?: number | null, max?: number | null): { teamMinSize: number; teamMaxSize: number } {
		if (type === 'singles') return { teamMinSize: 1, teamMaxSize: 1 };
		if (type === 'doubles') return { teamMinSize: 2, teamMaxSize: 2 };
		const lo = Math.max(2, min ?? 2), hi = Math.max(lo, max ?? Math.max(lo, 5));
		return { teamMinSize: lo, teamMaxSize: hi };
	}

	@bindThis
	public async update(c: MiCompetition, host: MiUser, data: Partial<MiCompetition>): Promise<MiCompetition> {
		if (!this.isHost(c, host.id)) throw this.err('not_host', 'Only the host can do this.');
		const drawn = await this.matchesRepository.existsBy({ competitionId: c.id });
		const structural = (['format', 'participantType', 'numGroups', 'numContinue', 'teamMinSize', 'teamMaxSize', 'roundRobinCycles'] as const).filter((k) => data[k] !== undefined && data[k] !== c[k]);
		if (drawn && structural.length) throw this.err('draw_exists', 'The draw is generated — reset the competition before changing its format.');
		// COMP-T3-V1: the timeline is checked when a date of it changes (a row saved before the rule still edits its notes)
		if ((['registrationOpenAt', 'earlyBirdAt', 'registrationCloseAt', 'startAt'] as const).some((k) => data[k] !== undefined)) this.assertTimeline({ ...c, ...data });
		if (data.courtLabels) data.courtLabels = this.cleanLabels(data.courtLabels);
		const type = (data.participantType ?? c.participantType) as MiCompetition['participantType'];
		const sizes = this.teamSizes(type, data.teamMinSize ?? c.teamMinSize, data.teamMaxSize ?? c.teamMaxSize);
		await this.competitionsRepository.update(c.id, { ...data, ...sizes, updatedAt: new Date() });
		if (data.name && c.chatRoomId) { const room = await this.chatService.findRoomById(c.chatRoomId); if (room) await this.chatService.updateRoom(room, { name: data.name }).catch(() => undefined); }
		return await this.get(c.id);
	}

	@bindThis
	public async setStatus(c: MiCompetition, host: MiUser, action: StatusAction): Promise<MiCompetition> {
		if (!this.isHost(c, host.id)) throw this.err('not_host', 'Only the host can do this.');
		// batch-1 review fix (operator): co-admins run the event, but only the host wipes its results
		if (action === 'reset' && !this.isOwner(c, host.id)) throw this.err('not_host', 'Only the host can reset the results.');
		const bad = () => this.err('invalid_transition', `Cannot ${action} a competition that is ${c.status}.`);
		const now = new Date();
		switch (action) {
			case 'publish':
				if (c.status !== 'draft') throw bad();
				await this.competitionsRepository.update(c.id, { status: 'open', lockRegistration: false, updatedAt: now });
				await this.notifyPublished(c, host);   // COMP-T3-V1: Reclub "a push notification to the community" (public only)
				break;
			case 'lock':
				if (c.status !== 'open') throw bad();
				await this.competitionsRepository.update(c.id, { status: 'closed', lockRegistration: true, updatedAt: now });
				break;
			case 'reopen':
				if (c.status !== 'closed') throw bad();
				await this.competitionsRepository.update(c.id, { status: 'open', lockRegistration: false, updatedAt: now });
				break;
			case 'start': {
				if (c.status !== 'open' && c.status !== 'closed') throw bad();
				const confirmed = await this.confirmedEntries(c);
				if (confirmed.length < 2) throw this.err('not_enough_entries', 'At least 2 confirmed entries are needed to start.');
				// pending entries are dropped at the start (Reclub: "Free Agents will be moved to Spectators when competition starts.")
				await this.entriesRepository.update({ competitionId: c.id, status: 'pending' }, { status: 'withdrawn', statusChangedAt: now });
				// COMP-W1B4: free agents without a team and incomplete teams (a partner never accepted) do not play
				// COMP-T3-V1: Reclub moves a free agent without a team to the SPECTATORS at the start (was: withdrawn)
				await this.entriesRepository.update({ competitionId: c.id, status: 'freeAgent' }, { status: 'spectator', statusChangedAt: now });
				for (const e of await this.entries(c)) {
					if (e.status !== 'confirmed' || this.isComplete(c, e)) continue;
					await this.entriesRepository.update(e.id, { status: 'withdrawn', invitedUserIds: [], requestedUserIds: [], statusChangedAt: now });
					for (const uid of e.userIds) this.notify(uid, c, 'Team incomplete', `${e.name} was withdrawn from ${c.name}: the team was not complete at the start.`);
				}
				if (!(await this.matchesRepository.existsBy({ competitionId: c.id }))) await this.draw(c, host, { stage: 'auto', reset: false, skipStatusCheck: true });
				await this.competitionsRepository.update(c.id, { status: 'inProgress', lockRegistration: true, startedAt: now, updatedAt: now });
				for (const e of confirmed) for (const uid of e.userIds) if (uid !== host.id) this.notify(uid, c, 'Competition started', `${c.name} has started. Check your matches.`);
				break;
			}
			case 'finish': {
				if (c.status !== 'inProgress') throw bad();
				await this.writeSystemAwards(c);
				await this.competitionsRepository.update(c.id, { status: 'done', endedAt: now, updatedAt: now });
				break;
			}
			case 'reopenEnded':
				if (c.status !== 'done') throw bad();
				await this.competitionsRepository.update(c.id, { status: 'inProgress', endedAt: null, updatedAt: now });
				break;
			case 'reset':
				if (c.status !== 'inProgress' && c.status !== 'closed' && c.status !== 'open') throw bad();
				await this.matchesRepository.delete({ competitionId: c.id });
				await this.awardsRepository.delete({ competitionId: c.id, type: In(['first', 'second', 'third', 'coThird', 'fourth']) });
				await this.entriesRepository.update({ competitionId: c.id, status: 'forfeit' }, { status: 'confirmed', statusChangedAt: now });
				await this.competitionsRepository.update(c.id, { status: c.status === 'inProgress' ? 'closed' : c.status, bracketData: null, startedAt: null, updatedAt: now });
				break;
		}
		return await this.get(c.id);
	}

	@bindThis
	public async cancel(c: MiCompetition, host: MiUser, message?: string | null): Promise<MiCompetition> {
		// batch-1 review fix (operator): only the host cancels (a co-admin cannot)
		if (!this.isOwner(c, host.id)) throw this.err('not_host', 'Only the host can cancel the competition.');
		if (c.status === 'cancelled' || c.status === 'done') throw this.err('invalid_transition', `Cannot cancel a competition that is ${c.status}.`);
		// COMP-T3-V1 (Reclub "optional cancellation announcement"): the host's words ride on the one cancellation notice and
		// stay on the page as an announcement — no second notification
		const msg = (message ?? '').trim().slice(0, 2000);
		const announcements = msg ? [{ id: this.idService.gen(), userId: host.id, text: msg, createdAt: new Date().toISOString() }, ...(c.announcements ?? [])].slice(0, 50) : c.announcements ?? [];
		await this.competitionsRepository.update(c.id, { status: 'cancelled', cancelledAt: new Date(), updatedAt: new Date(), announcements });
		const body = `${c.name} has been cancelled by the host.` + (msg ? ` ${msg.length > 140 ? msg.slice(0, 139) + '…' : msg}` : '');
		const told = new Set<string>();
		for (const e of await this.entries(c)) {
			if (!['pending', 'confirmed', 'forfeit', 'freeAgent', 'spectator'].includes(e.status)) continue;
			for (const uid of [...e.userIds, ...(e.invitedUserIds ?? [])]) if (uid !== host.id && !told.has(uid)) { told.add(uid); this.notify(uid, c, 'Competition cancelled', body); }
		}
		for (const uid of [...(c.adminIds ?? []), ...(c.refereeIds ?? [])]) if (uid !== host.id && !told.has(uid)) { told.add(uid); this.notify(uid, c, 'Competition cancelled', body); }
		return await this.get(c.id);
	}

	/**
	 * COMP-T3-V1 — Reclub kebab "Delete competition" ("Are you sure you want to delete this competition?"). The owner only.
	 * A competition nobody else is part of (a draft, a cancelled one, or an open one with no entrant, free agent or
	 * spectator) is deleted with its rows (FK CASCADE) and its chat room; anything with people in it is refused — cancel
	 * it first, so they are told. A finished competition keeps its podium on the players' profiles and is never deleted.
	 */
	@bindThis
	public async delete(c: MiCompetition, user: MiUser): Promise<void> {
		if (!this.isOwner(c, user.id)) throw this.err('not_host', 'Only the host can delete the competition.');
		if (c.status === 'inProgress' || c.status === 'done') throw this.err('cannot_delete', 'A started competition cannot be deleted — cancel it first.');
		if (c.status !== 'draft' && c.status !== 'cancelled') {
			const people = await this.entriesRepository.countBy({ competitionId: c.id, status: In(['pending', 'confirmed', 'forfeit', 'freeAgent', 'spectator']) });
			if (people) throw this.err('cannot_delete', 'People have joined this competition — cancel it first, so they are told.');
		}
		const roomId = c.chatRoomId;
		await this.competitionsRepository.delete(c.id);
		if (roomId) { const room = await this.chatService.findRoomById(roomId).catch(() => null); if (room) await this.chatService.deleteRoom(room).catch(() => undefined); }
	}

	// -------------------------------------------------------------------------------------------- entries
	private registrationOpen(c: MiCompetition): boolean {
		if (c.status !== 'open' || c.lockRegistration) return false;
		const now = Date.now();
		if (c.registrationOpenAt && c.registrationOpenAt.getTime() > now) return false;
		if (c.registrationCloseAt && c.registrationCloseAt.getTime() < now) return false;
		return true;
	}

	private async activeCount(c: MiCompetition): Promise<number> {
		return await this.entriesRepository.countBy({ competitionId: c.id, status: In([...ENTRY_ACTIVE]) });
	}

	private async assertTeam(c: MiCompetition, userIds: string[]): Promise<void> {
		const uniq = Array.from(new Set(userIds));
		if (uniq.length !== userIds.length) throw this.err('bad_team', 'A player is listed twice.');
		if (uniq.length < c.teamMinSize || uniq.length > c.teamMaxSize) throw this.err('bad_team', c.teamMinSize === c.teamMaxSize ? `This competition takes ${c.teamMinSize} player(s) per entry.` : `This competition takes ${c.teamMinSize}–${c.teamMaxSize} players per entry.`);
		if (uniq.length) {
			const n = await this.usersRepository.countBy({ id: In(uniq) });
			if (n !== uniq.length) throw this.err('bad_team', 'A player does not exist.');
			const taken = await this.entriesRepository.createQueryBuilder('e')
				.where('e."competitionId" = :cid', { cid: c.id })
				.andWhere('e."userIds" && ARRAY[:...ids]::varchar[]', { ids: uniq })
				.andWhere('e.status IN (:...st)', { st: [...ENTRY_ACTIVE] }).getCount();
			if (taken) throw this.err('already_entered', 'A player already has an entry in this competition.');
		}
	}

	/** Self sign-up (Reclub join-competition).
	 *  COMP-CONSENT (batch 1: lane A's T1 D-comp-join.03 guard on lane B4's data model): naming partners no longer seats
	 *  them. Only the entrant is in the team (userIds); the partners wait in invitedUserIds until each accepts through
	 *  competitions/invitations/respond (seated + chat) or declines (the place opens; the captain re-invites through
	 *  competitions/entries/partners). The whole proposed team must fit the size rule, exist, not be entered elsewhere, and
	 *  have no block between any two of them (either direction, COMPETITION_BLOCKED). An invited partner holds nobody's
	 *  place anywhere else (myEntry reads userIds only), so a stale invite never locks anyone out; a team that is still
	 *  incomplete at the start is withdrawn (COMP-W1B4 statusAction start). */
	@bindThis
	public async enter(c: MiCompetition, user: MiUser, data: { name?: string | null; partnerIds?: string[] | null; accessToken?: string | null }): Promise<MiCompetitionEntry> {
		await this.assertVisible(c, user, data.accessToken);
		if (!this.registrationOpen(c)) throw this.err('registration_closed', 'Registration is closed.');
		if ((await this.activeCount(c)) >= c.maxEntries) throw this.err('full', 'No spot left.');
		const partners = Array.from(new Set((data.partnerIds ?? []).filter((x) => x !== user.id)));
		const team = [user.id, ...partners];
		await this.assertMayJoin(c, team);   // COMP-T3-V1: club members only — the whole proposed team
		await this.assertTeam(c, team);
		await this.assertNoBlocks(team);
		const name = (data.name ?? '').trim() || (user.name ?? user.username);
		const status = c.autoApprove ? 'confirmed' : 'pending';
		// a free agent who enters a team of their own is no longer looking for one (COMP-T3-V1: nor spectating — a player)
		await this.entriesRepository.update({ competitionId: c.id, status: In(['freeAgent', 'spectator']), captainId: user.id }, { status: 'withdrawn', statusChangedAt: new Date() });
		const entry = await this.entriesRepository.insertOne({ id: this.idService.gen(), competitionId: c.id, name, captainId: user.id, userIds: [user.id], invitedUserIds: partners, requestedUserIds: [], seed: null, pool: null, status, isPaid: false, notes: null, createdById: user.id, createdAt: new Date(), statusChangedAt: new Date() });
		if (status === 'confirmed') await this.joinChat(c, [user.id]);
		await this.closeAsksElsewhere(c, user.id, entry.id); // batch-1 review fix: the entrant no longer holds a place on another team
		if (partners.length) this.notifyInvites(c, entry, user);
		// BACKEND-DELIVERY-V1: two whole sentences (not a verb spliced into one) so the app can put each in the reader's language
		this.notify(c.hostId, c, status === 'confirmed' ? 'New entry' : 'Entry request', status === 'confirmed' ? `${name} entered ${c.name}.` : `${name} requested to enter ${c.name}.`);
		return entry;
	}

	/** Leave before the start (Reclub "Leave competition"); during play the host forfeits the entry instead. */
	@bindThis
	public async withdraw(c: MiCompetition, user: MiUser): Promise<MiCompetitionEntry> {
		const e = await this.myEntry(c, user.id);
		if (!e) throw this.err('not_entered', 'You are not entered.');
		if (c.status === 'inProgress' || c.status === 'done') throw this.err('started', 'The competition has started — ask the host to forfeit your entry.');
		// COMP-T3-V1 (Reclub team detail self options "Leave team" vs "Withdraw"): a member who is not the captain leaves the
		// TEAM — the team stays entered with a place open again (and is withdrawn at the start if it is then incomplete).
		// Before this, any member's Leave withdrew the whole team, their partner's entry included.
		if (e.captainId && e.captainId !== user.id && e.userIds.length > 1) {
			await this.entriesRepository.update(e.id, { userIds: e.userIds.filter((x) => x !== user.id) });
			if (c.chatRoomId) await this.chatService.leaveRoom(user.id, c.chatRoomId).catch(() => undefined);
			this.notify(e.captainId, c, 'Player left your team', `${user.name ?? user.username} left your team in ${c.name}; your team has a place open again.`);
			return (await this.entriesRepository.findOneBy({ id: e.id }))!;
		}
		await this.entriesRepository.update(e.id, { status: 'withdrawn', invitedUserIds: [], requestedUserIds: [], statusChangedAt: new Date() });
		this.notify(c.hostId, c, 'Entry withdrawn', `${e.name} withdrew from ${c.name}.`);
		// COMP-CONSENT (batch 1): partners still invited to this team hear that the invitation is gone
		for (const uid of e.invitedUserIds ?? []) this.notify(uid, c, 'Team invitation withdrawn', `${e.name} withdrew from ${c.name}; your invitation is closed.`);
		// batch-1 review fix: players who asked to join the team hear it too
		for (const uid of e.requestedUserIds ?? []) this.notify(uid, c, 'Join request closed', `${e.name} withdrew from ${c.name}; your request to join is closed.`);
		return (await this.entriesRepository.findOneBy({ id: e.id }))!;
	}

	/** Host adds an entry: real players (userIds) or a reserved spot (a name only). */
	@bindThis
	public async hostAddEntry(c: MiCompetition, host: MiUser, data: { name?: string | null; userIds?: string[] | null; seed?: number | null }): Promise<MiCompetitionEntry> {
		if (!this.isHost(c, host.id)) throw this.err('not_host', 'Only the host can do this.');
		if (c.status === 'done' || c.status === 'cancelled') throw this.err('invalid_transition', 'The competition is over.');
		if ((await this.activeCount(c)) >= c.maxEntries) throw this.err('full', 'No spot left.');
		const userIds = Array.from(new Set(data.userIds ?? []));
		if (userIds.length) await this.assertTeam(c, userIds);
		let name = (data.name ?? '').trim();
		if (!name && userIds[0]) { const u = await this.usersRepository.findOneBy({ id: userIds[0] }); name = u ? (u.name ?? u.username) : ''; }
		if (!name) name = 'Reserved spot';
		const entry = await this.entriesRepository.insertOne({ id: this.idService.gen(), competitionId: c.id, name, captainId: userIds[0] ?? null, userIds, seed: data.seed ?? null, pool: null, status: 'confirmed', isPaid: false, notes: null, createdById: host.id, createdAt: new Date(), statusChangedAt: new Date() });
		await this.joinChat(c, userIds);
		for (const uid of userIds) if (uid !== host.id) this.notify(uid, c, 'You are entered', `${host.name ?? host.username} added you to ${c.name}.`);
		return entry;
	}

	@bindThis
	public async hostUpdateEntry(c: MiCompetition, host: MiUser, entryId: string, patch: { name?: string | null; userIds?: string[] | null; seed?: number | null; pool?: number | null; status?: 'confirmed' | 'withdrawn' | 'forfeit' | null; isPaid?: boolean | null; notes?: string | null; remove?: boolean | null; eligibleUserId?: string | null; eligible?: boolean | null }): Promise<MiCompetitionEntry | null> {
		if (!this.isHost(c, host.id)) throw this.err('not_host', 'Only the host can do this.');
		const e = await this.entriesRepository.findOneBy({ id: entryId, competitionId: c.id });
		if (!e) throw this.err('no_such_entry', 'No such entry.');
		// COMP-T3-V1 (Reclub participant settings "Eligible"): the host's call on one member; null hands it back to the
		// automatic rule. A member marked ineligible hears it (Reclub "You are marked as ineligible… contact admin").
		if (patch.eligibleUserId) {
			if (!e.userIds.includes(patch.eligibleUserId)) throw this.err('no_such_entry', 'That player is not in this entry.');
			const next = { ...(e.eligibility ?? {}) };
			if (patch.eligible == null) delete next[patch.eligibleUserId]; else next[patch.eligibleUserId] = patch.eligible;
			await this.entriesRepository.update(e.id, { eligibility: next });
			if (patch.eligible === false && patch.eligibleUserId !== host.id) this.notify(patch.eligibleUserId, c, 'Marked ineligible', `You are marked as ineligible in ${c.name}. Contact the host.`);
			return await this.entriesRepository.findOneBy({ id: e.id });
		}
		const drawn = await this.matchesRepository.existsBy({ competitionId: c.id });
		if (patch.remove) {
			if (drawn) throw this.err('draw_exists', 'The draw is generated — forfeit the entry instead.');
			await this.entriesRepository.delete(e.id);
			return null;
		}
		const upd: Partial<MiCompetitionEntry> = {};
		if (patch.name != null && patch.name.trim()) upd.name = patch.name.trim();
		if (patch.userIds != null) {
			if (drawn) throw this.err('draw_exists', 'The draw is generated — the roster is fixed.');
			// the entry's own members may stay; the check excludes this entry
			const ids = Array.from(new Set(patch.userIds));
			await this.entriesRepository.update(e.id, { userIds: [] });
			try { if (ids.length) await this.assertTeam(c, ids); } catch (err) { await this.entriesRepository.update(e.id, { userIds: e.userIds }); throw err; }
			upd.userIds = ids; upd.captainId = ids[0] ?? null;
			await this.joinChat(c, ids);
		}
		if (patch.seed !== undefined) upd.seed = patch.seed;
		if (patch.pool !== undefined) upd.pool = patch.pool;
		if (patch.isPaid != null) upd.isPaid = patch.isPaid;
		if (patch.notes !== undefined) upd.notes = patch.notes;
		if (patch.status) {
			if (patch.status === 'confirmed' && e.status !== 'confirmed' && (await this.activeCount(c)) >= c.maxEntries && e.status !== 'pending') throw this.err('full', 'No spot left.');
			if (patch.status === 'forfeit' && c.status !== 'inProgress') throw this.err('invalid_transition', 'An entry can only forfeit while the competition is in progress.');
			upd.status = patch.status; upd.statusChangedAt = new Date();
			if (patch.status === 'confirmed') { await this.joinChat(c, e.userIds); for (const uid of e.userIds) this.notify(uid, c, 'Entry approved', `${e.name} is confirmed for ${c.name}.`); }
			if (patch.status === 'forfeit') await this.forfeitEntry(c, e.id);
		}
		if (Object.keys(upd).length) await this.entriesRepository.update(e.id, upd);
		if (patch.seed !== undefined) await this.competitionsRepository.update(c.id, { manualSeeding: true });
		return await this.entriesRepository.findOneBy({ id: e.id });
	}

	/** Every pending match of a forfeiting entry is scored as a forfeit (and reported to the bracket). */
	private async forfeitEntry(c: MiCompetition, entryId: string): Promise<void> {
		const ms = (await this.matches(c)).filter((m) => m.status !== 'completed' && m.status !== 'cancelled' && (m.entry1Id === entryId || m.entry2Id === entryId) && m.entry1Id && m.entry2Id);
		for (const m of ms) {
			await this.applyResult(await this.get(c.id), m, { scores: m.scores, forfeit: m.entry1Id === entryId ? 'entry1' : 'entry2', finalize: true });
		}
	}

	private async joinChat(c: MiCompetition, userIds: string[]): Promise<void> {
		if (!c.chatRoomId) return;
		const room = await this.chatService.findRoomById(c.chatRoomId);
		if (!room) return;
		for (const uid of userIds) {
			if (uid === room.ownerId) continue;
			try {
				if (!(await this.chatService.isRoomMember(room, uid))) {
					await this.chatService.createRoomInvitation(room.ownerId, room.id, uid, { notify: false });
					await this.chatService.joinToRoom(uid, room.id);
				}
			} catch { /* already invited / room full: the chat door re-tries on open */ }
		}
	}

	/** The general chat room for a host or entrant (the club/meet chat room pattern). */
	@bindThis
	public async chatRoom(c: MiCompetition, user: MiUser): Promise<{ roomId: string }> {
		const entry = await this.myEntry(c, user.id);
		// COMP-T3-V1: a spectator reads the general chat too (Reclub spectators are in the General chat)
		if (!this.isHost(c, user.id) && !this.isReferee(c, user.id) && !(entry && entry.status !== 'pending') && !(await this.mySpectator(c, user.id))) throw this.err('forbidden', 'Only participants can open the competition chat.');
		let room = c.chatRoomId ? await this.chatService.findRoomById(c.chatRoomId) : null;
		if (!room) {
			const owner = await this.usersRepository.findOneByOrFail({ id: c.hostId });
			room = await this.chatService.createRoom(owner, { name: c.name, description: 'Competition chat' });
			await this.competitionsRepository.update(c.id, { chatRoomId: room.id });
		}
		await this.joinChat({ ...c, chatRoomId: room.id }, [user.id]);
		return { roomId: room.id };
	}

	// ------------------------------------------------------------------------------------------------ draw
	private isKnockout(format: CompetitionFormat): boolean { return format === 'singleElim' || format === 'doubleElim'; }

	/**
	 * Generates the next stage that is missing (or the one asked for):
	 *   roundRobin        → 'regular': one round robin over every confirmed entry (meets generator, circle method)
	 *   poolPlayKnockout  → 'regular': pools (snake by seed) each a round robin; then 'playoff': a single-elimination
	 *                       bracket of the top numContinue per pool, seeded across pools (A1 B2 … B1 A2)
	 *   singleElim/doubleElim → 'playoff': the bracket over every confirmed entry in seed order
	 * reset wipes every match (and the bracket) first. Allowed while open / closed (a preview, Reclub
	 * "This is a preview of the competition's matchups") and inProgress.
	 */
	@bindThis
	public async draw(c: MiCompetition, host: MiUser, opts: { stage: 'auto' | 'regular' | 'playoff'; reset: boolean; skipStatusCheck?: boolean; seedOrder?: string[] | null; resetPlayoff?: boolean }): Promise<{ stage: 'regular' | 'playoff'; matches: MiCompetitionMatch[] }> {
		if (!this.isHost(c, host.id)) throw this.err('not_host', 'Only the host can do this.');
		if (!opts.skipStatusCheck && !['open', 'closed', 'inProgress'].includes(c.status)) throw this.err('invalid_transition', `Cannot draw a competition that is ${c.status}.`);
		if (opts.reset) {
			await this.matchesRepository.delete({ competitionId: c.id });
			await this.competitionsRepository.update(c.id, { bracketData: null });
			c = await this.get(c.id);
		}
		// COMP-T3-V1 (Reclub Manage seeds "Update Seeds → Arranging matches"; "Seeds cannot be changed after playoff matches have
		// already started."): the playoff bracket alone is set aside and drawn again, only while none of its matches is played
		if (opts.resetPlayoff && !opts.reset) {
			const ko = (await this.matches(c)).filter((m) => m.stage === 'playoff');
			if (ko.some((m) => m.status === 'completed' && m.entry1Status !== 'bye' && m.entry2Status !== 'bye')) throw this.err('bracket_locked', 'Seeds cannot be changed after playoff matches have already started.');
			await this.matchesRepository.delete({ competitionId: c.id, stage: 'playoff' });
			await this.competitionsRepository.update(c.id, { bracketData: null });
			c = await this.get(c.id);
		}
		const existing = await this.matches(c);
		const hasRegular = existing.some((m) => m.stage === 'regular');
		const hasPlayoff = existing.some((m) => m.stage === 'playoff');
		let stage: 'regular' | 'playoff';
		if (opts.stage === 'auto') stage = this.isKnockout(c.format) ? 'playoff' : (c.format === 'poolPlayKnockout' && hasRegular ? 'playoff' : 'regular');
		else stage = opts.stage;
		if (this.isKnockout(c.format)) stage = 'playoff';
		if (stage === 'regular' && hasRegular) throw this.err('draw_exists', 'The draw is already generated — reset to redraw.');
		if (stage === 'playoff' && hasPlayoff) throw this.err('draw_exists', 'The bracket is already generated — reset to redraw.');

		const confirmed = await this.confirmedEntries(c);
		if (confirmed.length < 2) throw this.err('not_enough_entries', 'At least 2 confirmed entries are needed for a draw.');

		if (stage === 'regular') {
			const pools = c.format === 'poolPlayKnockout' ? Math.max(1, Math.min(c.numGroups, Math.floor(confirmed.length / 2))) : 1;
			// pool assignment: the host's own (entry.pool) when every entry has one, else a snake by seed order
			const assigned = confirmed.every((e) => e.pool != null && e.pool >= 1 && e.pool <= pools) && pools > 1;
			const byPool = new Map<number, MiCompetitionEntry[]>();
			confirmed.forEach((e, i) => {
				const p = assigned ? e.pool! : pools === 1 ? 1 : (Math.floor(i / pools) % 2 === 0 ? (i % pools) + 1 : pools - (i % pools));
				(byPool.get(p) ?? byPool.set(p, []).get(p)!).push(e);
			});
			const rows: Partial<MiCompetitionMatch>[] = [];
			for (const [p, es] of byPool) {
				if (es.length > RR_LIMITS.simple) throw this.err('too_many_entries', `A round robin takes at most ${RR_LIMITS.simple} entries per pool — add pools.`);
				for (const e of es) await this.entriesRepository.update(e.id, { pool: pools === 1 ? null : p });
				const gen = generateRoundRobin({ scheme: 'SINGLES', participantIds: es.map((e) => e.id), courts: Math.max(1, Math.floor(es.length / 2)), limitRounds: null, stats: {}, startRound: 1, seed: 7 });
				if (gen.warnings.includes('not_enough_players')) continue;
				// COMP-T3-V1 (Reclub Double / Triple round robin): every pair meets once per cycle; each later cycle repeats the
				// schedule with the sides swapped, after the last round — hkpl lib/schedule-generator.js:56-59 (doubleRoundRobin)
				const lastRound = Math.max(0, ...gen.matches.map((m) => m.round));
				const cycles = Math.max(1, Math.min(3, c.roundRobinCycles ?? 1));
				for (let k = 0; k < cycles; k++) {
					const swap = k % 2 === 1;
					gen.matches.forEach((m) => rows.push({ stage: 'regular', pool: pools === 1 ? null : p, round: m.round + k * lastRound, number: m.courtIndex + 1, entry1Id: swap ? m.team2Ids[0] : m.team1Ids[0], entry2Id: swap ? m.team1Ids[0] : m.team2Ids[0], entry1Status: 'confirmed', entry2Status: 'confirmed', courtIndex: null }));
				}
			}
			const saved: MiCompetitionMatch[] = [];
			for (const r of rows) saved.push(await this.matchesRepository.insertOne({ id: this.idService.gen(), competitionId: c.id, status: 'pending', scores: [], result: null, bracketId: null, bracketGroup: null, startAt: null, notes: null, isExtra: false, createdAt: new Date(), updatedAt: new Date(), ...r }));
			await this.competitionsRepository.update(c.id, { updatedAt: new Date() });
			if (!opts.skipStatusCheck) this.notifyDraw(c, host, confirmed);
			return { stage, matches: saved };
		}

		// playoff: who is in, in seed order
		let seeded: string[];
		if (opts.seedOrder && opts.seedOrder.length) {
			// COMP-T3-V1 (Reclub Manage seeds: manual seeding, up / down, Disqualify / Qualify): the host's order of the
			// entries that play the bracket — any confirmed entry, each once, at least two
			const ok = new Set(confirmed.map((e) => e.id));
			const order = Array.from(new Set(opts.seedOrder));
			if (order.length !== opts.seedOrder.length || order.some((x) => !ok.has(x))) throw this.err('no_such_entry', 'Every seeded entry must be a confirmed entry, once.');
			if (order.length < 2) throw this.err('not_enough_entries', 'At least 2 entries advance to the playoffs.');
			if (c.format === 'poolPlayKnockout' && !(await this.standings(c)).stageComplete) throw this.err('stage_incomplete', 'Every pool match must be completed before the playoffs.');
			seeded = order;
			await this.competitionsRepository.update(c.id, { manualSeeding: true });
		} else if (this.isKnockout(c.format)) {
			seeded = confirmed.map((e) => e.id);
		} else {
			const st = await this.standings(c);
			if (!st.stageComplete) throw this.err('stage_incomplete', 'Every pool match must be completed before the playoffs.');
			const perPool = st.pools.map((p) => p.rows.slice(0, c.numContinue).map((r) => r.entryId));
			seeded = [];
			const depth = Math.max(...perPool.map((p) => p.length));
			for (let rank = 0; rank < depth; rank++) {
				const order = rank % 2 === 0 ? perPool : perPool.slice().reverse();
				for (const p of order) if (p[rank]) seeded.push(p[rank]);
			}
			if (seeded.length < 2) throw this.err('not_enough_entries', 'At least 2 entries advance to the playoffs.');
		}
		const type = c.format === 'doubleElim' ? 'double_elimination' : 'single_elimination';
		const { data, stageId } = await createKnockoutStage(c.bracketData, { name: 'Playoffs', type, entryIds: seeded, consolationFinal: c.thirdPlaceMatch && seeded.length > 2 });
		await this.competitionsRepository.update(c.id, { bracketData: data, updatedAt: new Date() });
		await this.syncBracket(c.id, data, stageId);
		if (!opts.skipStatusCheck) this.notifyDraw(c, host, confirmed);
		return { stage, matches: (await this.matches(await this.get(c.id))).filter((m) => m.stage === 'playoff') };
	}

	/** Mirrors the bracket's matches into competition_match rows (insert on first sight, update after). */
	private async syncBracket(competitionId: string, data: BracketDb, stageId: number): Promise<void> {
		const views = viewStage(data, stageId);
		const rows = await this.matchesRepository.find({ where: { competitionId, stage: 'playoff' } });
		const byBracket = new Map<number, MiCompetitionMatch>(rows.filter((r) => r.bracketId != null).map((r) => [r.bracketId!, r]));
		for (const v of views) {
			const fields = this.rowFromView(v);
			const row = byBracket.get(v.bracketId);
			if (row) {
				// never overwrite a reported score; only the structure (who plays whom, bye, status) follows the bracket
				const upd: Partial<MiCompetitionMatch> = { entry1Id: fields.entry1Id, entry2Id: fields.entry2Id, entry1Status: fields.entry1Status, entry2Status: fields.entry2Status, round: fields.round, number: fields.number, bracketGroup: fields.bracketGroup, updatedAt: new Date() };
				if (row.status !== 'completed' || fields.status === 'pending') { upd.status = fields.status; upd.result = fields.result; if (fields.status === 'pending') upd.scores = []; }
				await this.matchesRepository.update(row.id, upd);
			} else {
				await this.matchesRepository.insertOne({ id: this.idService.gen(), competitionId, stage: 'playoff', pool: null, bracketId: v.bracketId, scores: [], courtIndex: null, startAt: null, notes: null, isExtra: false, createdAt: new Date(), updatedAt: new Date(), ...fields });
			}
		}
	}

	private rowFromView(v: BracketMatchView): Pick<MiCompetitionMatch, 'entry1Id' | 'entry2Id' | 'entry1Status' | 'entry2Status' | 'status' | 'result' | 'round' | 'number' | 'bracketGroup'> {
		const side = (o: BracketMatchView['opponent1']): [string | null, MiCompetitionMatch['entry1Status']] => o === null ? [null, 'bye'] : o.entryId == null ? [null, 'pending'] : [o.entryId, o.forfeit ? 'forfeit' : 'confirmed'];
		const [e1, s1] = side(v.opponent1), [e2, s2] = side(v.opponent2);
		const bye = s1 === 'bye' || s2 === 'bye';
		// brackets-model Status: Locked 0, Waiting 1, Ready 2, Running 3, Completed 4, Archived 5
		let status: MiCompetitionMatch['status'] = v.status >= 4 ? 'completed' : v.status === 3 ? 'inProgress' : 'pending';
		let result: MiCompetitionMatch['result'] = null;
		if (bye) { status = 'completed'; result = s1 === 'bye' ? (e2 ? 'entry2' : null) : (e1 ? 'entry1' : null); }
		else if (status === 'completed') result = v.opponent1?.win ? 'entry1' : v.opponent2?.win ? 'entry2' : (s1 === 'forfeit' ? 'entry2' : s2 === 'forfeit' ? 'entry1' : null);
		return { entry1Id: e1, entry2Id: e2, entry1Status: s1, entry2Status: s2, status, result, round: v.roundNumber, number: v.number, bracketGroup: v.groupKind };
	}

	// --------------------------------------------------------------------------------------------- results
	@bindThis
	public async canScore(c: MiCompetition, m: MiCompetitionMatch, userId: string | null | undefined): Promise<boolean> {
		if (!userId) return false;
		if (this.isHost(c, userId) || this.isReferee(c, userId)) return true;   // COMP-W1B4: referees score any match
		if ((m.refereeIds ?? []).includes(userId)) return true;   // COMP-T3-V1: this match's own referee
		const e = await this.myEntry(c, userId);
		return !!e && (m.entry1Id === e.id || m.entry2Id === e.id);
	}

	/**
	 * Reclub upsert-competition-score / match manage in one door. The host may create an extra match (no matchId).
	 * Scores from a player of the match are saved (inProgress); the host finalizes (completed), which fixes the
	 * result and, for a knockout match, advances the winner in the bracket.
	 */
	@bindThis
	public async upsertMatch(c: MiCompetition, user: MiUser, data: { matchId: string | null; scores?: CompetitionScoreSet[]; forfeit?: 'entry1' | 'entry2' | 'both' | null; finalize?: boolean; entry1Id?: string | null; entry2Id?: string | null; round?: number | null; courtIndex?: number | null; startAt?: Date | null; notes?: string | null; reopen?: boolean; refereeIds?: string[] | null; remove?: boolean; restore?: boolean }): Promise<MiCompetitionMatch> {
		if (c.status !== 'inProgress' && !(this.isHost(c, user.id) && (c.status === 'open' || c.status === 'closed'))) throw this.err('invalid_transition', 'Scores can be entered once the competition has started.');
		let m: MiCompetitionMatch;
		if (data.matchId) {
			const found = await this.matchesRepository.findOneBy({ id: data.matchId, competitionId: c.id });
			if (!found) throw this.err('no_such_match', 'No such match.');
			m = found;
			if (!(await this.canScore(c, m, user.id))) throw this.err('forbidden', 'Only the host or a player of this match can score it.');
			// COMP-T3-V1: managing the match (its referees, removing / restoring it) is the host's; a player asking is refused,
			// not silently ignored
			if ((data.refereeIds !== undefined || data.remove || data.restore) && !this.isHost(c, user.id)) throw this.err('not_host', 'Only the host can do this.');
		} else {
			if (!this.isHost(c, user.id)) throw this.err('not_host', 'Only the host can add a match.');
			if (!data.entry1Id || !data.entry2Id || data.entry1Id === data.entry2Id) throw this.err('no_such_entry', 'Two different entries are needed.');
			const n = await this.entriesRepository.countBy({ id: In([data.entry1Id, data.entry2Id]), competitionId: c.id });
			if (n !== 2) throw this.err('no_such_entry', 'No such entry.');
			const last = (await this.matches(c)).filter((x) => x.stage === 'regular');
			m = await this.matchesRepository.insertOne({ id: this.idService.gen(), competitionId: c.id, stage: 'regular', pool: null, round: data.round ?? (last.length ? Math.max(...last.map((x) => x.round)) : 1), number: last.length + 1, bracketId: null, bracketGroup: null, entry1Id: data.entry1Id, entry2Id: data.entry2Id, entry1Status: 'confirmed', entry2Status: 'confirmed', status: 'pending', scores: [], result: null, courtIndex: data.courtIndex ?? null, startAt: data.startAt ?? null, notes: data.notes ?? null, isExtra: true, createdAt: new Date(), updatedAt: new Date() });
		}
		const host = this.isHost(c, user.id);
		if (host) {
			const upd: Partial<MiCompetitionMatch> = {};
			if (data.courtIndex !== undefined) upd.courtIndex = data.courtIndex;
			if (data.startAt !== undefined) upd.startAt = data.startAt;
			if (data.notes !== undefined) upd.notes = data.notes;
			if (m.bracketId == null) { if (data.entry1Id !== undefined && data.matchId) upd.entry1Id = data.entry1Id; if (data.entry2Id !== undefined && data.matchId) upd.entry2Id = data.entry2Id; if (data.round != null) upd.round = data.round; }
			const moved = (data.startAt !== undefined && (data.startAt?.getTime() ?? null) !== (m.startAt?.getTime() ?? null)) || (data.courtIndex !== undefined && data.courtIndex !== m.courtIndex);
			// COMP-T3-V1 (Reclub match manage "Referees: pick from Staff / Teams / Players"): the match's own referees
			let newRefs: string[] = [];
			if (data.refereeIds != null) {
				const ids = Array.from(new Set(data.refereeIds)).slice(0, 4);
				if (ids.length && (await this.usersRepository.countBy({ id: In(ids) })) !== ids.length) throw this.err('no_such_entry', 'No such user.');
				newRefs = ids.filter((x) => !(m.refereeIds ?? []).includes(x));
				upd.refereeIds = ids;
			}
			// COMP-T3-V1 (Reclub "Remove match" / "Unremove"): a non-bracket match is set aside (cancelled — no result, out of the
			// standings, not counted as remaining) or put back; a bracket match belongs to the bracket and is never removed
			if (data.remove || data.restore) {
				if (m.bracketId != null) throw this.err('bracket_locked', 'A bracket match cannot be removed.');
				if (data.remove) Object.assign(upd, { status: 'cancelled', result: null });
				else if (m.status === 'cancelled') Object.assign(upd, { status: m.scores.length ? 'inProgress' : 'pending', result: null });
			}
			if (Object.keys(upd).length) { await this.matchesRepository.update(m.id, { ...upd, updatedAt: new Date() }); m = (await this.matchesRepository.findOneBy({ id: m.id }))!; }
			for (const uid of newRefs) if (uid !== user.id) this.notify(uid, c, 'You are the referee', `You are the referee of a match in ${c.name}.`);
			if (data.remove || data.restore) return m;
			// COMP-W1B4: a scheduled / moved match reaches its players (the time and court are on the match page)
			if (moved && data.matchId && (m.entry1Id || m.entry2Id)) {
				const es = await this.entriesRepository.findBy({ id: In([m.entry1Id, m.entry2Id].filter((x): x is string => !!x)) });
				for (const e of es) for (const uid of e.userIds) if (uid !== user.id) this.notify(uid, c, 'Match scheduled', `Your match in ${c.name} has a new time or court.`);
			}
		}
		// COMP-T3-V1: this match's own referee is official for it, like a competition referee
		const matchRef = (m.refereeIds ?? []).includes(user.id);
		if (data.reopen && (host || this.isReferee(c, user.id) || matchRef)) {
			if (m.status === 'completed' && m.bracketId != null && c.bracketData) {
				let db: BracketDb;
				try { db = await resetBracketMatch(c.bracketData, m.bracketId); } catch { throw this.err('bracket_locked', 'A later match already has a result — reopen that one first.'); }
				await this.competitionsRepository.update(c.id, { bracketData: db });
				await this.syncBracket(c.id, db, this.playoffStageId(db));
			}
			await this.matchesRepository.update(m.id, { status: 'pending', result: null, entry1Status: m.entry1Status === 'forfeit' ? 'confirmed' : m.entry1Status, entry2Status: m.entry2Status === 'forfeit' ? 'confirmed' : m.entry2Status, updatedAt: new Date() });
			return (await this.matchesRepository.findOneBy({ id: m.id }))!;
		}
		if (data.scores !== undefined || data.forfeit !== undefined) {
			if (!m.entry1Id || !m.entry2Id) throw this.err('needs_winner', 'Both sides must be known before a score.');
			if (m.entry1Status === 'bye' || m.entry2Status === 'bye') throw this.err('needs_winner', 'A bye has no score.');
			const wasCompleted = m.status === 'completed';
			const official = host || this.isReferee(c, user.id) || matchRef;   // COMP-W1B4: a referee's result is final like the host's (COMP-T3-V1: + the match's own)
			await this.applyResult(await this.get(c.id), m, { scores: data.scores ?? m.scores, forfeit: data.forfeit ?? null, finalize: official ? (data.finalize !== false) : false });
			const after = await this.matchesRepository.findOneBy({ id: m.id });
			// BACKEND-DELIVERY-V1: a finalized result (or a corrected one) reaches every player of the match but its scorer
			if (after && after.status === 'completed' && (!wasCompleted || JSON.stringify(after.scores) !== JSON.stringify(m.scores))) {
				const es = await this.entriesRepository.findBy({ id: In([after.entry1Id, after.entry2Id].filter((x): x is string => !!x)) });
				for (const e of es) for (const uid of e.userIds) if (uid !== user.id) this.notify(uid, c, 'Match result', `Your match result in ${c.name} was recorded.`);
			}
		}
		return (await this.matchesRepository.findOneBy({ id: m.id }))!;
	}

	private playoffStageId(db: BracketDb): number { const s = db.stage.slice().sort((a, b) => b.number - a.number)[0]; return s ? Number(s.id) : 1; }

	private async applyResult(c: MiCompetition, m: MiCompetitionMatch, r: { scores: CompetitionScoreSet[]; forfeit: 'entry1' | 'entry2' | 'both' | null; finalize: boolean }): Promise<void> {
		const knockout = m.bracketId != null;
		// COMP-T3-V1: a set keeps its name (Reclub Manage score sets) — trimmed, 32 chars, absent when blank
		const scores: CompetitionScoreSet[] = r.scores.map((s) => { const n = (s.name ?? '').trim().slice(0, 32); return { t1: Math.max(0, s.t1 | 0), t2: Math.max(0, s.t2 | 0), type: s.type ?? 'standard', ...(n ? { name: n } : {}) }; });
		const result = decideResult(scores, r.forfeit, !knockout);
		if (r.finalize && result == null) throw this.err('needs_winner', knockout ? 'A knockout match needs a winner — add a deciding set or a forfeit.' : 'Enter at least one set or a forfeit.');
		const e1s: MiCompetitionMatch['entry1Status'] = r.forfeit === 'entry1' || r.forfeit === 'both' ? 'forfeit' : 'confirmed';
		const e2s: MiCompetitionMatch['entry2Status'] = r.forfeit === 'entry2' || r.forfeit === 'both' ? 'forfeit' : 'confirmed';
		if (knockout && r.finalize && c.bracketData) {
			// a re-score of a completed knockout match: undo it in the bracket first (throws when later matches are played)
			let db = c.bracketData;
			if (m.status === 'completed') {
				try { db = await resetBracketMatch(db, m.bracketId!); } catch { throw this.err('bracket_locked', 'A later match already has a result — reopen that one first.'); }
			}
			const [s1, s2] = setsWon(scores);
			try {
				db = await reportBracketMatch(db, { bracketId: m.bracketId!, score1: r.forfeit === 'entry1' ? 0 : s1, score2: r.forfeit === 'entry2' ? 0 : s2, forfeit1: e1s === 'forfeit', forfeit2: e2s === 'forfeit', winner: result === 'draw' ? null : result });
			} catch (e) {
				throw this.err('bracket_locked', (e as Error).message || 'The bracket refused this result.');
			}
			await this.matchesRepository.update(m.id, { scores, result, entry1Status: e1s, entry2Status: e2s, status: 'completed', updatedAt: new Date() });
			await this.competitionsRepository.update(c.id, { bracketData: db, updatedAt: new Date() });
			await this.syncBracket(c.id, db, this.playoffStageId(db));
			return;
		}
		await this.matchesRepository.update(m.id, { scores, result: r.finalize ? result : null, entry1Status: e1s, entry2Status: e2s, status: r.finalize ? 'completed' : (scores.length ? 'inProgress' : 'pending'), updatedAt: new Date() });
	}

	// ------------------------------------------------------------------------------------------- standings
	@bindThis
	public async standings(c: MiCompetition): Promise<StandingsResult> {
		const entries = await this.confirmedEntries(c);
		const ms = await this.matches(c);
		const regular = ms.filter((m) => m.stage === 'regular');
		const pools: StandingsResult['pools'] = [];
		if (this.isKnockout(c.format)) {
			pools.push({ pool: null, rows: computeStandings(entries.map((e) => ({ id: e.id, pool: null })), ms.filter((m) => m.stage === 'playoff'), c) });
		} else {
			const poolNos = Array.from(new Set(entries.map((e) => e.pool ?? null))).sort((a, b) => (a ?? 0) - (b ?? 0));
			for (const p of poolNos) {
				const es = entries.filter((e) => (e.pool ?? null) === p);
				pools.push({ pool: p, rows: computeStandings(es.map((e) => ({ id: e.id, pool: p })), regular.filter((m) => (m.pool ?? null) === p), c) });
			}
		}
		const playoff = ms.filter((m) => m.stage === 'playoff');
		let placements: StandingsResult['placements'] = null;
		let stageComplete: boolean;
		if (playoff.length && c.bracketData) {
			placements = await bracketFinalStandings(c.bracketData, this.playoffStageId(c.bracketData));
			stageComplete = placements != null;
		} else if (this.isKnockout(c.format)) {
			stageComplete = false;
		} else {
			stageComplete = regular.length > 0 && regular.every((m) => m.status === 'completed' || m.status === 'cancelled');
			if (c.format === 'roundRobin' && stageComplete) placements = pools[0].rows.map((r) => ({ entryId: r.entryId, rank: r.place }));
		}
		return { pools, placements, stageComplete };
	}

	// ---------------------------------------------------------------------------------------------- awards
	private async writeSystemAwards(c: MiCompetition): Promise<void> {
		const st = await this.standings(c);
		let places = st.placements;
		if (!places) {
			// the competition is ended before its last match: rank by the table that exists (round robin / pools), else nothing
			const rows = st.pools.length === 1 ? st.pools[0].rows : [];
			places = rows.map((r) => ({ entryId: r.entryId, rank: r.place }));
		}
		const entries = await this.entries(c);
		const byId = new Map(entries.map((e) => [e.id, e]));
		const existing = await this.awards(c);
		const spec: { type: MiCompetitionAward['type']; rank: number; name: string }[] = [
			{ type: 'first', rank: 1, name: '1st place' }, { type: 'second', rank: 2, name: '2nd place' }, { type: 'third', rank: 3, name: '3rd place' }, { type: 'fourth', rank: 4, name: '4th place' },
		];
		for (const s of spec) {
			const winners = places.filter((p) => p.rank === s.rank);
			const have = existing.filter((a) => a.type === s.type);
			// co-third: two entries share rank 3 (no third place match) → 'third' + 'coThird'
			const targets = s.type === 'third' && winners.length > 1 ? [{ type: 'third' as const, e: winners[0] }, { type: 'coThird' as const, e: winners[1] }] : [{ type: s.type, e: winners[0] }];
			for (const t of targets) {
				const entry = t.e ? byId.get(t.e.entryId) : null;
				const row = existing.find((a) => a.type === t.type) ?? have[0];
				if (row) {
					if (row.entryId == null || row.type === t.type) await this.awardsRepository.update(row.id, { entryId: entry?.id ?? null, userIds: entry?.userIds ?? [], awardedAt: entry ? new Date() : null });
				} else {
					await this.awardsRepository.insertOne({ id: this.idService.gen(), competitionId: c.id, type: t.type, name: t.type === 'coThird' ? '3rd place' : s.name, description: null, entryId: entry?.id ?? null, userIds: entry?.userIds ?? [], enabled: true, awardedAt: entry ? new Date() : null, createdAt: new Date() });
				}
				if (entry) for (const uid of entry.userIds) this.notify(uid, c, 'You placed!', `${entry.name} finished ${t.type === 'coThird' ? '3rd' : s.name.replace(' place', '')} in ${c.name}.`);
			}
		}
	}

	@bindThis
	public async upsertAward(c: MiCompetition, host: MiUser, data: { awardId: string | null; type?: MiCompetitionAward['type'] | null; name?: string | null; description?: string | null; entryId?: string | null; enabled?: boolean | null; remove?: boolean | null }): Promise<MiCompetitionAward | null> {
		if (!this.isHost(c, host.id)) throw this.err('not_host', 'Only the host can do this.');
		let entry: MiCompetitionEntry | null = null;
		if (data.entryId) { entry = await this.entriesRepository.findOneBy({ id: data.entryId, competitionId: c.id }); if (!entry) throw this.err('no_such_entry', 'No such entry.'); }
		if (data.awardId) {
			const a = await this.awardsRepository.findOneBy({ id: data.awardId, competitionId: c.id });
			if (!a) throw this.err('no_such_award', 'No such award.');
			if (data.remove) { await this.awardsRepository.delete(a.id); return null; }
			const upd: Partial<MiCompetitionAward> = {};
			if (data.name != null && data.name.trim()) upd.name = data.name.trim();
			if (data.description !== undefined) upd.description = data.description;
			if (data.enabled != null) upd.enabled = data.enabled;
			if (data.entryId !== undefined) { upd.entryId = entry?.id ?? null; upd.userIds = entry?.userIds ?? []; upd.awardedAt = entry ? new Date() : null; }
			await this.awardsRepository.update(a.id, upd);
			if (entry && data.entryId !== undefined) for (const uid of entry.userIds) this.notify(uid, c, 'Award', `${entry.name} received "${upd.name ?? a.name}" in ${c.name}.`);
			return await this.awardsRepository.findOneBy({ id: a.id });
		}
		const name = (data.name ?? '').trim();
		if (!name) throw this.err('no_such_award', 'An award needs a name.');
		const a = await this.awardsRepository.insertOne({ id: this.idService.gen(), competitionId: c.id, type: data.type ?? 'custom', name, description: data.description ?? null, entryId: entry?.id ?? null, userIds: entry?.userIds ?? [], enabled: data.enabled ?? true, awardedAt: entry ? new Date() : null, createdAt: new Date() });
		if (entry) for (const uid of entry.userIds) this.notify(uid, c, 'Award', `${entry.name} received "${name}" in ${c.name}.`);
		return a;
	}

	/** A player's placements (users/show `placements`): every enabled award naming them, newest first. */
	@bindThis
	public async placementsOf(userId: string): Promise<{ competitionId: string; competitionName: string; type: string; name: string; entryName: string; awardedAt: string | null }[]> {
		const rows = await this.awardsRepository.createQueryBuilder('a')
			.innerJoin('competition', 'c', 'c.id = a."competitionId"')
			.leftJoin('competition_entry', 'e', 'e.id = a."entryId"')
			.select(['a."competitionId" AS "competitionId"', 'c.name AS "competitionName"', 'a.type AS type', 'a.name AS name', 'e.name AS "entryName"', 'a."awardedAt" AS "awardedAt"'])
			.where(':uid = ANY(a."userIds")', { uid: userId }).andWhere('a.enabled = true')
			.orderBy('a."awardedAt"', 'DESC').limit(50).getRawMany();
		return rows.map((r) => ({ competitionId: r.competitionId, competitionName: r.competitionName, type: r.type, name: r.name, entryName: r.entryName ?? '', awardedAt: r.awardedAt ? new Date(r.awardedAt).toISOString() : null }));
	}

	/** BACKEND-DELIVERY-V1: a draw generated by the host reaches every confirmed entrant (the start sends its own line). */
	private notifyDraw(c: MiCompetition, host: MiUser, confirmed: MiCompetitionEntry[]): void {
		for (const e of confirmed) for (const uid of e.userIds) if (uid !== host.id) this.notify(uid, c, 'Draw published', `The draw for ${c.name} is out. Check your matches.`);
	}

	// ================================================================================ COMP-W1B4 (2026-09-20)
	// Teams with consent (T1 partner consent), join an existing team, free agents, staff, announcements.

	/** A team is complete when it has its minimum of ACCEPTED players (a reserved spot — no users — counts as complete). */
	@bindThis
	public isComplete(c: MiCompetition, e: MiCompetitionEntry): boolean {
		if (e.status === 'freeAgent') return false;
		if (!e.captainId && e.userIds.length === 0) return true;
		return e.userIds.length >= c.teamMinSize;
	}

	/** Places still open in a team: max size minus accepted players and open invitations. */
	@bindThis
	public openSlots(c: MiCompetition, e: MiCompetitionEntry): number {
		if (e.status !== 'confirmed' && e.status !== 'pending') return 0;
		if (!e.captainId) return 0;
		return Math.max(0, c.teamMaxSize - e.userIds.length - (e.invitedUserIds ?? []).length);
	}

	/** Invited to, asking to join, or a free agent in this competition (sees a private competition, no seat yet). */
	private async hasPendingRole(c: MiCompetition, userId: string): Promise<boolean> {
		return await this.entriesRepository.createQueryBuilder('e')
			.where('e."competitionId" = :cid', { cid: c.id })
			.andWhere('(:uid = ANY(e."invitedUserIds") OR :uid = ANY(e."requestedUserIds") OR (e.status IN (\'freeAgent\', \'spectator\') AND :uid = ANY(e."userIds")))', { uid: userId })
			.andWhere('e.status IN (:...st)', { st: ['pending', 'confirmed', 'freeAgent', 'spectator'] })   // COMP-T3-V1: a spectator
			.getExists();
	}

	/** Refuses a team in which any two players block each other, in either direction (competition:blocked). */
	@bindThis
	public async assertNoBlocks(userIds: string[]): Promise<void> {
		const ids = Array.from(new Set(userIds.filter(Boolean)));
		if (ids.length < 2) return;
		const hit = await this.blockingsRepository.exists({ where: { blockerId: In(ids), blockeeId: In(ids) } });
		if (hit) throw this.err('blocked', 'You cannot play in a team with this player.');
	}

	/** Each invitee hears who invited them, to which competition and team (the link opens the competition). */
	@bindThis
	public notifyInvites(c: MiCompetition, e: MiCompetitionEntry, inviter: MiUser, userIds?: string[]): void {
		for (const uid of userIds ?? e.invitedUserIds ?? []) this.notify(uid, c, 'Team invitation', `${inviter.name ?? inviter.username} invited you to play ${c.name} in the team ${e.name}.`);
	}

	/** The accepted entry a user plays in (pending / confirmed / forfeit), excluding one entry. */
	private async acceptedEntryOf(c: MiCompetition, userId: string, exceptEntryId?: string): Promise<MiCompetitionEntry | null> {
		const e = await this.myEntry(c, userId);
		return e && e.id !== exceptEntryId ? e : null;
	}

	private async entryOrFail(c: MiCompetition, entryId: string): Promise<MiCompetitionEntry> {
		const e = await this.entriesRepository.findOneBy({ id: entryId, competitionId: c.id });
		if (!e) throw this.err('no_such_entry', 'No such entry.');
		return e;
	}

	/** Seats a player in a team: the free-agent row is closed, other asks of this player in the competition dropped. */
	private async seat(c: MiCompetition, e: MiCompetitionEntry, userId: string): Promise<MiCompetitionEntry> {
		const userIds = e.userIds.includes(userId) ? e.userIds : [...e.userIds, userId];
		await this.entriesRepository.update(e.id, {
			userIds, captainId: e.captainId ?? userId,
			invitedUserIds: (e.invitedUserIds ?? []).filter((x) => x !== userId),
			requestedUserIds: (e.requestedUserIds ?? []).filter((x) => x !== userId),
		});
		await this.entriesRepository.update({ competitionId: c.id, status: 'freeAgent', captainId: userId }, { status: 'withdrawn', statusChangedAt: new Date() });
		const others = await this.entriesRepository.createQueryBuilder('x').where('x."competitionId" = :cid', { cid: c.id }).andWhere('x.id <> :eid', { eid: e.id })
			.andWhere(':uid = ANY(x."requestedUserIds")', { uid: userId }).getMany();
		for (const o of others) await this.entriesRepository.update(o.id, { requestedUserIds: o.requestedUserIds.filter((x) => x !== userId) });
		await this.closeAsksElsewhere(c, userId, e.id); // batch-1 review fix: no phantom invitation on another team
		if (e.status === 'confirmed') await this.joinChat(c, [userId]);
		return (await this.entriesRepository.findOneBy({ id: e.id }))!;
	}

	/** Batch-1 review fix: a player who now plays in one team is taken out of every OTHER live team's open invitations
	 *  (its captain is told — the place is open again) and join requests (silently). */
	private async closeAsksElsewhere(c: MiCompetition, userId: string, exceptEntryId: string): Promise<void> {
		const others = await this.entriesRepository.createQueryBuilder('x').where('x."competitionId" = :cid', { cid: c.id }).andWhere('x.id <> :eid', { eid: exceptEntryId })
			.andWhere('x.status IN (:...st)', { st: ['pending', 'confirmed'] })
			.andWhere('(:uid = ANY(x."invitedUserIds") OR :uid = ANY(x."requestedUserIds"))', { uid: userId }).getMany();
		if (!others.length) return;
		const u = await this.usersRepository.findOneBy({ id: userId });
		const who = u ? (u.name ?? u.username) : 'A player';
		for (const o of others) {
			const wasInvited = (o.invitedUserIds ?? []).includes(userId);
			await this.entriesRepository.update(o.id, { invitedUserIds: (o.invitedUserIds ?? []).filter((x) => x !== userId), requestedUserIds: (o.requestedUserIds ?? []).filter((x) => x !== userId) });
			/* FRESH-EYES P2-13 (2026-09-20): a tester read "Mei Lam joined another team in [probe] W1B4-consent 2310;
			 * the place in Amy Chan is open again." — Amy Chan being the READER'S OWN name. `o.name` is the ENTRY's
			 * name, and an entry with no team name is named after its captain, who is exactly the person this
			 * notification is addressed to. A sentence written to someone must never carry their own name as a
			 * variable: from their side the entry is "your team". */
			if (wasInvited && o.captainId && o.captainId !== userId) this.notify(o.captainId, c, 'Team invitation closed', `${who} joined another team in ${c.name}; your team has a place open again.`);
		}
	}

	/** My open invitations across competitions still taking entries (newest first). */
	@bindThis
	public async invitationsOf(userId: string): Promise<{ c: MiCompetition; e: MiCompetitionEntry }[]> {
		const es = await this.entriesRepository.createQueryBuilder('e')
			.where(':uid = ANY(e."invitedUserIds")', { uid: userId })
			.andWhere('e.status IN (:...st)', { st: ['pending', 'confirmed'] })
			.orderBy('e."createdAt"', 'DESC').take(50).getMany();
		const cs = es.length ? await this.competitionsRepository.findBy({ id: In(es.map((e) => e.competitionId)) }) : [];
		const byId = new Map(cs.map((c) => [c.id, c]));
		return es.map((e) => ({ c: byId.get(e.competitionId)!, e })).filter((x) => x.c && ['open', 'closed'].includes(x.c.status));
	}

	/** The entry inviting this user in a competition (or null). */
	@bindThis
	public async invitationIn(c: MiCompetition, userId: string | null | undefined): Promise<MiCompetitionEntry | null> {
		if (!userId) return null;
		return await this.entriesRepository.createQueryBuilder('e').where('e."competitionId" = :cid', { cid: c.id })
			.andWhere(':uid = ANY(e."invitedUserIds")', { uid: userId }).andWhere('e.status IN (:...st)', { st: ['pending', 'confirmed'] }).getOne();
	}

	/** Accept (seated, joins the chat, the captain hears it) or decline (the place opens again) a team invitation. */
	@bindThis
	public async respondInvitation(c: MiCompetition, me: MiUser, entryId: string, accept: boolean): Promise<MiCompetitionEntry> {
		const e = await this.entriesRepository.findOneBy({ id: entryId, competitionId: c.id });
		if (!e || !(e.invitedUserIds ?? []).includes(me.id) || !['pending', 'confirmed'].includes(e.status)) throw this.err('no_such_invitation', 'No such invitation.');
		if (!accept) {
			await this.entriesRepository.update(e.id, { invitedUserIds: e.invitedUserIds.filter((x) => x !== me.id) });
			if (e.captainId) this.notify(e.captainId, c, 'Invitation declined', `${me.name ?? me.username} declined to play ${c.name} in ${e.name}.`);
			return (await this.entriesRepository.findOneBy({ id: e.id }))!;
		}
		if (c.status !== 'open' && c.status !== 'closed') throw this.err('started', 'The competition has started.');
		if (await this.acceptedEntryOf(c, me.id, e.id)) throw this.err('already_entered', 'You already play in another team of this competition.');
		await this.assertNoBlocks([...e.userIds, me.id]);
		const seated = await this.seat(c, e, me.id);
		if (e.captainId) this.notify(e.captainId, c, 'Invitation accepted', `${me.name ?? me.username} accepted to play ${c.name} in ${e.name}.`);
		return seated;
	}

	/** The captain (or a manager) invites more partners after a decline, or cancels an open invitation. */
	@bindThis
	public async setPartners(c: MiCompetition, actor: MiUser, entryId: string, data: { invite?: string[] | null; cancel?: string[] | null }): Promise<MiCompetitionEntry> {
		const e = await this.entryOrFail(c, entryId);
		if (e.captainId !== actor.id && !this.isHost(c, actor.id)) throw this.err('forbidden', 'Only the captain can invite partners.');
		if (c.status !== 'open' && c.status !== 'closed') throw this.err('started', 'The competition has started.');
		let invited = (e.invitedUserIds ?? []).filter((x) => !(data.cancel ?? []).includes(x));
		const add = Array.from(new Set((data.invite ?? []).filter((x) => !e.userIds.includes(x) && !invited.includes(x))));
		if (add.length) {
			if (e.userIds.length + invited.length + add.length > c.teamMaxSize) throw this.err('team_full', 'This team has no place left.');
			if ((await this.usersRepository.countBy({ id: In(add) })) !== add.length) throw this.err('bad_team', 'A player does not exist.');
			if (!this.isHost(c, actor.id)) await this.assertMayJoin(c, add);   // COMP-T3-V1: a captain invites club members only
			await this.assertNoBlocks([...e.userIds, ...add]);
			for (const uid of add) if (await this.acceptedEntryOf(c, uid, e.id)) throw this.err('already_entered', 'A player already plays in another team of this competition.');
			invited = [...invited, ...add];
		}
		await this.entriesRepository.update(e.id, { invitedUserIds: invited });
		const after = (await this.entriesRepository.findOneBy({ id: e.id }))!;
		if (add.length) this.notifyInvites(c, after, actor, add);
		return after;
	}

	/** Join an existing team (Reclub "Join" on a team that needs players): ask, or take the ask back. */
	@bindThis
	public async requestJoin(c: MiCompetition, me: MiUser, entryId: string, cancel: boolean, accessToken?: string | null): Promise<MiCompetitionEntry> {
		const e = await this.entryOrFail(c, entryId);
		if (cancel) {
			await this.entriesRepository.update(e.id, { requestedUserIds: (e.requestedUserIds ?? []).filter((x) => x !== me.id) });
			return (await this.entriesRepository.findOneBy({ id: e.id }))!;
		}
		await this.assertVisible(c, me, accessToken);
		if (!this.registrationOpen(c)) throw this.err('registration_closed', 'Registration is closed.');
		await this.assertMayJoin(c, [me.id]);   // COMP-T3-V1
		if (e.status === 'freeAgent' || this.openSlots(c, e) <= 0) throw this.err('team_full', 'This team has no place left.');
		if (e.userIds.includes(me.id)) throw this.err('already_entered', 'You are in this team.');
		if (await this.acceptedEntryOf(c, me.id)) throw this.err('already_entered', 'You already play in a team of this competition.');
		await this.assertNoBlocks([...e.userIds, me.id]);
		if (!(e.requestedUserIds ?? []).includes(me.id)) await this.entriesRepository.update(e.id, { requestedUserIds: [...(e.requestedUserIds ?? []), me.id] });
		if (e.captainId) this.notify(e.captainId, c, 'Join request', `${me.name ?? me.username} asked to join ${e.name} in ${c.name}.`);
		return (await this.entriesRepository.findOneBy({ id: e.id }))!;
	}

	/** The captain (or a manager) accepts or declines a player who asked to join the team. */
	@bindThis
	public async decideJoin(c: MiCompetition, actor: MiUser, entryId: string, userId: string, accept: boolean): Promise<MiCompetitionEntry> {
		const e = await this.entryOrFail(c, entryId);
		if (e.captainId !== actor.id && !this.isHost(c, actor.id)) throw this.err('forbidden', 'Only the captain can answer a join request.');
		if (!(e.requestedUserIds ?? []).includes(userId)) throw this.err('no_such_invitation', 'No such request.');
		if (!accept) {
			await this.entriesRepository.update(e.id, { requestedUserIds: e.requestedUserIds.filter((x) => x !== userId) });
			this.notify(userId, c, 'Join request declined', `${e.name} did not take your request in ${c.name}.`);
			return (await this.entriesRepository.findOneBy({ id: e.id }))!;
		}
		if (c.status !== 'open' && c.status !== 'closed') throw this.err('started', 'The competition has started.');
		if (this.openSlots(c, e) <= 0) throw this.err('team_full', 'This team has no place left.');
		if (await this.acceptedEntryOf(c, userId, e.id)) throw this.err('already_entered', 'This player already plays in another team.');
		await this.assertNoBlocks([...e.userIds, userId]);
		const seated = await this.seat(c, e, userId);
		this.notify(userId, c, 'Join request accepted', `You are in ${e.name} for ${c.name}.`);
		return seated;
	}

	/** Join as a free agent (Reclub): one row per player with notes; leave takes it back. */
	@bindThis
	public async freeAgent(c: MiCompetition, me: MiUser, data: { notes?: string | null; leave?: boolean | null; accessToken?: string | null }): Promise<MiCompetitionEntry | null> {
		const mine = await this.entriesRepository.findOneBy({ competitionId: c.id, status: 'freeAgent', captainId: me.id });
		if (data.leave) {
			if (mine) await this.entriesRepository.update(mine.id, { status: 'withdrawn', statusChangedAt: new Date() });
			return null;
		}
		await this.assertVisible(c, me, data.accessToken);
		if (c.participantType === 'singles') throw this.err('bad_team', 'A singles competition has no teams — join it directly.');
		if (!this.registrationOpen(c)) throw this.err('registration_closed', 'Registration is closed.');
		await this.assertMayJoin(c, [me.id]);   // COMP-T3-V1
		if (await this.acceptedEntryOf(c, me.id)) throw this.err('already_entered', 'You already play in a team of this competition.');
		const notes = (data.notes ?? '').trim().slice(0, 512) || null;
		if (mine) { await this.entriesRepository.update(mine.id, { notes }); return (await this.entriesRepository.findOneBy({ id: mine.id }))!; }
		const e = await this.entriesRepository.insertOne({ id: this.idService.gen(), competitionId: c.id, name: me.name ?? me.username, captainId: me.id, userIds: [me.id], invitedUserIds: [], requestedUserIds: [], seed: null, pool: null, status: 'freeAgent', isPaid: false, notes, createdById: me.id, createdAt: new Date(), statusChangedAt: new Date() });
		this.notify(c.hostId, c, 'New free agent', `${e.name} is looking for a team in ${c.name}.`);
		return e;
	}

	/** A manager places a free agent in a team with an open place (Reclub "Assign team"). */
	@bindThis
	public async assignFreeAgent(c: MiCompetition, actor: MiUser, freeAgentEntryId: string, entryId: string): Promise<MiCompetitionEntry> {
		if (!this.isHost(c, actor.id)) throw this.err('not_host', 'Only the host can do this.');
		const fa = await this.entryOrFail(c, freeAgentEntryId);
		if (fa.status !== 'freeAgent' || !fa.captainId) throw this.err('no_such_entry', 'No such free agent.');
		const e = await this.entryOrFail(c, entryId);
		if (e.status === 'freeAgent' || this.openSlots(c, e) <= 0) throw this.err('team_full', 'This team has no place left.');
		await this.assertNoBlocks([...e.userIds, fa.captainId]);
		const seated = await this.seat(c, e, fa.captainId);
		this.notify(fa.captainId, c, 'You have a team', `The host placed you in ${e.name} for ${c.name}.`);
		if (e.captainId && e.captainId !== actor.id) this.notify(e.captainId, c, 'New teammate', `The host added ${fa.name} to ${e.name} in ${c.name}.`);
		return seated;
	}

	/** Staff (Reclub Admins + Referees): the owner or a co-admin adds / removes a co-admin or a referee. */
	@bindThis
	public async setStaff(c: MiCompetition, actor: MiUser, userId: string, role: 'admin' | 'referee' | null): Promise<MiCompetition> {
		if (!this.isHost(c, actor.id)) throw this.err('not_host', 'Only the host can do this.');
		if (userId === c.hostId) throw this.err('forbidden', 'The host is always an admin.');
		// batch-1 review fix (operator): co-admins may add / remove referees; only the host adds or removes co-admins
		if ((role === 'admin' || (c.adminIds ?? []).includes(userId)) && !this.isOwner(c, actor.id)) throw this.err('not_host', 'Only the host can add or remove co-admins.');
		if (role && !(await this.usersRepository.existsBy({ id: userId }))) throw this.err('no_such_entry', 'No such user.');
		if (role) await this.assertNoBlocks([c.hostId, userId]);
		const admins = (c.adminIds ?? []).filter((x) => x !== userId);
		const refs = (c.refereeIds ?? []).filter((x) => x !== userId);
		if (role === 'admin') admins.push(userId);
		if (role === 'referee') refs.push(userId);
		await this.competitionsRepository.update(c.id, { adminIds: admins, refereeIds: refs, updatedAt: new Date() });
		if (role) this.notify(userId, c, role === 'admin' ? 'You are a co-admin' : 'You are a referee', role === 'admin' ? `${actor.name ?? actor.username} made you a co-admin of ${c.name}.` : `${actor.name ?? actor.username} made you a referee of ${c.name}.`);
		return await this.get(c.id);
	}

	/** Announcements (Reclub "Need to announce something? / Post announcement"): every player and staff member hears it. */
	@bindThis
	public async postAnnouncement(c: MiCompetition, actor: MiUser, text: string): Promise<MiCompetition> {
		if (!this.isHost(c, actor.id)) throw this.err('not_host', 'Only the host can do this.');
		const t = text.trim();
		if (!t) throw this.err('no_such_announcement', 'An announcement needs text.');
		const a: CompetitionAnnouncement = { id: this.idService.gen(), userId: actor.id, text: t.slice(0, 2000), createdAt: new Date().toISOString() };
		await this.competitionsRepository.update(c.id, { announcements: [a, ...(c.announcements ?? [])].slice(0, 50), updatedAt: new Date() });
		const to = new Set<string>([c.hostId, ...(c.adminIds ?? []), ...(c.refereeIds ?? [])]);
		for (const e of await this.entries(c)) if (['pending', 'confirmed', 'forfeit', 'freeAgent', 'spectator'].includes(e.status)) for (const uid of e.userIds) to.add(uid);   // COMP-T3-V1: + spectators
		to.delete(actor.id);
		for (const uid of to) this.notify(uid, c, 'Announcement', `${c.name}: ${a.text.length > 140 ? a.text.slice(0, 139) + '…' : a.text}`);
		return await this.get(c.id);
	}

	@bindThis
	public async deleteAnnouncement(c: MiCompetition, actor: MiUser, announcementId: string): Promise<MiCompetition> {
		if (!this.isHost(c, actor.id)) throw this.err('not_host', 'Only the host can do this.');
		const list = c.announcements ?? [];
		if (!list.some((a) => a.id === announcementId)) throw this.err('no_such_announcement', 'No such announcement.');
		await this.competitionsRepository.update(c.id, { announcements: list.filter((a) => a.id !== announcementId), updatedAt: new Date() });
		return await this.get(c.id);
	}

	// ================================================================================ COMP-T3-V1 (2026-09-23)
	// The verified-missing tail of the Reclub triage (probes/t3-competitions.verdict.json).

	/** Reclub create wizard: registration open ≤ early bird ≤ registration deadline ≤ start (unset dates are skipped). */
	private assertTimeline(x: Partial<Pick<MiCompetition, 'registrationOpenAt' | 'earlyBirdAt' | 'registrationCloseAt' | 'startAt'>>): void {
		const chain: [string, Date | null | undefined][] = [['Registration open', x.registrationOpenAt], ['Early bird deadline', x.earlyBirdAt], ['Registration deadline', x.registrationCloseAt], ['Start', x.startAt]];
		let prev: [string, Date] | null = null;
		for (const [label, d] of chain) {
			if (!(d instanceof Date)) continue;
			if (prev && d.getTime() < prev[1].getTime()) throw this.err('bad_timeline', `${label} cannot be before ${prev[0].toLowerCase()}.`);
			prev = [label, d];
		}
	}

	private cleanLabels(labels: string[]): string[] { return labels.map((l) => String(l).trim().slice(0, 32)).filter(Boolean).slice(0, 16); }

	/** One club-member question, answered by the ONE rule (club-tiers.ts memberExistsSql = ClubService.isMember). */
	private async isClubMember(channelId: string, userId: string): Promise<boolean> {
		const r = await this.db.query(`SELECT ${memberExistsSql('$1', '$2')} AS "m"`, [channelId, userId]) as { m: boolean }[];
		return !!(r[0] && r[0].m);
	}

	/** A club competition marked membersOnly takes the club's members only (the host and co-admins add anyone). */
	private async assertMayJoin(c: MiCompetition, userIds: string[]): Promise<void> {
		if (!c.membersOnly || !c.channelId) return;
		for (const uid of userIds) if (!(await this.isClubMember(c.channelId, uid))) throw this.err('members_only', 'This competition is for the club members only.');
	}

	/** True when the user may take part under the members-only rule (always true without it). */
	@bindThis
	public async passesMembersOnly(c: MiCompetition, userId: string | null | undefined): Promise<boolean> {
		if (!c.membersOnly || !c.channelId) return true;
		if (!userId) return false;
		return this.isHost(c, userId) || await this.isClubMember(c.channelId, userId);
	}

	@bindThis
	public async mySpectator(c: MiCompetition, userId: string | null | undefined): Promise<MiCompetitionEntry | null> {
		if (!userId) return null;
		return await this.entriesRepository.findOneBy({ competitionId: c.id, status: 'spectator', captainId: userId });
	}

	/** Reclub "Join as a spectator" (auto approved) / "Cancel request": a row holding no seat. A player is not also a spectator;
	 *  a free agent who spectates stops looking for a team (the same row, now a spectator). */
	@bindThis
	public async spectate(c: MiCompetition, me: MiUser, data: { leave?: boolean | null; accessToken?: string | null }): Promise<MiCompetitionEntry | null> {
		const mine = await this.mySpectator(c, me.id);
		if (data.leave) { if (mine) await this.entriesRepository.update(mine.id, { status: 'withdrawn', statusChangedAt: new Date() }); return null; }
		await this.assertVisible(c, me, data.accessToken);
		if (c.status === 'done' || c.status === 'cancelled' || c.status === 'draft') throw this.err('invalid_transition', `Cannot spectate a competition that is ${c.status}.`);
		await this.assertMayJoin(c, [me.id]);
		if (await this.myEntry(c, me.id)) throw this.err('already_entered', 'You already play in this competition.');
		if (mine) return mine;
		const fa = await this.entriesRepository.findOneBy({ competitionId: c.id, status: 'freeAgent', captainId: me.id });
		if (fa) { await this.entriesRepository.update(fa.id, { status: 'spectator', statusChangedAt: new Date() }); return (await this.entriesRepository.findOneBy({ id: fa.id }))!; }
		return await this.entriesRepository.insertOne({ id: this.idService.gen(), competitionId: c.id, name: me.name ?? me.username, captainId: me.id, userIds: [me.id], invitedUserIds: [], requestedUserIds: [], seed: null, pool: null, status: 'spectator', isPaid: false, notes: null, eligibility: {}, avatarFileId: null, createdById: me.id, createdAt: new Date(), statusChangedAt: new Date() });
	}

	/** Reclub Create / edit team: the captain (or a manager) renames the team, writes its description, sets its avatar
	 *  (a drive image of the one setting it; null clears). */
	@bindThis
	public async editTeam(c: MiCompetition, actor: MiUser, entryId: string, data: { name?: string | null; notes?: string | null; avatarFileId?: string | null }): Promise<MiCompetitionEntry> {
		const e = await this.entryOrFail(c, entryId);
		if (e.captainId !== actor.id && !this.isHost(c, actor.id)) throw this.err('forbidden', 'Only the captain can edit the team.');
		if (c.status === 'cancelled' || !['pending', 'confirmed', 'forfeit'].includes(e.status)) throw this.err('invalid_transition', 'This team cannot be edited.');
		const upd: Partial<MiCompetitionEntry> = {};
		if (data.name != null) { const n = data.name.trim().slice(0, 128); if (n) upd.name = n; }
		if (data.notes !== undefined) upd.notes = data.notes == null ? null : (data.notes.trim().slice(0, 512) || null);
		if (data.avatarFileId !== undefined) {
			if (data.avatarFileId === null) upd.avatarFileId = null;
			else {
				const f = await this.driveFilesRepository.findOneBy({ id: data.avatarFileId, userId: actor.id });
				if (!f || !f.type.startsWith('image/')) throw this.err('no_such_file', 'No such image.');
				upd.avatarFileId = f.id;
			}
		}
		if (Object.keys(upd).length) await this.entriesRepository.update(e.id, upd);
		return (await this.entriesRepository.findOneBy({ id: e.id }))!;
	}

	/** Reclub "Are you able to attend this match?" Can go / Maybe / Can't go — a player of the match for themself, or the
	 *  host / a referee / the entry's captain for one of its players; null clears. */
	@bindThis
	public async setAvailability(c: MiCompetition, actor: MiUser, matchId: string, userId: string | null, status: 'yes' | 'maybe' | 'no' | null): Promise<MiCompetitionMatch> {
		const m = await this.matchesRepository.findOneBy({ id: matchId, competitionId: c.id });
		if (!m) throw this.err('no_such_match', 'No such match.');
		if (c.status === 'done' || c.status === 'cancelled' || m.status === 'completed' || m.status === 'cancelled') throw this.err('invalid_transition', 'This match is over.');
		const uid = userId ?? actor.id;
		const es = await this.entriesRepository.findBy({ id: In([m.entry1Id, m.entry2Id].filter((x): x is string => !!x)) });
		const entry = es.find((e) => e.userIds.includes(uid));
		if (!entry) throw this.err('no_such_entry', 'That player is not in this match.');
		if (uid !== actor.id && !this.isHost(c, actor.id) && !this.isReferee(c, actor.id) && !(m.refereeIds ?? []).includes(actor.id) && entry.captainId !== actor.id) throw this.err('forbidden', 'Only the player, the captain or the staff can set this.');
		const next = { ...(m.availability ?? {}) };
		if (status == null) delete next[uid]; else next[uid] = status;
		await this.matchesRepository.update(m.id, { availability: next, updatedAt: new Date() });
		return (await this.matchesRepository.findOneBy({ id: m.id }))!;
	}

	/**
	 * Eligibility of every member of the given entries (Reclub "Ineligible" tag / "This team has ineligible member(s)"):
	 * the host's call when there is one (entry.eligibility), else the automatic rule — hkpl lib/eligibility-auto.js
	 * (DIVISION-RATING-AUTO-ELIGIBILITY-V1): the competition's MAX level is the cap, playing up below the min is allowed, an
	 * unrated player is flagged for review when there is a cap; gender / age-group restrictions are hard gates exactly as
	 * MeetLevelService.gateVerdict has them. Levels are the meets' own (meet_player_level): DUPR singles for a singles
	 * competition, DUPR doubles otherwise, the self level when DUPR is absent.
	 */
	@bindThis
	public async eligibilityOf(c: MiCompetition, entries: MiCompetitionEntry[]): Promise<Map<string, { ineligibleUserIds: string[]; reasons: Record<string, string> }>> {
		const out = new Map<string, { ineligibleUserIds: string[]; reasons: Record<string, string> }>();
		const uids = Array.from(new Set(entries.flatMap((e) => e.userIds)));
		const gated = c.maxLevel != null || (c.gender !== 'any' && c.gender !== 'coed') || c.ageGroup !== 'any';
		const levels = gated && uids.length ? await this.meetPlayerLevelsRepository.find({ where: { userId: In(uids), sport: c.sport } }) : [];
		const byUser = new Map(levels.map((l) => [l.userId, l]));
		for (const e of entries) {
			const reasons: Record<string, string> = {};
			for (const uid of e.userIds) {
				const manual = (e.eligibility ?? {})[uid];
				if (manual === true) continue;
				if (manual === false) { reasons[uid] = 'host'; continue; }
				if (!gated) continue;
				const l = byUser.get(uid) ?? null;
				if (c.gender !== 'any' && c.gender !== 'coed' && (l?.gender == null || l.gender !== c.gender)) { reasons[uid] = 'gender'; continue; }
				if (c.ageGroup !== 'any' && (l?.ageGroup == null || l.ageGroup !== c.ageGroup)) { reasons[uid] = 'age_group'; continue; }
				if (c.maxLevel != null) {
					const v = l ? ((c.participantType === 'singles' ? l.duprSingles : l.duprDoubles) ?? l.selfLevel) : null;
					if (v == null) { reasons[uid] = 'no_rating'; continue; }
					if (v > c.maxLevel) { reasons[uid] = 'above_max'; continue; }
				}
			}
			out.set(e.id, { ineligibleUserIds: Object.keys(reasons), reasons });
		}
		return out;
	}

	/** Reclub "You're about to publish… a push notification to the community" (public competitions): a club competition
	 *  tells the club's members (minus members on a break — the meets' PROMOTE-AUDIENCE-V1 'club' audience,
	 *  MeetExtras.ts:204-207), any other the host's followers. One push per competition: publish happens once, from draft. */
	private async notifyPublished(c: MiCompetition, host: MiUser): Promise<void> {
		if (c.visibility !== 'public') return;
		try {
			const rows = c.channelId
				? await this.db.query(`SELECT u."id" FROM "user" u WHERE u."host" IS NULL AND u."isSuspended" = false AND u."isDeleted" = false AND u."id" <> $2 AND ${memberExistsSql('$1', 'u."id"')}
					AND NOT EXISTS (SELECT 1 FROM "club_member_state" s WHERE s."channelId" = $1 AND s."userId" = u."id" AND s."pausedAt" IS NOT NULL) LIMIT 500`, [c.channelId, host.id]) as { id: string }[]
				: await this.db.query(`SELECT f."followerId" AS "id" FROM "following" f JOIN "user" u ON u."id" = f."followerId" WHERE f."followeeId" = $1 AND u."host" IS NULL AND u."isSuspended" = false AND u."isDeleted" = false LIMIT 500`, [host.id]) as { id: string }[];
			for (const r of rows) if (r.id !== host.id) this.notify(r.id, c, 'New competition', `${host.name ?? host.username} published a competition: ${c.name}.`);
		} catch { /* a failed push never blocks the publish */ }
	}

	private notify(userId: string, c: MiCompetition, header: string, body: string): void {
		this.notificationService.createNotification(userId, 'app', { customHeader: header, customBody: body, customIcon: null, appAccessTokenId: null, customLink: 'competition:' + c.id });
	}
}

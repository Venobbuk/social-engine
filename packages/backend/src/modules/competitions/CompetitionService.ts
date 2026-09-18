/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { In } from 'typeorm';
import { DI } from '@/di-symbols.js';
import type { CompetitionsRepository, CompetitionEntriesRepository, CompetitionMatchesRepository, CompetitionAwardsRepository, UsersRepository } from '@/models/_.js';
import type { MiUser } from '@/models/User.js';
import { IdService } from '@/core/IdService.js';
import { ChatService } from '@/core/ChatService.js';
import { NotificationService } from '@/core/NotificationService.js';
import { bindThis } from '@/decorators.js';
import { secureRndstr, L_CHARS } from '@/misc/secure-rndstr.js';
import { IdentifiableError } from '@/misc/identifiable-error.js';
import { generate as generateRoundRobin, LIMITS as RR_LIMITS } from '@/modules/meets/MeetMatchGenerator.js';
import type { MiCompetition, CompetitionFormat } from './models/Competition.js';
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
	| 'no_such_entry' | 'needs_winner' | 'bracket_locked' | 'stage_incomplete' | 'no_such_award' | 'forbidden';

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
	public isHost(c: MiCompetition, userId: string | null | undefined): boolean { return !!userId && c.hostId === userId; }

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
		throw this.err('private', 'This competition is private, only invited people and participants can see.');
	}

	@bindThis
	public async entries(c: MiCompetition): Promise<MiCompetitionEntry[]> {
		return await this.entriesRepository.find({ where: { competitionId: c.id }, order: { seed: 'ASC', createdAt: 'ASC' } });
	}

	@bindThis
	public async confirmedEntries(c: MiCompetition): Promise<MiCompetitionEntry[]> {
		const all = await this.entries(c);
		const confirmed = all.filter((e) => e.status === 'confirmed' || e.status === 'forfeit');
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
			qb.where('c."hostId" = :me', { me: me.id });
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
		const structural = (['format', 'participantType', 'numGroups', 'numContinue', 'teamMinSize', 'teamMaxSize'] as const).filter((k) => data[k] !== undefined && data[k] !== c[k]);
		if (drawn && structural.length) throw this.err('draw_exists', 'The draw is generated — reset the competition before changing its format.');
		const type = (data.participantType ?? c.participantType) as MiCompetition['participantType'];
		const sizes = this.teamSizes(type, data.teamMinSize ?? c.teamMinSize, data.teamMaxSize ?? c.teamMaxSize);
		await this.competitionsRepository.update(c.id, { ...data, ...sizes, updatedAt: new Date() });
		if (data.name && c.chatRoomId) { const room = await this.chatService.findRoomById(c.chatRoomId); if (room) await this.chatService.updateRoom(room, { name: data.name }).catch(() => undefined); }
		return await this.get(c.id);
	}

	@bindThis
	public async setStatus(c: MiCompetition, host: MiUser, action: StatusAction): Promise<MiCompetition> {
		if (!this.isHost(c, host.id)) throw this.err('not_host', 'Only the host can do this.');
		const bad = () => this.err('invalid_transition', `Cannot ${action} a competition that is ${c.status}.`);
		const now = new Date();
		switch (action) {
			case 'publish':
				if (c.status !== 'draft') throw bad();
				await this.competitionsRepository.update(c.id, { status: 'open', lockRegistration: false, updatedAt: now });
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
	public async cancel(c: MiCompetition, host: MiUser): Promise<MiCompetition> {
		if (!this.isHost(c, host.id)) throw this.err('not_host', 'Only the host can do this.');
		if (c.status === 'cancelled' || c.status === 'done') throw this.err('invalid_transition', `Cannot cancel a competition that is ${c.status}.`);
		await this.competitionsRepository.update(c.id, { status: 'cancelled', cancelledAt: new Date(), updatedAt: new Date() });
		for (const e of await this.entries(c)) for (const uid of e.userIds) if (uid !== host.id) this.notify(uid, c, 'Competition cancelled', `${c.name} has been cancelled by the host.`);
		return await this.get(c.id);
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

	/** Self sign-up (Reclub join-competition). */
	@bindThis
	public async enter(c: MiCompetition, user: MiUser, data: { name?: string | null; partnerIds?: string[] | null; accessToken?: string | null }): Promise<MiCompetitionEntry> {
		await this.assertVisible(c, user, data.accessToken);
		if (!this.registrationOpen(c)) throw this.err('registration_closed', 'Registration is closed.');
		if ((await this.activeCount(c)) >= c.maxEntries) throw this.err('full', 'No spot left.');
		const userIds = [user.id, ...(data.partnerIds ?? []).filter((x) => x !== user.id)];
		await this.assertTeam(c, userIds);
		const name = (data.name ?? '').trim() || (user.name ?? user.username);
		const status = c.autoApprove ? 'confirmed' : 'pending';
		const entry = await this.entriesRepository.insertOne({ id: this.idService.gen(), competitionId: c.id, name, captainId: user.id, userIds, seed: null, pool: null, status, isPaid: false, notes: null, createdById: user.id, createdAt: new Date(), statusChangedAt: new Date() });
		if (status === 'confirmed') await this.joinChat(c, userIds);
		this.notify(c.hostId, c, status === 'confirmed' ? 'New entry' : 'Entry request', `${name} ${status === 'confirmed' ? 'entered' : 'requested to enter'} ${c.name}.`);
		return entry;
	}

	/** Leave before the start (Reclub "Leave competition"); during play the host forfeits the entry instead. */
	@bindThis
	public async withdraw(c: MiCompetition, user: MiUser): Promise<MiCompetitionEntry> {
		const e = await this.myEntry(c, user.id);
		if (!e) throw this.err('not_entered', 'You are not entered.');
		if (c.status === 'inProgress' || c.status === 'done') throw this.err('started', 'The competition has started — ask the host to forfeit your entry.');
		await this.entriesRepository.update(e.id, { status: 'withdrawn', statusChangedAt: new Date() });
		this.notify(c.hostId, c, 'Entry withdrawn', `${e.name} withdrew from ${c.name}.`);
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
	public async hostUpdateEntry(c: MiCompetition, host: MiUser, entryId: string, patch: { name?: string | null; userIds?: string[] | null; seed?: number | null; pool?: number | null; status?: 'confirmed' | 'withdrawn' | 'forfeit' | null; isPaid?: boolean | null; notes?: string | null; remove?: boolean | null }): Promise<MiCompetitionEntry | null> {
		if (!this.isHost(c, host.id)) throw this.err('not_host', 'Only the host can do this.');
		const e = await this.entriesRepository.findOneBy({ id: entryId, competitionId: c.id });
		if (!e) throw this.err('no_such_entry', 'No such entry.');
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
					await this.chatService.createRoomInvitation(room.ownerId, room.id, uid);
					await this.chatService.joinToRoom(uid, room.id);
				}
			} catch { /* already invited / room full: the chat door re-tries on open */ }
		}
	}

	/** The general chat room for a host or entrant (the club/meet chat room pattern). */
	@bindThis
	public async chatRoom(c: MiCompetition, user: MiUser): Promise<{ roomId: string }> {
		const entry = await this.myEntry(c, user.id);
		if (!this.isHost(c, user.id) && !(entry && entry.status !== 'pending')) throw this.err('forbidden', 'Only participants can open the competition chat.');
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
	public async draw(c: MiCompetition, host: MiUser, opts: { stage: 'auto' | 'regular' | 'playoff'; reset: boolean; skipStatusCheck?: boolean }): Promise<{ stage: 'regular' | 'playoff'; matches: MiCompetitionMatch[] }> {
		if (!this.isHost(c, host.id)) throw this.err('not_host', 'Only the host can do this.');
		if (!opts.skipStatusCheck && !['open', 'closed', 'inProgress'].includes(c.status)) throw this.err('invalid_transition', `Cannot draw a competition that is ${c.status}.`);
		if (opts.reset) {
			await this.matchesRepository.delete({ competitionId: c.id });
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
				gen.matches.forEach((m) => rows.push({ stage: 'regular', pool: pools === 1 ? null : p, round: m.round, number: m.courtIndex + 1, entry1Id: m.team1Ids[0], entry2Id: m.team2Ids[0], entry1Status: 'confirmed', entry2Status: 'confirmed', courtIndex: null }));
			}
			const saved: MiCompetitionMatch[] = [];
			for (const r of rows) saved.push(await this.matchesRepository.insertOne({ id: this.idService.gen(), competitionId: c.id, status: 'pending', scores: [], result: null, bracketId: null, bracketGroup: null, startAt: null, notes: null, isExtra: false, createdAt: new Date(), updatedAt: new Date(), ...r }));
			await this.competitionsRepository.update(c.id, { updatedAt: new Date() });
			return { stage, matches: saved };
		}

		// playoff: who is in, in seed order
		let seeded: string[];
		if (this.isKnockout(c.format)) {
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
		if (this.isHost(c, userId)) return true;
		const e = await this.myEntry(c, userId);
		return !!e && (m.entry1Id === e.id || m.entry2Id === e.id);
	}

	/**
	 * Reclub upsert-competition-score / match manage in one door. The host may create an extra match (no matchId).
	 * Scores from a player of the match are saved (inProgress); the host finalizes (completed), which fixes the
	 * result and, for a knockout match, advances the winner in the bracket.
	 */
	@bindThis
	public async upsertMatch(c: MiCompetition, user: MiUser, data: { matchId: string | null; scores?: CompetitionScoreSet[]; forfeit?: 'entry1' | 'entry2' | 'both' | null; finalize?: boolean; entry1Id?: string | null; entry2Id?: string | null; round?: number | null; courtIndex?: number | null; startAt?: Date | null; notes?: string | null; reopen?: boolean }): Promise<MiCompetitionMatch> {
		if (c.status !== 'inProgress' && !(this.isHost(c, user.id) && (c.status === 'open' || c.status === 'closed'))) throw this.err('invalid_transition', 'Scores can be entered once the competition has started.');
		let m: MiCompetitionMatch;
		if (data.matchId) {
			const found = await this.matchesRepository.findOneBy({ id: data.matchId, competitionId: c.id });
			if (!found) throw this.err('no_such_match', 'No such match.');
			m = found;
			if (!(await this.canScore(c, m, user.id))) throw this.err('forbidden', 'Only the host or a player of this match can score it.');
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
			if (Object.keys(upd).length) { await this.matchesRepository.update(m.id, upd); m = (await this.matchesRepository.findOneBy({ id: m.id }))!; }
		}
		if (data.reopen && host) {
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
			await this.applyResult(await this.get(c.id), m, { scores: data.scores ?? m.scores, forfeit: data.forfeit ?? null, finalize: host ? (data.finalize !== false) : false });
		}
		return (await this.matchesRepository.findOneBy({ id: m.id }))!;
	}

	private playoffStageId(db: BracketDb): number { const s = db.stage.slice().sort((a, b) => b.number - a.number)[0]; return s ? Number(s.id) : 1; }

	private async applyResult(c: MiCompetition, m: MiCompetitionMatch, r: { scores: CompetitionScoreSet[]; forfeit: 'entry1' | 'entry2' | 'both' | null; finalize: boolean }): Promise<void> {
		const knockout = m.bracketId != null;
		const scores = r.scores.map((s) => ({ t1: Math.max(0, s.t1 | 0), t2: Math.max(0, s.t2 | 0), type: s.type ?? 'standard' }));
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

	private notify(userId: string, c: MiCompetition, header: string, body: string): void {
		this.notificationService.createNotification(userId, 'app', { customHeader: header, customBody: body, customIcon: null, appAccessTokenId: null, customLink: 'competition:' + c.id });
	}
}

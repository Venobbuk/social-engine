/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { In, LessThan, Not } from 'typeorm';
import { DI } from '@/di-symbols.js';
import type { MeetsRepository, MeetParticipantsRepository, MeetPlayerLevelsRepository, UsersRepository } from '@/models/_.js';
import type { MiMeet } from '@/modules/meets/models/Meet.js';
import type { MiMeetParticipant } from '@/modules/meets/models/MeetParticipant.js';
import type { MiMeetPlayerLevel } from '@/modules/meets/models/MeetPlayerLevel.js';
import type { MiUser } from '@/models/User.js';
import { IdService } from '@/core/IdService.js';
import { ChatService } from '@/core/ChatService.js';
import { NotificationService } from '@/core/NotificationService.js';
import { bindThis } from '@/decorators.js';
import { secureRndstr, L_CHARS } from '@/misc/secure-rndstr.js';
import { IdentifiableError } from '@/misc/identifiable-error.js';

export type GateVerdict = 'approved' | 'requestOnly' | 'denied';
export type MeetErrorId =
	| 'meet_not_active'
	| 'meet_started'
	| 'meet_full'
	| 'gate_denied'
	| 'already_participant'
	| 'not_participant'
	| 'freeze_window'
	| 'not_host'
	| 'invalid_transition'
	| 'plus_one_not_allowed'
	| 'guest_limit';

const MAYBE_PURGE_MINUTES = 120;
const INVITE_AUTO_CONFIRM_DAYS = 3;

/**
 * The meet state machine. Statuses (see MeetParticipant): requested, invited, confirmed, waitlisted, hold,
 * maybe, declined, removed, left. Transitions are driven by the player (request/leave/respond), the host
 * (confirm/waitlist/hold/remove/roles/tags) and the sweep job (hold expiry, maybe purge, invite auto-confirm).
 */
@Injectable()
export class MeetService {
	constructor(
		@Inject(DI.meetsRepository)
		private meetsRepository: MeetsRepository,

		@Inject(DI.meetParticipantsRepository)
		private meetParticipantsRepository: MeetParticipantsRepository,

		@Inject(DI.meetPlayerLevelsRepository)
		private meetPlayerLevelsRepository: MeetPlayerLevelsRepository,

		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,

		private idService: IdService,
		private chatService: ChatService,
		private notificationService: NotificationService,
	) {
	}

	private err(id: MeetErrorId, message: string): IdentifiableError {
		return new IdentifiableError(`meet:${id}`, message);
	}

	@bindThis
	public isPast(meet: MiMeet, now = Date.now()): boolean {
		return meet.startAt.getTime() + meet.durationMinutes * 60_000 < now;
	}

	@bindThis
	public hasStarted(meet: MiMeet, now = Date.now()): boolean {
		return meet.startAt.getTime() <= now;
	}

	@bindThis
	public inFreezeWindow(meet: MiMeet, now = Date.now()): boolean {
		if (meet.cancellationFreezeHours <= 0) return false;
		return meet.startAt.getTime() - meet.cancellationFreezeHours * 3_600_000 <= now;
	}

	// ---------------------------------------------------------------- levels & gates

	@bindThis
	public async getLevel(userId: MiUser['id'], sport: string): Promise<MiMeetPlayerLevel | null> {
		return await this.meetPlayerLevelsRepository.findOneBy({ userId, sport });
	}

	@bindThis
	public levelValue(level: MiMeetPlayerLevel | null, basis: MiMeet['levelBasis']): number | null {
		if (level == null) return null;
		switch (basis) {
			case 'duprSingles': return level.duprSingles ?? level.selfLevel;
			case 'duprDoubles': return level.duprDoubles ?? level.selfLevel;
			default: return level.selfLevel ?? level.duprDoubles ?? level.duprSingles;
		}
	}

	/**
	 * Gate verdict for a player. strict: below min (or above max when set) → denied; autoApprove: qualifying
	 * players skip approval, others need it; guidance: informational only. Gender/age gates are strict when set.
	 */
	@bindThis
	public gateVerdict(meet: MiMeet, level: MiMeetPlayerLevel | null): GateVerdict {
		let verdict: GateVerdict = 'approved';
		const value = this.levelValue(level, meet.levelBasis);
		const hasLevelGate = meet.minLevel != null || meet.maxLevel != null;
		if (hasLevelGate) {
			const meets = value != null
				&& (meet.minLevel == null || value >= meet.minLevel)
				&& (meet.maxLevel == null || value <= meet.maxLevel);
			if (!meets) {
				if (meet.gateType === 'strict') verdict = 'denied';
				else if (meet.gateType === 'autoApprove') verdict = 'requestOnly';
				else verdict = 'requestOnly';
			}
		}
		if (meet.gender !== 'any' && meet.gender !== 'coed') {
			if (level?.gender == null || level.gender !== meet.gender) verdict = 'denied';
		}
		if (meet.ageGroup !== 'any') {
			if (level?.ageGroup == null || level.ageGroup !== meet.ageGroup) verdict = 'denied';
		}
		return verdict;
	}

	@bindThis
	public async upsertLevel(userId: MiUser['id'], sport: string, patch: Partial<Pick<MiMeetPlayerLevel, 'selfLevel' | 'duprSingles' | 'duprDoubles' | 'duprId' | 'gender' | 'ageGroup' | 'source'>>): Promise<MiMeetPlayerLevel> {
		const existing = await this.meetPlayerLevelsRepository.findOneBy({ userId, sport });
		if (existing) {
			await this.meetPlayerLevelsRepository.update(existing.id, { ...patch, updatedAt: new Date() });
			return (await this.meetPlayerLevelsRepository.findOneByOrFail({ id: existing.id }));
		}
		return await this.meetPlayerLevelsRepository.insertOne({
			id: this.idService.gen(),
			userId,
			sport,
			selfLevel: patch.selfLevel ?? null,
			duprSingles: patch.duprSingles ?? null,
			duprDoubles: patch.duprDoubles ?? null,
			duprId: patch.duprId ?? null,
			gender: patch.gender ?? null,
			ageGroup: patch.ageGroup ?? null,
			source: patch.source ?? null,
			updatedAt: new Date(),
		});
	}

	// ---------------------------------------------------------------- counts

	@bindThis
	public async counts(meetId: MiMeet['id']): Promise<{ confirmed: number; waitlisted: number; requested: number; hold: number }> {
		const rows = await this.meetParticipantsRepository.createQueryBuilder('p')
			.select('p.status', 'status').addSelect('COUNT(*)', 'count')
			.where('p.meetId = :meetId', { meetId })
			.groupBy('p.status')
			.getRawMany<{ status: string; count: string }>();
		const get = (s: string) => Number(rows.find(r => r.status === s)?.count ?? 0);
		return { confirmed: get('confirmed'), waitlisted: get('waitlisted'), requested: get('requested'), hold: get('hold') };
	}

	@bindThis
	public async spotsLeft(meet: MiMeet): Promise<number> {
		const c = await this.counts(meet.id);
		// held spots are reserved until they expire
		return Math.max(0, meet.capacity - c.confirmed - c.hold);
	}

	// ---------------------------------------------------------------- create / update / cancel

	@bindThis
	public async create(host: MiUser, data: Partial<MiMeet> & Pick<MiMeet, 'name' | 'startAt' | 'durationMinutes' | 'capacity'>): Promise<MiMeet> {
		const id = this.idService.gen();
		let referenceCode = secureRndstr(8, { chars: L_CHARS });
		while (await this.meetsRepository.existsBy({ referenceCode })) referenceCode = secureRndstr(8, { chars: L_CHARS });

		const room = await this.chatService.createRoom(host, { name: data.name, description: 'Meet chat' });

		const meet = await this.meetsRepository.insertOne({
			id,
			referenceCode,
			hostId: host.id,
			chatRoomId: room.id,
			accessToken: data.visibility === 'private' ? secureRndstr(16) : null,
			...data,
		});

		await this.meetParticipantsRepository.insertOne({
			id: this.idService.gen(),
			meetId: meet.id,
			userId: host.id,
			kind: 'user',
			status: meet.hostPlays ? 'confirmed' : 'declined',
			isHost: true,
			tags: [],
			statusChangedAt: new Date(),
		});

		return meet;
	}

	@bindThis
	public async update(meet: MiMeet, patch: Partial<MiMeet>): Promise<MiMeet> {
		await this.meetsRepository.update(meet.id, { ...patch, updatedAt: new Date() });
		const updated = await this.meetsRepository.findOneByOrFail({ id: meet.id });
		// capacity may have grown: promote from the waitlist
		await this.promoteFromWaitlist(updated);
		return updated;
	}

	@bindThis
	public async cancel(meet: MiMeet): Promise<void> {
		await this.meetsRepository.update(meet.id, { status: 'cancelled', cancelledAt: new Date(), updatedAt: new Date() });
		const active = await this.meetParticipantsRepository.findBy({ meetId: meet.id, status: In(['confirmed', 'waitlisted', 'hold', 'requested', 'invited', 'maybe']), kind: 'user' });
		for (const p of active) {
			if (p.userId && p.userId !== meet.hostId) this.notify(p.userId, meet, 'Meet cancelled', `${meet.name} has been cancelled by the host.`);
		}
	}

	// ---------------------------------------------------------------- player actions

	/**
	 * A player asks to join. Outcome by gate + autoApprove + capacity:
	 * denied → error; approved & (autoApprove or gateType autoApprove) & spot → confirmed; approved & no spot → waitlisted;
	 * otherwise → requested (host decides).
	 */
	@bindThis
	public async join(meet: MiMeet, user: MiUser, opts: { accessToken?: string | null; guests?: number } = {}): Promise<MiMeetParticipant> {
		if (meet.status !== 'active') throw this.err('meet_not_active', 'This meet is not active.');
		if (this.hasStarted(meet)) throw this.err('meet_started', 'This meet has already started.');
		if (meet.visibility === 'private' && meet.accessToken && opts.accessToken !== meet.accessToken) {
			throw this.err('gate_denied', 'This meet is private.');
		}

		const existing = await this.meetParticipantsRepository.findOneBy({ meetId: meet.id, userId: user.id });
		if (existing && !['declined', 'left', 'removed'].includes(existing.status)) {
			throw this.err('already_participant', 'You already have a status on this meet.');
		}

		const level = await this.getLevel(user.id, meet.sport);
		const verdict = this.gateVerdict(meet, level);
		if (verdict === 'denied') throw this.err('gate_denied', 'You do not meet the requirements for this meet.');

		const guests = Math.max(0, Math.min(opts.guests ?? 0, meet.allowPlusOne ? meet.guestsPerMember : 0));
		if ((opts.guests ?? 0) > 0 && !meet.allowPlusOne) throw this.err('plus_one_not_allowed', 'Guests are not allowed on this meet.');
		if ((opts.guests ?? 0) > meet.guestsPerMember) throw this.err('guest_limit', `At most ${meet.guestsPerMember} guest(s).`);

		const autoConfirm = meet.autoApprove || (meet.gateType === 'autoApprove' && verdict === 'approved');
		let status: MiMeetParticipant['status'] = 'requested';
		if (autoConfirm) {
			const spots = await this.spotsLeft(meet);
			status = spots >= 1 + guests ? 'confirmed' : 'waitlisted';
		}

		const row: Partial<MiMeetParticipant> = {
			id: existing?.id ?? this.idService.gen(),
			meetId: meet.id,
			userId: user.id,
			kind: 'user',
			status,
			waitlistRank: status === 'waitlisted' ? await this.nextWaitlistRank(meet.id) : null,
			holdExpiresAt: null,
			isHost: false,
			tags: [],
			statusChangedAt: new Date(),
		};
		const participant = existing
			? (await this.meetParticipantsRepository.update(existing.id, row), await this.meetParticipantsRepository.findOneByOrFail({ id: existing.id }))
			: await this.meetParticipantsRepository.insertOne(row);

		for (let i = 0; i < guests; i++) {
			await this.meetParticipantsRepository.insertOne({
				id: this.idService.gen(),
				meetId: meet.id,
				userId: null,
				kind: 'plusOne',
				sponsorId: user.id,
				displayName: `${user.name ?? user.username} +1`,
				status: participant.status,
				waitlistRank: participant.status === 'waitlisted' ? await this.nextWaitlistRank(meet.id) : null,
				isHost: false,
				tags: ['guest'],
				statusChangedAt: new Date(),
			});
		}

		if (participant.status === 'confirmed') await this.onConfirmed(meet, participant);
		if (participant.status === 'requested') this.notify(meet.hostId, meet, 'Join request', `${user.name ?? user.username} requested to join ${meet.name}.`);
		return participant;
	}

	/** Player responds to an invitation or sets "maybe". */
	@bindThis
	public async respond(meet: MiMeet, user: MiUser, answer: 'accept' | 'decline' | 'maybe'): Promise<MiMeetParticipant> {
		const p = await this.meetParticipantsRepository.findOneBy({ meetId: meet.id, userId: user.id });
		if (p == null) throw this.err('not_participant', 'You are not on this meet.');
		if (answer === 'decline') return await this.setStatus(meet, p, 'declined');
		if (answer === 'maybe') return await this.setStatus(meet, p, 'maybe');
		// accept: invited or hold → confirmed if a spot exists, else waitlisted
		if (!['invited', 'hold', 'maybe', 'waitlisted'].includes(p.status)) throw this.err('invalid_transition', `Cannot accept from ${p.status}.`);
		const spots = await this.spotsLeft(meet) + (p.status === 'hold' ? 1 : 0);
		return await this.setStatus(meet, p, spots >= 1 ? 'confirmed' : 'waitlisted');
	}

	/** Player leaves (confirmed/waitlisted/requested/hold/maybe → left). Freeze window blocks confirmed players. */
	@bindThis
	public async leave(meet: MiMeet, user: MiUser): Promise<MiMeetParticipant> {
		const p = await this.meetParticipantsRepository.findOneBy({ meetId: meet.id, userId: user.id });
		if (p == null || ['declined', 'left', 'removed'].includes(p.status)) throw this.err('not_participant', 'You are not on this meet.');
		if (p.isHost) throw this.err('invalid_transition', 'The host cannot leave; cancel the meet instead.');
		if (p.status === 'confirmed' && this.inFreezeWindow(meet)) throw this.err('freeze_window', 'Cancellations are frozen this close to the start.');
		// drop this member's guests too
		await this.meetParticipantsRepository.update({ meetId: meet.id, sponsorId: user.id, kind: 'plusOne' }, { status: 'left', waitlistRank: null, statusChangedAt: new Date() });
		return await this.setStatus(meet, p, 'left');
	}

	// ---------------------------------------------------------------- host actions

	@bindThis
	public async assertHost(meet: MiMeet, user: MiUser): Promise<void> {
		if (meet.hostId === user.id) return;
		const p = await this.meetParticipantsRepository.findOneBy({ meetId: meet.id, userId: user.id });
		if (!p?.isHost) throw this.err('not_host', 'Only a host can do this.');
	}

	/** Host sets a participant status: confirmed | waitlisted | hold | declined | removed | invited. */
	@bindThis
	public async hostSetStatus(meet: MiMeet, participant: MiMeetParticipant, status: 'confirmed' | 'waitlisted' | 'hold' | 'declined' | 'removed' | 'invited', holdMinutes?: number | null): Promise<MiMeetParticipant> {
		if (status === 'confirmed') {
			const spots = await this.spotsLeft(meet) + (participant.status === 'hold' ? 1 : 0);
			if (spots < 1) throw this.err('meet_full', 'No spot left; enlarge the meet or waitlist the player.');
		}
		const p = await this.setStatus(meet, participant, status, holdMinutes ?? meet.payByMinutes);
		if (status === 'invited' && p.userId) this.notify(p.userId, meet, 'Invitation', `You are invited to ${meet.name}.`);
		return p;
	}

	@bindThis
	public async hostUpdateParticipant(meet: MiMeet, participant: MiMeetParticipant, patch: Partial<Pick<MiMeetParticipant, 'isHost' | 'isCoach' | 'isReferee' | 'isPaymentCollector' | 'tags' | 'teamKey' | 'courtIndex' | 'displayName' | 'declaredLevel'>>): Promise<MiMeetParticipant> {
		const next: Partial<MiMeetParticipant> = { ...patch };
		if (patch.tags) {
			if (patch.tags.includes('checkedIn') && !participant.tags.includes('checkedIn')) next.checkedInAt = new Date();
			if (patch.tags.includes('paid')) next.tags = patch.tags.filter(t => t !== 'unpaid');
		}
		await this.meetParticipantsRepository.update(participant.id, next);
		return await this.meetParticipantsRepository.findOneByOrFail({ id: participant.id });
	}

	/** Host adds a reserved (non-app) player or invites a user directly. */
	@bindThis
	public async hostAdd(meet: MiMeet, data: { userId?: string | null; displayName?: string | null; declaredLevel?: number | null; status: 'confirmed' | 'invited' | 'waitlisted' }): Promise<MiMeetParticipant> {
		if (data.userId) {
			const existing = await this.meetParticipantsRepository.findOneBy({ meetId: meet.id, userId: data.userId });
			if (existing && !['declined', 'left', 'removed'].includes(existing.status)) throw this.err('already_participant', 'Already on this meet.');
			if (existing) {
				return await this.setStatus(meet, existing, data.status);
			}
		}
		if (data.status === 'confirmed' && await this.spotsLeft(meet) < 1) throw this.err('meet_full', 'No spot left.');
		const p = await this.meetParticipantsRepository.insertOne({
			id: this.idService.gen(),
			meetId: meet.id,
			userId: data.userId ?? null,
			kind: data.userId ? 'user' : 'reserved',
			displayName: data.displayName ?? null,
			declaredLevel: data.declaredLevel ?? null,
			status: data.status,
			waitlistRank: data.status === 'waitlisted' ? await this.nextWaitlistRank(meet.id) : null,
			isHost: false,
			tags: [],
			statusChangedAt: new Date(),
		});
		if (p.status === 'confirmed') await this.onConfirmed(meet, p);
		if (p.status === 'invited' && p.userId) this.notify(p.userId, meet, 'Invitation', `You are invited to ${meet.name}.`);
		return p;
	}

	// ---------------------------------------------------------------- transitions

	@bindThis
	private async setStatus(meet: MiMeet, p: MiMeetParticipant, status: MiMeetParticipant['status'], holdMinutes?: number | null): Promise<MiMeetParticipant> {
		const wasConfirmedOrHold = p.status === 'confirmed' || p.status === 'hold';
		const patch: Partial<MiMeetParticipant> = {
			status,
			statusChangedAt: new Date(),
			waitlistRank: status === 'waitlisted' ? (p.waitlistRank ?? await this.nextWaitlistRank(meet.id)) : null,
			holdExpiresAt: status === 'hold' && holdMinutes ? new Date(Date.now() + holdMinutes * 60_000) : null,
		};
		await this.meetParticipantsRepository.update(p.id, patch);
		const updated = await this.meetParticipantsRepository.findOneByOrFail({ id: p.id });

		if (status === 'confirmed' && p.status !== 'confirmed') await this.onConfirmed(meet, updated);
		if (status === 'hold' && updated.userId) {
			this.notify(updated.userId, meet, 'Spot on hold for you', `A spot in ${meet.name} is held for you${updated.holdExpiresAt ? ` until ${updated.holdExpiresAt.toISOString()}` : ''}. Confirm to keep it.`);
		}
		if (status === 'waitlisted' && updated.userId && p.status !== 'waitlisted') {
			this.notify(updated.userId, meet, 'Waitlisted', `You are on the waitlist for ${meet.name}. We will tell you when a spot opens.`);
		}
		if (status === 'declined' && updated.userId && p.status === 'requested') {
			this.notify(updated.userId, meet, 'Request declined', `Your request to join ${meet.name} was declined.`);
		}
		// a freed spot → promote the next waitlisted
		if (wasConfirmedOrHold && !['confirmed', 'hold'].includes(status)) await this.promoteFromWaitlist(meet);
		return updated;
	}

	@bindThis
	private async onConfirmed(meet: MiMeet, p: MiMeetParticipant): Promise<void> {
		if (p.userId && meet.chatRoomId) {
			try {
				const room = await this.chatService.findRoomById(meet.chatRoomId);
				if (room && !(await this.chatService.isRoomMember(room, p.userId))) {
					await this.chatService.createRoomInvitation(meet.hostId, room.id, p.userId);
					await this.chatService.joinToRoom(p.userId, room.id);
				}
			} catch {
				// chat is best-effort
			}
			if (p.userId !== meet.hostId) this.notify(p.userId, meet, 'You are confirmed', `You are confirmed to play at ${meet.name}. Please be on time.`);
		}
	}

	@bindThis
	private async nextWaitlistRank(meetId: MiMeet['id']): Promise<number> {
		const max = await this.meetParticipantsRepository.createQueryBuilder('p')
			.select('MAX(p.waitlistRank)', 'max')
			.where('p.meetId = :meetId', { meetId })
			.getRawOne<{ max: number | null }>();
		return (max?.max ?? 0) + 1;
	}

	/**
	 * Fill free spots from the waitlist in rank order. With a pay-by deadline the player gets a hold
	 * (must confirm/pay); without one the player is confirmed directly.
	 */
	@bindThis
	public async promoteFromWaitlist(meet: MiMeet): Promise<number> {
		if (meet.status !== 'active' || this.hasStarted(meet)) return 0;
		let promoted = 0;
		let spots = await this.spotsLeft(meet);
		while (spots > 0) {
			const next = await this.meetParticipantsRepository.findOne({ where: { meetId: meet.id, status: 'waitlisted' }, order: { waitlistRank: 'ASC' } });
			if (next == null) break;
			if (meet.payByMinutes && next.userId) {
				await this.setStatus(meet, next, 'hold', meet.payByMinutes);
			} else {
				await this.setStatus(meet, next, 'confirmed');
			}
			promoted++;
			spots = await this.spotsLeft(meet);
		}
		return promoted;
	}

	// ---------------------------------------------------------------- sweep (called every minute by the queue)

	@bindThis
	public async sweep(now = new Date()): Promise<{ expiredHolds: number; purgedMaybes: number; autoConfirmedInvites: number }> {
		let expiredHolds = 0, purgedMaybes = 0, autoConfirmedInvites = 0;

		// holds past their deadline → back to the tail of the waitlist, then promote the next
		const expired = await this.meetParticipantsRepository.findBy({ status: 'hold', holdExpiresAt: LessThan(now) });
		for (const p of expired) {
			const meet = await this.meetsRepository.findOneBy({ id: p.meetId });
			if (meet == null) continue;
			await this.setStatus(meet, p, 'waitlisted');
			if (p.userId) this.notify(p.userId, meet, 'Hold expired', `Your held spot in ${meet.name} was released.`);
			expiredHolds++;
		}

		// maybes purged 2 h before start
		const soon = new Date(now.getTime() + MAYBE_PURGE_MINUTES * 60_000);
		const meetsSoon = await this.meetsRepository.findBy({ status: 'active', startAt: LessThan(soon) });
		for (const meet of meetsSoon) {
			const maybes = await this.meetParticipantsRepository.findBy({ meetId: meet.id, status: 'maybe' });
			for (const p of maybes) { await this.setStatus(meet, p, 'declined'); purgedMaybes++; }
			// invitations older than 3 days auto-confirm while there is room
			const cutoff = new Date(now.getTime() - INVITE_AUTO_CONFIRM_DAYS * 86_400_000);
			const invites = await this.meetParticipantsRepository.findBy({ meetId: meet.id, status: 'invited', statusChangedAt: LessThan(cutoff), userId: Not(In([''])) });
			for (const p of invites) {
				if (await this.spotsLeft(meet) < 1) break;
				await this.setStatus(meet, p, 'confirmed'); autoConfirmedInvites++;
			}
		}
		return { expiredHolds, purgedMaybes, autoConfirmedInvites };
	}

	// ---------------------------------------------------------------- notifications

	@bindThis
	private notify(userId: MiUser['id'], meet: MiMeet, header: string, body: string): void {
		this.notificationService.createNotification(userId, 'app', {
			customHeader: header,
			customBody: body,
			customIcon: null,
			appAccessTokenId: null,
		});
	}
}

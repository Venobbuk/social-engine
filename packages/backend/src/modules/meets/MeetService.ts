/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { DataSource, EntityManager, In, LessThan, MoreThan } from 'typeorm';
import { DI } from '@/di-symbols.js';
import type { MeetsRepository, MeetParticipantsRepository, MeetGroupsRepository, MeetReviewsRepository, BlockingsRepository, UsersRepository } from '@/models/_.js';
import type { MiMeet } from '@/modules/meets/models/Meet.js';
import type { MiMeetParticipant } from '@/modules/meets/models/MeetParticipant.js';
import type { MiMeetReview } from '@/modules/meets/models/MeetReview.js';
import { WARNING_PUBLIC_THRESHOLD } from '@/modules/meets/models/MeetReview.js';
import type { MiUser } from '@/models/User.js';
import { IdService } from '@/core/IdService.js';
import { ChatService } from '@/core/ChatService.js';
import { NotificationService } from '@/core/NotificationService.js';
import { MeetLevelService } from '@/modules/meets/MeetLevelService.js';
import { bindThis } from '@/decorators.js';
import { secureRndstr, L_CHARS } from '@/misc/secure-rndstr.js';
import { IdentifiableError } from '@/misc/identifiable-error.js';

export type MeetErrorId =
	| 'meet_not_found'
	| 'meet_not_active'
	| 'meet_started'
	| 'meet_full'
	| 'gate_denied'
	| 'blocked'
	| 'private'
	| 'already_participant'
	| 'not_participant'
	| 'freeze_window'
	| 'not_host'
	| 'invalid_transition'
	| 'plus_one_not_allowed'
	| 'capacity_below_confirmed'
	| 'host_needs_seat';

const MAYBE_PURGE_MINUTES = 120;         // "People in Maybe list will be removed 2 hours before meet start."
const INVITE_AUTO_CONFIRM_DAYS = 3;      // "You will be auto-confirmed in 3 days if no action is taken."
const NO_SHOW_WINDOW_DAYS = 30;          // "No showed {{count}} times in 30 days"

/** A participant row as the raw driver returns it (camelCase columns, dates as Date). */
type Row = MiMeetParticipant;

/**
 * MEET-V4-RECLUB (2026-09-16) — the meet state machine, rewritten after the adversarial review of 2026-09-12.
 *
 * THE ONE RULE. A seat is held by a row in status 'confirmed', and only by that. meet.confirmed is the count of
 * such rows and the database refuses confirmed > capacity (CHK_meet_confirmed_within_capacity). Every path into
 * 'confirmed' — auto-approve join, host confirm, waitlist promotion, hold release, invite accept (incl. the 3-day
 * auto-confirm), reserved spot, +1 approval — goes through claimSeat(): one conditional UPDATE that returns a row
 * only if a seat was taken. Zero rows means full, started or cancelled; nothing counted, decided and then wrote.
 * Every transition additionally runs inside withMeetLock(): a transaction holding the meet row FOR UPDATE, so
 * rank assignment and promotion are serialised per meet. The CHECK is the backstop should any path forget.
 *
 * v1 counted spots (spotsLeft) in one statement and inserted in another; the probe passed 20/20 and live data
 * still held ten waitlist rows on three ranks. v1 also carried a pay-by timer Reclub does not have; it is gone.
 *
 * STATES (Reclub MeetParticipantStatus): requested · invited · confirmed · waitlisted · hold · maybe · declined ·
 * spectator. Leaving/removal DELETES the row (Reclub fn#75239). hold is a manual host state with no timer.
 * TIMERS (all Reclub): maybe purged 2 h before start; invitation auto-confirms after 3 days (through claimSeat —
 * if full it waitlists, decision E3); cancellation freeze N hours before start blocks leaving.
 * GATE ORDER (Reclub footer-CTA table): cancelled/past → host blocked → private-not-invited → level/DUPR/gender/
 * age (MeetLevelService) → capacity, last.
 */
@Injectable()
export class MeetService {
	constructor(
		@Inject(DI.db)
		private db: DataSource,

		@Inject(DI.meetsRepository)
		private meetsRepository: MeetsRepository,

		@Inject(DI.meetParticipantsRepository)
		private meetParticipantsRepository: MeetParticipantsRepository,

		@Inject(DI.meetGroupsRepository)
		private meetGroupsRepository: MeetGroupsRepository,

		@Inject(DI.meetReviewsRepository)
		private meetReviewsRepository: MeetReviewsRepository,

		@Inject(DI.blockingsRepository)
		private blockingsRepository: BlockingsRepository,

		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,

		private idService: IdService,
		private chatService: ChatService,
		private notificationService: NotificationService,
		private meetLevelService: MeetLevelService,
	) {
	}

	private err(id: MeetErrorId, message: string): IdentifiableError {
		return new IdentifiableError(`meet:${id}`, message);
	}

	// ------------------------------------------------------------------------------------------ time
	@bindThis
	public isPast(meet: MiMeet, now = Date.now()): boolean {
		return new Date(meet.startAt).getTime() + meet.durationMinutes * 60_000 < now;
	}

	@bindThis
	public hasStarted(meet: MiMeet, now = Date.now()): boolean {
		return new Date(meet.startAt).getTime() <= now;
	}

	@bindThis
	public inFreezeWindow(meet: MiMeet, now = Date.now()): boolean {
		if (!meet.cancellationFreezeHours) return false;
		return new Date(meet.startAt).getTime() - meet.cancellationFreezeHours * 3_600_000 <= now;
	}

	// ----------------------------------------------------------------------------- the seat, in SQL
	/**
	 * Run `fn` inside a transaction that holds the meet row FOR UPDATE. Every state transition uses this.
	 * The locked row is re-read inside the transaction so the callback sees current counters.
	 */
	private async withMeetLock<T>(meetId: MiMeet['id'], fn: (em: EntityManager, meet: MiMeet) => Promise<T>): Promise<T> {
		return await this.db.transaction(async em => {
			const rows = await em.query(`SELECT * FROM "meet" WHERE "id" = $1 FOR UPDATE`, [meetId]) as MiMeet[];
			if (!rows.length) throw this.err('meet_not_found', 'This meet does not exist.');
			return await fn(em, rows[0]);
		});
	}

	/** The claim. True iff a seat was taken. Zero rows = full, not active, or started — no separate read decided it. */
	private async claimSeat(em: EntityManager, meetId: MiMeet['id']): Promise<boolean> {
		const rows = await em.query(
			`UPDATE "meet" SET "confirmed" = "confirmed" + 1, "updatedAt" = now()
			  WHERE "id" = $1 AND "status" = 'active' AND "startAt" > now() AND "confirmed" + 1 <= "capacity"
			  RETURNING "confirmed"`, [meetId]) as unknown[];
		return Array.isArray(rows) && rows.length > 0;
	}

	private async releaseSeat(em: EntityManager, meetId: MiMeet['id']): Promise<void> {
		await em.query(`UPDATE "meet" SET "confirmed" = GREATEST("confirmed" - 1, 0), "updatedAt" = now() WHERE "id" = $1`, [meetId]);
	}

	/** Next waitlist rank. Safe only under withMeetLock; the partial unique index is the tie guard regardless. */
	private async nextRank(em: EntityManager, meetId: MiMeet['id']): Promise<number> {
		const rows = await em.query(`SELECT COALESCE(MAX("waitlistRank"), 0) + 1 AS next FROM "meet_participant" WHERE "meetId" = $1 AND "status" = 'waitlisted'`, [meetId]) as { next: string | number }[];
		return Number(rows[0]?.next ?? 1);
	}

	private async getRow(em: EntityManager, id: string): Promise<Row | null> {
		const rows = await em.query(`SELECT * FROM "meet_participant" WHERE "id" = $1`, [id]) as Row[];
		return rows[0] ?? null;
	}

	private async setRowStatus(em: EntityManager, row: Row, status: Row['status'], extra: Partial<Pick<Row, 'waitlistRank'>> = {}): Promise<Row> {
		const rank = status === 'waitlisted' ? (extra.waitlistRank ?? null) : null;
		await em.query(`UPDATE "meet_participant" SET "status" = $2, "waitlistRank" = $3, "statusChangedAt" = now() WHERE "id" = $1`, [row.id, status, rank]);
		return (await this.getRow(em, row.id))!;
	}

	/**
	 * Move a row INTO 'confirmed' through the claim. Returns the row on success, or the row moved to the fallback
	 * status when no seat could be taken (waitlisted by default — Reclub's own answer for a full meet).
	 */
	private async confirmOrFallback(em: EntityManager, meet: MiMeet, row: Row, fallback: 'waitlisted' | 'hold' | 'requested' = 'waitlisted'): Promise<Row> {
		if (row.status === 'confirmed') return row;
		if (await this.claimSeat(em, meet.id)) {
			const r = await this.setRowStatus(em, row, 'confirmed');
			await this.onConfirmed(meet, r);
			return r;
		}
		if (fallback === 'waitlisted') return await this.setRowStatus(em, row, 'waitlisted', { waitlistRank: await this.nextRank(em, meet.id) });
		return await this.setRowStatus(em, row, fallback);
	}

	/** Move a row OUT of 'confirmed' (to another status, or delete) — always releases the seat it held. */
	private async leaveConfirmed(em: EntityManager, meet: MiMeet, row: Row, to: Row['status'] | 'delete'): Promise<Row | null> {
		if (row.status === 'confirmed') await this.releaseSeat(em, meet.id);
		if (to === 'delete') {
			await em.query(`DELETE FROM "meet_participant" WHERE "id" = $1`, [row.id]);
			return null;
		}
		return await this.setRowStatus(em, row, to, to === 'waitlisted' ? { waitlistRank: await this.nextRank(em, meet.id) } : {});
	}

	/** Free seats go to the waitlist first, in rank order, each through the claim. Stops at the first refusal. */
	private async promoteLocked(em: EntityManager, meet: MiMeet): Promise<number> {
		let promoted = 0;
		for (;;) {
			const rows = await em.query(
				`SELECT * FROM "meet_participant" WHERE "meetId" = $1 AND "status" = 'waitlisted'
				  ORDER BY "waitlistRank" ASC LIMIT 1 FOR UPDATE SKIP LOCKED`, [meet.id]) as Row[];
			const next = rows[0];
			if (!next) break;
			if (!(await this.claimSeat(em, meet.id))) break;
			const r = await this.setRowStatus(em, next, 'confirmed');
			await this.onConfirmed(meet, r);
			promoted++;
		}
		return promoted;
	}

	// ------------------------------------------------------------------------------------ read side
	@bindThis
	public async counts(meetId: MiMeet['id']): Promise<{ confirmed: number; waitlisted: number; requested: number; hold: number; maybe: number; invited: number }> {
		const rows = await this.meetParticipantsRepository.createQueryBuilder('p').select('p.status', 'status').addSelect('count(*)', 'n').where('p.meetId = :meetId', { meetId }).groupBy('p.status').getRawMany<{ status: string; n: string }>();
		const c = { confirmed: 0, waitlisted: 0, requested: 0, hold: 0, maybe: 0, invited: 0 };
		for (const r of rows) if (r.status in c) (c as Record<string, number>)[r.status] = Number(r.n);
		return c;
	}

	@bindThis
	public async spotsLeft(meet: MiMeet): Promise<number> {
		// the counter is authoritative (decision E8); re-read it rather than trusting a possibly stale entity
		const fresh = await this.meetsRepository.findOneBy({ id: meet.id });
		return Math.max(0, (fresh ?? meet).capacity - (fresh ?? meet).confirmed);
	}

	// ------------------------------------------------------------------------------------- lifecycle
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
			// minted for EVERY meet, not only private ones: flipping a public meet to private later must not leave
			// it world-readable (adversarial review 2026-09-12)
			accessToken: secureRndstr(16),
			confirmed: 0,
			status: 'active',
			...data,
		});

		// the host's own row. hostPlays = "Host and play" → a seat, through the claim like everyone else;
		// otherwise "Host only" → spectator, a roster row holding no seat (v1 stored this as 'declined').
		await this.withMeetLock(meet.id, async (em, locked) => {
			const rows = await em.query(
				`INSERT INTO "meet_participant" ("id","meetId","userId","kind","status","isHost","tags","statusChangedAt")
				 VALUES ($1,$2,$3,'user','spectator',true,'{}',now()) RETURNING *`, [this.idService.gen(), meet.id, host.id]) as Row[];
			if (meet.hostPlays) {
				const r = await this.confirmOrFallback(em, locked, rows[0], 'requested');
				if (r.status !== 'confirmed') throw this.err('host_needs_seat', 'The host cannot take a seat in a meet with no capacity.');
			}
		});

		return (await this.meetsRepository.findOneByOrFail({ id }));
	}

	@bindThis
	public async update(meet: MiMeet, patch: Partial<MiMeet>): Promise<MiMeet> {
		return await this.withMeetLock(meet.id, async (em, locked) => {
			// E5: capacity may not drop below the confirmed count (Reclub disables the minus control there)
			if (patch.capacity != null && patch.capacity < locked.confirmed) {
				throw this.err('capacity_below_confirmed', `Capacity cannot be below the ${locked.confirmed} confirmed players.`);
			}
			// E4: "Host only" → "Host and play" needs a seat
			if (patch.hostPlays === true && !locked.hostPlays) {
				const hostRow = (await em.query(`SELECT * FROM "meet_participant" WHERE "meetId" = $1 AND "userId" = $2`, [meet.id, meet.hostId]) as Row[])[0];
				if (hostRow && hostRow.status !== 'confirmed') {
					if (!(await this.claimSeat(em, meet.id))) throw this.err('host_needs_seat', 'This meet is full, so the host cannot take a seat. Raise the number of players first.');
					await this.setRowStatus(em, hostRow, 'confirmed');
				}
			}
			if (patch.hostPlays === false && locked.hostPlays) {
				const hostRow = (await em.query(`SELECT * FROM "meet_participant" WHERE "meetId" = $1 AND "userId" = $2`, [meet.id, meet.hostId]) as Row[])[0];
				if (hostRow && hostRow.status === 'confirmed') await this.leaveConfirmed(em, locked, hostRow, 'spectator');
			}
			await em.getRepository(this.meetsRepository.target).update(meet.id, { ...patch, updatedAt: new Date() });
			const fresh = await em.getRepository(this.meetsRepository.target).findOneByOrFail({ id: meet.id }) as MiMeet;
			// a bigger room seats the waitlist
			if (patch.capacity != null && patch.capacity > locked.capacity) await this.promoteLocked(em, fresh);
			return fresh;
		});
	}

	/** E9: the meet is cancelled; rows and their history stay. The counter is meaningless afterwards and untouched. */
	@bindThis
	public async cancel(meet: MiMeet): Promise<void> {
		await this.meetsRepository.update(meet.id, { status: 'cancelled', cancelledAt: new Date(), updatedAt: new Date() });
		const rows = await this.meetParticipantsRepository.findBy({ meetId: meet.id, status: In(['confirmed', 'waitlisted', 'requested', 'invited', 'hold', 'maybe']) });
		for (const p of rows) if (p.userId && p.userId !== meet.hostId) this.notify(p.userId, meet, 'Cancelled', `${meet.name} has been cancelled by the host.`);
	}

	// ------------------------------------------------------------------------------------ the gate
	/** Reclub `isJoinBlocked`: any host has blocked the user, or the user has blocked any host. A social-graph read. */
	@bindThis
	public async isBlockedWithHosts(meet: MiMeet, userId: MiUser['id']): Promise<boolean> {
		const hosts = (await this.meetParticipantsRepository.find({ where: { meetId: meet.id, isHost: true }, select: { userId: true } })).map(h => h.userId).filter((x): x is string => !!x);
		if (!hosts.includes(meet.hostId)) hosts.push(meet.hostId);
		if (!hosts.length) return false;
		const a = await this.blockingsRepository.exists({ where: { blockerId: In(hosts), blockeeId: userId } });
		if (a) return true;
		return await this.blockingsRepository.exists({ where: { blockerId: userId, blockeeId: In(hosts) } });
	}

	/** Private meets: the access token, an invitation, or club membership (any attached club's channel) admits. */
	private async mayViewPrivate(meet: MiMeet, userId: MiUser['id'] | null, accessToken?: string | null): Promise<boolean> {
		if (meet.visibility !== 'private') return true;
		if (accessToken && meet.accessToken === accessToken) return true;
		if (!userId) return false;
		if (userId === meet.hostId) return true;
		if (await this.meetParticipantsRepository.existsBy({ meetId: meet.id, userId })) return true;
		const groups = await this.meetGroupsRepository.find({ where: { meetId: meet.id }, select: { channelId: true } });
		if (!groups.length) return false;
		const rows = await this.db.query(`SELECT 1 FROM "channel_following" WHERE "followeeId" = ANY($1) AND "followerId" = $2 LIMIT 1`, [groups.map(g => g.channelId), userId]) as unknown[];
		return rows.length > 0;
	}

	/**
	 * Reclub "Safety First" context for the client: hosts the user has never played with, and roster members the
	 * user has blocked. The client shows the interstitial when either list is non-empty; nothing is gated here.
	 */
	@bindThis
	public async safetyContext(meet: MiMeet, userId: MiUser['id']): Promise<{ newHostUserIds: string[]; blockedUserIds: string[] }> {
		const hosts = (await this.meetParticipantsRepository.find({ where: { meetId: meet.id, isHost: true }, select: { userId: true } })).map(h => h.userId).filter((x): x is string => !!x && x !== userId);
		const played = hosts.length ? (await this.db.query(
			`SELECT DISTINCT h."userId" FROM "meet_participant" h
			   JOIN "meet_participant" me ON me."meetId" = h."meetId" AND me."userId" = $1 AND me."status" = 'confirmed'
			   JOIN "meet" m ON m."id" = h."meetId" AND m."startAt" < now() AND m."id" <> $3
			  WHERE h."userId" = ANY($2) AND h."status" = 'confirmed'`, [userId, hosts, meet.id]) as { userId: string }[]).map(r => r.userId) : [];
		const newHostUserIds = hosts.filter(h => !played.includes(h));
		const roster = (await this.meetParticipantsRepository.find({ where: { meetId: meet.id }, select: { userId: true } })).map(p => p.userId).filter((x): x is string => !!x && x !== userId);
		const blocked = roster.length ? await this.blockingsRepository.find({ where: { blockerId: userId, blockeeId: In(roster) }, select: { blockeeId: true } }) : [];
		return { newHostUserIds, blockedUserIds: blocked.map(b => b.blockeeId) };
	}

	// ------------------------------------------------------------------------------- player actions
	/**
	 * Join or request to join. Gate order is Reclub's. The only capacity check is the claim itself.
	 * Guests: `plusOnes` extra rows of kind plusOne, each needing its own seat ("status chosen by capacity").
	 */
	@bindThis
	public async join(meet: MiMeet, user: MiUser, opts: { accessToken?: string | null; plusOnes?: number } = {}): Promise<MiMeetParticipant> {
		if (meet.status !== 'active') throw this.err('meet_not_active', 'This meet is not active.');
		if (this.hasStarted(meet)) throw this.err('meet_started', 'This meet has already started.');
		if (await this.isBlockedWithHosts(meet, user.id)) throw this.err('blocked', "You can't join this meet because the host(s) has blocked you");
		if (!(await this.mayViewPrivate(meet, user.id, opts.accessToken))) throw this.err('private', 'This is a private meet, only invited people and participants can see.');

		const level = await this.meetLevelService.getLevel(user.id, meet.sport);
		const verdict = this.meetLevelService.gateVerdict(meet, level);
		if (verdict === 'denied') throw this.err('gate_denied', "You cannot join this meet because you don't meet the level requirements.");

		const plusOnes = Math.max(0, Math.min(opts.plusOnes ?? 0, 1));
		if (plusOnes > 0 && !meet.allowPlusOne) throw this.err('plus_one_not_allowed', 'This meet does not allow +1 requests.');

		const autoConfirm = meet.autoApprove && verdict === 'approved';

		return await this.withMeetLock(meet.id, async (em, locked) => {
			const existing = (await em.query(`SELECT * FROM "meet_participant" WHERE "meetId" = $1 AND "userId" = $2`, [meet.id, user.id]) as Row[])[0];
			if (existing && !['declined', 'maybe'].includes(existing.status)) throw this.err('already_participant', 'You already have a status on this meet.');

			let row: Row;
			if (existing) {
				row = await this.setRowStatus(em, existing, 'requested');
			} else {
				row = (await em.query(
					`INSERT INTO "meet_participant" ("id","meetId","userId","kind","status","isHost","tags","statusChangedAt")
					 VALUES ($1,$2,$3,'user','requested',false,'{}',now()) RETURNING *`, [this.idService.gen(), meet.id, user.id]) as Row[])[0];
			}
			if (autoConfirm) row = await this.confirmOrFallback(em, locked, row, 'waitlisted');

			for (let i = 0; i < plusOnes; i++) {
				const guest = (await em.query(
					`INSERT INTO "meet_participant" ("id","meetId","userId","kind","sponsorId","displayName","status","isHost","tags","statusChangedAt")
					 VALUES ($1,$2,NULL,'plusOne',$3,$4,'requested',false,'{guest}',now()) RETURNING *`,
					[this.idService.gen(), meet.id, user.id, `${user.name ?? user.username} +1`]) as Row[])[0];
				if (autoConfirm) await this.confirmOrFallback(em, locked, guest, 'waitlisted');
			}
			if (!autoConfirm && meet.hostId !== user.id) this.notify(meet.hostId, meet, 'Request to join', `${user.name ?? user.username} has requested to join.`);
			return row as MiMeetParticipant;
		});
	}

	/** Invitation answer: accept (through the claim), decline, or maybe. */
	@bindThis
	public async respond(meet: MiMeet, user: MiUser, answer: 'accept' | 'decline' | 'maybe'): Promise<MiMeetParticipant> {
		if (meet.status !== 'active') throw this.err('meet_not_active', 'This meet is not active.');
		return await this.withMeetLock(meet.id, async (em, locked) => {
			const row = (await em.query(`SELECT * FROM "meet_participant" WHERE "meetId" = $1 AND "userId" = $2`, [meet.id, user.id]) as Row[])[0];
			if (!row) throw this.err('not_participant', 'You are not on this meet.');
			if (!['invited', 'maybe', 'requested', 'waitlisted', 'hold'].includes(row.status)) throw this.err('invalid_transition', `Cannot answer from status ${row.status}.`);
			if (answer === 'decline') return await this.leaveConfirmed(em, locked, row, 'declined') as MiMeetParticipant;
			if (answer === 'maybe') {
				// "maybe/cancel actions disabled within 2 h" — isAround2HourMeetStart
				if (new Date(locked.startAt).getTime() - Date.now() <= MAYBE_PURGE_MINUTES * 60_000) throw this.err('invalid_transition', 'Too close to the start to be a maybe.');
				return await this.setRowStatus(em, row, 'maybe') as MiMeetParticipant;
			}
			if (row.status !== 'invited') throw this.err('invalid_transition', 'Only an invitation can be accepted; request to join instead.');
			return await this.confirmOrFallback(em, locked, row, 'waitlisted') as MiMeetParticipant;
		});
	}

	/**
	 * "Can't go" / leave waitlist / cancel request. Reclub DELETES the row; a +1 goes with its sponsor
	 * ("Leaving this meet will also remove your +1"). The cancellation freeze applies to confirmed players only.
	 */
	@bindThis
	public async leave(meet: MiMeet, user: MiUser): Promise<void> {
		await this.withMeetLock(meet.id, async (em, locked) => {
			const row = (await em.query(`SELECT * FROM "meet_participant" WHERE "meetId" = $1 AND "userId" = $2`, [meet.id, user.id]) as Row[])[0];
			if (!row) throw this.err('not_participant', 'You are not on this meet.');
			if (row.isHost) throw this.err('invalid_transition', 'The host cannot leave; cancel the meet instead.');
			if (row.status === 'confirmed') {
				if (this.hasStarted(locked)) throw this.err('freeze_window', 'This meet has already started, if you want to leave, please message host');
				if (this.inFreezeWindow(locked)) throw this.err('freeze_window', `The host has disallowed cancellations ${locked.cancellationFreezeHours} hours prior to the start of the meet. If you would like to leave, please contact the host.`);
			}
			const guests = await em.query(`SELECT * FROM "meet_participant" WHERE "meetId" = $1 AND "sponsorId" = $2 AND "kind" = 'plusOne'`, [meet.id, user.id]) as Row[];
			for (const g of guests) await this.leaveConfirmed(em, locked, g, 'delete');
			await this.leaveConfirmed(em, locked, row, 'delete');
			await this.promoteLocked(em, locked);
		});
	}

	// --------------------------------------------------------------------------------- host actions
	@bindThis
	public async assertHost(meet: MiMeet, user: MiUser): Promise<void> {
		if (meet.hostId === user.id) return;
		const p = await this.meetParticipantsRepository.findOneBy({ meetId: meet.id, userId: user.id });
		if (!p?.isHost) throw this.err('not_host', 'Only a host can do that.');
	}

	/**
	 * Host moves a participant. Into confirmed → through the claim (meet_full if no seat). 'remove' deletes the
	 * row, as Reclub does, and frees its seat to the waitlist.
	 */
	@bindThis
	public async hostSetStatus(meet: MiMeet, participantId: string, status: 'confirmed' | 'waitlisted' | 'hold' | 'declined' | 'invited' | 'spectator' | 'remove'): Promise<MiMeetParticipant | null> {
		return await this.withMeetLock(meet.id, async (em, locked) => {
			const row = await this.getRow(em, participantId);
			if (!row || row.meetId !== meet.id) throw this.err('not_participant', 'No such participant on this meet.');
			if (status === 'remove') {
				if (row.isHost) throw this.err('invalid_transition', 'Remove the host role first.');
				const guests = row.userId ? await em.query(`SELECT * FROM "meet_participant" WHERE "meetId" = $1 AND "sponsorId" = $2`, [meet.id, row.userId]) as Row[] : [];
				for (const g of guests) await this.leaveConfirmed(em, locked, g, 'delete');
				await this.leaveConfirmed(em, locked, row, 'delete');
				await this.promoteLocked(em, locked);
				if (row.userId) this.notify(row.userId, meet, 'Removed', `You were removed from ${meet.name}.`);
				return null;
			}
			if (status === 'confirmed') {
				if (row.status === 'confirmed') return row as MiMeetParticipant;
				if (!(await this.claimSeat(em, meet.id))) throw this.err('meet_full', 'This meet is full.');
				const r = await this.setRowStatus(em, row, 'confirmed');
				await this.onConfirmed(meet, r);
				return r as MiMeetParticipant;
			}
			const r = await this.leaveConfirmed(em, locked, row, status);
			if (row.status === 'confirmed') await this.promoteLocked(em, locked);
			if (status === 'invited' && row.userId) this.notify(row.userId, meet, "You've been invited", `You've been invited to ${meet.name}.`);
			if (status === 'hold' && row.userId) this.notify(row.userId, meet, 'On hold', 'You are on hold. Please message the host for more details.');
			return r as MiMeetParticipant;
		});
	}

	@bindThis
	public async hostUpdateParticipant(meet: MiMeet, participantId: string, patch: Partial<Pick<MiMeetParticipant, 'isHost' | 'isCoach' | 'isReferee' | 'isPaymentCollector' | 'tags' | 'teamKey' | 'courtIndex' | 'positionId' | 'forceSkill' | 'forcePosition' | 'paymentType' | 'displayName' | 'declaredLevel' | 'extGender' | 'extAge'>>): Promise<MiMeetParticipant> {
		const p = await this.meetParticipantsRepository.findOneBy({ id: participantId, meetId: meet.id });
		if (!p) throw this.err('not_participant', 'No such participant on this meet.');
		await this.meetParticipantsRepository.update(p.id, patch);
		return await this.meetParticipantsRepository.findOneByOrFail({ id: p.id });
	}

	/**
	 * Reserve a spot / add a droppin / add a club member / invite a user. A user gets kind 'user'; a name-only
	 * guest gets 'reserved' with externalReference. Into confirmed → through the claim; on a full meet Reclub
	 * asks "confirmed or waitlist?" — the caller passes the answer as `status`.
	 */
	@bindThis
	public async hostAdd(meet: MiMeet, data: { userId?: string | null; displayName?: string | null; declaredLevel?: number | null; extGender?: string | null; extAge?: string | null; status: 'confirmed' | 'invited' | 'waitlisted' | 'hold' }): Promise<MiMeetParticipant> {
		return await this.withMeetLock(meet.id, async (em, locked) => {
			if (data.userId) {
				const existing = (await em.query(`SELECT * FROM "meet_participant" WHERE "meetId" = $1 AND "userId" = $2`, [meet.id, data.userId]) as Row[])[0];
				if (existing) throw this.err('already_participant', 'That person already has a status on this meet.');
			}
			const kind = data.userId ? 'user' : 'reserved';
			let row = (await em.query(
				`INSERT INTO "meet_participant" ("id","meetId","userId","kind","displayName","declaredLevel","extGender","extAge","status","isHost","tags","statusChangedAt")
				 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'requested',false,'{}',now()) RETURNING *`,
				[this.idService.gen(), meet.id, data.userId ?? null, kind, data.displayName ?? null, data.declaredLevel ?? null, data.extGender ?? null, data.extAge ?? null]) as Row[])[0];
			if (data.status === 'confirmed') {
				if (!(await this.claimSeat(em, meet.id))) throw this.err('meet_full', 'This meet is full, do you want to put this reservation to confirmed or waitlist?');
				row = await this.setRowStatus(em, row, 'confirmed');
				await this.onConfirmed(meet, row);
			} else if (data.status === 'waitlisted') {
				row = await this.setRowStatus(em, row, 'waitlisted', { waitlistRank: await this.nextRank(em, meet.id) });
			} else {
				row = await this.setRowStatus(em, row, data.status);
				if (data.status === 'invited' && data.userId) this.notify(data.userId, meet, "You've been invited", `You've been invited to ${meet.name}.`);
			}
			return row as MiMeetParticipant;
		});
	}

	@bindThis
	public async promoteFromWaitlist(meet: MiMeet): Promise<number> {
		if (meet.status !== 'active' || this.hasStarted(meet)) return 0;
		return await this.withMeetLock(meet.id, (em, locked) => this.promoteLocked(em, locked));
	}

	// ------------------------------------------------------------------------------------- the sweep
	/**
	 * Every minute. Both timers are Reclub's own:
	 *   • maybes purged 2 h before start ("People in Maybe list will be removed 2 hours before meet start")
	 *   • invitations auto-confirm after 3 days, through the claim; a full meet waitlists them (E3) — and this
	 *     runs for EVERY active meet, not only those starting soon (v1 scoped it wrongly)
	 * Lazy AND swept: reads treat a lapsed deadline as lapsed; this job makes it prompt.
	 */
	@bindThis
	public async sweep(now = new Date()): Promise<{ purgedMaybes: number; autoConfirmedInvites: number; waitlistedInvites: number }> {
		let purgedMaybes = 0, autoConfirmedInvites = 0, waitlistedInvites = 0;

		const soon = new Date(now.getTime() + MAYBE_PURGE_MINUTES * 60_000);
		const meetsSoon = await this.meetsRepository.findBy({ status: 'active', startAt: LessThan(soon) });
		for (const meet of meetsSoon) {
			const maybes = await this.meetParticipantsRepository.findBy({ meetId: meet.id, status: 'maybe' });
			if (!maybes.length) continue;
			await this.withMeetLock(meet.id, async (em, locked) => {
				for (const p of maybes) { await this.leaveConfirmed(em, locked, p, 'declined'); purgedMaybes++; }
			});
		}

		const cutoff = new Date(now.getTime() - INVITE_AUTO_CONFIRM_DAYS * 86_400_000);
		const stale = await this.meetParticipantsRepository.find({ where: { status: 'invited', statusChangedAt: LessThan(cutoff) }, select: { id: true, meetId: true } });
		const byMeet = new Map<string, string[]>();
		for (const p of stale) byMeet.set(p.meetId, [...(byMeet.get(p.meetId) ?? []), p.id]);
		for (const [meetId, ids] of byMeet) {
			const meet = await this.meetsRepository.findOneBy({ id: meetId, status: 'active', startAt: MoreThan(now) });
			if (!meet) continue;
			await this.withMeetLock(meetId, async (em, locked) => {
				for (const id of ids) {
					const row = await this.getRow(em, id);
					if (!row || row.status !== 'invited') continue;
					const r = await this.confirmOrFallback(em, locked, row, 'waitlisted');
					if (r.status === 'confirmed') autoConfirmedInvites++; else waitlistedInvites++;
				}
			});
		}
		return { purgedMaybes, autoConfirmedInvites, waitlistedInvites };
	}

	// ------------------------------------------------------------------------------------- reviews
	/** endorsement / feedback / warning. One per (author, target, type); a repeat updates the body. */
	@bindThis
	public async review(author: MiUser, targetUserId: MiUser['id'], type: MiMeetReview['type'], body: string | null, meetId: MiMeet['id'] | null): Promise<MiMeetReview> {
		if (author.id === targetUserId) throw this.err('invalid_transition', 'You cannot review yourself.');
		const existing = await this.meetReviewsRepository.findOneBy({ authorId: author.id, targetUserId, type });
		if (existing) {
			await this.meetReviewsRepository.update(existing.id, { body, meetId, archivedAt: null });
			return await this.meetReviewsRepository.findOneByOrFail({ id: existing.id });
		}
		return await this.meetReviewsRepository.insertOne({ id: this.idService.gen(), authorId: author.id, targetUserId, type, body, meetId, createdAt: new Date() });
	}

	/**
	 * What `viewer` may see about `target`. Endorsements: everyone. Feedback: the target only. Warnings: their
	 * author, the target, and everyone once WARNING_PUBLIC_THRESHOLD distinct people have issued one
	 * ("Warnings will be publicly shown to the community when given by at least 5 others").
	 */
	@bindThis
	public async reviewsVisibleTo(targetUserId: MiUser['id'], viewerId: MiUser['id'] | null): Promise<{ reviews: MiMeetReview[]; warningCount: number; warningsPublic: boolean }> {
		const all = await this.meetReviewsRepository.find({ where: { targetUserId }, order: { createdAt: 'DESC' } });
		const warnings = all.filter(r => r.type === 'warning' && !r.archivedAt);
		const warningCount = new Set(warnings.map(w => w.authorId)).size;
		const warningsPublic = warningCount >= WARNING_PUBLIC_THRESHOLD;
		const reviews = all.filter(r => {
			if (r.archivedAt) return viewerId === targetUserId;
			if (r.type === 'endorsement') return true;
			if (r.type === 'feedback') return viewerId === targetUserId || viewerId === r.authorId;
			return warningsPublic || viewerId === targetUserId || viewerId === r.authorId;
		});
		return { reviews, warningCount, warningsPublic };
	}

	/** "No showed {{count}} times in 30 days" — derived, never stored against the person. */
	@bindThis
	public async noShowCount(userId: MiUser['id'], now = new Date()): Promise<number> {
		const since = new Date(now.getTime() - NO_SHOW_WINDOW_DAYS * 86_400_000);
		const rows = await this.db.query(
			`SELECT count(*)::int AS n FROM "meet_participant" p JOIN "meet" m ON m."id" = p."meetId"
			  WHERE p."userId" = $1 AND 'noShow' = ANY(p."tags") AND m."startAt" >= $2`, [userId, since]) as { n: number }[];
		return rows[0]?.n ?? 0;
	}

	// ---------------------------------------------------------------------------------------- misc
	private async onConfirmed(meet: MiMeet, p: Row): Promise<void> {
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
			if (p.userId !== meet.hostId) this.notify(p.userId, meet, 'You are confirmed', 'You are confirmed to play. Please be on time.');
		}
	}

	private notify(userId: MiUser['id'], meet: MiMeet, header: string, body: string): void {
		if (meet.sendNotifications === false) return;
		this.notificationService.createNotification(userId, 'app', {
			customHeader: header,
			customBody: body,
			customIcon: null,
			appAccessTokenId: null,
		});
	}
}

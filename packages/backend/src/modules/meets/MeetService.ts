/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { DataSource, EntityManager, In, IsNull, LessThan, MoreThan } from 'typeorm';
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
import { meetSystemLine, meetUpdateSystemKey, sweepEndedMeetChats } from '@/modules/meets/MeetChatSystem.js';
import { bindThis } from '@/decorators.js';
import { memberExistsSql, adminExistsSql } from '@/modules/clubs/club-tiers.js';   // CLUB-TIERS-V1
import { meetUpdatesMuted } from '@/modules/meets/meet-updates-mute.js';   // ACCOUNT-BUGS-V1: Settings › Meet updates
import type { Packed } from '@/misc/json-schema.js';
import type { UserEntityService } from '@/core/entities/UserEntityService.js';
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
	| 'host_needs_seat'
	| 'guest_limit'          // T3-MEET-HOST-V1: a confirmed player already has their +1
	| 'has_matches'          // T3-MEET-HOST-V1: meets/delete
	| 'has_participants';    // T3-MEET-HOST-V1: meets/delete

const MAYBE_PURGE_MINUTES = 120;         // "People in Maybe list will be removed 2 hours before meet start."
const INVITE_AUTO_CONFIRM_DAYS = 3;      // "You will be auto-confirmed in 3 days if no action is taken."
const NO_SHOW_WINDOW_DAYS = 30;          // "No showed {{count}} times in 30 days"

/* SEC-REVIEW-AUTHOR-V1 (2026-09-24, lane sec-chemistry; G15.4) — ONE rule for who may learn a review's AUTHOR, applied by
 * every review door (reviews/show via packReviews, reviews/list, reviews/meet-summary's givers):
 *   the author always; the person reviewed for an endorsement or feedback ("attributed" — G15.4), never for a warning
 *   ("anonymous to the person warned" — G15.4); nobody else, signed in or out.
 * Why not "endorsements are signed for everyone": Reclub hides kudos givers from everyone but paying Supporters, the
 * recipient included ("Curious who gave you kudos?" upsell, spec_meets §5.1 / §5.4) — GripBat gives the recipient that for
 * free (REVIEWS-LIST-V1) and no more. Measured 2026-09-24: reviews/list applied this while reviews/show packed every
 * endorsement's author for any caller, a signed-out one included. The endorsement itself (body, dimensions, counts)
 * stays public; only who wrote it is held back. */
export function reviewAuthorKnown(r: { type: string; authorId: string; targetUserId: string }, viewerId: string | null | undefined): boolean {
	if (!viewerId) return false;
	if (viewerId === r.authorId) return true;
	return viewerId === r.targetUserId && r.type !== 'warning';
}

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
/** Affected-row count of an em.query() UPDATE/DELETE: TypeORM (pg) returns [rows, rowCount]; a bare rows array otherwise. */
function affectedRows(res: unknown): number {
	if (Array.isArray(res) && res.length === 2 && Array.isArray(res[0]) && typeof res[1] === 'number') return res[1];
	return Array.isArray(res) ? res.length : 0;
}

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
		// Side effects (chat room membership, notifications) queue here and run AFTER commit. Inside the lock they
		// need a second pool connection; under N concurrent joins the N waiters hold every connection, the holder
		// starves, and the waiters die at statement_timeout — observed live as 9/11 joins → 500 (probe C2, 09-16).
		const after: Array<() => Promise<void> | void> = [];
		const result = await this.db.transaction(async em => {
			this.afterCommit.set(em, after);
			const rows = await em.query(`SELECT * FROM "meet" WHERE "id" = $1 FOR UPDATE`, [meetId]) as MiMeet[];
			if (!rows.length) throw this.err('meet_not_found', 'This meet does not exist.');
			return await fn(em, rows[0]);
		});
		for (const f of after) {
			try { await f(); } catch { /* best-effort side effects; the seat is already committed */ }
		}
		return result;
	}

	/** Per-transaction queue of post-commit side effects (keyed by the transaction's own EntityManager). */
	private readonly afterCommit = new WeakMap<EntityManager, Array<() => Promise<void> | void>>();

	/**
	 * The claim. True iff a seat was taken. Zero rows = full, not active, or started — no separate read decided it.
	 * TypeORM returns [rows, rowCount] for UPDATE/DELETE (a 2-element array ALWAYS), so the affected count is read
	 * explicitly — the first live probe (09-16) confirmed 22 rows against a counter of 5 because `.length > 0` was
	 * true for every claim. The counter held; the rows did not. Both must.
	 */
	private async claimSeat(em: EntityManager, meetId: MiMeet['id']): Promise<boolean> {
		const res = await em.query(
			`UPDATE "meet" SET "confirmed" = "confirmed" + 1, "updatedAt" = now()
			  WHERE "id" = $1 AND "status" = 'active' AND "startAt" > now() AND "confirmed" + 1 <= "capacity"
			  RETURNING "confirmed"`, [meetId]) as unknown;
		return affectedRows(res) > 0;
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
			this.onConfirmed(em, meet, r);
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
			this.onConfirmed(em, meet, r);
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
		const systemKey = meetUpdateSystemKey(meet, patch); // CHAT-V2: what Reclub announces in the room (time / venue / fee)
		const updated = await this.withMeetLock(meet.id, async (em, locked) => {
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
		if (systemKey) {
			const host = await this.usersRepository.findOneBy({ id: meet.hostId });
			void meetSystemLine(this.chatService, updated, systemKey, { name: host?.name ?? host?.username ?? null, userId: meet.hostId });
		}
		// BACKEND-DELIVERY-V1: a new time or place reaches every player holding a spot (Reclub
		// notifications.meet_location_changed: "The meet location has changed. Tap to see changes.")
		if (systemKey === 'time' || systemKey === 'venue') {
			const rows = await this.meetParticipantsRepository.findBy({ meetId: meet.id, status: In(['confirmed', 'waitlisted', 'hold', 'invited', 'requested']) });
			const body = systemKey === 'time' ? `The time of ${updated.name} has changed. Tap to see changes.` : `The location of ${updated.name} has changed. Tap to see changes.`;
			for (const p of rows) if (p.userId && p.userId !== meet.hostId && !p.isHost) this.notify(p.userId, updated, 'Meet updated', body);
		}
		return updated;
	}

	/** E9: the meet is cancelled; rows and their history stay. The counter is meaningless afterwards and untouched. */
	/** SERIES-V1: the same meet, count times, every day or week, sharing a seriesId. Returns them in date order. */
	@bindThis
	public async createSeries(host: MiUser, data: Parameters<MeetService['create']>[1], repeat: { every: 'day' | 'week'; count: number }): Promise<MiMeet[]> {
		const seriesId = this.idService.gen();
		const out: MiMeet[] = [];
		const step = repeat.every === 'day' ? 86_400_000 : 7 * 86_400_000;
		for (let i = 0; i < Math.max(1, Math.min(26, repeat.count)); i++) {
			out.push(await this.create(host, { ...data, seriesId, startAt: new Date(new Date(data.startAt).getTime() + i * step) }));
		}
		return out;
	}

	/** SERIES-V1: cancel this meet and every later meet of its series. */
	@bindThis
	public async cancelSeries(meet: MiMeet): Promise<number> {
		if (!meet.seriesId) { await this.cancel(meet); return 1; }
		const rows = await this.meetsRepository.find({ where: { seriesId: meet.seriesId, status: 'active' } });
		let n = 0;
		for (const m of rows) if (new Date(m.startAt).getTime() >= new Date(meet.startAt).getTime()) { await this.cancel(m); n++; }
		return n;
	}

	/** KUDOS-LEADERBOARD-V1 (Reclub street-cred): players ranked by public endorsements received in a window. */
	@bindThis
	public async kudosLeaderboard(from: Date, to: Date, dimension: string | null, limit: number): Promise<{ userId: string; count: number; dims: Record<string, number> }[]> {
		const rows = await this.db.query(
			`SELECT r."targetUserId" AS "userId", r."body" FROM "meet_review" r WHERE r."type" = 'endorsement' AND r."archivedAt" IS NULL AND r."createdAt" >= $1 AND r."createdAt" < $2`, [from, to]) as { userId: string; body: string | null }[];
		const by = new Map<string, { count: number; dims: Record<string, number> }>();
		for (const r of rows) {
			const dims = (r.body ?? '').split(',').map(x => x.trim()).filter(Boolean);
			if (dimension && !dims.includes(dimension)) continue;
			const e = by.get(r.userId) ?? { count: 0, dims: {} };
			e.count += dimension ? 1 : Math.max(1, dims.length);
			for (const d of dims) e.dims[d] = (e.dims[d] ?? 0) + 1;
			by.set(r.userId, e);
		}
		return [...by.entries()].map(([userId, e]) => ({ userId, ...e })).sort((a, b) => b.count - a.count).slice(0, limit);
	}

	@bindThis
	public async cancel(meet: MiMeet): Promise<void> {
		await this.meetsRepository.update(meet.id, { status: 'cancelled', cancelledAt: new Date(), updatedAt: new Date() });
		void meetSystemLine(this.chatService, meet, 'cancelled'); // CHAT-V2 system line in the room
		const rows = await this.meetParticipantsRepository.findBy({ meetId: meet.id, status: In(['confirmed', 'waitlisted', 'requested', 'invited', 'hold', 'maybe']) });
		for (const p of rows) if (p.userId && p.userId !== meet.hostId) this.notify(p.userId, meet, 'Cancelled', `${meet.name} has been cancelled by the host.`);
		await this.retireRatings(meet);
	}

	/* T3-MEET-HOST-V1 (Reclub triage A-meet-detail.07) — the host kebab's "Delete meet". Reclub deletes only a meet
	 * nothing has happened on; everything else is CANCELLED, because a cancel tells the roster and keeps history. So:
	 * the creating host only (a co-host may cancel, not erase); never a schedule-made or coaching meet (the schedule
	 * sweep owns those — deleting one would let the sweep make it again); refused while any match exists or anyone
	 * but the host is on the roster. Checked and deleted under the meet lock, so a join cannot slip in between.
	 * The FKs do the rest (meet_participant / meet_group / meet_match CASCADE, meet_review SET NULL); the meet's own
	 * chat room goes with it through the native ChatService.deleteRoom. G11: EXTEND — no table, one door. */
	@bindThis
	public async deleteMeet(meet: MiMeet, user: MiUser): Promise<void> {
		if (meet.hostId !== user.id) throw this.err('not_host', 'Only the host who created this meet can delete it.');
		if (meet.seriesId || meet.coachScheduleId) throw this.err('invalid_transition', 'This meet belongs to a schedule. Cancel it instead.');
		const roomId = await this.withMeetLock(meet.id, async (em, locked) => {
			const matches = await em.query(`SELECT 1 FROM "meet_match" WHERE "meetId" = $1 LIMIT 1`, [meet.id]) as unknown[];
			if (matches.length) throw this.err('has_matches', 'This meet has matches. Delete the matches first, or cancel the meet.');
			const others = await em.query(`SELECT 1 FROM "meet_participant" WHERE "meetId" = $1 AND ("userId" IS NULL OR "userId" <> $2) LIMIT 1`, [meet.id, locked.hostId]) as unknown[];
			if (others.length) throw this.err('has_participants', 'Players are on this meet. Cancel it instead, so they are told.');
			await em.query(`DELETE FROM "meet" WHERE "id" = $1`, [meet.id]);
			return locked.chatRoomId;
		});
		if (roomId) {
			const room = await this.chatService.findRoomById(roomId).catch(() => null);
			if (room) await this.chatService.deleteRoom(room).catch(() => undefined);
		}
	}

	/* T3-MEET-HOST-V1 (Reclub triage A-meet-detail.10) — the host kebab's "Refresh meet chat": everyone who should be in
	 * the meet's room (confirmed players and co-hosts) and is not — the join side effect is best-effort and can miss —
	 * is put back through the same native invitation + join the confirmation uses. Returns how many were added. */
	@bindThis
	public async refreshRoom(meet: MiMeet): Promise<{ added: number }> {
		if (!meet.chatRoomId) return { added: 0 };
		const room = await this.chatService.findRoomById(meet.chatRoomId);
		if (!room) return { added: 0 };
		const rows = await this.db.query(`SELECT "userId" FROM "meet_participant" WHERE "meetId" = $1 AND "userId" IS NOT NULL AND ("status" = 'confirmed' OR "isHost" = true)`, [meet.id]) as { userId: string }[];
		let added = 0;
		for (const r of rows) {
			if (r.userId === room.ownerId) continue;
			if (await this.chatService.isRoomMember(room, r.userId)) continue;
			try {
				await this.chatService.createRoomInvitation(meet.hostId, room.id, r.userId, { notify: false }).catch((e: any) => { if (!/already invited/.test(String(e && e.message))) throw e; });
				await this.chatService.joinToRoom(r.userId, room.id);
				added++;
			} catch { /* one refusal must not stop the others */ }
		}
		return { added };
	}

	/* FRESH-EYES P1-2 (2026-09-20) — CANCELLING A MEET RETIRES WHAT ITS MATCHES WROTE TO THE GRIPBAT RATING.
	 *
	 * The rule that a cancelled meet does not count already exists, and is only half applied: pendingMatches() in
	 * modules/stats/GbRating.ts refuses a match whose meet is cancelled, but it asks at RATING time. A meet that was
	 * rated first and cancelled afterwards keeps every gb_rating_log row it minted, for ever.
	 *
	 * MEASURED on UAT (probes/fresh-eyes.json P1-2). player-amy's Statistics read "GRIPBAT RATING 3.32 · +0.32 30d ·
	 * 3 matches", "FORM On fire — 3 wins in 3" and "Upsets 3" directly above the tiles "0 Meets played / 0 Hosted".
	 * All three of those matches came from meets that had since been cancelled (gb_rating_log.source='meet', matchId
	 * → meet_match → meet.status='cancelled'), so the tiles were right and the Edge was the wrong number. A player
	 * could not tell what their record was.
	 *
	 * The rule is now SYMMETRIC: what a cancelled meet wrote is taken back, and gb_player_rating is set to what the
	 * REMAINING log says — the rating and the match count come from one place, whichever way a meet ends. Scoped to
	 * the players the meet actually rated, and never allowed to fail the cancellation (the meet is already
	 * cancelled by the time this runs; the sweep and the next rating pass reconcile anything left).
	 *
	 * G11: this is (2) EXTEND — no new endpoint or table. It is GripBat's own rating (modules/stats/GbRating.ts),
	 * which Misskey has no equivalent of, kept consistent on the existing cancel path.
	 */
	private async retireRatings(meet: MiMeet): Promise<void> {
		try {
			const touched = await this.db.query(
				'SELECT DISTINCT l."userId" AS "userId", l.sport AS sport FROM gb_rating_log l JOIN meet_match mm ON mm.id = l."matchId" WHERE l.source = $1 AND mm."meetId" = $2',
				['meet', meet.id]) as { userId: string; sport: string }[];
			if (!touched.length) return;
			await this.db.query('DELETE FROM gb_rating_log l USING meet_match mm WHERE l.source = $1 AND l."matchId" = mm.id AND mm."meetId" = $2', ['meet', meet.id]);
			for (const t of touched) {
				if (!t.userId || t.userId === '-') continue;
				const agg = (await this.db.query(
					'SELECT count(*)::int AS cnt, (array_agg(post ORDER BY "createdAt" DESC, "playedAt" DESC))[1] AS last FROM gb_rating_log WHERE "userId" = $1 AND sport = $2 AND NOT skipped',
					[t.userId, t.sport]))[0] as { cnt: number; last: string | null } | undefined;
				if (!agg || !agg.cnt) await this.db.query('DELETE FROM gb_player_rating WHERE "userId" = $1 AND sport = $2', [t.userId, t.sport]);
				else await this.db.query('UPDATE gb_player_rating SET matches = $3, rating = $4, "updatedAt" = now() WHERE "userId" = $1 AND sport = $2', [t.userId, t.sport, agg.cnt, agg.last]);
			}
		} catch (e) { /* the cancellation stands; probes/_sweep.cjs and the next rating pass reconcile */ }
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

	/** Private meets: the access token, an invitation, or club membership (the meet's own club, or any attached club's
	 *  channel) admits. CLUB-TIERS-V1: membership is club_member (+ owner / admins), not the follow — a follower of the
	 *  club does not see its members-only meets. */
	public async mayViewPrivate(meet: MiMeet, userId: MiUser['id'] | null, accessToken?: string | null): Promise<boolean> {
		if (meet.visibility !== 'private') return true;
		if (accessToken && meet.accessToken === accessToken) return true;
		if (!userId) return false;
		if (userId === meet.hostId) return true;
		if (await this.meetParticipantsRepository.existsBy({ meetId: meet.id, userId })) return true;
		const groups = await this.meetGroupsRepository.find({ where: { meetId: meet.id }, select: { channelId: true } });
		const clubIds = Array.from(new Set([...(meet.channelId ? [meet.channelId] : []), ...groups.map(g => g.channelId)]));
		if (!clubIds.length) return false;
		const rows = await this.db.query(`SELECT 1 FROM unnest($1::varchar[]) AS c(id) WHERE ${memberExistsSql('c.id', '$2')} OR ${adminExistsSql('c.id', '$2')} LIMIT 1`, [clubIds, userId]) as unknown[];
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
		if (meet.type === 'listing') throw this.err('invalid_transition', 'This meet is a listing and only contains information. Contact the host directly.'); // MEET-EXTRAS-V1
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
			// T3-MEET-HOST-V1 (Reclub triage A-meet-detail.35 "Request +1"): a player who is ALREADY confirmed asks for their one
			// guest afterwards — the same guest row the join makes (kind plusOne, sponsorId = the player), the same seat rule
			// (autoApprove inside the band → claimSeat, else a request the host decides). One guest per player, as at join.
			if (existing && existing.status === 'confirmed' && plusOnes > 0) {
				const had = await em.query(`SELECT 1 FROM "meet_participant" WHERE "meetId" = $1 AND "sponsorId" = $2 AND "kind" = 'plusOne' LIMIT 1`, [meet.id, user.id]) as unknown[];
				if (had.length) throw this.err('guest_limit', 'You already have a +1 on this meet.');
				const guest = (await em.query(
					`INSERT INTO "meet_participant" ("id","meetId","userId","kind","sponsorId","displayName","status","isHost","tags","statusChangedAt")
					 VALUES ($1,$2,NULL,'plusOne',$3,$4,'requested',false,'{guest}',now()) RETURNING *`,
					[this.idService.gen(), meet.id, user.id, `${user.name ?? user.username} +1`]) as Row[])[0];
				if (autoConfirm) await this.confirmOrFallback(em, locked, guest, 'waitlisted');
				else if (meet.hostId !== user.id) this.notify(meet.hostId, meet, 'Request to join', `${user.name ?? user.username} has requested a +1 for ${meet.name}.`);
				return existing as MiMeetParticipant;
			}
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
			if (!autoConfirm && meet.hostId !== user.id) this.notify(meet.hostId, meet, 'Request to join', `${user.name ?? user.username} has requested to join ${meet.name}.`);
			// BACKEND-DELIVERY-V1: an auto-approved join reaches the host too (a seat taken, or a place on the waitlist)
			if (autoConfirm && meet.hostId !== user.id) {
				if (row.status === 'confirmed') this.notify(meet.hostId, meet, 'New player', `${user.name ?? user.username} joined ${meet.name}.`);
				else if (row.status === 'waitlisted') this.notify(meet.hostId, meet, 'New player', `${user.name ?? user.username} joined the waitlist of ${meet.name}.`);
			}
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
			// SEC-CASUAL-CONSENT-V1: a logged casual game is already played — its consent is its own path, not a seat
			// claim (claimSeat requires startAt > now, and the game is dated in the past). The invitee's answer is final
			// and idempotent: accept → confirmed (a repeat accept is a no-op), decline → declined (the game never counts).
			if ((locked.flags ?? []).includes('casual')) {
				if (answer === 'accept') {
					if (row.status === 'confirmed') return row as MiMeetParticipant;
					if (row.status !== 'invited') throw this.err('invalid_transition', `Cannot confirm a casual game from status ${row.status}.`);
					await em.query(`UPDATE "meet" SET "confirmed" = LEAST("confirmed" + 1, "capacity"), "updatedAt" = now() WHERE "id" = $1`, [meet.id]);
					return await this.setRowStatus(em, row, 'confirmed') as MiMeetParticipant;
				}
				if (answer === 'decline') {
					if (row.status === 'declined') return row as MiMeetParticipant;
					if (row.status !== 'invited') throw this.err('invalid_transition', `Cannot decline a casual game from status ${row.status}.`);
					return await this.setRowStatus(em, row, 'declined') as MiMeetParticipant;
				}
				throw this.err('invalid_transition', 'A casual game can only be confirmed or declined.');
			}
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
		let leftFrom: string | null = null;
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
			leftFrom = row.status;
			await this.leaveConfirmed(em, locked, row, 'delete');
			await this.promoteLocked(em, locked);
		});
		// BACKEND-DELIVERY-V1: the host hears that a seat (or a waitlist place, or a request) was given up
		if (meet.hostId !== user.id && (leftFrom === 'confirmed' || leftFrom === 'waitlisted' || leftFrom === 'requested')) {
			this.notify(meet.hostId, meet, 'Player left', leftFrom === 'requested' ? `${user.name ?? user.username} withdrew their request to join ${meet.name}.` : `${user.name ?? user.username} left ${meet.name}.`);
		}
		// CHAT-V2 fix: a player who leaves also leaves the meet room, so a later re-join posts "{name} has joined" again
		// (the joined line is written only when the player is not yet a room member — probe chat-v2 E8).
		if (meet.chatRoomId) await this.chatService.leaveRoom(user.id, meet.chatRoomId).catch(() => undefined);
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
			// SEC-CASUAL-CONSENT-V1: on a casual game only the player answers for themself — the host may remove or decline
			// another player, never confirm / re-invite / waitlist / hold them (that would manufacture consent).
			if ((locked.flags ?? []).includes('casual') && row.userId && row.userId !== meet.hostId && status !== 'remove' && status !== 'declined') {
				throw this.err('invalid_transition', 'Only the player can confirm a casual game.');
			}
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
				this.onConfirmed(em, meet, r);
				return r as MiMeetParticipant;
			}
			const r = await this.leaveConfirmed(em, locked, row, status);
			if (row.status === 'confirmed') await this.promoteLocked(em, locked);
			if (status === 'invited' && row.userId) this.notify(row.userId, meet, "You've been invited", `You've been invited to ${meet.name}.`);
			if (status === 'hold' && row.userId) this.notify(row.userId, meet, 'On hold', `You are on hold for ${meet.name}. Please message the host for more details.`);
			// BACKEND-DELIVERY-V1: a declined request (or a declined spot) is told to the player, as an approval is
			if (status === 'declined' && row.userId && row.status !== 'declined') this.notify(row.userId, meet, 'Request declined', `Your request to join ${meet.name} was declined.`);
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
			// SEC-CASUAL-CONSENT-V1: another account can join a casual game only as PENDING ('invited'); never straight in
			if ((locked.flags ?? []).includes('casual') && data.userId && data.userId !== meet.hostId && data.status !== 'invited') {
				throw this.err('invalid_transition', 'Another player can only be invited to a casual game; they confirm it themselves.');
			}
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
				this.onConfirmed(em, meet, row);
			} else if (data.status === 'waitlisted') {
				row = await this.setRowStatus(em, row, 'waitlisted', { waitlistRank: await this.nextRank(em, meet.id) });
			} else {
				row = await this.setRowStatus(em, row, data.status);
				if (data.status === 'invited' && data.userId) this.notify(data.userId, meet, "You've been invited", `You've been invited to ${meet.name}.`);
			}
			return row as MiMeetParticipant;
		});
	}

	/**
	 * FIX-S5 HOST-SWAP-V1 (2026-09-24; Reclub A-roles-action.12 — participant sheet › More › `common:swap` → add-from-community):
	 * the HOST puts another player into a confirmed participant's seat. EXTENDS MEET-SWAP-V1 (swapSeat below): the same
	 * seat-in-place rules (the row keeps its roster place, team and court; the confirmed count never moves; nobody on the
	 * waitlist is skipped), the same checks on the new player (not blocked with a host, inside the level band, may see a
	 * private meet — G15.5), refused once the meet has started. The seat may be a player, a reserved spot or a +1; a host
	 * row never. A player swapped out is told the way Remove tells them (their +1 guests leave with them, as Remove does)
	 * and leaves the chat; the new player is told they are confirmed. No new sentence: both are ones the app translates.
	 */
	@bindThis
	public async hostSwapSeat(meet: MiMeet, host: MiUser, participantId: string, taker: MiUser): Promise<MiMeetParticipant> {
		await this.assertHost(meet, host);
		if (meet.type === 'listing') throw this.err('invalid_transition', 'This meet is a listing and only contains information.');
		if (meet.status !== 'active') throw this.err('meet_not_active', 'This meet is not active.');
		if (this.hasStarted(meet)) throw this.err('meet_started', 'This meet has already started.');
		if ((meet.flags ?? []).includes('casual')) throw this.err('invalid_transition', 'A casual game cannot be handed to another player.');
		if (await this.isBlockedWithHosts(meet, taker.id)) throw this.err('blocked', 'That player cannot join this meet.');
		if (meet.visibility === 'private' && !(await this.mayViewPrivate(meet, taker.id))) throw this.err('private', 'That player is not in this private meet\'s club.');
		const level = await this.meetLevelService.getLevel(taker.id, meet.sport);
		if (this.meetLevelService.gateVerdict(meet, level) === 'denied') throw this.err('gate_denied', 'That player does not meet the level requirements.');
		let outUserId: string | null = null;
		const row = await this.withMeetLock(meet.id, async (em, locked) => {
			if (this.hasStarted(locked)) throw this.err('meet_started', 'This meet has already started.');
			const seat = (await em.query(`SELECT * FROM "meet_participant" WHERE "id" = $1 AND "meetId" = $2`, [participantId, meet.id]) as Row[])[0];
			if (!seat) throw this.err('not_participant', 'No such participant on this meet.');
			if (seat.status !== 'confirmed') throw this.err('invalid_transition', 'Only a confirmed spot can be swapped.');
			if (seat.isHost || (seat.userId && seat.userId === locked.hostId)) throw this.err('invalid_transition', 'A host cannot be swapped out of the meet.');
			if (seat.userId === taker.id) throw this.err('invalid_transition', 'Choose another player.');
			const theirs = (await em.query(`SELECT * FROM "meet_participant" WHERE "meetId" = $1 AND "userId" = $2`, [meet.id, taker.id]) as Row[])[0];
			if (theirs && theirs.status === 'confirmed') throw this.err('already_participant', 'That player is already confirmed on this meet.');
			if (theirs) await this.leaveConfirmed(em, locked, theirs, 'delete');   // a waitlist place / request / invite becomes the seat
			const out = seat.kind === 'user' && seat.userId ? seat.userId : null;
			const guests = out ? await em.query(`SELECT * FROM "meet_participant" WHERE "meetId" = $1 AND "sponsorId" = $2 AND "kind" = 'plusOne'`, [meet.id, out]) as Row[] : [];
			for (const g of guests) await this.leaveConfirmed(em, locked, g, 'delete');
			await em.query(
				`UPDATE "meet_participant" SET "userId" = $2, "kind" = 'user', "sponsorId" = NULL, "displayName" = NULL, "declaredLevel" = NULL, "extGender" = NULL, "extAge" = NULL,
				        "tags" = '{}', "isCoach" = false, "isReferee" = false, "isPaymentCollector" = false, "paymentType" = NULL, "checkedInAt" = NULL,
				        "receiptFileId" = NULL, "receiptUrl" = NULL, "receiptAt" = NULL, "receiptById" = NULL, "forceSkill" = NULL, "forcePosition" = NULL
				  WHERE "id" = $1`, [seat.id, taker.id]);
			if (guests.length) await this.promoteLocked(em, locked);
			outUserId = out;
			return (await this.getRow(em, seat.id))!;
		});
		if (meet.chatRoomId) {
			if (outUserId) await this.chatService.leaveRoom(outUserId, meet.chatRoomId).catch(() => undefined);
			try {
				const room = await this.chatService.findRoomById(meet.chatRoomId);
				if (room && !(await this.chatService.isRoomMember(room, taker.id))) {
					await this.chatService.createRoomInvitation(meet.hostId, room.id, taker.id, { notify: false }).catch((e: any) => { if (!/already invited/.test(String(e && e.message))) throw e; });
					await this.chatService.joinToRoom(taker.id, room.id);
					await meetSystemLine(this.chatService, meet, 'joined', { name: taker.name ?? taker.username ?? null, userId: taker.id });
				}
			} catch {
				// chat is best-effort
			}
		}
		if (outUserId) this.notify(outUserId, meet, 'Removed', `You were removed from ${meet.name}.`);
		this.notify(taker.id, meet, 'You are confirmed', `You are confirmed to play ${meet.name}. Please be on time.`);
		return row as MiMeetParticipant;
	}

	/**
	 * MEET-SWAP-V1 (lane mop-up, 2026-09-24; Reclub A-meet-detail.47 `common:swap` → `swapParticipant`, overlay
	 * add-from-community): a confirmed player hands THEIR seat to another player. The seat changes hands in place — the same
	 * row keeps its place in the roster, its team and court (a generated rotation keeps working), so the confirmed count never
	 * moves and nobody on the waitlist is skipped or promoted by it. Allowed inside the cancellation freeze (the seat stays
	 * filled — that is what a swap is for), refused once the meet has started. The new player must be able to join on their
	 * own terms: not blocked with a host or with the giver, inside the level band, and — on a private meet — someone who may
	 * already see it (club member / invited), so a swap never shows a private meet to a stranger (G15.5).
	 * Their +1 guests leave with the giver (Reclub: "Your +1 leaves with you"); those freed seats go to the waitlist.
	 */
	@bindThis
	public async swapSeat(meet: MiMeet, giver: MiUser, taker: MiUser): Promise<MiMeetParticipant> {
		if (meet.type === 'listing') throw this.err('invalid_transition', 'This meet is a listing and only contains information.');
		if (meet.status !== 'active') throw this.err('meet_not_active', 'This meet is not active.');
		if (this.hasStarted(meet)) throw this.err('meet_started', 'This meet has already started.');
		if ((meet.flags ?? []).includes('casual')) throw this.err('invalid_transition', 'A casual game cannot be handed to another player.');
		if (taker.id === giver.id) throw this.err('invalid_transition', 'Choose another player.');
		if (await this.isBlockedWithHosts(meet, taker.id)) throw this.err('blocked', 'That player cannot join this meet.');
		const blockedPair = await this.blockingsRepository.exists({ where: [{ blockerId: giver.id, blockeeId: taker.id }, { blockerId: taker.id, blockeeId: giver.id }] });
		if (blockedPair) throw this.err('blocked', 'That player cannot join this meet.');
		if (meet.visibility === 'private' && !(await this.mayViewPrivate(meet, taker.id))) throw this.err('private', 'That player is not in this private meet\'s club.');
		const level = await this.meetLevelService.getLevel(taker.id, meet.sport);
		if (this.meetLevelService.gateVerdict(meet, level) === 'denied') throw this.err('gate_denied', 'That player does not meet the level requirements.');
		const row = await this.withMeetLock(meet.id, async (em, locked) => {
			if (this.hasStarted(locked)) throw this.err('meet_started', 'This meet has already started.');
			const mine = (await em.query(`SELECT * FROM "meet_participant" WHERE "meetId" = $1 AND "userId" = $2`, [meet.id, giver.id]) as Row[])[0];
			if (!mine || mine.status !== 'confirmed') throw this.err('not_participant', 'Only a confirmed player can swap their spot.');
			if (mine.isHost || locked.hostId === giver.id) throw this.err('invalid_transition', 'A host cannot swap out of their own meet.');
			const theirs = (await em.query(`SELECT * FROM "meet_participant" WHERE "meetId" = $1 AND "userId" = $2`, [meet.id, taker.id]) as Row[])[0];
			if (theirs && theirs.status === 'confirmed') throw this.err('already_participant', 'That player is already confirmed on this meet.');
			if (theirs) await this.leaveConfirmed(em, locked, theirs, 'delete');   // a waitlist place / request / invite becomes the seat
			const guests = await em.query(`SELECT * FROM "meet_participant" WHERE "meetId" = $1 AND "sponsorId" = $2 AND "kind" = 'plusOne'`, [meet.id, giver.id]) as Row[];
			for (const g of guests) await this.leaveConfirmed(em, locked, g, 'delete');
			await em.query(
				`UPDATE "meet_participant" SET "userId" = $2, "kind" = 'user', "displayName" = NULL, "declaredLevel" = NULL, "extGender" = NULL, "extAge" = NULL,
				        "tags" = '{}', "isCoach" = false, "isReferee" = false, "isPaymentCollector" = false, "paymentType" = NULL, "checkedInAt" = NULL,
				        "receiptFileId" = NULL, "receiptUrl" = NULL, "receiptAt" = NULL, "receiptById" = NULL, "forceSkill" = NULL, "forcePosition" = NULL
				  WHERE "id" = $1`, [mine.id, taker.id]);
			if (guests.length) await this.promoteLocked(em, locked);
			return (await this.getRow(em, mine.id))!;
		});
		// after commit: the room follows the seat, the new player is told who handed it over, the host hears of it
		if (meet.chatRoomId) {
			await this.chatService.leaveRoom(giver.id, meet.chatRoomId).catch(() => undefined);
			try {
				const room = await this.chatService.findRoomById(meet.chatRoomId);
				if (room && !(await this.chatService.isRoomMember(room, taker.id))) {
					await this.chatService.createRoomInvitation(meet.hostId, room.id, taker.id, { notify: false }).catch((e: any) => { if (!/already invited/.test(String(e && e.message))) throw e; });
					await this.chatService.joinToRoom(taker.id, room.id);
					await meetSystemLine(this.chatService, meet, 'joined', { name: taker.name ?? taker.username ?? null, userId: taker.id });
				}
			} catch {
				// chat is best-effort
			}
		}
		const gname = giver.name ?? giver.username, tname = taker.name ?? taker.username;
		this.notify(taker.id, meet, 'Spot handed to you', `${gname} gave you their spot in ${meet.name}. You are confirmed to play.`);
		if (meet.hostId !== giver.id) this.notify(meet.hostId, meet, 'Spot swapped', `${gname} swapped their spot in ${meet.name} with ${tname}.`);
		return row as MiMeetParticipant;
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
			if ((meet.flags ?? []).includes('casual')) continue; // SEC-CASUAL-CONSENT-V1: a casual invite is never auto-confirmed
			await this.withMeetLock(meetId, async (em, locked) => {
				for (const id of ids) {
					const row = await this.getRow(em, id);
					if (!row || row.status !== 'invited') continue;
					const r = await this.confirmOrFallback(em, locked, row, 'waitlisted');
					if (r.status === 'confirmed') autoConfirmedInvites++; else waitlistedInvites++;
				}
			});
		}
		await sweepEndedMeetChats(this.db, this.chatService, now).catch(() => 0); // CHAT-V2: "This meet has ended" + the 14-day archive clock
		return { purgedMaybes, autoConfirmedInvites, waitlistedInvites };
	}

	// ------------------------------------------------------------------------------------- reviews
	/** endorsement / feedback / warning. One per (author, target, type); a repeat updates the body. */
	@bindThis
	public async review(author: MiUser, targetUserId: MiUser['id'], type: MiMeetReview['type'], body: string | null, meetId: MiMeet['id'] | null, opts: { competitionId?: string | null; note?: string | null } = {}): Promise<MiMeetReview> {
		if (author.id === targetUserId) throw this.err('invalid_transition', 'You cannot review yourself.');
		// KUDOS-CHAT-V1: an endorsement (kudos) is one per pair PER ACTIVITY (Reclub KudoReferenceType meet | competition);
		// feedback / warning stay one per pair. The migration's partial unique indexes hold the same rule.
		const competitionId = opts.competitionId ?? null;
		const where = type === 'endorsement'
			? { authorId: author.id, targetUserId, type, meetId: competitionId ? IsNull() : (meetId ?? IsNull()), competitionId: competitionId ?? IsNull() }
			: { authorId: author.id, targetUserId, type };
		const existing = await this.meetReviewsRepository.findOneBy(where);
		const note = type === 'endorsement' ? (opts.note ?? null) : null;
		if (existing) {
			await this.meetReviewsRepository.update(existing.id, type === 'endorsement' ? { body, note } : { body, meetId }); // W2-F: keeps archivedAt — the reviewed player's archive stands
			return await this.meetReviewsRepository.findOneByOrFail({ id: existing.id });
		}
		return await this.meetReviewsRepository.insertOne({ id: this.idService.gen(), authorId: author.id, targetUserId, type, body, meetId: competitionId ? null : meetId, competitionId, note, createdAt: new Date() });
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

	/** SAFETY-V1: a review needs a shared meet — both confirmed on this meet (host counts as confirmed). */
	@bindThis
	public async assertPlayedTogether(meet: MiMeet, authorId: MiUser['id'], targetUserId: MiUser['id']): Promise<void> {
		const rows = await this.meetParticipantsRepository.find({ where: { meetId: meet.id, userId: In([authorId, targetUserId]) }, select: { userId: true, status: true, isHost: true } });
		const okFor = (id: string) => rows.some(r => r.userId === id && (r.status === 'confirmed' || r.isHost));
		if (!okFor(authorId) || !okFor(targetUserId)) throw this.err('not_participant', 'You can only review someone you played with.');
		if (new Date(meet.startAt).getTime() > Date.now()) throw this.err('invalid_transition', 'You can review players once the meet has started.');
	}

	/** SAFETY-V1: the packed view of a person's reviews for a viewer (see reviewsVisibleTo) + no-shows + kudos tally. */
	@bindThis
	public async packReviews(targetUserId: MiUser['id'], viewerId: MiUser['id'] | null, users: UserEntityService, ref: { meetId?: string | null; competitionId?: string | null } = {}): Promise<Packed<'PlayerReviews'>> {
		const { reviews: visible, warningCount, warningsPublic } = await this.reviewsVisibleTo(targetUserId, viewerId);
		const reviews = visible.filter(r => !r.archivedAt); // W2-F: an archived review leaves the tallies, the person's own view too
		// SEC-WARN-ANON-V1 (2026-09-21, permission-sweep hole 4): a WARNING's author was packed like any other review,
		// so the person warned was told who warned them. A safety report that names the reporter to the person reported
		// is worse than no report — it invites retaliation and teaches everyone else not to file one. An endorsement or
		// a piece of feedback is still attributed (that is the point of it); a warning is attributed only back to the
		// person who wrote it, so they can see and withdraw their own.
		// SEC-REVIEW-AUTHOR-V1: the one author rule (reviewAuthorKnown) — this door used to name every endorser to anyone.
		const packRow = async (r: MiMeetReview) => ({
			author: !reviewAuthorKnown(r, viewerId)
				? null
				: await users.pack(r.authorId, null, { schema: 'UserLite' as const }).catch(() => null),
			body: r.body,
			note: r.type === 'endorsement' ? r.note : null,   // KUDOS-CHAT-V1: the endorsement's note is public with it
			createdAt: r.createdAt.toISOString(),
		});
		const by = async (t: MiMeetReview['type']) => Promise.all(reviews.filter(r => r.type === t).map(packRow));
		const kudos: Record<string, number> = {};
		for (const r of reviews) if (r.type === 'endorsement' && r.body) for (const k of r.body.split(',').map(x => x.trim()).filter(Boolean)) kudos[k] = (kudos[k] ?? 0) + 1;
		const mine: Record<string, string | null> = {};
		// KUDOS-CHAT-V1: several endorsements per pair (one per activity) — `mine.endorsement` is the one of the activity
		// asked about (ref), else the newest; mineIds / mineNote let the card update or delete exactly that row
		const mineIds: Record<string, string> = {}; let mineNote: string | null = null;
		if (viewerId) {
			const my = await this.meetReviewsRepository.find({ where: { authorId: viewerId, targetUserId }, order: { createdAt: 'ASC' } });
			const refd = ref.competitionId ? (r: MiMeetReview) => r.competitionId === ref.competitionId : ref.meetId ? (r: MiMeetReview) => r.meetId === ref.meetId && !r.competitionId : null;
			for (const r of my) {
				if (r.type === 'endorsement' && refd && !refd(r)) continue;
				mine[r.type] = r.body; mineIds[r.type] = r.id; if (r.type === 'endorsement') mineNote = r.note;
			}
		}
		return { userId: targetUserId, endorsements: await by('endorsement'), feedback: await by('feedback'), warnings: await by('warning'), warningCount, warningsPublic, noShows30d: await this.noShowCount(targetUserId), kudos, mine, mineIds, mineNote } as Packed<'PlayerReviews'>;
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
	/** Queue the confirmed-seat side effects for after commit (runs at once if no transaction is in flight). */
	private onConfirmed(em: EntityManager, meet: MiMeet, p: Row): void {
		const q = this.afterCommit.get(em);
		if (q) q.push(() => this.onConfirmedNow(meet, p));
		else void this.onConfirmedNow(meet, p).catch(() => {});
	}

	private async onConfirmedNow(meet: MiMeet, p: Row): Promise<void> {
		if (p.userId && meet.chatRoomId) {
			try {
				const room = await this.chatService.findRoomById(meet.chatRoomId);
				if (room && !(await this.chatService.isRoomMember(room, p.userId))) {
					// an earlier stint on this meet leaves an invitation row: "already invited" must not skip the join (chat-v2 E8)
					await this.chatService.createRoomInvitation(meet.hostId, room.id, p.userId, { notify: false }).catch((e: any) => { if (!/already invited/.test(String(e && e.message))) throw e; });
					await this.chatService.joinToRoom(p.userId, room.id);
					// CHAT-V2: "{name} has joined the conversation." (Reclub gate line)
					const joined = await this.usersRepository.findOneBy({ id: p.userId });
					await meetSystemLine(this.chatService, meet, 'joined', { name: joined?.name ?? joined?.username ?? null, userId: p.userId });
				}
			} catch {
				// chat is best-effort
			}
			if (p.userId !== meet.hostId) this.notify(p.userId, meet, 'You are confirmed', `You are confirmed to play ${meet.name}. Please be on time.`);
		}
	}

	/** BACKEND-DELIVERY-V1: the one meet notification door for callers outside this service (endpoints). */
	@bindThis
	public notifyUser(userId: MiUser['id'], meet: MiMeet, header: string, body: string): void {
		this.notify(userId, meet, header, body);
	}

	private notify(userId: MiUser['id'], meet: MiMeet, header: string, body: string): void {
		// SEC-CASUAL-NOTIFY-V1: a casual game carries no announcements — its only notifications are the consent ask and
		// its decisions — and log-casual creates it with sendNotifications:false, so suppressing them would hide the
		// request the consent flow depends on (gate re-run D-1: opponent never notified → game could never count).
		const consentCritical = Array.isArray((meet as { flags?: string[] }).flags) && (meet as { flags?: string[] }).flags!.includes('casual');
		if (meet.sendNotifications === false && !consentCritical) return;
		// ACCOUNT-BUGS-V1: the person switched Settings › Meet updates off (meet-updates-mute.ts). The consent ask of a casual
		// game still goes — it is the request the game depends on, not an update.
		void (consentCritical ? Promise.resolve(false) : meetUpdatesMuted(this.db, userId)).then((muted) => {
			if (muted) return;
			this.notificationService.createNotification(userId, 'app', {
				customHeader: header,
				customBody: body,
				customIcon: null,
				appAccessTokenId: null,
				customLink: 'meet:' + meet.id,
			});
		});
	}
}

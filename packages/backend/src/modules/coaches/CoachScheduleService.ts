/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { DataSource, In, MoreThanOrEqual } from 'typeorm';
import { DI } from '@/di-symbols.js';
import type { CoachSchedulesRepository, MeetsRepository, MeetParticipantsRepository, UsersRepository } from '@/models/_.js';
import type { MiUser } from '@/models/User.js';
import type { MiMeet } from '@/modules/meets/models/Meet.js';
import type { MiMeetParticipant } from '@/modules/meets/models/MeetParticipant.js';
import { MiCoachSchedule, coachBookingModes } from '@/modules/coaches/models/CoachSchedule.js';
import { ClubService } from '@/modules/clubs/ClubService.js';
import { MeetService } from '@/modules/meets/MeetService.js';
import { MeetEntityService } from '@/modules/meets/MeetEntityService.js';
import { IdService } from '@/core/IdService.js';
import { NotificationService } from '@/core/NotificationService.js';
import { IdentifiableError } from '@/misc/identifiable-error.js';
import { bindThis } from '@/decorators.js';
import { COACHING_V1_MARK, normalisePriceTiers, normaliseCancellation, normaliseCurrency, priceForGroup, type PriceTiers, type CancellationPolicy, type PriceBand } from '@/modules/coaches/coach-pricing.js';

// venue-local time: the schedule's timezone fixes the wall clock; occurrences are stored/returned in UTC (research #5).
const TZ_OFFSET_MIN: Record<string, number> = { 'Asia/Hong_Kong': 480, 'Asia/Shanghai': 480, 'Asia/Macau': 480, 'Asia/Taipei': 480, 'Asia/Singapore': 480, 'Asia/Bangkok': 420, 'Asia/Tokyo': 540, UTC: 0 };

export type CoachSchedulePatch = Partial<Pick<MiCoachSchedule,
	'name' | 'sport' | 'weekday' | 'startTime' | 'durationMinutes' | 'timezone' | 'venueId' | 'venueName' | 'venueAddress' | 'lat' | 'lng' |
	'capacity' | 'bookingMode' | 'packSize' | 'priceTiers' | 'cancellationPolicy' | 'paymentInfo' | 'visibility' | 'autoApprove' | 'gateType' |
	'levelBasis' | 'minLevel' | 'maxLevel' | 'gender' | 'ageGroup' | 'publishLeadHours' | 'status' | 'tagIds' | 'notes' | 'sendNotifications'>>;

/** A coach_enrollment row (raw table, like coach_claim — no entity, accessed through the DataSource). */
export type EnrollmentRow = {
	id: string; scheduleId: string; userId: string; mode: 'series' | 'pack'; status: 'active' | 'cancelled';
	agreedPrice: number | null; agreedCurrency: string | null; packSize: number | null; packRemaining: number | null;
	paid: boolean; paidAt: Date | null; skips: string[]; createdAt: Date; cancelledAt: Date | null;
};

@Injectable()
export class CoachScheduleService {
	public readonly mark = COACHING_V1_MARK; // greppable in the built tree for SHIP verification

	constructor(
		@Inject(DI.db) private db: DataSource,
		@Inject(DI.coachSchedulesRepository) private coachSchedulesRepository: CoachSchedulesRepository,
		@Inject(DI.meetsRepository) private meetsRepository: MeetsRepository,
		@Inject(DI.meetParticipantsRepository) private meetParticipantsRepository: MeetParticipantsRepository,
		@Inject(DI.usersRepository) private usersRepository: UsersRepository,
		private clubService: ClubService,
		private meetService: MeetService,
		private meetEntityService: MeetEntityService,
		private idService: IdService,
		private notificationService: NotificationService,
	) {}

	private err(id: string, message: string): IdentifiableError { return new IdentifiableError(`coach:${id}`, message); }

	private notify(userId: string, header: string, body: string, link: string): void {
		this.notificationService.createNotification(userId, 'app', { customHeader: header, customBody: body, customIcon: null, appAccessTokenId: null, customLink: link });
	}

	// COACHING-V1 flag (default OFF): the ONE gate. When it is off the whole feature is invisible — every write door
	// throws not_available, every read returns nothing, and the sweep creates no lessons. Flipped on per instance with
	// the env COACHING_V1=true (UAT first). Read at call time so a restart is all it takes to flip.
	@bindThis
	public enabled(): boolean { return process.env.COACHING_V1 === 'true'; }
	private assertEnabled(): void { if (!this.enabled()) throw this.err('not_available', 'Coaching is not available yet.'); }

	// --------------------------------------------------------------------------------------------- read
	@bindThis
	public async get(scheduleId: string): Promise<MiCoachSchedule> {
		this.assertEnabled();
		const s = await this.coachSchedulesRepository.findOneBy({ id: scheduleId });
		if (!s) throw this.err('no_such_schedule', 'No such lesson schedule.');
		return s;
	}

	/** Occurrences of the slot at or after `from`, in start order, computed in the schedule timezone, returned UTC. */
	@bindThis
	public occurrences(s: MiCoachSchedule, from: Date, count: number): Date[] {
		const off = (TZ_OFFSET_MIN[s.timezone] ?? 480) * 60_000;
		const [hh, mm] = s.startTime.split(':').map(Number);
		const local = new Date(from.getTime() + off);
		const todayLocalMidnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
		const wd = local.getUTCDay() === 0 ? 7 : local.getUTCDay();
		const delta = (s.weekday - wd + 7) % 7;
		let first = todayLocalMidnight + delta * 86_400_000 + (hh * 60 + mm) * 60_000 - off;
		if (first < from.getTime()) first += 7 * 86_400_000;
		const out: Date[] = [];
		for (let i = 0; i < count; i++) out.push(new Date(first + i * 7 * 86_400_000));
		return out;
	}

	@bindThis
	public priceBandFor(s: MiCoachSchedule, count: number): PriceBand | null {
		return priceForGroup(s.priceTiers, count);
	}

	// --------------------------------------------------------------------------------------------- CRUD
	/** "Who can post" (operator decision 2): any owner/admin of the club the schedule is attached to. */
	private async assertClubAdmin(channelId: string, by: MiUser): Promise<void> {
		const channel = await this.clubService.channel(channelId);
		await this.clubService.assertAdmin(channel, by.id);
	}

	@bindThis
	public async listMine(ownerUserId: string): Promise<MiCoachSchedule[]> {
		if (!this.enabled()) return [];
		return await this.coachSchedulesRepository.find({ where: { ownerUserId }, order: { weekday: 'ASC', startTime: 'ASC' } });
	}

	/** Public schedules of a coach (coach profile + Discover). Private ones only for the club's members/admins. */
	@bindThis
	public async listPublic(coachUserId: string, viewer: MiUser | null): Promise<MiCoachSchedule[]> {
		if (!this.enabled()) return [];
		const rows = await this.coachSchedulesRepository.find({ where: { ownerUserId: coachUserId, status: 'active' }, order: { weekday: 'ASC', startTime: 'ASC' } });
		const out: MiCoachSchedule[] = [];
		for (const s of rows) {
			if (s.visibility === 'public') { out.push(s); continue; }
			if (!viewer) continue;
			if (viewer.id === s.ownerUserId) { out.push(s); continue; }
			if (await this.clubService.isMember(s.channelId, viewer.id).catch(() => false)) out.push(s);
		}
		return out;
	}

	private validate(d: CoachSchedulePatch): void {
		if (d.weekday != null && (d.weekday < 1 || d.weekday > 7)) throw this.err('invalid', 'Weekday must be 1 (Monday) to 7 (Sunday).');
		if (d.startTime != null && !/^([01]\d|2[0-3]):[0-5]\d$/.test(d.startTime)) throw this.err('invalid', 'Start time must be HH:mm.');
		if (d.durationMinutes != null && (d.durationMinutes < 15 || d.durationMinutes > 1440)) throw this.err('invalid', 'Duration must be 15 minutes to 24 hours.');
		if (d.publishLeadHours != null && (d.publishLeadHours < 1 || d.publishLeadHours > 24 * 28)) throw this.err('invalid', 'Publish lead time must be 1 hour to 4 weeks.');
		if (d.capacity != null && (d.capacity < 1 || d.capacity > 50)) throw this.err('invalid', 'Group size must be 1 to 50.');
		if (d.bookingMode != null && !coachBookingModes.includes(d.bookingMode)) throw this.err('invalid', 'Invalid booking mode.');
		if (d.packSize != null && (d.packSize < 2 || d.packSize > 52)) throw this.err('invalid', 'A pack must cover 2 to 52 lessons.');
	}

	/** Normalise the mutable fields; the two value objects go through their own validators (COACH_INVALID on failure). */
	private clean(d: CoachSchedulePatch): CoachSchedulePatch {
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(d)) if (v !== undefined) out[k] = v;
		if (typeof out.name === 'string') out.name = (out.name as string).trim().slice(0, 128);
		if (out.priceTiers !== undefined) {
			try { out.priceTiers = normalisePriceTiers(out.priceTiers, (out.priceTiers as PriceTiers)?.tiers?.[0]?.currency ?? 'HKD'); }
			catch (e) { throw this.err('invalid', e instanceof Error ? e.message : 'Invalid price bands.'); }
		}
		if (out.cancellationPolicy !== undefined) out.cancellationPolicy = normaliseCancellation(out.cancellationPolicy);
		return out as CoachSchedulePatch;
	}

	@bindThis
	public async create(by: MiUser, channelId: string, data: CoachSchedulePatch & Pick<MiCoachSchedule, 'name' | 'weekday' | 'startTime'>): Promise<MiCoachSchedule> {
		this.assertEnabled();
		await this.assertClubAdmin(channelId, by);
		this.validate(data);
		const clean = this.clean(data);
		if (clean.priceTiers === undefined) clean.priceTiers = normalisePriceTiers([{ minParticipants: 1, maxParticipants: (clean.capacity as number) ?? 1, pricePerPerson: 0, currency: 'HKD' }]);
		const now = new Date();
		return await this.coachSchedulesRepository.insertOne({
			id: this.idService.gen(), ownerUserId: by.id, channelId, sport: 'pickleball', timezone: 'Asia/Hong_Kong',
			durationMinutes: 60, venueId: null, venueName: null, venueAddress: null, lat: null, lng: null, capacity: 1,
			bookingMode: 'single', packSize: null, cancellationPolicy: { windowHours: 24 }, paymentInfo: null, visibility: 'public',
			autoApprove: true, gateType: 'guidance', levelBasis: 'self', minLevel: null, maxLevel: null, gender: 'any', ageGroup: 'any',
			publishLeadHours: 168, status: 'active', tagIds: [], notes: null, sendNotifications: true, lastRunAt: null, createdAt: now, updatedAt: now,
			...(clean as Partial<MiCoachSchedule>),
		});
	}

	@bindThis
	public async update(by: MiUser, s: MiCoachSchedule, patch: CoachSchedulePatch): Promise<MiCoachSchedule> {
		if (by.id !== s.ownerUserId) await this.assertClubAdmin(s.channelId, by);
		this.validate(patch);
		const clean = this.clean(patch);
		await this.coachSchedulesRepository.update(s.id, { ...(clean as Partial<MiCoachSchedule>), updatedAt: new Date() });
		const fresh = await this.coachSchedulesRepository.findOneByOrFail({ id: s.id });
		// research #2: re-tiering NEVER re-prices a booked student. Propagate only display/logistics fields to future
		// lessons (name / venue / notes / time), never price — those stay locked on the participant + enrolment rows.
		await this.applyToFutureLessons(fresh, clean).catch(() => undefined);
		return fresh;
	}

	private async applyToFutureLessons(s: MiCoachSchedule, patch: CoachSchedulePatch): Promise<void> {
		const FIELDS = ['name', 'durationMinutes', 'venueId', 'venueName', 'venueAddress', 'lat', 'lng', 'notes', 'sendNotifications', 'minLevel', 'maxLevel', 'gender', 'ageGroup'] as const;
		const base: Record<string, unknown> = {};
		for (const k of FIELDS) if ((patch as Record<string, unknown>)[k] !== undefined) base[k] = (patch as Record<string, unknown>)[k];
		if (patch.priceTiers !== undefined) base.priceTiers = patch.priceTiers; // a NEW lesson prices from the new tiers; existing bookings keep their locked price
		const now = new Date();
		const meets = await this.meetsRepository.find({ where: { coachScheduleId: s.id, status: 'active', startAt: MoreThanOrEqual(now) } });
		const off = (TZ_OFFSET_MIN[s.timezone] ?? 480) * 60_000;
		for (const m of meets) {
			const mp: Record<string, unknown> = { ...base };
			if (patch.startTime) {
				const [hh, mm] = patch.startTime.split(':').map(Number);
				const local = new Date(new Date(m.startAt).getTime() + off);
				const at = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) + (hh * 60 + mm) * 60_000 - off);
				if (at.getTime() > now.getTime()) mp.startAt = at;
			}
			if (!Object.keys(mp).length) continue;
			try { await this.meetService.update(m, mp as Partial<MiMeet>); } catch { /* one refused field must not stop the rest */ }
		}
	}

	@bindThis
	public async remove(by: MiUser, s: MiCoachSchedule): Promise<void> {
		if (by.id !== s.ownerUserId) await this.assertClubAdmin(s.channelId, by);
		// cancel FUTURE empty lessons (nobody booked); leave booked lessons standing so students keep what they paid for
		const now = new Date();
		const future = await this.meetsRepository.find({ where: { coachScheduleId: s.id, status: 'active', startAt: MoreThanOrEqual(now) } });
		for (const m of future) if (m.confirmed === 0) await this.meetService.cancel(m).catch(() => undefined);
		await this.db.query(`UPDATE "coach_enrollment" SET "status" = 'cancelled', "cancelledAt" = now() WHERE "scheduleId" = $1 AND "status" = 'active'`, [s.id]);
		await this.coachSchedulesRepository.delete(s.id);
	}

	// ------------------------------------------------------------------------------------ materialisation
	/** Lesson meet settings from a schedule + a start time. hostPlays=false: the coach hosts, students take the seats. */
	private lessonData(s: MiCoachSchedule, startAt: Date): Partial<MiMeet> & Pick<MiMeet, 'name' | 'startAt' | 'durationMinutes' | 'capacity'> {
		const band1 = priceForGroup(s.priceTiers, 1);
		return {
			name: s.name, startAt, durationMinutes: s.durationMinutes, capacity: s.capacity, channelId: s.channelId, sport: s.sport, timezone: s.timezone,
			venueId: s.venueId, venueName: s.venueName, venueAddress: s.venueAddress, lat: s.lat, lng: s.lng, hostPlays: false,
			visibility: s.visibility as MiMeet['visibility'], autoApprove: s.autoApprove, allowPlusOne: false,
			feeType: 'perPax', feeAmount: band1?.pricePerPerson ?? null, feeCurrency: normaliseCurrency(band1?.currency ?? 'HKD'), paymentInfo: s.paymentInfo,
			cancellationFreezeHours: s.cancellationPolicy?.windowHours ?? 24,
			gateType: s.gateType as MiMeet['gateType'], levelBasis: s.levelBasis as MiMeet['levelBasis'], minLevel: s.minLevel, maxLevel: s.maxLevel,
			gender: s.gender as MiMeet['gender'], ageGroup: s.ageGroup as MiMeet['ageGroup'], submitMatches: false, notes: s.notes,
			sendNotifications: s.sendNotifications, seriesId: s.id, coachScheduleId: s.id, priceTiers: s.priceTiers,
		};
	}

	/** Create the lessons whose start is inside the lead window and not yet created, then book the active enrollees. */
	@bindThis
	public async materialise(s: MiCoachSchedule, now = new Date()): Promise<MiMeet[]> {
		if (s.status !== 'active') return [];
		const host = await this.usersRepository.findOneBy({ id: s.ownerUserId });
		if (!host) return [];
		const window = s.publishLeadHours * 3_600_000;
		const due = this.occurrences(s, now, 6).filter(d => d.getTime() - now.getTime() <= window);
		if (!due.length) { await this.coachSchedulesRepository.update(s.id, { lastRunAt: now }); return []; }
		const existing = await this.meetsRepository.find({ where: { coachScheduleId: s.id, startAt: In(due) }, select: { startAt: true } });
		const have = new Set(existing.map(m => new Date(m.startAt).getTime()));
		const created: MiMeet[] = [];
		for (const startAt of due) {
			if (have.has(startAt.getTime())) continue;
			const meet = await this.meetService.create(host, this.lessonData(s, startAt));
			created.push(meet);
			// invite the tagged club members (a lesson is posted in the coach's club) — never the coach/host
			if (s.tagIds.length) {
				const channel = await this.clubService.channel(s.channelId).catch(() => null);
				if (channel) for (const uid of await this.clubService.activeMemberIds(channel, s.tagIds)) {
					if (uid === host.id) continue;
					try { await this.meetService.hostAdd(meet, { userId: uid, status: 'invited' }); } catch { /* already on it */ }
				}
			}
			// book the active series/pack enrollees onto this fresh occurrence
			await this.bookEnrolleesOnto(s, meet, startAt).catch(() => undefined);
		}
		await this.coachSchedulesRepository.update(s.id, { lastRunAt: now });
		return created;
	}

	/** For a fresh lesson, auto-book every active enrollee who is not skipping it and (for packs) still has credit. */
	private async bookEnrolleesOnto(s: MiCoachSchedule, meet: MiMeet, startAt: Date): Promise<void> {
		const iso = startAt.toISOString();
		const enrolments = await this.db.query(`SELECT * FROM "coach_enrollment" WHERE "scheduleId" = $1 AND "status" = 'active'`, [s.id]) as EnrollmentRow[];
		for (const e of enrolments) {
			if (Array.isArray(e.skips) && e.skips.includes(iso)) continue;              // research #3: a skipped week is not booked
			if (e.mode === 'pack' && (e.packRemaining ?? 0) <= 0) continue;             // pack credit exhausted
			try {
				await this.bookParticipant(meet, e.userId, { enrollmentId: e.id, prepaid: e.mode === 'pack', agreedPrice: e.agreedPrice, agreedCurrency: e.agreedCurrency });
				if (e.mode === 'pack') await this.db.query(`UPDATE "coach_enrollment" SET "packRemaining" = GREATEST(COALESCE("packRemaining",0) - 1, 0) WHERE "id" = $1`, [e.id]);
			} catch { /* already on it, or full → they keep the enrolment and catch the next week */ }
		}
	}

	/**
	 * Put a user on a lesson through the NATIVE host-add claim (atomic capacity — research #5), then stamp the
	 * price the student agreed to onto their row (research #2: LOCKED at booking). A full lesson waitlists them.
	 */
	private async bookParticipant(meet: MiMeet, userId: string, opts: { enrollmentId?: string | null; prepaid?: boolean; agreedPrice?: number | null; agreedCurrency?: string | null }): Promise<MiMeetParticipant> {
		let p: MiMeetParticipant;
		try { p = await this.meetService.hostAdd(meet, { userId, status: 'confirmed' }); }
		catch { p = await this.meetService.hostAdd(meet, { userId, status: 'waitlisted' }); }
		const price = opts.agreedPrice ?? priceForGroup(meet.priceTiers ?? null, meet.confirmed + 1)?.pricePerPerson ?? null;
		const currency = normaliseCurrency(opts.agreedCurrency ?? priceForGroup(meet.priceTiers ?? null, 1)?.currency ?? 'HKD');
		const tags = opts.prepaid ? [...new Set([...(p.tags ?? []), 'punch'])] : (p.tags ?? []);
		await this.meetParticipantsRepository.update(p.id, { agreedPrice: price, agreedCurrency: currency, enrollmentId: opts.enrollmentId ?? null, tags });
		return await this.meetParticipantsRepository.findOneByOrFail({ id: p.id });
	}

	@bindThis
	public async sweep(now = new Date()): Promise<{ schedules: number; created: number }> {
		if (!this.enabled()) return { schedules: 0, created: 0 };
		const rows = await this.coachSchedulesRepository.find({ where: { status: 'active' } });
		let created = 0;
		for (const s of rows) { try { created += (await this.materialise(s, now)).length; } catch { /* one bad schedule must not stop the rest */ } }
		return { schedules: rows.length, created };
	}

	@bindThis
	public async runForSchedule(by: MiUser, s: MiCoachSchedule): Promise<{ created: string[] }> {
		if (by.id !== s.ownerUserId) await this.assertClubAdmin(s.channelId, by);
		return { created: (await this.materialise(s)).map(m => m.id) };
	}

	// ------------------------------------------------------------------------------------------- booking
	/** Single-lesson booking: the student joins through the NATIVE meet gate + claim, then the price is locked on. */
	@bindThis
	public async bookSingle(meet: MiMeet, user: MiUser, accessToken?: string | null): Promise<MiMeetParticipant> {
		this.assertEnabled();
		if (!meet.coachScheduleId) throw this.err('not_a_lesson', 'This meet is not a coaching lesson.');
		const p = await this.meetService.join(meet, user, { accessToken });
		const fresh = await this.meetsRepository.findOneByOrFail({ id: meet.id });
		const band = priceForGroup(fresh.priceTiers ?? null, fresh.confirmed);
		await this.meetParticipantsRepository.update(p.id, { agreedPrice: band?.pricePerPerson ?? null, agreedCurrency: normaliseCurrency(band?.currency ?? 'HKD') });
		return await this.meetParticipantsRepository.findOneByOrFail({ id: p.id });
	}

	private modeAllowed(s: MiCoachSchedule, mode: 'series' | 'pack'): boolean {
		if (s.bookingMode === 'several') return true;
		return s.bookingMode === mode;
	}

	/** Series/pack enrolment: locks a per-person price now, and books every already-materialised future occurrence. */
	@bindThis
	public async enroll(s: MiCoachSchedule, user: MiUser, mode: 'series' | 'pack'): Promise<{ enrollment: EnrollmentRow; booked: string[] }> {
		if (!this.modeAllowed(s, mode)) throw this.err('mode_not_allowed', 'This coach does not offer that on this slot.');
		if (mode === 'pack' && (!s.packSize || s.packSize < 2)) throw this.err('invalid', 'This slot has no pack defined.');
		const already = (await this.db.query(`SELECT * FROM "coach_enrollment" WHERE "scheduleId" = $1 AND "userId" = $2 AND "status" = 'active'`, [s.id, user.id]) as EnrollmentRow[])[0];
		if (already) throw this.err('already_enrolled', 'You already have an active enrolment on this slot.');
		const activeCount = Number((await this.db.query(`SELECT count(*)::int AS n FROM "coach_enrollment" WHERE "scheduleId" = $1 AND "status" = 'active'`, [s.id]))[0].n);
		const band = priceForGroup(s.priceTiers, activeCount + 1);              // the price for the group they join; locked on this row
		const id = this.idService.gen();
		const packRemaining = mode === 'pack' ? (s.packSize ?? null) : null;
		await this.db.query(
			`INSERT INTO "coach_enrollment" ("id","scheduleId","userId","mode","status","agreedPrice","agreedCurrency","packSize","packRemaining","paid","skips","createdAt")
			 VALUES ($1,$2,$3,$4,'active',$5,$6,$7,$8,false,'{}',now())`,
			[id, s.id, user.id, mode, band?.pricePerPerson ?? null, normaliseCurrency(band?.currency ?? 'HKD'), mode === 'pack' ? s.packSize : null, packRemaining]);
		const row = (await this.db.query(`SELECT * FROM "coach_enrollment" WHERE "id" = $1`, [id]) as EnrollmentRow[])[0];
		// book the occurrences that already exist and are still upcoming (the sweep will book the ones not yet created)
		const now = new Date();
		const upcoming = await this.meetsRepository.find({ where: { coachScheduleId: s.id, status: 'active', startAt: MoreThanOrEqual(now) }, order: { startAt: 'ASC' } });
		const booked: string[] = [];
		let credit = mode === 'pack' ? (s.packSize ?? 0) : Number.MAX_SAFE_INTEGER;
		for (const m of upcoming) {
			if (credit <= 0) break;
			try {
				await this.bookParticipant(m, user.id, { enrollmentId: row.id, prepaid: mode === 'pack', agreedPrice: row.agreedPrice, agreedCurrency: row.agreedCurrency });
				booked.push(m.id);
				if (mode === 'pack') { credit--; await this.db.query(`UPDATE "coach_enrollment" SET "packRemaining" = GREATEST(COALESCE("packRemaining",0) - 1, 0) WHERE "id" = $1`, [row.id]); }
			} catch { /* already on it */ }
		}
		this.notify(s.ownerUserId, 'New enrolment', `${user.name ?? user.username} enrolled in ${s.name} (${mode}).`, 'coach:' + s.ownerUserId);
		return { enrollment: (await this.db.query(`SELECT * FROM "coach_enrollment" WHERE "id" = $1`, [row.id]) as EnrollmentRow[])[0], booked };
	}

	@bindThis
	public async myEnrollment(enrollmentId: string, user: MiUser): Promise<{ row: EnrollmentRow; schedule: MiCoachSchedule }> {
		const row = (await this.db.query(`SELECT * FROM "coach_enrollment" WHERE "id" = $1`, [enrollmentId]) as EnrollmentRow[])[0];
		if (!row) throw this.err('no_such_enrolment', 'No such enrolment.');
		const schedule = await this.get(row.scheduleId);
		if (row.userId !== user.id && user.id !== schedule.ownerUserId) throw this.err('not_yours', 'That is not your enrolment.');
		return { row, schedule };
	}

	/** Cancel the whole enrolment: leaves every future lesson booked by it (freeze window permitting), keeps the past. */
	@bindThis
	public async unenroll(enrollmentId: string, user: MiUser): Promise<{ left: string[]; kept: string[] }> {
		const { row } = await this.myEnrollment(enrollmentId, user);
		if (row.status !== 'active') return { left: [], kept: [] };
		await this.db.query(`UPDATE "coach_enrollment" SET "status" = 'cancelled', "cancelledAt" = now() WHERE "id" = $1`, [row.id]);
		const now = new Date();
		const rows = await this.meetParticipantsRepository.find({ where: { enrollmentId: row.id, userId: row.userId } });
		const left: string[] = []; const kept: string[] = [];
		for (const p of rows) {
			const m = await this.meetsRepository.findOneBy({ id: p.meetId });
			if (!m || m.status !== 'active' || new Date(m.startAt).getTime() <= now.getTime()) { kept.push(p.meetId); continue; }
			try { await this.meetService.leave(m, { id: row.userId } as MiUser); left.push(p.meetId); }
			catch { kept.push(p.meetId); } // inside the freeze window → they contact the coach
		}
		return { left, kept };
	}

	/** research #3: skip ONE week. No charge, the seat opens to the waitlist (native auto-promote), the enrolment stays. */
	@bindThis
	public async skip(enrollmentId: string, lessonId: string, user: MiUser): Promise<{ skippedAt: string; leftLesson: boolean }> {
		const { row, schedule } = await this.myEnrollment(enrollmentId, user);
		const meet = await this.meetsRepository.findOneBy({ id: lessonId, coachScheduleId: schedule.id });
		if (!meet) throw this.err('no_such_lesson', 'No such lesson on this schedule.');
		const iso = new Date(meet.startAt).toISOString();
		const skips = Array.from(new Set([...(row.skips ?? []), iso]));
		await this.db.query(`UPDATE "coach_enrollment" SET "skips" = $2::varchar[] WHERE "id" = $1`, [row.id, skips]);
		let leftLesson = false;
		const p = await this.meetParticipantsRepository.findOneBy({ meetId: meet.id, userId: row.userId });
		if (p && meet.status === 'active' && new Date(meet.startAt).getTime() > Date.now()) {
			try { await this.meetService.leave(meet, { id: row.userId } as MiUser); leftLesson = true; if (row.mode === 'pack') await this.db.query(`UPDATE "coach_enrollment" SET "packRemaining" = COALESCE("packRemaining",0) + 1 WHERE "id" = $1`, [row.id]); }
			catch { /* freeze window: the skip is recorded for future weeks but this seat stays */ }
		}
		return { skippedAt: iso, leftLesson };
	}

	// ---------------------------------------------------------------------------------------- dashboards
	private async gbRating(userId: string, sport: string): Promise<{ rating: number; matches: number } | null> {
		try {
			const r = (await this.db.query(`SELECT rating, matches FROM "gb_player_rating" WHERE "userId" = $1 AND sport = $2`, [userId, sport]))[0] as { rating: number; matches: number } | undefined;
			return r ? { rating: Number(r.rating), matches: Number(r.matches) } : null;
		} catch { return null; }
	}

	/**
	 * Coach "My lessons": every lesson of the coach's schedules in [from,to] with its roster, the price each student
	 * locked, glanceable paid/owed (research #5), an EMPTY flag (so the coach can drop the court), and a revenue tally
	 * summed LIVE from marked-paid rows + paid packs (G11: never a stored running total). Rating-aware win 6b: each
	 * roster row carries the student's GripBat rating — the coach is the host and could already see these players.
	 */
	@bindThis
	public async coachDashboard(coach: MiUser, from: Date, to: Date): Promise<Record<string, unknown>> {
		this.assertEnabled();
		const schedules = await this.listMine(coach.id);
		const scheduleIds = schedules.map(s => s.id);
		const lessons: Record<string, unknown>[] = [];
		let revenuePaid = 0; const currencies = new Set<string>();
		if (scheduleIds.length) {
			const meets = await this.meetsRepository.find({ where: { coachScheduleId: In(scheduleIds), startAt: MoreThanOrEqual(from) }, order: { startAt: 'ASC' } });
			for (const m of meets) {
				if (new Date(m.startAt).getTime() > to.getTime()) continue;
				const parts = await this.meetParticipantsRepository.find({ where: { meetId: m.id, status: In(['confirmed', 'waitlisted']) }, order: { statusChangedAt: 'ASC' } });
				const roster = [] as Record<string, unknown>[];
				for (const p of parts) {
					if (!p.userId) continue;
					const paid = (p.tags ?? []).includes('paid');
					const prepaid = (p.tags ?? []).includes('punch');
					if (paid && p.agreedPrice) { revenuePaid += p.agreedPrice; currencies.add(p.agreedCurrency ?? 'HKD'); }
					const u = await this.usersRepository.findOneBy({ id: p.userId });
					roster.push({
						participantId: p.id, userId: p.userId, name: u?.name ?? u?.username ?? null, username: u?.username ?? null,
						status: p.status, agreedPrice: p.agreedPrice, agreedCurrency: p.agreedCurrency,
						paid, prepaid, paidClaim: (p.tags ?? []).includes('paidClaim'),
						gbRating: await this.gbRating(p.userId, m.sport),
					});
				}
				lessons.push({
					meetId: m.id, name: m.name, startAt: new Date(m.startAt).toISOString(), durationMinutes: m.durationMinutes,
					venueName: m.venueName, capacity: m.capacity, confirmed: m.confirmed, status: m.status,
					empty: m.confirmed === 0, priceTiers: m.priceTiers ?? null, roster,
				});
			}
		}
		// paid packs count once, at price × pack size (their per-lesson rows are prepaid 'punch', never re-counted above)
		const paidPacks = await this.db.query(`SELECT e."agreedPrice" AS p, e."packSize" AS n, e."agreedCurrency" AS c FROM "coach_enrollment" e WHERE e."scheduleId" = ANY($1) AND e."mode" = 'pack' AND e."paid" = true`, [scheduleIds.length ? scheduleIds : ['-']]) as { p: number | null; n: number | null; c: string | null }[];
		for (const pk of paidPacks) { if (pk.p && pk.n) { revenuePaid += pk.p * pk.n; currencies.add(pk.c ?? 'HKD'); } }
		return {
			from: from.toISOString(), to: to.toISOString(),
			schedules: await Promise.all(schedules.map(s => this.packSchedule(s, coach))),
			lessons,
			revenue: { paid: revenuePaid, currency: currencies.size === 1 ? [...currencies][0] : (currencies.size === 0 ? 'HKD' : 'MIXED') },
		};
	}

	/** Student "My lessons": upcoming booked lessons + active weekly enrolments (each cancellable / skippable). */
	@bindThis
	public async studentDashboard(user: MiUser): Promise<Record<string, unknown>> {
		this.assertEnabled();
		const now = new Date();
		const rows = await this.meetParticipantsRepository.find({ where: { userId: user.id, status: In(['confirmed', 'waitlisted']) } });
		const lessons: Record<string, unknown>[] = [];
		for (const p of rows) {
			const m = await this.meetsRepository.findOneBy({ id: p.meetId });
			if (!m || !m.coachScheduleId || m.status !== 'active' || new Date(m.startAt).getTime() <= now.getTime()) continue;
			const coach = await this.usersRepository.findOneBy({ id: m.hostId });
			lessons.push({
				meetId: m.id, coachScheduleId: m.coachScheduleId, name: m.name, startAt: new Date(m.startAt).toISOString(), durationMinutes: m.durationMinutes,
				venueName: m.venueName, status: p.status, agreedPrice: p.agreedPrice, agreedCurrency: p.agreedCurrency,
				paid: (p.tags ?? []).includes('paid'), prepaid: (p.tags ?? []).includes('punch'), paidClaim: (p.tags ?? []).includes('paidClaim'),
				participantId: p.id, enrollmentId: p.enrollmentId ?? null, paymentInfo: m.paymentInfo,
				coach: { userId: m.hostId, name: coach?.name ?? coach?.username ?? null },
			});
		}
		lessons.sort((a, b) => String(a.startAt).localeCompare(String(b.startAt)));
		const enrolRows = await this.db.query(`SELECT * FROM "coach_enrollment" WHERE "userId" = $1 AND "status" = 'active' ORDER BY "createdAt" DESC`, [user.id]) as EnrollmentRow[];
		const enrolments = [] as Record<string, unknown>[];
		for (const e of enrolRows) {
			const s = await this.coachSchedulesRepository.findOneBy({ id: e.scheduleId });
			enrolments.push({ ...this.packEnrollment(e), schedule: s ? await this.packSchedule(s, user) : null });
		}
		return { lessons, enrolments };
	}

	/**
	 * research 6c: fill an EMPTY (or under-filled) lesson by re-announcing it to the coach's club members who are not
	 * already on it. Reuses the club membership read + the native meet notification door — no new social graph.
	 */
	@bindThis
	public async broadcastEmptySlot(by: MiUser, lessonId: string): Promise<{ reached: number }> {
		this.assertEnabled();
		const meet = await this.meetsRepository.findOneBy({ id: lessonId });
		if (!meet || !meet.coachScheduleId) throw this.err('no_such_lesson', 'No such lesson.');
		const s = await this.get(meet.coachScheduleId);
		if (by.id !== s.ownerUserId) await this.assertClubAdmin(s.channelId, by);
		const channel = await this.clubService.channel(s.channelId).catch(() => null);
		if (!channel) return { reached: 0 };
		const onMeet = new Set((await this.meetParticipantsRepository.find({ where: { meetId: meet.id }, select: { userId: true } })).map(p => p.userId).filter((x): x is string => !!x));
		let reached = 0;
		for (const uid of await this.clubService.activeMemberIds(channel)) {
			if (uid === s.ownerUserId || onMeet.has(uid)) continue;
			this.meetService.notifyUser(uid, meet, 'Lesson spot open', `${s.name} still has spots. Tap to book.`);
			reached++;
		}
		return { reached };
	}

	/**
	 * The coach's own free-text "About / qualifications / certs" (operator 2026-09-22: we neither verify nor gate on
	 * it — it simply displays to students). One row per coach in coach_profile. Public read; self-serve write.
	 */
	@bindThis
	public async getCoachProfile(userId: string): Promise<{ userId: string; about: string | null; updatedAt: string | null }> {
		if (!this.enabled()) return { userId, about: null, updatedAt: null };
		const r = (await this.db.query(`SELECT "about", "updatedAt" FROM "coach_profile" WHERE "userId" = $1`, [userId]) as { about: string | null; updatedAt: Date | null }[])[0];
		return { userId, about: r?.about ?? null, updatedAt: r?.updatedAt ? new Date(r.updatedAt).toISOString() : null };
	}

	@bindThis
	public async setCoachProfile(user: MiUser, about: string | null): Promise<{ userId: string; about: string | null; updatedAt: string | null }> {
		this.assertEnabled();
		const text = typeof about === 'string' ? about.trim().slice(0, 2000) : null;
		await this.db.query(
			`INSERT INTO "coach_profile" ("userId", "about", "updatedAt") VALUES ($1, $2, now())
			 ON CONFLICT ("userId") DO UPDATE SET "about" = EXCLUDED."about", "updatedAt" = now()`, [user.id, text]);
		return await this.getCoachProfile(user.id);
	}

	// ------------------------------------------------------------------------------------------- packing
	@bindThis
	public packEnrollment(e: EnrollmentRow): Record<string, unknown> {
		return {
			id: e.id, scheduleId: e.scheduleId, userId: e.userId, mode: e.mode, status: e.status,
			agreedPrice: e.agreedPrice, agreedCurrency: e.agreedCurrency, packSize: e.packSize, packRemaining: e.packRemaining,
			paid: e.paid, paidAt: e.paidAt ? new Date(e.paidAt).toISOString() : null,
			skips: Array.isArray(e.skips) ? e.skips : [], createdAt: new Date(e.createdAt).toISOString(),
		};
	}

	@bindThis
	public async packSchedule(s: MiCoachSchedule, me: MiUser | null): Promise<Record<string, unknown>> {
		const now = new Date();
		const nextAt = this.occurrences(s, now, 1)[0];
		const upcoming = await this.meetsRepository.find({ where: { coachScheduleId: s.id, startAt: MoreThanOrEqual(now) }, order: { startAt: 'ASC' }, take: 8 });
		const owner = await this.usersRepository.findOneBy({ id: s.ownerUserId });
		return {
			id: s.id, ownerUserId: s.ownerUserId, channelId: s.channelId,
			owner: owner ? { userId: owner.id, name: owner.name ?? owner.username ?? null, username: owner.username ?? null } : null,
			name: s.name, sport: s.sport, weekday: s.weekday, startTime: s.startTime, durationMinutes: s.durationMinutes, timezone: s.timezone,
			venueId: s.venueId, venueName: s.venueName, venueAddress: s.venueAddress, lat: s.lat, lng: s.lng,
			capacity: s.capacity, bookingMode: s.bookingMode, packSize: s.packSize, priceTiers: s.priceTiers, cancellationPolicy: s.cancellationPolicy,
			paymentInfo: (me && me.id === s.ownerUserId) ? s.paymentInfo : null,
			visibility: s.visibility, autoApprove: s.autoApprove, gateType: s.gateType, levelBasis: s.levelBasis, minLevel: s.minLevel, maxLevel: s.maxLevel,
			gender: s.gender, ageGroup: s.ageGroup, publishLeadHours: s.publishLeadHours, status: s.status, tagIds: s.tagIds, notes: s.notes, sendNotifications: s.sendNotifications,
			nextAt: nextAt.toISOString(), lastRunAt: s.lastRunAt ? s.lastRunAt.toISOString() : null,
			createdAt: new Date(s.createdAt).toISOString(), updatedAt: new Date(s.updatedAt).toISOString(),
			upcoming: await Promise.all(upcoming.map(m => this.meetEntityService.pack(m, me))),
		};
	}
}

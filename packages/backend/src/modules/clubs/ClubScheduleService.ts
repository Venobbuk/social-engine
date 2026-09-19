/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { In, MoreThanOrEqual } from 'typeorm';
import { DI } from '@/di-symbols.js';
import type { ClubSchedulesRepository, MeetsRepository, UsersRepository } from '@/models/_.js';
import type { MiChannel } from '@/models/Channel.js';
import type { MiUser } from '@/models/User.js';
import type { MiMeet } from '@/modules/meets/models/Meet.js';
import type { MiClubSchedule } from '@/modules/clubs/models/ClubSchedule.js';
import { ClubService } from '@/modules/clubs/ClubService.js';
import { MeetService } from '@/modules/meets/MeetService.js';
import { MeetEntityService } from '@/modules/meets/MeetEntityService.js';
import { IdService } from '@/core/IdService.js';
import { NotificationService } from '@/core/NotificationService.js';
import { IdentifiableError } from '@/misc/identifiable-error.js';
import { bindThis } from '@/decorators.js';

/**
 * CLUB-V3: Reclub's club SCHEDULE (spec_meets.md §11). A schedule is a weekly slot the admins set once; the sweep
 * (every 5 min, clubScheduleSweep) — or clubs/schedules/run for an admin — creates the next meet once its start is
 * inside the publish lead window, as a normal meet hosted by the schedule's host with meet.seriesId = schedule.id,
 * and invites every active member (all, or the schedule's tags). Paused schedules create nothing. Time zone: the
 * schedule's (Asia/Hong_Kong — fixed +08:00, no DST; other zones fall back to the same offset table below).
 */
export type SchedulePatch = Partial<Pick<MiClubSchedule, 'name' | 'weekday' | 'startTime' | 'durationMinutes' | 'venueId' | 'venueName' | 'venueAddress' | 'lat' | 'lng' | 'capacity' | 'hostPlays' | 'visibility' | 'autoApprove' | 'allowPlusOne' | 'feeType' | 'feeAmount' | 'feeCurrency' | 'paymentInfo' | 'gateType' | 'levelBasis' | 'minLevel' | 'maxLevel' | 'gender' | 'ageGroup' | 'submitMatches' | 'publishLeadHours' | 'status' | 'tagIds' | 'notes' | 'sendNotifications'>>;

const TZ_OFFSET_MIN: Record<string, number> = { 'Asia/Hong_Kong': 480, 'Asia/Shanghai': 480, 'Asia/Macau': 480, 'Asia/Taipei': 480, 'Asia/Singapore': 480, 'Asia/Bangkok': 420, 'Asia/Tokyo': 540, UTC: 0 };

@Injectable()
export class ClubScheduleService {
	constructor(
		@Inject(DI.clubSchedulesRepository) private clubSchedulesRepository: ClubSchedulesRepository,
		@Inject(DI.meetsRepository) private meetsRepository: MeetsRepository,
		@Inject(DI.usersRepository) private usersRepository: UsersRepository,
		private clubService: ClubService,
		private meetService: MeetService,
		private meetEntityService: MeetEntityService,
		private idService: IdService,
		private notificationService: NotificationService,
	) {}

	private err(id: string, message: string): IdentifiableError { return new IdentifiableError(`club:${id}`, message); }

	@bindThis
	public async get(scheduleId: string): Promise<MiClubSchedule> {
		const s = await this.clubSchedulesRepository.findOneBy({ id: scheduleId });
		if (!s) throw this.err('no_such_schedule', 'No such schedule.');
		return s;
	}

	// ------------------------------------------------------------------------------------- occurrences
	/** The occurrences of the slot at or after `from`, in start order (weekday 1 = Monday … 7 = Sunday). */
	@bindThis
	public occurrences(s: MiClubSchedule, from: Date, count: number): Date[] {
		const off = (TZ_OFFSET_MIN[s.timezone] ?? 480) * 60_000;
		const [hh, mm] = s.startTime.split(':').map(Number);
		// "local" clock = UTC clock shifted by the offset; weekday in local time
		const local = new Date(from.getTime() + off);
		const todayLocalMidnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
		const wd = local.getUTCDay() === 0 ? 7 : local.getUTCDay();
		let delta = (s.weekday - wd + 7) % 7;
		let first = todayLocalMidnight + delta * 86_400_000 + (hh * 60 + mm) * 60_000 - off;
		if (first < from.getTime()) first += 7 * 86_400_000;
		const out: Date[] = [];
		for (let i = 0; i < count; i++) out.push(new Date(first + i * 7 * 86_400_000));
		return out;
	}

	/** The next occurrence that will be materialised (or already is) and the meet standing for it, if created. */
	@bindThis
	public async next(s: MiClubSchedule, now = new Date()): Promise<{ nextAt: Date; meet: MiMeet | null }> {
		const nextAt = this.occurrences(s, now, 1)[0];
		const meet = await this.meetsRepository.findOne({ where: { seriesId: s.id, startAt: MoreThanOrEqual(now), status: In(['active', 'pending']) }, order: { startAt: 'ASC' } });
		return { nextAt: meet ? meet.startAt : nextAt, meet };
	}

	// ------------------------------------------------------------------------------------- CRUD
	@bindThis
	public async list(channel: MiChannel): Promise<MiClubSchedule[]> {
		return await this.clubSchedulesRepository.find({ where: { channelId: channel.id }, order: { weekday: 'ASC', startTime: 'ASC' } });
	}

	@bindThis
	public async create(channel: MiChannel, by: MiUser, data: SchedulePatch & Pick<MiClubSchedule, 'name' | 'weekday' | 'startTime'>): Promise<MiClubSchedule> {
		await this.clubService.assertAdmin(channel, by.id);
		this.validate(data);
		const now = new Date();
		return await this.clubSchedulesRepository.insertOne({
			id: this.idService.gen(), channelId: channel.id, hostId: by.id, timezone: 'Asia/Hong_Kong',
			durationMinutes: 120, venueId: null, venueName: null, venueAddress: null, lat: null, lng: null, capacity: 8, hostPlays: true, visibility: 'public', autoApprove: true, allowPlusOne: true,
			feeType: 'none', feeAmount: null, feeCurrency: 'HKD', paymentInfo: null, gateType: 'guidance', levelBasis: 'self', minLevel: null, maxLevel: null, gender: 'any', ageGroup: 'any', submitMatches: false,
			publishLeadHours: 168, status: 'active', tagIds: [], notes: null, sendNotifications: true, lastRunAt: null, createdAt: now, updatedAt: now,
			...this.clean(data),
		});
	}

	@bindThis
	public async update(channel: MiChannel, by: MiUser, s: MiClubSchedule, patch: SchedulePatch): Promise<MiClubSchedule> {
		await this.clubService.assertAdmin(channel, by.id);
		this.validate(patch);
		await this.clubSchedulesRepository.update(s.id, { ...this.clean(patch), updatedAt: new Date() });
		return await this.clubSchedulesRepository.findOneByOrFail({ id: s.id });
	}

	@bindThis
	public async remove(channel: MiChannel, by: MiUser, s: MiClubSchedule): Promise<void> {
		await this.clubService.assertAdmin(channel, by.id);
		await this.clubSchedulesRepository.delete(s.id);
	}

	private validate(d: SchedulePatch): void {
		if (d.weekday != null && (d.weekday < 1 || d.weekday > 7)) throw this.err('invalid', 'Weekday must be 1 (Monday) to 7 (Sunday).');
		if (d.startTime != null && !/^([01]\d|2[0-3]):[0-5]\d$/.test(d.startTime)) throw this.err('invalid', 'Start time must be HH:mm.');
		if (d.publishLeadHours != null && (d.publishLeadHours < 1 || d.publishLeadHours > 24 * 28)) throw this.err('invalid', 'Publish lead time must be 1 hour to 4 weeks.');
		if (d.capacity != null && (d.capacity < 1 || d.capacity > 500)) throw this.err('invalid', 'Capacity must be 1 to 500.');
	}

	private clean(d: SchedulePatch): SchedulePatch {
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(d)) if (v !== undefined) out[k] = v;
		if (typeof out.name === 'string') out.name = out.name.trim().slice(0, 128);
		return out as SchedulePatch;
	}

	// ------------------------------------------------------------------------------------- materialisation
	/** Create the meets whose start is inside the lead window and not yet created. Returns what was created. */
	@bindThis
	public async materialise(s: MiClubSchedule, now = new Date()): Promise<MiMeet[]> {
		if (s.status !== 'active') return [];
		const channel = await this.clubService.channel(s.channelId);
		const host = await this.usersRepository.findOneBy({ id: s.hostId }) ?? (channel.userId ? await this.usersRepository.findOneBy({ id: channel.userId }) : null);
		if (!host) return [];
		const window = s.publishLeadHours * 3_600_000;
		const due = this.occurrences(s, now, 4).filter(d => d.getTime() - now.getTime() <= window);
		if (!due.length) { await this.clubSchedulesRepository.update(s.id, { lastRunAt: now }); return []; }
		const existing = await this.meetsRepository.find({ where: { seriesId: s.id, startAt: In(due) }, select: { startAt: true } });
		const have = new Set(existing.map(m => new Date(m.startAt).getTime()));
		const created: MiMeet[] = [];
		for (const startAt of due) {
			if (have.has(startAt.getTime())) continue;
			const meet = await this.meetService.create(host, {
				name: s.name, startAt, durationMinutes: s.durationMinutes, capacity: s.capacity, channelId: channel.id, sport: 'pickleball', timezone: s.timezone,
				venueId: s.venueId, venueName: s.venueName, venueAddress: s.venueAddress, lat: s.lat, lng: s.lng, hostPlays: s.hostPlays,
				visibility: s.visibility as MiMeet['visibility'], autoApprove: s.autoApprove, allowPlusOne: s.allowPlusOne,
				feeType: s.feeType as MiMeet['feeType'], feeAmount: s.feeAmount, feeCurrency: s.feeCurrency, paymentInfo: s.paymentInfo,
				gateType: s.gateType as MiMeet['gateType'], levelBasis: s.levelBasis as MiMeet['levelBasis'], minLevel: s.minLevel, maxLevel: s.maxLevel,
				gender: s.gender as MiMeet['gender'], ageGroup: s.ageGroup as MiMeet['ageGroup'], submitMatches: s.submitMatches, notes: s.notes,
				sendNotifications: s.sendNotifications, seriesId: s.id,
			});
			created.push(meet);
			// Reclub "Members of your club will automatically be invited and notified." — all, or the tagged ones; nobody on a break
			for (const uid of await this.clubService.activeMemberIds(channel, s.tagIds)) {
				if (uid === host.id) continue;
				try { await this.meetService.hostAdd(meet, { userId: uid, status: 'invited' }); } catch { /* already on it */ }
			}
		}
		await this.clubSchedulesRepository.update(s.id, { lastRunAt: now });
		return created;
	}

	/**
	 * SCHEDULE-UPDATE-MEETS-V1 (W1 lane B1, triage A-upsert-schedule.13): Reclub's "Do you want to update existing future
	 * meets with the new changes?" — Yes carries the changed settings onto every meet this schedule already created that
	 * has not started and is still active (meet.seriesId = schedule.id). Each meet goes through MeetService.update, so its
	 * rules hold (capacity never below the confirmed count, host seat) and its players hear about a new time / place.
	 * A new start time moves each meet to that time on its own date; a new weekday applies to the meets created from now
	 * on. A meet that refuses a field (capacity below its confirmed players) keeps that one field and is reported.
	 */
	@bindThis
	public async applyToFutureMeets(s: MiClubSchedule, patch: SchedulePatch, now = new Date()): Promise<{ updated: string[]; skipped: { id: string; reason: string }[] }> {
		const FIELDS = ['name', 'durationMinutes', 'capacity', 'venueId', 'venueName', 'venueAddress', 'lat', 'lng', 'hostPlays', 'visibility', 'autoApprove', 'allowPlusOne', 'feeType', 'feeAmount', 'feeCurrency', 'paymentInfo', 'gateType', 'levelBasis', 'minLevel', 'maxLevel', 'gender', 'ageGroup', 'submitMatches', 'notes', 'sendNotifications'] as const;
		const base: Record<string, unknown> = {};
		for (const k of FIELDS) if ((patch as Record<string, unknown>)[k] !== undefined) base[k] = (patch as Record<string, unknown>)[k];
		const meets = await this.meetsRepository.find({ where: { seriesId: s.id, status: 'active', startAt: MoreThanOrEqual(now) }, order: { startAt: 'ASC' } });
		const updated: string[] = []; const skipped: { id: string; reason: string }[] = [];
		const off = (TZ_OFFSET_MIN[s.timezone] ?? 480) * 60_000;
		for (const m of meets) {
			const mp: Record<string, unknown> = { ...base };
			if (patch.startTime) {
				const [hh, mm] = patch.startTime.split(':').map(Number);
				const local = new Date(new Date(m.startAt).getTime() + off);
				const at = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) + (hh * 60 + mm) * 60_000 - off);
				if (at.getTime() > now.getTime()) mp.startAt = at; else skipped.push({ id: m.id, reason: 'time_in_past' });
			}
			if (!Object.keys(mp).length) continue;
			try {
				await this.meetService.update(m, mp as Partial<MiMeet>);
				updated.push(m.id);
			} catch (e) {
				if (mp.capacity === undefined) { skipped.push({ id: m.id, reason: e instanceof Error ? e.message : String(e) }); continue; }
				delete mp.capacity;
				try {
					if (Object.keys(mp).length) await this.meetService.update(m, mp as Partial<MiMeet>);
					updated.push(m.id); skipped.push({ id: m.id, reason: 'capacity_below_confirmed' });
				} catch (e2) { skipped.push({ id: m.id, reason: e2 instanceof Error ? e2.message : String(e2) }); }
			}
		}
		return { updated, skipped };
	}

	/**
	 * MEET-CLUB-INVITE-V1 (W1 lane B1, triage A-meet-form.03): Reclub's meet form "Creating a meet for your club?" —
	 * "Members of your club will automatically be invited and notified." A one-off meet posted in a club invites the
	 * club's active members (all, or those holding one of tagIds; nobody on a break; never the host) — the very rule the
	 * schedule applies in materialise(). The caller hosts the meet and is a member (or the owner) of its club. preview
	 * answers how many would be invited, without inviting. Someone already on the meet is left as they are.
	 */
	@bindThis
	public async inviteMembersToMeet(meetId: string, by: MiUser, tagIds: string[], preview: boolean): Promise<{ eligible: number; invited: number }> {
		const meet = await this.meetsRepository.findOneBy({ id: meetId });
		if (!meet) throw this.err('invalid', 'No such meet.');
		if (!meet.channelId) throw this.err('invalid', 'This meet is not posted in a club.');
		if (meet.status !== 'active') throw this.err('invalid', 'This meet is not active.');
		await this.meetService.assertHost(meet, by);
		const channel = await this.clubService.channel(meet.channelId);
		if (channel.userId !== by.id && !(await this.clubService.isMember(channel.id, by.id))) throw this.err('not_member', 'Only members can do that.');
		const onMeet = new Set((await this.meetsRepository.manager.query(`SELECT "userId" FROM "meet_participant" WHERE "meetId" = $1 AND "userId" IS NOT NULL`, [meet.id]) as { userId: string }[]).map((r) => r.userId));
		const ids = (await this.clubService.activeMemberIds(channel, tagIds)).filter((u) => u !== meet.hostId && !onMeet.has(u));
		if (preview) return { eligible: ids.length, invited: 0 };
		let invited = 0;
		for (const uid of ids) {
			try { await this.meetService.hostAdd(meet, { userId: uid, status: 'invited' }); invited++; } catch { /* joined meanwhile */ }
		}
		return { eligible: ids.length, invited };
	}

	/** The sweep: every active schedule, once. */
	@bindThis
	public async sweep(now = new Date()): Promise<{ schedules: number; created: number }> {
		const rows = await this.clubSchedulesRepository.find({ where: { status: 'active' } });
		let created = 0;
		for (const s of rows) { try { created += (await this.materialise(s, now)).length; } catch { /* one bad schedule must not stop the rest */ } }
		return { schedules: rows.length, created };
	}

	/** An admin runs the sweep for one club now (and "Create now" on a scheduled occurrence is the same door). */
	@bindThis
	public async runForClub(channel: MiChannel, by: MiUser): Promise<{ created: string[] }> {
		await this.clubService.assertAdmin(channel, by.id);
		const created: string[] = [];
		for (const s of await this.list(channel)) for (const m of await this.materialise(s)) created.push(m.id);
		return { created };
	}

	// ------------------------------------------------------------------------------------- packing
	@bindThis
	public async pack(s: MiClubSchedule, me: MiUser | null): Promise<Record<string, unknown>> {
		const { nextAt, meet } = await this.next(s);
		const upcoming = await this.meetsRepository.find({ where: { seriesId: s.id, startAt: MoreThanOrEqual(new Date()) }, order: { startAt: 'ASC' }, take: 8 });
		return {
			id: s.id, channelId: s.channelId, hostId: s.hostId, name: s.name, weekday: s.weekday, startTime: s.startTime, durationMinutes: s.durationMinutes, timezone: s.timezone,
			venueId: s.venueId, venueName: s.venueName, venueAddress: s.venueAddress, lat: s.lat, lng: s.lng, capacity: s.capacity, hostPlays: s.hostPlays, visibility: s.visibility,
			autoApprove: s.autoApprove, allowPlusOne: s.allowPlusOne, feeType: s.feeType, feeAmount: s.feeAmount, feeCurrency: s.feeCurrency, paymentInfo: s.paymentInfo,
			gateType: s.gateType, levelBasis: s.levelBasis, minLevel: s.minLevel, maxLevel: s.maxLevel, gender: s.gender, ageGroup: s.ageGroup, submitMatches: s.submitMatches,
			publishLeadHours: s.publishLeadHours, status: s.status, tagIds: s.tagIds, notes: s.notes, sendNotifications: s.sendNotifications,
			lastRunAt: s.lastRunAt ? s.lastRunAt.toISOString() : null, createdAt: s.createdAt.toISOString(), updatedAt: s.updatedAt.toISOString(),
			nextAt: nextAt.toISOString(),
			nextMeet: meet ? await this.meetEntityService.pack(meet, me) : null,
			upcoming: await Promise.all(upcoming.map(m => this.meetEntityService.pack(m, me))),
		};
	}
}

/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Entity, Column, PrimaryColumn, Index } from 'typeorm';
import { id } from '@/models/util/id.js';
import { MiUser } from '@/models/User.js';
import { MiChannel } from '@/models/Channel.js';
import type { PriceTiers, CancellationPolicy } from '@/modules/coaches/coach-pricing.js';

export const coachScheduleStatuses = ['active', 'paused'] as const;
export const coachBookingModes = ['single', 'series', 'pack', 'several'] as const; // several = coach lets the student choose

/**
 * COACHING-V1 (2026-09-22): a coach's recurring lesson SLOT. Mirrors MiClubSchedule (weekday + startTime + duration
 * + venue + the meet settings a lesson carries) but is OWNED BY A USER (ownerUserId — the coach, who is a club
 * owner/admin) rather than by a channel. It is ATTACHED to that club (channelId) for the permission gate, member
 * invites and the empty-slot broadcast, and its lessons are real meets (meet.coachScheduleId = this id) hosted by
 * the coach. The coachScheduleSweep job (and coaches/schedules/run) materialises the next occurrence once it is
 * inside the publish lead window, then books the active enrollees. Paused schedules create nothing.
 *
 * bookingMode is the operator's "single | subscribe-weekly | both", widened to include the research's class PACK.
 * priceTiers / cancellationPolicy are the two loosely-coupled value objects (modules/coaches/coach-pricing.ts).
 */
@Entity('coach_schedule')
export class MiCoachSchedule {
	@PrimaryColumn(id())
	public id: string;

	@Index()
	@Column({ ...id(), comment: 'The coach who owns this schedule and hosts every lesson it creates.' })
	public ownerUserId: MiUser['id'];

	@Index()
	@Column({ ...id(), comment: 'The club (channel) the coach administers; the create gate + member invites + broadcast.' })
	public channelId: MiChannel['id'];

	@Column('varchar', { length: 128 })
	public name: string;

	@Column('varchar', { length: 32, default: 'pickleball' })
	public sport: string;

	@Column('integer', { comment: 'Monday=1 … Sunday=7.' })
	public weekday: number;

	@Column('varchar', { length: 5, comment: 'HH:mm in the schedule timezone (venue-local; stored occurrences are UTC).' })
	public startTime: string;

	@Column('integer', { default: 60 })
	public durationMinutes: number;

	@Column('varchar', { length: 64, default: 'Asia/Hong_Kong' })
	public timezone: string;

	@Column('varchar', { length: 32, nullable: true })
	public venueId: string | null;

	@Column('varchar', { length: 256, nullable: true })
	public venueName: string | null;

	@Column('varchar', { length: 512, nullable: true })
	public venueAddress: string | null;

	@Column('double precision', { nullable: true })
	public lat: number | null;

	@Column('double precision', { nullable: true })
	public lng: number | null;

	@Column('integer', { default: 1, comment: 'Group size = student seats per lesson (1 = private). The coach hosts without taking a seat.' })
	public capacity: number;

	@Column('varchar', { length: 16, default: 'single' })
	public bookingMode: typeof coachBookingModes[number];

	@Column('integer', { nullable: true, comment: 'For pack mode: how many consecutive occurrences one pack purchase covers.' })
	public packSize: number | null;

	@Column('jsonb', { default: () => `'{"version":1,"tiers":[]}'`, comment: 'COACHING-V1 price bands (coach-pricing.ts PriceTiers).' })
	public priceTiers: PriceTiers;

	@Column('jsonb', { default: () => `'{"windowHours":24}'`, comment: 'COACHING-V1 cancellation policy (coach-pricing.ts CancellationPolicy).' })
	public cancellationPolicy: CancellationPolicy;

	@Column('varchar', { length: 512, nullable: true, comment: 'How to pay the coach (PayMe / FPS…), shown to booked students only.' })
	public paymentInfo: string | null;

	@Column('varchar', { length: 16, default: 'public' })
	public visibility: string;

	@Column('boolean', { default: true, comment: 'Bookings confirm without the coach approving (subject to capacity).' })
	public autoApprove: boolean;

	@Column('varchar', { length: 16, default: 'guidance' })
	public gateType: string;

	@Column('varchar', { length: 16, default: 'self' })
	public levelBasis: string;

	@Column('double precision', { nullable: true, comment: 'Target rating range (min) — group lessons cluster by level.' })
	public minLevel: number | null;

	@Column('double precision', { nullable: true })
	public maxLevel: number | null;

	@Column('varchar', { length: 16, default: 'any' })
	public gender: string;

	@Column('varchar', { length: 16, default: 'any' })
	public ageGroup: string;

	@Column('integer', { default: 168, comment: 'The lesson is created this many hours before its start (1 … 672).' })
	public publishLeadHours: number;

	@Index()
	@Column('varchar', { length: 16, default: 'active' })
	public status: typeof coachScheduleStatuses[number];

	@Column('varchar', { array: true, length: 32, default: '{}', comment: 'Club tag ids whose members are auto-invited to each lesson; empty = none.' })
	public tagIds: string[];

	@Column('varchar', { length: 4096, nullable: true })
	public notes: string | null;

	@Column('boolean', { default: true })
	public sendNotifications: boolean;

	@Column('timestamp with time zone', { nullable: true })
	public lastRunAt: Date | null;

	@Column('timestamp with time zone', { default: () => 'now()' })
	public createdAt: Date;

	@Column('timestamp with time zone', { default: () => 'now()' })
	public updatedAt: Date;
}

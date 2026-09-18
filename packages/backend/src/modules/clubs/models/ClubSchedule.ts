/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Entity, Column, PrimaryColumn, Index } from 'typeorm';
import { id } from '@/models/util/id.js';
import { MiChannel } from '@/models/Channel.js';
import { MiUser } from '@/models/User.js';

export const clubScheduleStatuses = ['active', 'paused'] as const;

/**
 * CLUB-V3: Reclub's recurring club SCHEDULE (spec_meets.md §11, WALK §10 CREATE SCHEDULE). One row = one weekly slot:
 * weekday + start time + duration + venue + the meet details a meet would carry (capacity, privacy, fee, level gate,
 * gender / age, +1, auto-approve, notes) + the publish lead time ("Choose time to create meet": 2 weeks … 24 hours
 * before). The clubScheduleSweep job (and clubs/schedules/run) materialises the next occurrence once it is inside the
 * lead window, as a real meet with meet.seriesId = this id, then invites the club's members (all, or the tagged ones)
 * who are not on a break. Paused schedules create nothing.
 */
@Entity('club_schedule')
export class MiClubSchedule {
	@PrimaryColumn(id())
	public id: string;

	@Index()
	@Column(id())
	public channelId: MiChannel['id'];

	@Column({ ...id(), comment: 'The host of every meet this schedule creates (the admin who made it).' })
	public hostId: MiUser['id'];

	@Column('varchar', { length: 128 })
	public name: string;

	@Column('integer', { comment: 'Reclub ScheduleFrequencyUnit: Monday=1 … Sunday=7.' })
	public weekday: number;

	@Column('varchar', { length: 5, comment: 'HH:mm in the schedule timezone.' })
	public startTime: string;

	@Column('integer', { default: 120 })
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

	@Column('integer', { default: 8 })
	public capacity: number;

	@Column('boolean', { default: true })
	public hostPlays: boolean;

	@Column('varchar', { length: 16, default: 'public' })
	public visibility: string;

	@Column('boolean', { default: true })
	public autoApprove: boolean;

	@Column('boolean', { default: true })
	public allowPlusOne: boolean;

	@Column('varchar', { length: 16, default: 'none' })
	public feeType: string;

	@Column('integer', { nullable: true })
	public feeAmount: number | null;

	@Column('varchar', { length: 3, default: 'HKD' })
	public feeCurrency: string;

	@Column('varchar', { length: 512, nullable: true })
	public paymentInfo: string | null;

	@Column('varchar', { length: 16, default: 'guidance' })
	public gateType: string;

	@Column('varchar', { length: 16, default: 'self' })
	public levelBasis: string;

	@Column('double precision', { nullable: true })
	public minLevel: number | null;

	@Column('double precision', { nullable: true })
	public maxLevel: number | null;

	@Column('varchar', { length: 16, default: 'any' })
	public gender: string;

	@Column('varchar', { length: 16, default: 'any' })
	public ageGroup: string;

	@Column('boolean', { default: false })
	public submitMatches: boolean;

	@Column('integer', { default: 168, comment: 'Reclub publishLeadTime: the meet is created this many hours before its start (24 … 336).' })
	public publishLeadHours: number;

	@Index()
	@Column('varchar', { length: 16, default: 'active' })
	public status: typeof clubScheduleStatuses[number];

	@Column('varchar', { array: true, length: 32, default: '{}', comment: 'Club tag ids whose members are auto-invited; empty = every member.' })
	public tagIds: string[];

	@Column('varchar', { length: 4096, nullable: true })
	public notes: string | null;

	@Column('boolean', { default: true, comment: 'Reclub "Send notifications when published".' })
	public sendNotifications: boolean;

	@Column('timestamp with time zone', { nullable: true })
	public lastRunAt: Date | null;

	@Column('timestamp with time zone', { default: () => 'now()' })
	public createdAt: Date;

	@Column('timestamp with time zone', { default: () => 'now()' })
	public updatedAt: Date;
}

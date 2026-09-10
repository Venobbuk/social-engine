/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { PrimaryColumn, Entity, Index, JoinColumn, Column, ManyToOne } from 'typeorm';
import { id } from './util/id.js';
import { MiUser } from './User.js';
import { MiMeet } from './Meet.js';

// RSVP row. One per (meet, user) for real users; reserved slots and plus-ones have no user.
export const meetParticipantStatuses = ['requested', 'invited', 'confirmed', 'waitlisted', 'hold', 'maybe', 'declined', 'removed', 'left'] as const;
export const meetParticipantKinds = ['user', 'reserved', 'plusOne'] as const;
export const meetParticipantTags = ['paid', 'unpaid', 'cash', 'digital', 'membership', 'punch', 'feeWaived', 'refunded', 'checkedIn', 'noShow', 'late', 'excused', 'guest'] as const;

@Entity('meet_participant')
@Index(['meetId', 'userId'], { unique: true, where: '"userId" IS NOT NULL' })
export class MiMeetParticipant {
	@PrimaryColumn(id())
	public id: string;

	@Index()
	@Column(id())
	public meetId: MiMeet['id'];

	@ManyToOne(() => MiMeet, { onDelete: 'CASCADE' })
	@JoinColumn()
	public meet: MiMeet | null;

	@Index()
	@Column({ ...id(), nullable: true })
	public userId: MiUser['id'] | null;

	@ManyToOne(() => MiUser, { onDelete: 'CASCADE' })
	@JoinColumn()
	public user: MiUser | null;

	@Column('varchar', { length: 16, default: 'user' })
	public kind: typeof meetParticipantKinds[number];

	@Column({ ...id(), nullable: true, comment: 'For plusOne rows: the member who brings the guest.' })
	public sponsorId: MiUser['id'] | null;

	@Column('varchar', { length: 128, nullable: true, comment: 'Display name for reserved/plusOne rows.' })
	public displayName: string | null;

	@Column('double precision', { nullable: true, comment: 'Declared level for reserved/plusOne rows.' })
	public declaredLevel: number | null;

	@Index()
	@Column('varchar', { length: 16, default: 'requested' })
	public status: typeof meetParticipantStatuses[number];

	@Column('integer', { nullable: true, comment: 'Position in the waitlist (1 = next).' })
	public waitlistRank: number | null;

	@Column('timestamp with time zone', { nullable: true, comment: 'When a hold (pay-by) expires and the spot is released.' })
	public holdExpiresAt: Date | null;

	@Column('boolean', { default: false })
	public isHost: boolean;

	@Column('boolean', { default: false })
	public isCoach: boolean;

	@Column('boolean', { default: false })
	public isReferee: boolean;

	@Column('boolean', { default: false })
	public isPaymentCollector: boolean;

	@Column('varchar', { array: true, length: 32, default: '{}' })
	public tags: string[];

	@Column('varchar', { length: 32, nullable: true })
	public teamKey: string | null;

	@Column('integer', { nullable: true })
	public courtIndex: number | null;

	@Column('timestamp with time zone', { nullable: true })
	public statusChangedAt: Date | null;

	@Column('timestamp with time zone', { nullable: true })
	public checkedInAt: Date | null;
}

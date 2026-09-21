/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { PrimaryColumn, Entity, Index, JoinColumn, Column, ManyToOne } from 'typeorm';
import { id } from '@/models/util/id.js';
import { MiUser } from '@/models/User.js';
import { MiMeet } from './Meet.js';

// RSVP row. One per (meet, user) for real users; reserved slots and plus-ones have no user.
// MEET-V4: Reclub MeetParticipantStatus. removed/left are not states — the row is DELETED (Reclub fn#75239). spectator = a roster row holding no seat (host-only host).
export const meetParticipantStatuses = ['requested', 'invited', 'confirmed', 'waitlisted', 'hold', 'maybe', 'declined', 'spectator'] as const;
export const meetParticipantKinds = ['user', 'reserved', 'plusOne'] as const;
export const meetParticipantTags = ['paid', 'unpaid', 'paidClaim', 'cash', 'digital', 'membership', 'punch', 'feeWaived', 'refunded', 'checkedIn', 'noShow', 'late', 'excused', 'guest', 'dropper'] as const; // PLAYER-PAYS-V1: paidClaim is the PLAYER's word; paid stays the host's // three independent groups: attendance / payment / method

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

	@Column('timestamp with time zone', { default: () => 'now()' })
	public statusChangedAt: Date; // Reclub lastStatusUpdatedAt — waitlist order and the 3-day invite auto-confirm run on it

	// ---- MEET-V4-RECLUB: externalReference{gender, age} for reserved/+1 rows (name = displayName, level = declaredLevel) ----
	@Column('varchar', { length: 8, nullable: true })
	public extGender: string | null;

	@Column('varchar', { length: 8, nullable: true })
	public extAge: string | null;

	@Column('varchar', { length: 32, nullable: true })
	public positionId: string | null;

	@Column('double precision', { nullable: true })
	public forceSkill: number | null;

	@Column('varchar', { length: 32, nullable: true })
	public forcePosition: string | null;

	@Column('varchar', { length: 16, nullable: true, comment: 'MeetParticipantPaymentType (cash = 1)' })
	public paymentType: string | null;

	@Column('timestamp with time zone', { nullable: true })
	public checkedInAt: Date | null;

	// ---- HOST-TOOLS-V1 (2026-09-19): proof of payment (a drive file). NUKE-CHAT-MUTE-V1 dropped chatMuted: the per-meet
	// chat mute IS the native chat room mute (chat_room_membership.isMuted), read through ChatService.isRoomMuted. ----
	@Column('varchar', { length: 32, nullable: true })
	public receiptFileId: string | null;

	@Column('varchar', { length: 1024, nullable: true })
	public receiptUrl: string | null;

	@Column('timestamp with time zone', { nullable: true })
	public receiptAt: Date | null;

	@Column('varchar', { length: 32, nullable: true })
	public receiptById: string | null;

	// ---- COACHING-V1 (2026-09-22): the per-person price the student LOCKED at booking (research #2 — a re-tier of
	// the schedule never re-prices them), the currency, and the weekly enrolment (series/pack) this row was booked by. ----
	@Column('integer', { nullable: true, comment: 'COACHING-V1: per-person lesson price in minor units, locked at booking.' })
	public agreedPrice: number | null;

	@Column('varchar', { length: 3, nullable: true })
	public agreedCurrency: string | null;

	@Index()
	@Column('varchar', { length: 32, nullable: true, comment: 'COACHING-V1: coach_enrollment id, if this seat was booked by a series/pack enrolment.' })
	public enrollmentId: string | null;
}

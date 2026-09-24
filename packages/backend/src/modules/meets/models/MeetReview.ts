/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Entity, Column, PrimaryColumn, Index, ManyToOne, JoinColumn } from 'typeorm';
import { id } from '@/models/util/id.js';
import { MiUser } from '@/models/User.js';
import { MiMeet } from './Meet.js';

export const meetReviewTypes = ['endorsement', 'feedback', 'warning'] as const;
/** Reclub warning_description: "Warnings will be publicly shown to the community when given by at least 5 others." */
export const WARNING_PUBLIC_THRESHOLD = 5;

/**
 * MEET-V4-RECLUB: the safety model, copied whole. endorsement = public positive; feedback = private to the person;
 * warning = private to the author until WARNING_PUBLIC_THRESHOLD distinct people have issued one, then public.
 * One row per (author, target, type) — a person's warning counts once, which is what "given by at least 5 others" means.
 */
/** KUDOS-CHAT-V1: an endorsement (GripBat's kudos) carries at most this many dimensions (Reclub "Select up to 3"). */
export const MAX_KUDOS_PER_REVIEW = 3;

// KUDOS-CHAT-V1 (migration 1789098800000): feedback / warning stay one per pair; an ENDORSEMENT (kudos) is one per pair
// per activity — meetId or competitionId (Reclub KudoReferenceType) — see the partial unique indexes in the migration.
@Entity('meet_review')
@Index(['authorId', 'targetUserId', 'type'], { unique: true, where: '"type" <> \'endorsement\'' })
export class MiMeetReview {
	@PrimaryColumn(id())
	public id: string;

	@Index()
	@Column(id())
	public authorId: MiUser['id'];

	@ManyToOne(() => MiUser, { onDelete: 'CASCADE' })
	@JoinColumn()
	public author: MiUser | null;

	@Index()
	@Column(id())
	public targetUserId: MiUser['id'];

	// the column is targetUserId (migration meet-v4-reclub); a bare @JoinColumn() would look for targetId — SAFETY-V1 found it
	@ManyToOne(() => MiUser, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'targetUserId' })
	public target: MiUser | null;

	@Column({ ...id(), nullable: true })
	public meetId: MiMeet['id'] | null;

	@ManyToOne(() => MiMeet, { onDelete: 'SET NULL' })
	@JoinColumn()
	public meet: MiMeet | null;

	/** KUDOS-CHAT-V1: the competition an endorsement (kudos) was given in (null = a meet, or legacy). */
	@Index()
	@Column('varchar', { length: 32, nullable: true })
	public competitionId: string | null;

	/** KUDOS-CHAT-V1: the endorsement's "Any additional notes?" (public with it). */
	@Column('varchar', { length: 512, nullable: true })
	public note: string | null;

	@Column('varchar', { length: 16 })
	public type: typeof meetReviewTypes[number];

	@Column('varchar', { length: 2048, nullable: true })
	public body: string | null;

	@Column('timestamp with time zone', { nullable: true })
	public acknowledgedAt: Date | null;

	@Column('timestamp with time zone', { nullable: true })
	public archivedAt: Date | null;

	@Column('timestamp with time zone', { default: () => 'now()' })
	public createdAt: Date;
}

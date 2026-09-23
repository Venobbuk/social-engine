/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Entity, Column, PrimaryColumn, Index, ManyToOne, JoinColumn } from 'typeorm';
import { id } from '@/models/util/id.js';
import { MiUser } from '@/models/User.js';
import { MiMeet } from './Meet.js';

/** Reclub DUPRIntegrationStatus on a match: nothing yet → queued at hkpl → submitted (locked) → failed → ineligible. */
export const meetMatchDuprStatuses = ['queued', 'submitted', 'failed', 'ineligible'] as const;

/**
 * MEET-MATCH-V1 (2026-09-16): Reclub's Matches pane, one row per match (spec_meets.md §4.1/§4.6).
 *   round / courtIndex     — "Round {{num}}" / "No round", "Court {{index}}" / "No assigned court"
 *   team1Ids / team2Ids    — meet_participant ids (a Reserved or PlusOne row may play; it has no user → no DUPR)
 *   scores                 — score sets in order, each [team1, team2]; empty = isPending
 *   dupr*                  — the badge "Submitted by {{name}}" and the lock "These matches have already been
 *                            submitted to DUPR." duprRef is hkpl's queue id (then DUPR's match id once drained).
 * DUPR itself lives on hkpl (SOCIAL-DUPR-V1): this table only remembers what was sent and what came back.
 */
@Entity('meet_match')
export class MiMeetMatch {
	@PrimaryColumn(id())
	public id: string;

	@Index()
	@Column(id())
	public meetId: MiMeet['id'];

	@ManyToOne(() => MiMeet, { onDelete: 'CASCADE' })
	@JoinColumn()
	public meet: MiMeet | null;

	@Column('integer', { nullable: true })
	public round: number | null;

	@Column('integer', { nullable: true })
	public courtIndex: number | null;

	@Column('varchar', { array: true, length: 32, default: '{}' })
	public team1Ids: string[];

	@Column('varchar', { array: true, length: 32, default: '{}' })
	public team2Ids: string[];

	@Column('jsonb', { default: [] })
	public scores: [number, number][];

	@Column({ ...id(), nullable: true })
	public createdById: MiUser['id'] | null;

	@Column('varchar', { length: 16, nullable: true })
	public duprStatus: typeof meetMatchDuprStatuses[number] | null;

	@Column({ ...id(), nullable: true })
	public duprSubmittedById: MiUser['id'] | null;

	@Column('timestamp with time zone', { nullable: true })
	public duprSubmittedAt: Date | null;

	@Column('varchar', { length: 128, nullable: true })
	public duprRef: string | null;

	@Column('varchar', { length: 512, nullable: true })
	public duprError: string | null;

	@Column('varchar', { length: 512, nullable: true, comment: 'MEETS-FIXES-V1: Reclub match notes.' })
	public notes?: string | null;

	@Column('timestamp with time zone', { default: () => 'now()' })
	public updatedAt: Date;
}

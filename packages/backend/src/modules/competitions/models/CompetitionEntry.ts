/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Entity, Column, PrimaryColumn, Index, ManyToOne, JoinColumn } from 'typeorm';
import { id } from '@/models/util/id.js';
import { MiUser } from '@/models/User.js';
import { MiCompetition } from './Competition.js';

// TOURNAMENT-V1: one entry = Reclub CompetitionTeam (+ its members). A singles entry is a team of one; a doubles entry a
// team of two; a team entry teamMinSize..teamMaxSize players. A reserved spot (Reclub CompetitionParticipantReferenceType
// Reserved) is an entry with no users and a name. Status follows Reclub CompetitionTeamStatus: Pending:0 → 'pending',
// Confirmed:1 → 'confirmed', Withdrawn:-1 → 'withdrawn', Forfeit:-2 → 'forfeit'.
export const competitionEntryStatuses = ['pending', 'confirmed', 'withdrawn', 'forfeit'] as const;

@Entity('competition_entry')
export class MiCompetitionEntry {
	@PrimaryColumn(id())
	public id: string;

	@Index()
	@Column(id())
	public competitionId: MiCompetition['id'];

	@ManyToOne(() => MiCompetition, { onDelete: 'CASCADE' })
	@JoinColumn()
	public competition: MiCompetition | null;

	@Column('varchar', { length: 128, comment: 'Team name (Reclub CompetitionTeam.name); for singles the player name.' })
	public name: string;

	@Index()
	@Column({ ...id(), nullable: true, comment: 'The captain / the single player (null = reserved spot).' })
	public captainId: MiUser['id'] | null;

	@Column('varchar', { array: true, length: 32, default: '{}', comment: 'All members (captain first).' })
	public userIds: string[];

	@Column('integer', { nullable: true, comment: 'Seed (1 = top), null = unseeded.' })
	public seed: number | null;

	@Column('integer', { nullable: true, comment: 'Pool number (Reclub group), 1-based; null = unassigned.' })
	public pool: number | null;

	@Index()
	@Column('varchar', { length: 16, default: 'confirmed' })
	public status: typeof competitionEntryStatuses[number];

	@Column('boolean', { default: false })
	public isPaid: boolean;

	@Column('varchar', { length: 512, nullable: true })
	public notes: string | null;

	@Column({ ...id(), nullable: true, comment: 'Who added the entry (self sign-up = the captain; host add = the host).' })
	public createdById: MiUser['id'] | null;

	@Column('timestamp with time zone', { default: () => 'now()' })
	public createdAt: Date;

	@Column('timestamp with time zone', { default: () => 'now()' })
	public statusChangedAt: Date;
}

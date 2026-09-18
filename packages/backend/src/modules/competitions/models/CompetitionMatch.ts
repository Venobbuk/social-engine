/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Entity, Column, PrimaryColumn, Index, ManyToOne, JoinColumn } from 'typeorm';
import { id } from '@/models/util/id.js';
import { MiCompetition } from './Competition.js';

// TOURNAMENT-V1: one row per match (Reclub CompetitionMatch + its CompetitionScore sets).
//   stage        Reclub CompetitionStage Regular:1 → 'regular' (round robin / pools), Playoff:2 → 'playoff', Consolation:3 → 'consolation'
//   pool         group number for pool matches (null elsewhere)
//   round/number the position inside the stage; bracketId links a knockout row to brackets-manager's match id
//   scores       score sets in order: { t1, t2, type } — type Reclub CompetitionScoreType Standard/Tiebreaker/Extra
//   result       Reclub CompetitionMatchResultUIStatus: null pending, 'entry1', 'entry2', 'draw'
//   entryNStatus Reclub CompetitionMatchTeamStatus: 'confirmed' | 'forfeit' | 'bye' | 'pending'
export const competitionStages = ['regular', 'playoff', 'consolation'] as const;
export const competitionMatchStatuses = ['pending', 'inProgress', 'completed', 'cancelled'] as const;
export const competitionMatchSideStatuses = ['pending', 'confirmed', 'forfeit', 'bye'] as const;
export const competitionScoreTypes = ['standard', 'tiebreaker', 'extra'] as const;
export type CompetitionScoreSet = { t1: number; t2: number; type: typeof competitionScoreTypes[number] };
export type CompetitionMatchResult = 'entry1' | 'entry2' | 'draw' | null;

@Entity('competition_match')
export class MiCompetitionMatch {
	@PrimaryColumn(id())
	public id: string;

	@Index()
	@Column(id())
	public competitionId: MiCompetition['id'];

	@ManyToOne(() => MiCompetition, { onDelete: 'CASCADE' })
	@JoinColumn()
	public competition: MiCompetition | null;

	@Column('varchar', { length: 16, default: 'regular' })
	public stage: typeof competitionStages[number];

	@Column('integer', { nullable: true })
	public pool: number | null;

	@Column('integer', { default: 1 })
	public round: number;

	@Column('integer', { default: 1, comment: 'Match number inside the round.' })
	public number: number;

	@Column('integer', { nullable: true, comment: 'brackets-manager match id (knockout stages only).' })
	public bracketId: number | null;

	@Column('varchar', { length: 16, nullable: true, comment: 'brackets-manager group: winner | loser | final (double elimination), single (single elimination), consolation (third place).' })
	public bracketGroup: string | null;

	@Column('varchar', { length: 32, nullable: true })
	public entry1Id: string | null;

	@Column('varchar', { length: 32, nullable: true })
	public entry2Id: string | null;

	@Column('varchar', { length: 16, default: 'pending' })
	public entry1Status: typeof competitionMatchSideStatuses[number];

	@Column('varchar', { length: 16, default: 'pending' })
	public entry2Status: typeof competitionMatchSideStatuses[number];

	@Index()
	@Column('varchar', { length: 16, default: 'pending' })
	public status: typeof competitionMatchStatuses[number];

	@Column('jsonb', { default: [] })
	public scores: CompetitionScoreSet[];

	@Column('varchar', { length: 8, nullable: true })
	public result: CompetitionMatchResult;

	@Column('integer', { nullable: true })
	public courtIndex: number | null;

	@Column('timestamp with time zone', { nullable: true })
	public startAt: Date | null;

	@Column('varchar', { length: 512, nullable: true })
	public notes: string | null;

	@Column('boolean', { default: false, comment: 'Reclub CompetitionMatchSourceType User:2 — added by the host, not generated.' })
	public isExtra: boolean;

	@Column('timestamp with time zone', { default: () => 'now()' })
	public createdAt: Date;

	@Column('timestamp with time zone', { default: () => 'now()' })
	public updatedAt: Date;
}

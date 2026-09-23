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
// COMP-DUPR-V1: the same DUPRIntegrationStatus meet_match carries (MeetMatch.ts:12) — nothing yet -> queued at
// hkpl -> submitted (locked) -> failed -> ineligible. DUPR itself lives on hkpl; this row keeps only the receipt.
export const competitionMatchDuprStatuses = ['queued', 'submitted', 'failed', 'ineligible'] as const;
// COMP-T3-V1: a score set may carry its name (Reclub Manage score sets "Set name"); absent = "Game n"
// COMP-FIXES-B (2026-09-23): Reclub CompetitionScore tags + score participants —
//   serve   the pickleball serve indicator (CompetitionScoreTag PBT1S1…PBT2S2: team n is serving, server 1 or 2)
//   p1 / p2 the line-up of this set: which members of entry 1 / entry 2 played it (Reclub "Assign players"; hkpl
//           routes/captain.js LINEUP-LOCK-V2 per-game line-ups). Absent = not assigned.
export const competitionServeTags = ['PBT1S1', 'PBT1S2', 'PBT2S1', 'PBT2S2'] as const;
export type CompetitionServeTag = typeof competitionServeTags[number];
export type CompetitionScoreSet = { t1: number; t2: number; type: typeof competitionScoreTypes[number]; name?: string; serve?: CompetitionServeTag; p1?: string[]; p2?: string[] };
// COMP-T3-V1: Reclub match availability "Can go / Maybe / Can't go" (the values of hkpl AVAILABILITY-V1, per match here)
export const competitionAvailabilities = ['yes', 'maybe', 'no'] as const;
export type CompetitionAvailability = typeof competitionAvailabilities[number];
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

	// COMP-DUPR-V1 — mirrors MeetMatch.ts:54-67 exactly (same names, same types, same widths)
	@Column('varchar', { length: 16, nullable: true })
	public duprStatus: typeof competitionMatchDuprStatuses[number] | null;

	@Column({ ...id(), nullable: true })
	public duprSubmittedById: string | null;

	@Column('timestamp with time zone', { nullable: true })
	public duprSubmittedAt: Date | null;

	@Column('varchar', { length: 128, nullable: true })
	public duprRef: string | null;

	@Column('varchar', { length: 512, nullable: true })
	public duprError: string | null;

	// COMP-T3-V1: Reclub match manage "Referees: pick from Staff / Teams / Players" — this match's own referees (a competition
	// referee, refereeIds on the competition, may still score any match)
	@Column('varchar', { array: true, length: 32, default: '{}' })
	public refereeIds: string[];

	@Column('jsonb', { default: {}, comment: 'Reclub match availability { userId: yes | maybe | no }.' })
	public availability: Record<string, CompetitionAvailability>;

	@Column('boolean', { default: false, comment: 'Reclub CompetitionMatchSourceType User:2 — added by the host, not generated.' })
	public isExtra: boolean;

	// COMP-FIXES-B: Reclub Create / Edit match "Name" (a match may carry the host's name for it: "Exhibition", "Rematch")
	@Column('varchar', { length: 64, nullable: true })
	public name: string | null;

	@Column('timestamp with time zone', { default: () => 'now()' })
	public createdAt: Date;

	@Column('timestamp with time zone', { default: () => 'now()' })
	public updatedAt: Date;
}

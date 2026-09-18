/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { PrimaryColumn, Entity, Index, JoinColumn, Column, ManyToOne } from 'typeorm';
import { id } from '@/models/util/id.js';
import { MiUser } from '@/models/User.js';
import { MiChannel } from '@/models/Channel.js';
import { MiChatRoom } from '@/models/ChatRoom.js';
import type { Database as BracketDb } from 'brackets-model';

// TOURNAMENT-V1 (2026-09-19): a user-created competition (Reclub 2.45.12 Competition, spec_competition_dupr.md §2.1 /
// §Y.1) reduced to what a GripBat host runs: format, participant type, registration timeline, fee, venue + dates,
// draw settings (pools, winners per pool, third place), standings calculation + tiebreakers, awards.
//
// Reclub's wire enums are carried as words, not numbers (paramDef enums must be strings; a null in an enum list crashes
// boot). Mapping: CompetitionStatus Draft:1→'draft', Open:3→'open', Open+lockRegistration→'closed', Started:4→
// 'inProgress', Ended:5→'done', Cancelled:-2→'cancelled'. CompetitionDrawFormatType SingleRoundRobin→'roundRobin',
// SinglePoolPlay→'poolPlayKnockout', SingleElimination→'singleElim', DoubleElimination→'doubleElim'.

export const competitionFormats = ['roundRobin', 'poolPlayKnockout', 'singleElim', 'doubleElim'] as const;
export const competitionParticipantTypes = ['singles', 'doubles', 'team'] as const;
export const competitionStatuses = ['draft', 'open', 'closed', 'inProgress', 'done', 'cancelled'] as const;
export const competitionFeeTypes = ['free', 'perEntry'] as const;
export const competitionVisibilities = ['public', 'private'] as const;
export const competitionPointCalculations = ['winLoss', 'totalScores', 'winPct', 'setsWinPct', 'setsWon'] as const;
export const competitionTiebreakers = ['h2h_wins', 'score_diff', 'h2h_diff', 'total_score', 'sets_won', 'win_pct', 'sets_win_pct'] as const;
export const competitionGenders = ['any', 'coed', 'female', 'male'] as const;
export const competitionAgeGroups = ['any', 'junior', 'adult', 'senior'] as const;

export type CompetitionFormat = typeof competitionFormats[number];
export type CompetitionStatus = typeof competitionStatuses[number];

@Entity('competition')
export class MiCompetition {
	@PrimaryColumn(id())
	public id: string;

	@Index({ unique: true })
	@Column('varchar', { length: 16, comment: 'Short public reference used in share links.' })
	public referenceCode: string;

	@Index()
	@Column({ ...id(), comment: 'The host (creator) — the competition admin.' })
	public hostId: MiUser['id'];

	@ManyToOne(() => MiUser, { onDelete: 'CASCADE' })
	@JoinColumn()
	public host: MiUser | null;

	@Index()
	@Column({ ...id(), nullable: true, comment: 'The club (channel) this competition belongs to, if any (Reclub CompetitionReferenceType.Group).' })
	public channelId: MiChannel['id'] | null;

	@ManyToOne(() => MiChannel, { onDelete: 'SET NULL' })
	@JoinColumn()
	public channel: MiChannel | null;

	@Column({ ...id(), nullable: true, comment: 'General chat room (Reclub competition general chat) — the meet chat room pattern.' })
	public chatRoomId: MiChatRoom['id'] | null;

	@ManyToOne(() => MiChatRoom, { onDelete: 'SET NULL' })
	@JoinColumn()
	public chatRoom: MiChatRoom | null;

	@Column('varchar', { length: 32, default: 'pickleball' })
	public sport: string;

	@Column('varchar', { length: 128 })
	public name: string;

	@Column('varchar', { length: 4096, nullable: true })
	public notes: string | null;

	@Column('varchar', { length: 32, default: 'singleElim' })
	public format: CompetitionFormat;

	@Column('varchar', { length: 16, default: 'singles' })
	public participantType: typeof competitionParticipantTypes[number];

	@Column('integer', { default: 1, comment: 'Players per entry, minimum (Reclub participantMinSize).' })
	public teamMinSize: number;

	@Column('integer', { default: 1, comment: 'Players per entry, maximum (Reclub participantMaxSize).' })
	public teamMaxSize: number;

	@Column('integer', { default: 8, comment: 'Max entries (Reclub participantMaxCount: "Max number of teams / players").' })
	public maxEntries: number;

	@Column('timestamp with time zone', { nullable: true, comment: 'Registration open (Reclub registrationStart).' })
	public registrationOpenAt: Date | null;

	@Column('timestamp with time zone', { nullable: true, comment: 'Registration deadline (Reclub registrationDeadline).' })
	public registrationCloseAt: Date | null;

	@Column('boolean', { default: false, comment: 'Host locked registration (Reclub lockRegistration) — status closed.' })
	public lockRegistration: boolean;

	@Index()
	@Column('timestamp with time zone', { comment: 'Approximate starting time (Reclub startDatetime).' })
	public startAt: Date;

	@Column('integer', { default: 1, comment: 'Duration in days (Reclub duration; "day"/"week" units).' })
	public durationDays: number;

	@Column('varchar', { length: 64, default: 'Asia/Hong_Kong' })
	public timezone: string;

	@Column('varchar', { length: 256, nullable: true })
	public venueName: string | null;

	@Column('varchar', { length: 512, nullable: true })
	public venueAddress: string | null;

	@Column('double precision', { nullable: true })
	public lat: number | null;

	@Column('double precision', { nullable: true })
	public lng: number | null;

	@Index()
	@Column('varchar', { length: 32, nullable: true, comment: 'Venue entity id.' })
	public venueId: string | null;

	@Column('varchar', { length: 16, default: 'free' })
	public feeType: typeof competitionFeeTypes[number];

	@Column('integer', { nullable: true, comment: 'Amount per entry in minor units (Reclub feeAmount).' })
	public feeAmount: number | null;

	@Column('integer', { nullable: true, comment: 'Early bird amount per entry (Reclub feeEarlyBirdAmount).' })
	public feeEarlyBirdAmount: number | null;

	@Column('timestamp with time zone', { nullable: true, comment: 'Early bird deadline (Reclub registrationEarlyBirdDeadline).' })
	public earlyBirdAt: Date | null;

	@Column('varchar', { length: 3, default: 'HKD' })
	public feeCurrency: string;

	@Column('varchar', { length: 512, nullable: true, comment: 'How to pay, shown to entrants.' })
	public paymentInfo: string | null;

	@Column('varchar', { length: 16, default: 'public' })
	public visibility: typeof competitionVisibilities[number];

	@Column('varchar', { length: 32, nullable: true, comment: 'Grants access to a private competition via link (Reclub accessToken).' })
	public accessToken: string | null;

	@Index()
	@Column('varchar', { length: 16, default: 'draft' })
	public status: CompetitionStatus;

	@Column('double precision', { nullable: true })
	public minLevel: number | null;

	@Column('double precision', { nullable: true })
	public maxLevel: number | null;

	@Column('varchar', { length: 16, default: 'any' })
	public gender: typeof competitionGenders[number];

	@Column('varchar', { length: 16, default: 'any' })
	public ageGroup: typeof competitionAgeGroups[number];

	// ---- draw settings (Reclub upsert-match-format) ----
	@Column('integer', { default: 1, comment: 'Pools (Reclub numGroups) — poolPlayKnockout only.' })
	public numGroups: number;

	@Column('integer', { default: 2, comment: 'Winners per pool who advance (Reclub numContinue).' })
	public numContinue: number;

	@Column('boolean', { default: true, comment: 'Third place match (Reclub thirdPlaceMatch).' })
	public thirdPlaceMatch: boolean;

	@Column('integer', { default: 1, comment: 'Standard score sets per match (Reclub setConfigurations count): 1 = one game, 3 = best of three.' })
	public setsPerMatch: number;

	@Column('integer', { default: 11, comment: 'Score awarded to the winner of a forfeited match (Reclub forfeitWinScore).' })
	public forfeitWinScore: number;

	@Column('varchar', { length: 16, default: 'winLoss' })
	public pointCalculationType: typeof competitionPointCalculations[number];

	@Column('integer', { default: 3 })
	public standardWinPoint: number;

	@Column('integer', { default: 0 })
	public standardLossPoint: number;

	@Column('integer', { default: 1 })
	public drawPoint: number;

	@Column('integer', { default: 2, comment: 'Reclub tiebreakerWinPoint.' })
	public tiebreakerWinPoint: number;

	@Column('integer', { default: 1, comment: 'Reclub tiebreakerLossPoint.' })
	public tiebreakerLossPoint: number;

	@Column('varchar', { length: 16, array: true, default: '{h2h_wins,score_diff,h2h_diff,total_score}', comment: 'Reclub tiebreaker1..4 in order.' })
	public tiebreakers: string[];

	@Column('boolean', { default: false, comment: 'Reclub revealDraw: participants may see the draw before the start.' })
	public revealDraw: boolean;

	@Column('boolean', { default: true, comment: 'Reclub showSeeds.' })
	public showSeeds: boolean;

	@Column('boolean', { default: false, comment: 'Reclub manualSeeding: the host ordered the seeds by hand.' })
	public manualSeeding: boolean;

	@Column('boolean', { default: true, comment: 'Reclub autoApprove for players: an entry is confirmed without host approval.' })
	public autoApprove: boolean;

	@Column('jsonb', { nullable: true, comment: 'brackets-manager export (participant/stage/group/round/match) for the knockout stage(s).' })
	public bracketData: BracketDb | null;

	@Column('timestamp with time zone', { nullable: true })
	public startedAt: Date | null;

	@Column('timestamp with time zone', { nullable: true })
	public endedAt: Date | null;

	@Column('timestamp with time zone', { nullable: true })
	public cancelledAt: Date | null;

	@Column('timestamp with time zone', { nullable: true })
	public updatedAt: Date | null;
}

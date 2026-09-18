/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Entity, Column, PrimaryColumn, Index, ManyToOne, JoinColumn } from 'typeorm';
import { id } from '@/models/util/id.js';
import { MiCompetition } from './Competition.js';

// TOURNAMENT-V1: Reclub Award (spec §2.4). type: CompetitionFirstPlace:201 → 'first', 202 → 'second', 203 → 'third',
// 204 → 'fourth', CompetitionCoThirdPlace:205 → 'coThird', CompetitionGeneric:200 → 'custom'. The recipient is an entry
// (Reclub AwardRecipientType CompetitionTeam) and userIds denormalises its members so a profile (users/show
// `placements`) reads its awards with one query. System awards (1st–4th) are written when the host ends the
// competition; the host may re-point or customise them and add custom awards.
export const competitionAwardTypes = ['first', 'second', 'third', 'coThird', 'fourth', 'custom'] as const;

@Entity('competition_award')
export class MiCompetitionAward {
	@PrimaryColumn(id())
	public id: string;

	@Index()
	@Column(id())
	public competitionId: MiCompetition['id'];

	@ManyToOne(() => MiCompetition, { onDelete: 'CASCADE' })
	@JoinColumn()
	public competition: MiCompetition | null;

	@Column('varchar', { length: 16, default: 'custom' })
	public type: typeof competitionAwardTypes[number];

	@Column('varchar', { length: 128 })
	public name: string;

	@Column('varchar', { length: 512, nullable: true })
	public description: string | null;

	@Column('varchar', { length: 32, nullable: true, comment: 'Recipient entry (null = no recipient yet).' })
	public entryId: string | null;

	@Column('varchar', { array: true, length: 32, default: '{}', comment: 'The recipient entry members (profile lookup; GIN index in the migration).' })
	public userIds: string[];

	@Column('boolean', { default: true, comment: 'Reclub AwardStatus Enabled/Disabled.' })
	public enabled: boolean;

	@Column('timestamp with time zone', { nullable: true })
	public awardedAt: Date | null;

	@Column('timestamp with time zone', { default: () => 'now()' })
	public createdAt: Date;
}

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
// COMP-W1B4: 'freeAgent' = Reclub "Join as free agent": one player + notes, no team yet — outside every active count,
// never drawn, never an already_entered lock; the host assigns the player to a team (the row is then withdrawn).
// COMP-T3-V1: 'spectator' = Reclub "Join as a spectator" — the meet's spectator (MeetParticipant.ts:12, a roster row holding
// no seat) on the competition's own row shape: one user, never counted, never drawn, hears the announcements, reads the
// general chat, sees a private competition. Free agents without a team become spectators at the start (Reclub copy).
export const competitionEntryStatuses = ['pending', 'confirmed', 'withdrawn', 'forfeit', 'freeAgent', 'spectator'] as const;

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

	// COMP-W1B4: partner consent — a partner named by the entrant waits here until they accept (never seated, never in the chat)
	@Column('varchar', { array: true, length: 32, default: '{}', comment: 'Invited partners who have not accepted yet.' })
	public invitedUserIds: string[];

	// COMP-W1B4: join an existing team — players asking the captain for a place in this team
	@Column('varchar', { array: true, length: 32, default: '{}', comment: 'Players who asked to join this team.' })
	public requestedUserIds: string[];

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

	// COMP-T3-V1: the host's eligibility calls (Reclub participant settings "Eligible") — { userId: true | false }; a user
	// absent here is judged by the automatic rule (CompetitionService.eligibilityOf, hkpl lib/eligibility-auto.js rating rule)
	@Column('jsonb', { default: {}, comment: 'Manual eligibility overrides { userId: boolean }.' })
	public eligibility: Record<string, boolean>;

	@Column({ ...id(), nullable: true, comment: 'Team avatar: a drive file of the captain / host (Reclub Add Team Avatar).' })
	public avatarFileId: string | null;

	@Column({ ...id(), nullable: true, comment: 'Who added the entry (self sign-up = the captain; host add = the host).' })
	public createdById: MiUser['id'] | null;

	@Column('timestamp with time zone', { default: () => 'now()' })
	public createdAt: Date;

	@Column('timestamp with time zone', { default: () => 'now()' })
	public statusChangedAt: Date;
}

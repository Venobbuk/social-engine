/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { PrimaryColumn, Entity, Index, JoinColumn, Column, ManyToOne } from 'typeorm';
import { id } from '@/models/util/id.js';
import { MiUser } from '@/models/User.js';
import { MiChannel } from '@/models/Channel.js';
import { MiChatRoom } from '@/models/ChatRoom.js';

// The meet object: a social open-play session with capacity, RSVP states, gates and (later) fees.
// Field set follows docs/spec_meets.md §Y.2 (Reclub 2.45.12 model) reduced to what v1 needs.

export const meetTypes = ['listing', 'managed'] as const;
export const meetVisibilities = ['public', 'private'] as const; // MEET-V4: Reclub privacy is binary; club = private + meet_group
export const meetStatuses = ['pending', 'active', 'cancelled'] as const; // MEET-V4: Reclub MeetStatus
export const meetRosterVisibilities = ['show_gender', 'show_age_group', 'show_self_rating', 'show_participant_tags', 'show_club_tags', 'show_dupr_ratings', 'show_courts', 'show_friends', 'show_position'] as const;
export const meetFlags = ['COMMUNITY_PROMOTED', 'GROUP_PROMOTED', 'PROXIMITY_PROMOTED'] as const;
export const meetFeeTypes = ['none', 'free', 'perPax', 'autoSplit'] as const;
export const meetGateTypes = ['guidance', 'autoApprove', 'strict'] as const;
export const meetLevelBases = ['self', 'duprSingles', 'duprDoubles'] as const;
export const meetGenders = ['any', 'coed', 'female', 'male'] as const;
export const meetAgeGroups = ['any', 'junior', 'adult', 'senior'] as const;

@Entity('meet')
export class MiMeet {
	@PrimaryColumn(id())
	public id: string;

	@Index({ unique: true })
	@Column('varchar', { length: 16, comment: 'Short public reference used in share links (/m/<ref>).' })
	public referenceCode: string;

	@Index()
	@Column({ ...id(), comment: 'The host (creator).' })
	public hostId: MiUser['id'];

	@ManyToOne(() => MiUser, { onDelete: 'CASCADE' })
	@JoinColumn()
	public host: MiUser | null;

	@Index()
	@Column({ ...id(), nullable: true, comment: 'The club (channel) this meet belongs to, if any.' })
	public channelId: MiChannel['id'] | null;

	@ManyToOne(() => MiChannel, { onDelete: 'SET NULL' })
	@JoinColumn()
	public channel: MiChannel | null;

	@Column({ ...id(), nullable: true, comment: 'Chat room auto-created for confirmed participants.' })
	public chatRoomId: MiChatRoom['id'] | null;

	@ManyToOne(() => MiChatRoom, { onDelete: 'SET NULL' })
	@JoinColumn()
	public chatRoom: MiChatRoom | null;

	@Column('varchar', { length: 16, default: 'managed' })
	public type: typeof meetTypes[number];

	@Column('varchar', { length: 32, default: 'pickleball' })
	public sport: string;

	@Column('varchar', { length: 32, nullable: true, comment: 'Sport format label (social, roundRobin, singles, doubles…).' })
	public format: string | null;

	@Column('varchar', { length: 128 })
	public name: string;

	@Column('varchar', { length: 4096, nullable: true })
	public notes: string | null;

	@Index()
	@Column('timestamp with time zone')
	public startAt: Date;

	@Column('integer', { comment: 'Duration in minutes.' })
	public durationMinutes: number;

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

	@Column('varchar', { length: 64, nullable: true, comment: 'Host-side venue reference (e.g. hkpl venue id).' })
	public venueRef: string | null;

	@Column('integer', { default: 4, comment: 'Player capacity (host counted when hostPlays).' })
	public capacity: number;

	@Column('boolean', { default: true })
	public hostPlays: boolean;

	@Column('varchar', { length: 16, default: 'public' })
	public visibility: typeof meetVisibilities[number];

	@Column('varchar', { length: 32, nullable: true, comment: 'Grants access to a private meet via link.' })
	public accessToken: string | null;

	@Index()
	@Column('varchar', { length: 16, default: 'active' })
	public status: typeof meetStatuses[number];

	@Column('boolean', { default: false, comment: 'Requests are confirmed without host approval (subject to gate + capacity).' })
	public autoApprove: boolean;

	@Column('boolean', { default: true })
	public allowPlusOne: boolean;

	@Column('integer', { default: 1, comment: 'Max guests one member may bring.' })
	public guestsPerMember: number;

	@Column('varchar', { length: 16, default: 'none' })
	public feeType: typeof meetFeeTypes[number];

	@Column('integer', { nullable: true, comment: 'Amount in minor units (cents).' })
	public feeAmount: number | null;

	@Column('varchar', { length: 3, default: 'HKD' })
	public feeCurrency: string;

	@Column('varchar', { length: 512, nullable: true, comment: 'How to pay (PayMe link, FPS id…) shown to confirmed players.' })
	public paymentInfo: string | null;


	@Column('integer', { default: 0, comment: 'Hours before start after which players cannot cancel (0 = none).' })
	public cancellationFreezeHours: number;

	@Column('varchar', { length: 16, default: 'strict' })
	public gateType: typeof meetGateTypes[number];

	@Column('varchar', { length: 16, default: 'self' })
	public levelBasis: typeof meetLevelBases[number];

	@Column('double precision', { nullable: true })
	public minLevel: number | null;

	@Column('double precision', { nullable: true })
	public maxLevel: number | null;

	@Column('varchar', { length: 16, default: 'any' })
	public gender: typeof meetGenders[number];

	@Column('varchar', { length: 16, default: 'any' })
	public ageGroup: typeof meetAgeGroups[number];

	@Column('boolean', { default: false, comment: 'Matches will be submitted to the rating provider (DUPR) by the host adapter.' })
	public submitMatches: boolean;

	// ---- MEET-V4-RECLUB (2026-09-16): Reclub 2.45.12 fields not previously carried ----
	@Column('integer', { default: 0, comment: 'The ONE seat counter (Reclub numComfirmedReserved). CHECK confirmed <= capacity in the DB; moved only by MeetService.claimSeat/releaseSeat.' })
	public confirmed: number;

	@Column('varchar', { length: 16, default: 'guidance', comment: 'DUPRAccountGateType: guidance | autoApprove | strict — whether a DUPR-linked account is required.' })
	public duprAccountGate: typeof meetGateTypes[number];

	@Column('varchar', { length: 16, nullable: true })
	public repeatInterval: string | null;

	@Column('integer', { nullable: true })
	public repeatCount: number | null;

	@Column('integer', { nullable: true, comment: 'Teams are blind until this many minutes before start.' })
	public blindTeamsMinutes: number | null;

	@Column('boolean', { default: false })
	public allowPlayerScoring: boolean;

	@Column('boolean', { default: true })
	public sendNotifications: boolean;

	@Column('varchar', { length: 32, array: true, default: '{}', comment: 'VISIBILITY_TYPE[] — which roster columns the host shows.' })
	public rosterVisibility: string[];

	@Column('varchar', { length: 32, array: true, default: '{}' })
	public flags: string[];

	@Index()
	@Column('varchar', { length: 32, nullable: true, comment: 'Venue entity (W4); venueName/venueAddress/lat/lng stay as the denormalised display.' })
	public venueId: string | null;

	@Column('varchar', { length: 32, nullable: true, comment: 'Series (recurring schedule) this meet was materialised from.' })
	public seriesId: string | null;

	// ---- COACHING-V1 (2026-09-22): a meet whose coachScheduleId is set IS a coaching LESSON. The thin coach flag
	// (lighter than a parallel Lesson table): it reuses the whole meet state machine and carries the lesson's own
	// copied price bands so it prices itself. Both null on a normal meet. ----
	@Index()
	@Column('varchar', { length: 32, nullable: true, comment: 'COACHING-V1: the coach_schedule this lesson belongs to; null = not a lesson.' })
	public coachScheduleId: string | null;

	@Column('jsonb', { nullable: true, comment: 'COACHING-V1: price bands copied from the coach schedule at materialise (coach-pricing.ts PriceTiers).' })
	public priceTiers: import('@/modules/coaches/coach-pricing.js').PriceTiers | null;

	// ---- MEET-EXTRAS-V1 (2026-09-19): listing link, promotion receipt, scoring rules, reminder receipts ----
	@Column('varchar', { length: 512, nullable: true, comment: 'Listing: the external link (registration page, chat group…).' })
	public externalUrl: string | null;

	@Column('varchar', { length: 256, nullable: true, comment: 'Listing: how to reach the organiser.' })
	public contactInfo: string | null;

	@Column('timestamp with time zone', { nullable: true, comment: 'Promote meet: sent once, at this time.' })
	public promotedAt: Date | null;

	@Column('integer', { default: 0 })
	public promotedReach: number;

	@Column('varchar', { length: 8, default: 'GAME', comment: 'GAME | SET — what one score set is called and whether a deciding set is a tiebreaker.' })
	public scoringType: string;

	@Column('varchar', { length: 16, default: 'winLoss', comment: 'winLoss | winPct | setsWon | setsWinPct | totalScore (Reclub CompetitionPointCalculationType).' })
	public standingsMode: string;

	@Column('varchar', { length: 16, array: true, default: '{h2h_wins,score_diff,total_score}', comment: 'Tiebreaker order (Reclub CompetitionTiebreaker).' })
	public tiebreakers: string[];

	@Column('integer', { default: 11, comment: 'Score credited to the winner of a forfeited match.' })
	public forfeitScore: number;

	@Column('integer', { default: 1 })
	public winPoints: number;

	@Column('integer', { default: 0 })
	public lossPoints: number;

	@Column('integer', { default: 0 })
	public drawPoints: number;

	@Column('integer', { default: 1 })
	public tbWinPoints: number;

	@Column('integer', { default: 0 })
	public tbLossPoints: number;

	@Column('timestamp with time zone', { nullable: true })
	public reminded24At: Date | null;

	@Column('timestamp with time zone', { nullable: true })
	public reminded2At: Date | null;

	@Column('timestamp with time zone', { nullable: true })
	public cancelledAt: Date | null;

	@Column('timestamp with time zone', { nullable: true })
	public updatedAt: Date | null;
}

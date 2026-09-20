/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Entity, Column, PrimaryColumn, Index } from 'typeorm';
import { id } from '@/models/util/id.js';
import { MiChannel } from '@/models/Channel.js';
import { MiUser } from '@/models/User.js';

export const clubVisibilities = ['public', 'private'] as const;
export const clubGateTypes = ['open', 'approval', 'invite'] as const;
export const clubCreateMeetPermissions = ['admins', 'members'] as const;
export const clubTagVisibilities = ['all', 'admins'] as const;
/** CLUB-V3: Reclub GroupTag — a named tag with a visibility, an order, and per-member expiry (GroupTagUser.expiredAt). */
export interface ClubTag { id: string; name: string; visibility: typeof clubTagVisibilities[number]; order: number; members: Record<string, string | null> }
/** CLUB-V3: one award on the club's showcase (a tournament placement, a league title…). */
export interface ClubAward { title: string; event: string | null; date: string | null; placement: string | null }

/**
 * CLUB-ADMIN-V1: Reclub's Group settings on top of a Misskey channel (the club). Membership is club_member
 * (CLUB-TIERS-V1; channel_following is the FOLLOWER tier — see modules/clubs/club-tiers.ts);
 * this row adds what a club owner manages — visibility, how people get in, who may create meets, the sport and
 * level, the admins, per-member tags (Reclub group tags), the venues the club plays at.
 */
@Entity('club_setting')
export class MiClubSetting {
	@PrimaryColumn(id())
	public channelId: MiChannel['id'];

	@Column('varchar', { length: 16, default: 'public' })
	public visibility: typeof clubVisibilities[number];

	@Column('varchar', { length: 16, default: 'open' })
	public gateType: typeof clubGateTypes[number];

	@Column('varchar', { length: 16, default: 'members' })
	public createMeetPermission: typeof clubCreateMeetPermissions[number];

	@Column('varchar', { length: 32, default: 'pickleball' })
	public sport: string;

	@Column('varchar', { length: 64, nullable: true, comment: 'level band the club plays at, free text ("3.0–4.0", "All levels")' })
	public level: string | null;

	@Column('varchar', { array: true, length: 32, default: '{}' })
	public adminIds: MiUser['id'][];

	@Column('jsonb', { default: {}, comment: 'userId → tags[] (Reclub group tags: "coach", "committee", "paid 2026"…)' })
	public memberTags: Record<string, string[]>;

	@Column('varchar', { array: true, length: 32, default: '{}' })
	public venueIds: string[];

	@Column('varchar', { length: 512, nullable: true, comment: 'payment info shown to members (Reclub paymentInfo)' })
	public paymentInfo: string | null;

	@Column('boolean', { default: true })
	public enableForum: boolean;

	@Column('boolean', { default: true })
	public enableChat: boolean;

	@Column('varchar', { length: 32, nullable: true, comment: 'the club\'s chat room (CLUB-CHAT-V1), minted on first open' })
	public chatRoomId: string | null;

	// ---- CLUB-V3 ----
	@Column('varchar', { length: 8, nullable: true, comment: 'CLUB-V3: the six-char club code (Reclub "ID: <refCode>", join by code)' })
	public refCode: string | null;

	@Column('varchar', { length: 32, nullable: true, comment: 'CLUB-V3: the ?at= invite token — lets a person join a private / invite-only club from the link' })
	public accessToken: string | null;

	@Column('jsonb', { default: [], comment: 'CLUB-V3: Reclub GroupTag list — { id, name, visibility: all|admins, order, members: { userId: expiresAt|null } }' })
	public tags: ClubTag[];

	@Column('jsonb', { default: [], comment: 'CLUB-V3: the club\'s awards showcase — [{ title, event, date, placement }]' })
	public awards: ClubAward[];

	@Column('timestamp with time zone', { default: () => 'now()' })
	public updatedAt: Date;
}

/** CLUB-V3: what one member set for one club — Pin to home, Take a break, the "Message admins" thread. */
@Entity('club_member_state')
@Index(['channelId', 'userId'], { unique: true })
export class MiClubMemberState {
	@PrimaryColumn(id())
	public id: string;

	@Column(id())
	public channelId: MiChannel['id'];

	@Index()
	@Column(id())
	public userId: MiUser['id'];

	// NUKE-CLUB-PIN-V1: pinnedAt is gone — "Pin to home screen" IS the native channel favourite (channel_favorite,
	// channels/favorite / channels/unfavorite / channels/my-favorites, and Channel.isFavorited on every packed club).
	@Column('timestamp with time zone', { nullable: true, comment: 'Reclub is_active=false ("Take a break"): hidden from rosters, no club notifications, no auto-invites until resumed' })
	public pausedAt: Date | null;

	@Column('varchar', { length: 32, nullable: true, comment: 'the chat room with the club\'s admins ("Message admins"), minted on first open' })
	public adminRoomId: string | null;

	@Column('timestamp with time zone', { default: () => 'now()' })
	public updatedAt: Date;
}

export const clubJoinRequestStatuses = ['pending', 'approved', 'declined'] as const;

/** A person asking to join an approval-gated club. */
@Entity('club_join_request')
@Index(['channelId', 'userId'], { unique: true })
export class MiClubJoinRequest {
	@PrimaryColumn(id())
	public id: string;

	@Index()
	@Column(id())
	public channelId: MiChannel['id'];

	@Column(id())
	public userId: MiUser['id'];

	@Column('varchar', { length: 16, default: 'pending' })
	public status: typeof clubJoinRequestStatuses[number];

	@Column('varchar', { length: 512, nullable: true })
	public message: string | null;

	@Column({ ...id(), nullable: true })
	public decidedById: MiUser['id'] | null;

	@Column('timestamp with time zone', { nullable: true })
	public decidedAt: Date | null;

	@Column('timestamp with time zone', { default: () => 'now()' })
	public createdAt: Date;
}

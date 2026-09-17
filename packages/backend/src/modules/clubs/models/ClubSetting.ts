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

/**
 * CLUB-ADMIN-V1: Reclub's Group settings on top of a Misskey channel (the club). Membership stays channel_following;
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

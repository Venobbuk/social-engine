/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Entity, Column, PrimaryColumn, Index, ManyToOne, JoinColumn } from 'typeorm';
import { id } from '@/models/util/id.js';
import { MiMeet } from './Meet.js';
import { MiChannel } from '@/models/Channel.js';

/**
 * MEET-V4-RECLUB: Reclub MeetGroup{groupId, groupTagIds}. Many clubs per meet, each with a tag filter — members of
 * the club carrying any of `tags` are auto-invited ("Members of your club with the selected tags will automatically
 * be invited and notified"). A club here is a channel. Private + a group row is what "club meet" means.
 */
@Entity('meet_group')
export class MiMeetGroup {
	@PrimaryColumn(id())
	public meetId: MiMeet['id'];

	@ManyToOne(() => MiMeet, { onDelete: 'CASCADE' })
	@JoinColumn()
	public meet: MiMeet | null;

	@Index()
	@PrimaryColumn(id())
	public channelId: MiChannel['id'];

	@ManyToOne(() => MiChannel, { onDelete: 'CASCADE' })
	@JoinColumn()
	public channel: MiChannel | null;

	@Column('varchar', { length: 64, array: true, default: '{}' })
	public tags: string[];

	@Column('timestamp with time zone', { default: () => 'now()' })
	public invitedAt: Date;

	@Column('timestamp with time zone', { nullable: true, comment: '"Are you sure to cancel invitation to {{groupName}}?"' })
	public cancelledAt: Date | null;
}

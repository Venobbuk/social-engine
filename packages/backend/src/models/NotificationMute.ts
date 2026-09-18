/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { PrimaryColumn, Entity, Index, Column } from 'typeorm';
import { id } from './util/id.js';
import { MiUser } from './User.js';

/** CHAT-V2 — every "notifications off" switch of one account in one row shape (Reclub ChannelUserNotifications.None
 *  for a thread; the settings toggles for the app-level kinds).
 *   scope 'room'     targetId = chat room id      — a meet / club / group thread
 *   scope 'user'     targetId = the other user id — a 1-on-1 thread
 *   scope 'club' | 'chat' | 'promoted' | 'updates'   targetId = ''  — the settings page toggles
 *  A row present = muted. No row = notifications on (the default). */
export const notificationMuteScopes = ['room', 'user', 'club', 'chat', 'promoted', 'updates'] as const;
export type NotificationMuteScope = typeof notificationMuteScopes[number];

@Entity('notification_mute')
@Index(['userId', 'scope', 'targetId'], { unique: true })
export class MiNotificationMute {
	@PrimaryColumn(id())
	public id: string;

	@Index()
	@Column({
		...id(),
	})
	public userId: MiUser['id'];

	@Column('varchar', {
		length: 16,
	})
	public scope: NotificationMuteScope;

	@Column('varchar', {
		length: 32, default: '',
	})
	public targetId: string;

	@Column('timestamp with time zone', {
		default: () => 'now()',
	})
	public createdAt: Date;
}

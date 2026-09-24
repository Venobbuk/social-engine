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
 *   scope 'meets'    targetId = ''  — ACCOUNT-BUGS-V1: Settings › Meet updates (modules/meets/meet-updates-mute.ts)
 *   scope 'social'   targetId = ''  — SOCIAL-NOTIF-V1: Settings › Social (kudos, feedback, awards; modules/account/social-mute.ts)
 *   scope 'promotedClub' targetId = '' — SOCIAL-NOTIF-V1: Settings › Promoted club meets (meets/promote audience 'club');
 *                    'promoted' is now Promoted community meets (audience 'all' / 'proximity')
 *   scope 'clubMeets' targetId = the club (channel id) — CLUB-TIERS-V1: "tell me about new meets" of one club, for a
 *                    follower and a member alike (the row belongs to the person, so joining keeps it)
 *  A row present = muted. No row = notifications on (the default).
 *  INBOX-ARCHIVE-V1 (2026-09-20) — the same per-account, per-thread flag shape carries the inbox ARCHIVE (Reclub
 *  PUT /channels/{id}/users/{me}/archival): a row present = I archived that thread. It is not a mute — nothing that
 *  reads notification mutes looks at these two scopes (they match only 'room' / 'user' / the toggles by name).
 *   scope 'archiveRoom'  targetId = chat room id
 *   scope 'archiveUser'  targetId = the other user id */
export const notificationMuteScopes = ['room', 'user', 'club', 'chat', 'promoted', 'updates', 'archiveRoom', 'archiveUser', 'clubMeets', 'meets', 'social', 'promotedClub'] as const;
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

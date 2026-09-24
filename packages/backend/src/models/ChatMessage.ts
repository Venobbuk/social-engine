/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { PrimaryColumn, Entity, Index, JoinColumn, Column, ManyToOne } from 'typeorm';
import { id } from './util/id.js';
import { MiUser } from './User.js';
import { MiDriveFile } from './DriveFile.js';
import { MiChatRoom } from './ChatRoom.js';

@Entity('chat_message')
export class MiChatMessage {
	@PrimaryColumn(id())
	public id: string;

	@Index()
	@Column({
		...id(),
	})
	public fromUserId: MiUser['id'];

	@ManyToOne(() => MiUser, {
		onDelete: 'CASCADE',
	})
	@JoinColumn()
	public fromUser: MiUser | null;

	@Index()
	@Column({
		...id(), nullable: true,
	})
	public toUserId: MiUser['id'] | null;

	@ManyToOne(() => MiUser, {
		onDelete: 'CASCADE',
	})
	@JoinColumn()
	public toUser: MiUser | null;

	@Index()
	@Column({
		...id(), nullable: true,
	})
	public toRoomId: MiChatRoom['id'] | null;

	@ManyToOne(() => MiChatRoom, {
		onDelete: 'CASCADE',
	})
	@JoinColumn()
	public toRoom: MiChatRoom | null;

	@Column('varchar', {
		length: 4096, nullable: true,
	})
	public text: string | null;

	@Column('varchar', {
		length: 512, nullable: true,
	})
	public uri: string | null;

	@Column({
		...id(),
		array: true, default: '{}',
	})
	public reads: MiUser['id'][];

	@Column({
		...id(),
		nullable: true,
	})
	public fileId: MiDriveFile['id'] | null;

	@ManyToOne(() => MiDriveFile, {
		onDelete: 'SET NULL',
	})
	@JoinColumn()
	public file: MiDriveFile | null;

	@Column('varchar', {
		length: 1024, array: true, default: '{}',
	})
	public reactions: string[];

	/** CHAT-V2: a card riding on the message — { kind: 'meet', meetId, name, startAt, venueName } (null = plain). */
	@Column('jsonb', {
		nullable: true,
	})
	public attachment: Record<string, any> | null;

	/** CHAT-V2: a system line (Reclub ChannelMessageType.System) — { key, name?, meetId? }; the sender is the room owner. */
	@Column('jsonb', {
		nullable: true,
	})
	public system: Record<string, any> | null;

	/** CHAT-SOFTDELETE-V1 (KUDOS-CHAT-V1): Reclub "Message unsent" / "removed by an admin" + Undelete — the row stays,
	 *  the packers blank it for everyone, the deleter may bring it back (chat/messages/undelete). */
	@Column('timestamp with time zone', {
		nullable: true,
	})
	public deletedAt: Date | null;

	@Column('varchar', {
		length: 32, nullable: true,
	})
	public deletedById: MiUser['id'] | null;
}

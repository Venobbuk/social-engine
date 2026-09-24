/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { ChatService } from '@/core/ChatService.js';
import type { UsersRepository } from '@/models/_.js';

/* CHAT-REPLY-V1 (2026-09-20) — Reclub's "Reply" (message menu → "Replying to …" bar → the quote above the bubble). The
 * reply rides on the message the way CHAT-V2's meet card does: `attachment` = { kind: 'reply', replyId, text, hasFile,
 * fromUserId, name } — a snapshot of the quoted message at send time (the quote draws without a second read, in a
 * room and in a 1-on-1 alike). The quoted message must be in the SAME thread. When the quoted message is deleted
 * (chat/messages/delete) its quotes are blanked to { …, text: null, deleted: true }. One card per message: a reply
 * cannot also carry a meet card. Returns null when the message cannot be quoted here. */
export async function replyAttachment(
	chatService: ChatService,
	usersRepository: UsersRepository,
	replyId: string,
	thread: { roomId: string } | { meId: string; otherId: string },
): Promise<Record<string, any> | null> {
	const m = await chatService.findMessageById(replyId);
	if (m == null || m.system != null || m.deletedAt != null) return null;   // CHAT-SOFTDELETE-V1: no quoting a deleted message
	if ('roomId' in thread) {
		if (m.toRoomId !== thread.roomId) return null;
	} else {
		const pair = (m.fromUserId === thread.meId && m.toUserId === thread.otherId) || (m.fromUserId === thread.otherId && m.toUserId === thread.meId);
		if (!pair) return null;
	}
	const u = await usersRepository.findOneBy({ id: m.fromUserId });
	return {
		kind: 'reply',
		replyId: m.id,
		text: m.text ? m.text.slice(0, 200) : null,
		hasFile: m.fileId != null,
		fromUserId: m.fromUserId,
		name: u ? (u.name ?? u.username) : null,
	};
}

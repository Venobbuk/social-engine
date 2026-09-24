/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { ChatMessagesRepository } from '@/models/_.js';
import type { MiUser } from '@/models/User.js';

/* CHAT-CSAT-V1 (KUDOS-CHAT-V1, E-chat-room.14) — Reclub's support survey (channels:csat.*, CSATSurveyMessage,
 * submitCSATRating): when the GripBat Team closes a conversation it drops a survey bubble into the 1-on-1
 * ("How was your support experience?"), the player answers 1–5 with an optional comment, the bubble then reads
 * "This survey has been submitted." — or "This survey has expired." after CSAT_DAYS.
 * EXTENDS the native 1-on-1 message's `attachment` (CHAT-V2 already carries kind 'meet' / 'reply' there):
 *   { kind: 'csat-ask', expiresAt, answered?, score? }  sent only BY the support account
 *   { kind: 'csat', askId, score, comment }             sent only TO the support account, once per ask, before expiry
 * The support account is the engine user GRIPBAT_SUPPORT_USERNAME (default 'boyau' — the app's SUPPORT_USERNAME).
 * NEW with a record of the search: Misskey has no survey; hkpl's bug-report module is a separate staff inbox with no
 * rating, so nothing to reuse beyond the message itself. */
export const CSAT_DAYS = 7;
export const supportUsername = (): string => process.env.GRIPBAT_SUPPORT_USERNAME || 'boyau';
export const isSupport = (u: Pick<MiUser, 'username' | 'host'> | null | undefined): boolean => !!u && u.host == null && u.username === supportUsername();

export class CsatError extends Error { constructor(public code: 'not_support' | 'no_such_ask' | 'expired' | 'answered' | 'bad_score') { super(code); } }

export function csatAskAttachment(): Record<string, any> {
	return { kind: 'csat-ask', expiresAt: new Date(Date.now() + CSAT_DAYS * 86400000).toISOString() };
}

/** Validate an answer and mark its ask answered; returns the answer's attachment. */
export async function csatAnswer(repo: ChatMessagesRepository, me: MiUser, toUser: MiUser, a: { askId: string; score: number; comment?: string | null }): Promise<Record<string, any>> {
	if (!isSupport(toUser)) throw new CsatError('not_support');
	if (!Number.isInteger(a.score) || a.score < 1 || a.score > 5) throw new CsatError('bad_score');
	const ask = await repo.findOneBy({ id: a.askId });
	if (ask == null || ask.fromUserId !== toUser.id || ask.toUserId !== me.id || !ask.attachment || ask.attachment.kind !== 'csat-ask' || ask.deletedAt) throw new CsatError('no_such_ask');
	if (ask.attachment.answered) throw new CsatError('answered');
	if (new Date(String(ask.attachment.expiresAt)).getTime() < Date.now()) throw new CsatError('expired');
	const comment = a.comment && a.comment.trim() ? a.comment.trim().slice(0, 500) : null;
	await repo.query(`UPDATE "chat_message" SET "attachment" = "attachment" || jsonb_build_object('answered', true, 'score', $2::int) WHERE id = $1`, [ask.id, a.score]);
	return { kind: 'csat', askId: ask.id, score: a.score, comment };
}

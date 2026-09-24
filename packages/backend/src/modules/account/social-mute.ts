/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { DataSource } from 'typeorm';

/* SOCIAL-NOTIF-V1 (lane account-rest, 2026-09-24; Reclub E-notif-settings.04 "Social: reviews, kudos, awards").
 * Settings › Social is a CHAT-V2 settings toggle like 'meets' / 'club' / 'promoted' (notification_mute, scope 'social',
 * targetId '' — EXTENDED, no new table, scope is varchar(16)). It covers the notices about what OTHER players said or gave
 * you: kudos (a review of type endorsement), feedback (type feedback) and a competition award. A warning is never
 * notified — its author is anonymous to the person warned (G15.4) and a ping right after a meet would point at them.
 * Fails OPEN: an unreadable preference never swallows a notice. */
export const SOCIAL_SCOPE = 'social' as const;

export async function socialMuted(db: DataSource, userId: string): Promise<boolean> {
	try {
		const rows = await db.query('SELECT 1 FROM "notification_mute" WHERE "userId" = $1 AND "scope" = $2 AND "targetId" = \'\' LIMIT 1', [userId, SOCIAL_SCOPE]) as unknown[];
		return rows.length > 0;
	} catch {
		return false;
	}
}

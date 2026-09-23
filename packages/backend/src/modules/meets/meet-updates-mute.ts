/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { DataSource } from 'typeorm';

/* ACCOUNT-BUGS-V1 (2026-09-23, L6 verifier S7 E-notif-settings.09) — Settings › "Meet updates (confirmed, invited,
 * cancelled)" had no effect. The app wrote i/update {mutingNotificationTypes:['app']}; this Misskey version dropped
 * that field (i/update has no such param; UserEntityService packs `mutingNotificationTypes: []` for backward
 * compatibility), so the write was silently ignored.
 *
 * Why not Misskey's native notificationRecieveConfig.app (G11 checked: i/update.ts:200-220, enforced at
 * NotificationService.ts:102 `type === 'never'`): EVERY GripBat notice is type 'app' — meets, club activity, coaching,
 * competitions. Muting 'app' would silence all of them and make the separate "Club activity" switch a lie. The four
 * switches that ARE Misskey types (follow / reaction / reply / mention) now use that native field directly (app side).
 *
 * "Meet updates" is therefore the CHAT-V2 settings-toggle shape (notification_mute, scope 'meets', targetId '' — the same
 * row the 'club' / 'promoted' / 'updates' toggles already write through chat/notification-prefs/update): EXTENDED,
 * no new table, no migration (scope is varchar(16)). Honoured by the two meet notification doors: MeetService.notify
 * (confirmed / invited / waitlist / cancelled / changed …) and the meet reminders (MeetSweepProcessorService). The
 * consent ask of a casual game is NOT a meet update — it is the request the game depends on — so it always goes.
 * Promoted meets and a club's new-meet fan-out keep their own switches ('promoted', 'club' / 'clubMeets'). */
export const MEET_UPDATES_SCOPE = 'meets' as const;

/** True when the person switched Meet updates off. Fails OPEN: an unreadable preference never swallows a meet update. */
export async function meetUpdatesMuted(db: DataSource, userId: string): Promise<boolean> {
	try {
		const rows = await db.query('SELECT 1 FROM "notification_mute" WHERE "userId" = $1 AND "scope" = $2 AND "targetId" = \'\' LIMIT 1', [userId, MEET_UPDATES_SCOPE]) as unknown[];
		return rows.length > 0;
	} catch {
		return false;
	}
}

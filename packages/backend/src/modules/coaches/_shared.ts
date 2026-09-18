/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { MiMeetPlayerLevel } from '@/modules/meets/models/MeetPlayerLevel.js';

// DISCOVER-V3 (coach): Reclub's Coach (module 2008: id, userId, sportId, experience, rate, notes, status Active|Inactive)
// packed from the (user, sport) level row — one profile per sport per user, as Reclub.
export const packedCoachSchema = {
	type: 'object', optional: false, nullable: true,
	properties: {
		userId: { type: 'string', optional: false, nullable: false },
		sport: { type: 'string', optional: false, nullable: false },
		status: { type: 'string', optional: false, nullable: false, enum: ['active', 'inactive'] },
		experience: { type: 'string', optional: false, nullable: true },
		rate: { type: 'string', optional: false, nullable: true },
		notes: { type: 'string', optional: false, nullable: true },
		updatedAt: { type: 'string', optional: false, nullable: true },
		user: { type: 'object', optional: true, nullable: true, ref: 'UserLite' },
	},
} as const;

export function packCoach(l: MiMeetPlayerLevel): { userId: string; sport: string; status: 'active' | 'inactive'; experience: string | null; rate: string | null; notes: string | null; updatedAt: string | null } | null {
	if (!l.coachStatus) return null;
	return {
		userId: l.userId,
		sport: l.sport,
		status: l.coachStatus === 'active' ? 'active' : 'inactive',
		experience: l.coachExperience,
		rate: l.coachRate,
		notes: l.coachNotes,
		updatedAt: l.coachUpdatedAt ? l.coachUpdatedAt.toISOString() : null,
	};
}

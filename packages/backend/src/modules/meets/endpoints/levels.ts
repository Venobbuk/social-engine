/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { MeetLevelService } from '@/modules/meets/MeetLevelService.js';

// LEVELS-V1: batch read of the stored player level for a list of users in one sport — the People list's rating chips.
// One query; users with no row for the sport are absent from the answer.
//
// SEC-ANON-FIELDS-V1 (2026-09-20): the rating chip (selfLevel / duprDoubles / duprSingles) is public by design, but a
// player's gender, age group and DUPR id are NOT. They are returned only to a signed-in caller; an anonymous caller
// gets the chip fields alone. (The app must send a session on any screen that needs duprId/gender/age — see report.)
export const meta = {
	tags: ['meets'],
	requireCredential: false,
	kind: 'read:meets',
	res: {
		type: 'array', optional: false, nullable: false,
		items: {
			type: 'object', optional: false, nullable: false,
			properties: {
				userId: { type: 'string', optional: false, nullable: false, format: 'id' },
				sport: { type: 'string', optional: false, nullable: false },
				selfLevel: { type: 'number', optional: false, nullable: true },
				duprDoubles: { type: 'number', optional: false, nullable: true },
				duprSingles: { type: 'number', optional: false, nullable: true },
				duprId: { type: 'string', optional: false, nullable: true },
				gender: { type: 'string', optional: false, nullable: true },
				ageGroup: { type: 'string', optional: false, nullable: true },
			},
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		userIds: { type: 'array', items: { type: 'string', format: 'misskey:id' }, maxItems: 100, uniqueItems: true },
		sport: { type: 'string', minLength: 1, maxLength: 32, default: 'pickleball' },
	},
	required: ['userIds'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private meetLevelService: MeetLevelService,) {
		super(meta, paramDef, async (ps, me) => {
			if (ps.userIds.length === 0) return [];
			const signedIn = me != null; // SEC-ANON-FIELDS-V1: private fields only to a credentialed caller
			const levels = await this.meetLevelService.getLevels(ps.userIds, ps.sport);
			return levels.map((level) => ({
				userId: level.userId,
				sport: level.sport,
				selfLevel: level.selfLevel,
				duprDoubles: level.duprDoubles,
				duprSingles: level.duprSingles,
				duprId: signedIn ? level.duprId : null, // DUPR-HKPL-V1: the app opens hkpl's DUPR profile with it
				gender: signedIn ? level.gender : null,
				ageGroup: signedIn ? level.ageGroup : null,
			}));
		});
	}
}

/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { MeetLevelService } from '@/modules/meets/MeetLevelService.js';

// The signed-in player sets their own self rating / gender / age group for a sport (DUPR values come from the host adapter).
export const meta = {
	tags: ['meets'],
	requireCredential: true,
	prohibitMoved: true,
	kind: 'write:meets',
	res: {
		type: 'object', optional: false, nullable: false,
		properties: {
			sport: { type: 'string', optional: false, nullable: false },
			selfLevel: { type: 'number', optional: false, nullable: true },
			duprSingles: { type: 'number', optional: false, nullable: true },
			duprDoubles: { type: 'number', optional: false, nullable: true },
			gender: { type: 'string', optional: false, nullable: true },
			ageGroup: { type: 'string', optional: false, nullable: true },
			onboarded: { type: 'boolean', optional: false, nullable: false },
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		sport: { type: 'string', minLength: 1, maxLength: 32, default: 'pickleball' },
		selfLevel: { type: 'number', nullable: true, minimum: 0, maximum: 10 },
		gender: { type: 'string', nullable: true, enum: ['male', 'female', 'nonbinary'] },
		ageGroup: { type: 'string', nullable: true, enum: ['junior', 'adult', 'senior'] },
		// ONBOARDED-V1: true stamps onboardedAt (once; later trues keep the first stamp). false/absent leaves it alone.
		onboarded: { type: 'boolean' },
	},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private meetLevelService: MeetLevelService,) {
		super(meta, paramDef, async (ps, me) => {
			const patch: Record<string, unknown> = {};
			if (ps.selfLevel !== undefined) patch.selfLevel = ps.selfLevel;
			if (ps.gender !== undefined) patch.gender = ps.gender;
			if (ps.ageGroup !== undefined) patch.ageGroup = ps.ageGroup;
			if (ps.onboarded === true) {
				const current = await this.meetLevelService.getLevel(me.id, ps.sport);
				if (current?.onboardedAt == null) patch.onboardedAt = new Date();
			}
			const level = await this.meetLevelService.upsertLevel(me.id, ps.sport, patch);
			return {
				sport: level.sport,
				selfLevel: level.selfLevel,
				duprSingles: level.duprSingles,
				duprDoubles: level.duprDoubles,
				gender: level.gender,
				ageGroup: level.ageGroup,
				onboarded: !!level.onboardedAt,
			};
		});
	}
}

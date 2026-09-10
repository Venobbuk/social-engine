/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { MeetService } from '@/core/MeetService.js';

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
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		sport: { type: 'string', minLength: 1, maxLength: 32, default: 'pickleball' },
		selfLevel: { type: 'number', nullable: true, minimum: 0, maximum: 10 },
		gender: { type: 'string', nullable: true, enum: ['male', 'female', 'nonbinary', null] },
		ageGroup: { type: 'string', nullable: true, enum: ['junior', 'adult', 'senior', null] },
	},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private meetService: MeetService) {
		super(meta, paramDef, async (ps, me) => {
			const patch: Record<string, unknown> = {};
			if (ps.selfLevel !== undefined) patch.selfLevel = ps.selfLevel;
			if (ps.gender !== undefined) patch.gender = ps.gender;
			if (ps.ageGroup !== undefined) patch.ageGroup = ps.ageGroup;
			const level = await this.meetService.upsertLevel(me.id, ps.sport, patch);
			return {
				sport: level.sport,
				selfLevel: level.selfLevel,
				duprSingles: level.duprSingles,
				duprDoubles: level.duprDoubles,
				gender: level.gender,
				ageGroup: level.ageGroup,
			};
		});
	}
}

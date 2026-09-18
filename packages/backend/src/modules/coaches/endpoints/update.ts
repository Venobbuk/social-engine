/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DI } from '@/di-symbols.js';
import type { MeetPlayerLevelsRepository } from '@/models/_.js';
import { IdService } from '@/core/IdService.js';
import { packedCoachSchema, packCoach } from '../_shared.js';

// DISCOVER-V3 (coach): Reclub POST /coaches + PUT /coaches/<id> + DELETE /coaches/<id> (manage-coach-profile, module
// 5851: "What is your experience?", "What is your rate?", "Do you have any other notes?", Active/Inactive switch,
// "Delete coach profile"). One call: creates the (user, sport) level row if absent, patches the coach fields;
// `remove: true` clears the profile (status null).
export const meta = {
	tags: ['coaches'],
	requireCredential: true,
	prohibitMoved: true,
	kind: 'write:meets',
	res: packedCoachSchema,
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		sport: { type: 'string', minLength: 1, maxLength: 32, default: 'pickleball' },
		status: { type: 'string', nullable: true, enum: ['active', 'inactive'] },
		experience: { type: 'string', nullable: true, maxLength: 2048 },
		rate: { type: 'string', nullable: true, maxLength: 256 },
		notes: { type: 'string', nullable: true, maxLength: 2048 },
		remove: { type: 'boolean', default: false },
	},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.meetPlayerLevelsRepository)
		private meetPlayerLevelsRepository: MeetPlayerLevelsRepository,
		private idService: IdService,
	) {
		super(meta, paramDef, async (ps, me) => {
			let row = await this.meetPlayerLevelsRepository.findOneBy({ userId: me.id, sport: ps.sport });
			if (!row) {
				row = await this.meetPlayerLevelsRepository.insertOne({
					id: this.idService.gen(), userId: me.id, sport: ps.sport, selfLevel: null, duprSingles: null, duprDoubles: null, duprId: null,
					gender: null, ageGroup: null, source: null, updatedAt: null, onboardedAt: null,
					coachStatus: null, coachExperience: null, coachRate: null, coachNotes: null, coachUpdatedAt: null,
				});
			}
			const patch: Record<string, unknown> = { coachUpdatedAt: new Date() };
			if (ps.remove) {
				Object.assign(patch, { coachStatus: null, coachExperience: null, coachRate: null, coachNotes: null });
			} else {
				if (ps.status !== undefined && ps.status !== null) patch.coachStatus = ps.status;
				else if (!row.coachStatus) patch.coachStatus = 'active';   // creating = active (Reclub CoachStatus.Active default)
				if (ps.experience !== undefined) patch.coachExperience = ps.experience;
				if (ps.rate !== undefined) patch.coachRate = ps.rate;
				if (ps.notes !== undefined) patch.coachNotes = ps.notes;
			}
			await this.meetPlayerLevelsRepository.update(row.id, patch);
			const fresh = await this.meetPlayerLevelsRepository.findOneByOrFail({ id: row.id });
			return packCoach(fresh);
		});
	}
}

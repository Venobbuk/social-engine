/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { CoachScheduleService, type CoachSchedulePatch } from '@/modules/coaches/CoachScheduleService.js';
import { coachErrors, toApiError } from './_shared.js';

// COACHING-V1 — edit a lesson slot (owner or club admin). Re-tiering never re-prices a booked student.
export const meta = { tags: ['coaches'], requireCredential: true, kind: 'write:account', res: { type: 'object', optional: false, nullable: false }, errors: coachErrors } as const;

const priceBand = { type: 'object', properties: { minParticipants: { type: 'integer', minimum: 1 }, maxParticipants: { type: 'integer', minimum: 1 }, pricePerPerson: { type: 'integer', minimum: 0 }, currency: { type: 'string', maxLength: 3 } }, required: ['minParticipants', 'maxParticipants', 'pricePerPerson'] } as const;

export const paramDef = {
	type: 'object',
	properties: {
		scheduleId: { type: 'string', format: 'misskey:id' },
		name: { type: 'string', maxLength: 128 }, sport: { type: 'string', maxLength: 32 },
		weekday: { type: 'integer', minimum: 1, maximum: 7 }, startTime: { type: 'string', maxLength: 5 }, durationMinutes: { type: 'integer', minimum: 15, maximum: 1440 }, timezone: { type: 'string', maxLength: 64 },
		venueId: { type: 'string', nullable: true }, venueName: { type: 'string', nullable: true, maxLength: 256 }, venueAddress: { type: 'string', nullable: true, maxLength: 512 }, lat: { type: 'number', nullable: true }, lng: { type: 'number', nullable: true },
		capacity: { type: 'integer', minimum: 1, maximum: 50 }, bookingMode: { type: 'string', enum: ['single', 'series', 'pack', 'several'] }, packSize: { type: 'integer', nullable: true, minimum: 2, maximum: 52 },
		priceTiers: { type: 'array', items: priceBand, maxItems: 3 }, cancellationPolicy: { type: 'object', properties: { windowHours: { type: 'integer', minimum: 0, maximum: 336 } } },
		paymentInfo: { type: 'string', nullable: true, maxLength: 512 }, visibility: { type: 'string', enum: ['public', 'private'] }, autoApprove: { type: 'boolean' },
		gateType: { type: 'string', enum: ['guidance', 'autoApprove', 'strict'] }, levelBasis: { type: 'string', enum: ['self', 'duprSingles', 'duprDoubles'] }, minLevel: { type: 'number', nullable: true }, maxLevel: { type: 'number', nullable: true },
		gender: { type: 'string', enum: ['any', 'coed', 'female', 'male'] }, ageGroup: { type: 'string', enum: ['any', 'junior', 'adult', 'senior'] }, publishLeadHours: { type: 'integer', minimum: 1, maximum: 672 },
		status: { type: 'string', enum: ['active', 'paused'] }, tagIds: { type: 'array', items: { type: 'string' }, maxItems: 20 }, notes: { type: 'string', nullable: true, maxLength: 4096 }, sendNotifications: { type: 'boolean' },
	},
	required: ['scheduleId'],
} as const;

const KEYS = ['name', 'sport', 'weekday', 'startTime', 'durationMinutes', 'timezone', 'venueId', 'venueName', 'venueAddress', 'lat', 'lng', 'capacity', 'bookingMode', 'packSize', 'priceTiers', 'cancellationPolicy', 'paymentInfo', 'visibility', 'autoApprove', 'gateType', 'levelBasis', 'minLevel', 'maxLevel', 'gender', 'ageGroup', 'publishLeadHours', 'status', 'tagIds', 'notes', 'sendNotifications'] as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private coachScheduleService: CoachScheduleService) {
		super(meta, paramDef, async (ps, me) => {
			try {
				const s = await this.coachScheduleService.get(ps.scheduleId);
				const patch: Record<string, unknown> = {};
				for (const k of KEYS) if ((ps as Record<string, unknown>)[k] !== undefined) patch[k] = (ps as Record<string, unknown>)[k];
				const fresh = await this.coachScheduleService.update(me, s, patch as CoachSchedulePatch);
				return await this.coachScheduleService.packSchedule(fresh, me);
			} catch (e) { return toApiError(e); }
		});
	}
}

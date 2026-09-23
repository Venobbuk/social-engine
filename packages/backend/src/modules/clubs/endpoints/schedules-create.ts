/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ClubService } from '@/modules/clubs/ClubService.js';
import { clubErrors, toApiError } from '@/modules/clubs/endpoints/_shared.js';
import { ClubScheduleService } from '@/modules/clubs/ClubScheduleService.js';

// CLUB-V3 — see modules/clubs/ClubService.ts / ClubScheduleService.ts
export const meta = {
	tags: ['clubs'],
	requireCredential: true,
	kind: 'write:channels',
	res: { type: 'object', optional: false, nullable: false },
	errors: clubErrors,
} as const;

export const paramDef = {
	type: 'object',
	properties: { channelId: { type: 'string', format: 'misskey:id' }, name: { type: 'string', maxLength: 128 }, weekday: { type: 'integer', minimum: 1, maximum: 7 }, startTime: { type: 'string', maxLength: 5 }, durationMinutes: { type: 'integer', minimum: 15, maximum: 1440 }, venueId: { type: 'string', nullable: true }, venueName: { type: 'string', nullable: true, maxLength: 256 }, venueAddress: { type: 'string', nullable: true, maxLength: 512 }, lat: { type: 'number', nullable: true }, lng: { type: 'number', nullable: true }, capacity: { type: 'integer', minimum: 1, maximum: 500 }, hostPlays: { type: 'boolean' }, visibility: { type: 'string', enum: ['public', 'private'] }, autoApprove: { type: 'boolean' }, allowPlusOne: { type: 'boolean' }, feeType: { type: 'string', enum: ['none', 'free', 'perPax', 'autoSplit'] }, feeAmount: { type: 'integer', nullable: true, minimum: 0 }, feeCurrency: { type: 'string', maxLength: 3 }, paymentInfo: { type: 'string', nullable: true, maxLength: 512 }, gateType: { type: 'string', enum: ['guidance', 'autoApprove', 'strict'] }, levelBasis: { type: 'string', enum: ['self', 'duprSingles', 'duprDoubles'] }, minLevel: { type: 'number', nullable: true }, maxLevel: { type: 'number', nullable: true }, gender: { type: 'string', enum: ['any', 'coed', 'female', 'male'] }, ageGroup: { type: 'string', enum: ['any', 'junior', 'adult', 'senior'] }, submitMatches: { type: 'boolean' }, publishLeadHours: { type: 'integer', minimum: 1, maximum: 672 }, status: { type: 'string', enum: ['active', 'paused'] }, tagIds: { type: 'array', items: { type: 'string' }, maxItems: 20 }, type: { type: 'string', enum: ['managed', 'listing'] }, duprAccountGate: { type: 'string', enum: ['guidance', 'autoApprove', 'strict'] }, cancellationFreezeHours: { type: 'integer', minimum: 0, maximum: 168 }, participants: { type: 'array', maxItems: 20, items: { type: 'object', properties: { userId: { type: 'string', format: 'misskey:id' }, role: { type: 'string', enum: ['host', 'coach', 'player', 'paymentCollector'] } }, required: ['userId', 'role'] } }, notes: { type: 'string', nullable: true, maxLength: 4096 }, sendNotifications: { type: 'boolean' } },
	required: ["channelId","name","weekday","startTime"],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private clubService: ClubService, private clubScheduleService: ClubScheduleService) {
		super(meta, paramDef, async (ps, me) => {
			try {
				// Reclub POST /schedules (CREATE SCHEDULE) — then the sweep (or clubs/schedules/run) publishes the meets
				const c = await this.clubService.channel(ps.channelId);
				const data: Record<string, unknown> = {};
				for (const k of ['name', 'weekday', 'startTime', 'durationMinutes', 'venueId', 'venueName', 'venueAddress', 'lat', 'lng', 'capacity', 'hostPlays', 'visibility', 'autoApprove', 'allowPlusOne', 'feeType', 'feeAmount', 'feeCurrency', 'paymentInfo', 'gateType', 'levelBasis', 'minLevel', 'maxLevel', 'gender', 'ageGroup', 'submitMatches', 'publishLeadHours', 'status', 'tagIds', 'notes', 'sendNotifications', 'type', 'duprAccountGate', 'cancellationFreezeHours', 'participants'] as const) if (ps[k] !== undefined) data[k] = ps[k];
				const s = await this.clubScheduleService.create(c, me, data as Parameters<ClubScheduleService['create']>[2]);
				return await this.clubScheduleService.pack(s, me);
			} catch (e) {
				return toApiError(e);
			}
		});
	}
}

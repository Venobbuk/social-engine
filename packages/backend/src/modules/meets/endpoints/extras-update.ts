/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { MeetsRepository } from '@/models/_.js';
import type { MiMeet } from '@/modules/meets/models/Meet.js';
import { DI } from '@/di-symbols.js';
import { MeetService } from '@/modules/meets/MeetService.js';
import { MeetEntityService } from '@/modules/meets/MeetEntityService.js';
import { ApiError } from '@/server/api/error.js';
import { SCORING_TYPES, STANDINGS_MODES, TIEBREAKERS } from '@/modules/meets/MeetExtras.js';
import { meetErrors, toApiError } from './_shared.js';

/**
 * MEET-EXTRAS-V1 — the host's extra settings, kept off meets/update so the shared param table stays other streams':
 *   listing details   externalUrl (a link) + contactInfo (how to reach the organiser) — Reclub "Meet listing"
 *   scoring rules     scoringType GAME|SET, standingsMode, tiebreakers (ordered, ≤ 4, distinct), forfeitScore,
 *                     win/loss/draw and tiebreaker win/loss point values (Reclub match-format §4.6)
 * Host only. Answers the packed meet.
 */
export const meta = {
	tags: ['meets'],
	requireCredential: true,
	prohibitMoved: true,
	kind: 'write:meets',
	res: { type: 'object', optional: false, nullable: false, ref: 'Meet' },
	errors: { ...meetErrors },
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		meetId: { type: 'string', format: 'misskey:id' },
		externalUrl: { type: 'string', nullable: true, maxLength: 512 },
		contactInfo: { type: 'string', nullable: true, maxLength: 256 },
		scoringType: { type: 'string', enum: [...SCORING_TYPES] },
		standingsMode: { type: 'string', enum: [...STANDINGS_MODES] },
		tiebreakers: { type: 'array', maxItems: 4, items: { type: 'string', enum: [...TIEBREAKERS] } },
		forfeitScore: { type: 'integer', minimum: 0, maximum: 99 },
		winPoints: { type: 'integer', minimum: -10, maximum: 10 },
		lossPoints: { type: 'integer', minimum: -10, maximum: 10 },
		drawPoints: { type: 'integer', minimum: -10, maximum: 10 },
		tbWinPoints: { type: 'integer', minimum: -10, maximum: 10 },
		tbLossPoints: { type: 'integer', minimum: -10, maximum: 10 },
	},
	required: ['meetId'],
} as const;

const KEYS = ['externalUrl', 'contactInfo', 'scoringType', 'standingsMode', 'tiebreakers', 'forfeitScore', 'winPoints', 'lossPoints', 'drawPoints', 'tbWinPoints', 'tbLossPoints'] as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.meetsRepository)
		private meetsRepository: MeetsRepository,
		private meetService: MeetService,
		private meetEntityService: MeetEntityService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const meet = await this.meetsRepository.findOneBy({ id: ps.meetId });
			if (meet == null) throw new ApiError(meta.errors.noSuchMeet);
			try { await this.meetService.assertHost(meet, me); } catch (e) { return toApiError(e); }
			const patch: Partial<MiMeet> = {};
			const src = ps as Record<string, unknown>;
			for (const k of KEYS) if (src[k] !== undefined) (patch as Record<string, unknown>)[k] = src[k];
			if (patch.tiebreakers) patch.tiebreakers = Array.from(new Set(patch.tiebreakers));
			if (typeof patch.externalUrl === 'string') {
				const u = patch.externalUrl.trim();
				patch.externalUrl = u === '' ? null : /^https?:\/\//i.test(u) ? u : 'https://' + u;
			}
			if (typeof patch.contactInfo === 'string') patch.contactInfo = patch.contactInfo.trim() || null;
			if (Object.keys(patch).length) await this.meetsRepository.update(meet.id, { ...patch, updatedAt: new Date() });
			return await this.meetEntityService.pack(meet.id, me, { detailed: true });
		});
	}
}

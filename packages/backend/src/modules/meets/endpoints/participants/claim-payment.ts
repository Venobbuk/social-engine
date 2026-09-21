/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { MeetsRepository, MeetParticipantsRepository } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import { MeetMatchService } from '@/modules/meets/MeetMatchService.js';
import { MeetEntityService } from '@/modules/meets/MeetEntityService.js';
import { MeetService } from '@/modules/meets/MeetService.js';
import { ApiError } from '@/server/api/error.js';
import { meetErrors, toApiError } from '../_shared.js';

// PLAYER-PAYS-V1 — the player's half of Reclub's payment loop. COPIED FROM participants/receipt.ts: the same
// "the host, or the player for their own row" gate (receipt.ts:63), the same notify-the-host line (receipt.ts:70),
// the same packParticipant return. Only the field written differs.
//
// The host's mark is the existing 'paid' tag, set through participants/update (assertHost) — untouched, still the
// only authoritative record of payment. This endpoint writes 'paidClaim': "the player says they have paid".
// Two tags, two authors, no ambiguity — the host confirms a claim by adding 'paid', which is the button the
// Payments Manager already has. Nothing here processes money: GripBat takes no card data and runs no gateway.
//
// 'paidClaim' rides the existing meet_participant.tags varchar(32)[] — no column, no migration.
export const meta = {
	tags: ['meets'],
	requireCredential: true,
	prohibitMoved: true,
	kind: 'write:meets',
	res: { type: 'object', optional: false, nullable: false, ref: 'MeetParticipant' },
	errors: {
		notCharging: { message: 'This meet has no fee to pay.', code: 'NOT_CHARGING', id: '6b1d0a3e-8f41-4c0b-9b7e-1a0000000031' },
		...meetErrors,
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		meetId: { type: 'string', format: 'misskey:id' },
		participantId: { type: 'string', format: 'misskey:id' },
		claimed: { type: 'boolean' },
		// how they say they paid. Optional: absence means they did not say. NULL-ENUM-V1 — no `nullable: true`
		// on an enum (ajv checks the enum and null is not in it); omit the key instead.
		method: { type: 'string', enum: ['cash', 'digital'] },
	},
	required: ['meetId', 'participantId', 'claimed'],
} as const;

const METHODS = ['cash', 'digital'];

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.meetsRepository)
		private meetsRepository: MeetsRepository,
		@Inject(DI.meetParticipantsRepository)
		private meetParticipantsRepository: MeetParticipantsRepository,
		private meetMatchService: MeetMatchService,
		private meetEntityService: MeetEntityService,
		private meetService: MeetService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const meet = await this.meetsRepository.findOneBy({ id: ps.meetId });
			if (meet == null) throw new ApiError(meta.errors.noSuchMeet);
			const p = await this.meetParticipantsRepository.findOneBy({ id: ps.participantId, meetId: meet.id });
			if (p == null) throw new ApiError(meta.errors.noSuchParticipant);
			// receipt.ts:63 — the host, or the player for their own row. Nobody else claims on someone's behalf.
			const host = await this.meetMatchService.isHost(meet, me);
			if (!host && p.userId !== me.id) throw new ApiError(meta.errors.notHost);
			if (meet.feeType === 'free' || meet.feeType === 'none') throw new ApiError(meta.errors.notCharging);
			try {
				const keep = p.tags.filter(t => t !== 'paidClaim' && !METHODS.includes(t));
				// the host's own 'paid' / 'feeWaived' / ... marks are in `keep` and survive untouched
				const tags = ps.claimed
					? [...keep, 'paidClaim', ...(ps.method ? [ps.method] : [])]
					: keep;
				await this.meetParticipantsRepository.update(p.id, { tags });
				// receipt.ts:70 — a player's claim reaches the host, who confirms it in the Payments Manager
				if (ps.claimed && !host && meet.hostId !== me.id) {
					this.meetService.notifyUser(meet.hostId, meet, 'Payment marked', `${me.name ?? me.username} marked themselves paid for ${meet.name}.`);
				}
				const row = await this.meetParticipantsRepository.findOneByOrFail({ id: p.id });
				return await this.meetEntityService.packParticipant(row, meet, me);
			} catch (e) {
				return toApiError(e);
			}
		});
	}
}

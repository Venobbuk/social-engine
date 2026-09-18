/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { In } from 'typeorm';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { MeetsRepository, MeetParticipantsRepository, UsersRepository } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import { MeetService } from '@/modules/meets/MeetService.js';
import { MeetEntityService } from '@/modules/meets/MeetEntityService.js';
import { meetParticipantTags } from '@/modules/meets/models/MeetParticipant.js';
import { ChatService } from '@/core/ChatService.js';
import { ApiError } from '@/server/api/error.js';
import { meetErrors, toApiError } from '../_shared.js';

// HOST-TOOLS-V1 — Reclub "Bulk actions" (spec_meets.md §3.5: PUT /participants/bulk {tag, team_id, participant_ids}):
// pick many participants, then tag them / assign a team / assign a court / send them all a direct message.
// A tag replaces the others of its group (paid ↔ unpaid; cash / digital / …; checked in / late / no show / excused).
export const meta = {
	tags: ['meets'],
	requireCredential: true,
	prohibitMoved: true,
	kind: 'write:meets',
	res: {
		type: 'object', optional: false, nullable: false,
		properties: {
			updated: { type: 'number', optional: false, nullable: false },
			messaged: { type: 'number', optional: false, nullable: false },
			meet: { type: 'object', optional: false, nullable: false, ref: 'Meet' },
		},
	},
	errors: { ...meetErrors },
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		meetId: { type: 'string', format: 'misskey:id' },
		participantIds: { type: 'array', items: { type: 'string', format: 'misskey:id' }, minItems: 1, maxItems: 200, uniqueItems: true },
		tag: { type: 'string', nullable: true, enum: [...meetParticipantTags] },
		untag: { type: 'boolean', default: false },
		teamKey: { type: 'string', nullable: true, maxLength: 32 },
		clearTeam: { type: 'boolean', default: false },
		courtIndex: { type: 'integer', nullable: true, minimum: 0, maximum: 64 },
		clearCourt: { type: 'boolean', default: false },
		message: { type: 'string', nullable: true, minLength: 1, maxLength: 2000 },
	},
	required: ['meetId', 'participantIds'],
} as const;

const TAG_GROUPS: string[][] = [['paid', 'unpaid'], ['cash', 'digital', 'membership', 'punch', 'feeWaived', 'refunded'], ['checkedIn', 'late', 'noShow', 'excused']];

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.meetsRepository)
		private meetsRepository: MeetsRepository,
		@Inject(DI.meetParticipantsRepository)
		private meetParticipantsRepository: MeetParticipantsRepository,
		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,
		private meetService: MeetService,
		private meetEntityService: MeetEntityService,
		private chatService: ChatService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const meet = await this.meetsRepository.findOneBy({ id: ps.meetId });
			if (meet == null) throw new ApiError(meta.errors.noSuchMeet);
			try {
				await this.meetService.assertHost(meet, me);
				const rows = await this.meetParticipantsRepository.find({ where: { meetId: meet.id, id: In(ps.participantIds) } });
				let updated = 0, messaged = 0;
				for (const p of rows) {
					const patch: Record<string, unknown> = {};
					if (ps.tag) {
						const group = TAG_GROUPS.find(g => g.includes(ps.tag as string)) ?? [ps.tag];
						const tags = ps.untag ? p.tags.filter(t => t !== ps.tag) : [...p.tags.filter(t => !group.includes(t)), ps.tag];
						if (ps.tag === 'checkedIn' && !ps.untag) patch.checkedInAt = new Date();
						patch.tags = tags;
					}
					if (ps.teamKey) patch.teamKey = ps.teamKey;
					if (ps.clearTeam) patch.teamKey = null;
					if (ps.courtIndex != null) patch.courtIndex = ps.courtIndex;
					if (ps.clearCourt) patch.courtIndex = null;
					if (Object.keys(patch).length) { await this.meetParticipantsRepository.update(p.id, patch); updated++; }
					if (ps.message && p.userId && p.userId !== me.id) {
						try {
							const to = await this.usersRepository.findOneBy({ id: p.userId });
							if (to) { await this.chatService.createMessageToUser(me, to, { text: ps.message }); messaged++; }
						} catch { /* a closed inbox (chatScope) is that player's choice; the rest still get it */ }
					}
				}
				return { updated, messaged, meet: await this.meetEntityService.pack(meet.id, me, { detailed: true }) };
			} catch (e) {
				return toApiError(e);
			}
		});
	}
}

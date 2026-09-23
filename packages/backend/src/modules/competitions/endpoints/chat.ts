/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { CompetitionService } from '@/modules/competitions/CompetitionService.js';
import { competitionErrors, toApiError } from './_shared.js';

// TOURNAMENT-V1: the competition's general chat room for a host or entrant (the meet / club chat room pattern).
export const meta = {
	tags: ['competitions'],
	requireCredential: true,
	kind: 'write:chat',
	res: { type: 'object', optional: false, nullable: false, properties: { roomId: { type: 'string', optional: false, nullable: false }, kind: { type: 'string', optional: true, nullable: false } } },
	errors: { ...competitionErrors },
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		competitionId: { type: 'string', format: 'misskey:id' },
		// COMP-FIXES-A: Reclub Discussion — Forum + General / Team / Captain / Staff chats (absent = general)
		kind: { type: 'string', enum: ['general', 'team', 'captain', 'staff', 'forum'] },
		entryId: { type: 'string', format: 'misskey:id' },
		accessToken: { type: 'string', nullable: true, maxLength: 32 },
	},
	required: ['competitionId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private competitionService: CompetitionService) {
		super(meta, paramDef, async (ps, me) => {
			try {
				const c = await this.competitionService.get(ps.competitionId);
				if (ps.kind && ps.kind !== 'general') return await this.competitionService.chatRoomOf(c, me, ps.kind, { entryId: ps.entryId, accessToken: ps.accessToken });
				return await this.competitionService.chatRoom(c, me);
			} catch (e) {
				return toApiError(e);
			}
		});
	}
}

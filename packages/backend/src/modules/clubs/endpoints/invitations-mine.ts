/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DI } from '@/di-symbols.js';
import type { ChannelsRepository } from '@/models/_.js';
import { ChannelEntityService } from '@/core/entities/ChannelEntityService.js';
import { clubErrors } from '@/modules/clubs/endpoints/_shared.js';

// T3-CLUBS-V1 (Reclub triage B-my-clubs.03 / .06): the clubs that have invited ME and are waiting for my answer — My clubs'
// "Reviewing" section answers them in place (clubs/invitations/respond). Only the caller's own pending invitations; an
// invited player may already read the invited club (ClubService.mayReadClub: myInvitation === 'pending'), so packing the
// club for them reveals nothing G15.5 keeps private. Archived clubs are left out.
export const meta = {
	tags: ['clubs'],
	requireCredential: true,
	kind: 'read:channels',
	res: { type: 'array', optional: false, nullable: false, items: { type: 'object', optional: false, nullable: false } },
	errors: clubErrors,
} as const;

export const paramDef = {
	type: 'object',
	properties: { limit: { type: 'integer', minimum: 1, maximum: 50, default: 30 } },
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.db) private db: DataSource,
		@Inject(DI.channelsRepository) private channelsRepository: ChannelsRepository,
		private channelEntityService: ChannelEntityService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const rows = await this.db.query(
				`SELECT i."channelId", i."createdAt" FROM "club_invitation" i JOIN "channel" c ON c."id" = i."channelId"
				 WHERE i."userId" = $1 AND i."status" = 'pending' AND c."isArchived" = false ORDER BY i."createdAt" DESC LIMIT $2`,
				[me.id, ps.limit ?? 30]) as { channelId: string; createdAt: Date }[];
			const out = [];
			for (const r of rows) {
				const ch = await this.channelsRepository.findOneBy({ id: r.channelId });
				if (!ch) continue;
				out.push({ ...(await this.channelEntityService.pack(ch, me, false)), invitedAt: new Date(r.createdAt).toISOString() });
			}
			return out;
		});
	}
}

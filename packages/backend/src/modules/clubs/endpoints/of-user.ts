/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { In } from 'typeorm';
import { DataSource } from 'typeorm';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DI } from '@/di-symbols.js';
import type { ChannelsRepository, ClubSettingsRepository, BlockingsRepository } from '@/models/_.js';
import { ChannelEntityService } from '@/core/entities/ChannelEntityService.js';

// PLAYER-CLUBS-V1 (W2-F, Reclub E-player.15 "Clubs the player belongs to → club page"): the clubs a person owns or has
// joined, each with their role there.
// INT-BATCH2 reconciliation with CLUB-TIERS-V1: this lane was written when membership was channel_following, and read
// the follows. It now reads club_member (ClubService.mine's rule, club-tiers.ts) — "the clubs the player BELONGS to"
// is the member tier; a club they merely follow is not listed, and the viewer's own membership (which unlocks the
// private ones they share) is the member tier too.
// What a viewer may see: every PUBLIC club; a PRIVATE club only when the viewer is that person or is a member of the
// same club (Reclub hides private groups from strangers). Archived clubs never. Anonymous viewers get the public
// ones. Newest membership first, owned clubs first.
export const meta = {
	tags: ['clubs'],
	requireCredential: false,
	res: { type: 'array', optional: false, nullable: false, items: { type: 'object', optional: false, nullable: false } },
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		userId: { type: 'string', format: 'misskey:id' },
		limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
	},
	required: ['userId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.db) private db: DataSource,
		@Inject(DI.channelsRepository) private channelsRepository: ChannelsRepository,
		@Inject(DI.clubSettingsRepository) private clubSettingsRepository: ClubSettingsRepository,
		@Inject(DI.blockingsRepository) private blockingsRepository: BlockingsRepository,
		private channelEntityService: ChannelEntityService,
	) {
		super(meta, paramDef, async (ps, me) => {
			// blocked either way: nothing to list
			if (me && me.id !== ps.userId && await this.blockingsRepository.exists({ where: [{ blockerId: ps.userId, blockeeId: me.id }, { blockerId: me.id, blockeeId: ps.userId }] })) return [];
			// CLUB-TIERS-V1: memberships, newest first (club_member ids are ULIDs, so id DESC is newest first)
			const joined = await this.db.query('SELECT "channelId" FROM "club_member" WHERE "userId" = $1 ORDER BY "id" DESC', [ps.userId]) as { channelId: string }[];
			const owned = await this.channelsRepository.find({ where: { userId: ps.userId, isArchived: false }, order: { id: 'DESC' } });
			const ids = Array.from(new Set([...owned.map(c => c.id), ...joined.map(r => r.channelId)]));
			if (!ids.length) return [];
			const channels = await this.channelsRepository.find({ where: { id: In(ids), isArchived: false } });
			const settings = await this.clubSettingsRepository.find({ where: { channelId: In(ids) } });
			const self = !!me && me.id === ps.userId;
			// the viewer's own memberships among them (for private clubs they share)
			const mine = new Set<string>();
			if (me && !self) {
				for (const r of await this.db.query('SELECT "channelId" FROM "club_member" WHERE "userId" = $1 AND "channelId" = ANY($2)', [me.id, ids]) as { channelId: string }[]) mine.add(r.channelId);
				for (const c of channels) if (c.userId === me.id) mine.add(c.id);
			}
			const byId = new Map(channels.map(c => [c.id, c]));
			const out = [];
			for (const id of ids) {
				const c = byId.get(id); if (!c) continue;
				const s = settings.find(x => x.channelId === id);
				const isPrivate = !!s && s.visibility === 'private';
				if (isPrivate && !self && !mine.has(id)) continue;
				const role = c.userId === ps.userId ? 'owner' : s && s.adminIds.includes(ps.userId) ? 'admin' : 'member';
				out.push({ ...(await this.channelEntityService.pack(c, me, false)), role, visibility: isPrivate ? 'private' : 'public' });
				if (out.length >= ps.limit) break;
			}
			return out;
		});
	}
}

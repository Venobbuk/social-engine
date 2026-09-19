/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { In } from 'typeorm';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DI } from '@/di-symbols.js';
import type { ChannelsRepository, ChannelFollowingsRepository, ClubSettingsRepository } from '@/models/_.js';
import { ChannelEntityService } from '@/core/entities/ChannelEntityService.js';

// PLAYER-CLUBS-V1 (W2-F, Reclub E-player.15 "Clubs the player belongs to → club page"): the clubs a person owns or has
// joined (a club = a Misskey channel; membership = a channel following, as ClubService.mine reads it), each with their
// role there. What a viewer may see: every PUBLIC club; a PRIVATE club only when the viewer is that person or is a
// member of the same club (Reclub hides private groups from strangers). Archived clubs never. Anonymous viewers get
// the public ones. Newest membership first, owned clubs first.
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
		@Inject(DI.channelsRepository) private channelsRepository: ChannelsRepository,
		@Inject(DI.channelFollowingsRepository) private channelFollowingsRepository: ChannelFollowingsRepository,
		@Inject(DI.clubSettingsRepository) private clubSettingsRepository: ClubSettingsRepository,
		private channelEntityService: ChannelEntityService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const follows = await this.channelFollowingsRepository.find({ where: { followerId: ps.userId }, order: { id: 'DESC' }, select: { followeeId: true } });
			const owned = await this.channelsRepository.find({ where: { userId: ps.userId, isArchived: false }, order: { id: 'DESC' } });
			const ids = Array.from(new Set([...owned.map(c => c.id), ...follows.map(f => f.followeeId)]));
			if (!ids.length) return [];
			const channels = await this.channelsRepository.find({ where: { id: In(ids), isArchived: false } });
			const settings = await this.clubSettingsRepository.find({ where: { channelId: In(ids) } });
			const self = !!me && me.id === ps.userId;
			// the viewer's own clubs among them (for private clubs they share)
			const mine = new Set<string>();
			if (me && !self) {
				for (const f of await this.channelFollowingsRepository.find({ where: { followerId: me.id, followeeId: In(ids) }, select: { followeeId: true } })) mine.add(f.followeeId);
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

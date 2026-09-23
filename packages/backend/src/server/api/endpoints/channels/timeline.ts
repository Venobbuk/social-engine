/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { ChannelsRepository, MiMeta, NotesRepository } from '@/models/_.js';
import { QueryService } from '@/core/QueryService.js';
import { NoteEntityService } from '@/core/entities/NoteEntityService.js';
import ActiveUsersChart from '@/core/chart/charts/active-users.js';
import { DI } from '@/di-symbols.js';
import { IdService } from '@/core/IdService.js';
import { FanoutTimelineEndpointService } from '@/core/FanoutTimelineEndpointService.js';
import { MiLocalUser } from '@/models/User.js';
import { ChannelMutingService } from '@/core/ChannelMutingService.js';
import { ClubService } from '@/modules/clubs/ClubService.js';
import { clubErrors } from '@/modules/clubs/endpoints/_shared.js';
import { ApiError } from '../../error.js';
import { Brackets } from 'typeorm';

export const meta = {
	tags: ['notes', 'channels'],

	requireCredential: false,

	res: {
		type: 'array',
		optional: false, nullable: false,
		items: {
			type: 'object',
			optional: false, nullable: false,
			ref: 'Note',
		},
	},

	errors: {
		noSuchChannel: {
			message: 'No such channel.',
			code: 'NO_SUCH_CHANNEL',
			id: '4d0eeeba-a02c-4c3c-9966-ef60d38d2e7f',
		},
		clubPrivate: clubErrors.clubPrivate, // CLUB-PRIVATE-V1 (W1)
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		channelId: { type: 'string', format: 'misskey:id' },
		limit: { type: 'integer', minimum: 1, maximum: 100, default: 10 },
		sinceId: { type: 'string', format: 'misskey:id' },
		untilId: { type: 'string', format: 'misskey:id' },
		sinceDate: { type: 'integer' },
		untilDate: { type: 'integer' },
		allowPartial: { type: 'boolean', default: false }, // true is recommended but for compatibility false by default
		accessToken: { type: 'string', nullable: true, maxLength: 32 }, // CLUB-PRIVATE-V1: the club's invite-link token (?at=)
	},
	required: ['channelId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.meta)
		private serverSettings: MiMeta,

		@Inject(DI.notesRepository)
		private notesRepository: NotesRepository,

		@Inject(DI.channelsRepository)
		private channelsRepository: ChannelsRepository,

		private idService: IdService,
		private noteEntityService: NoteEntityService,
		private queryService: QueryService,
		private fanoutTimelineEndpointService: FanoutTimelineEndpointService,
		private activeUsersChart: ActiveUsersChart,
		private channelMutingService: ChannelMutingService,
		private clubService: ClubService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const untilId = ps.untilId ?? (ps.untilDate ? this.idService.gen(ps.untilDate!) : null);
			const sinceId = ps.sinceId ?? (ps.sinceDate ? this.idService.gen(ps.sinceDate!) : null);

			const channel = await this.channelsRepository.findOneBy({
				id: ps.channelId,
			});

			if (channel == null) {
				throw new ApiError(meta.errors.noSuchChannel);
			}

			// CLUB-PRIVATE-V1 (W1): a private club's feed is its members', admins' and the invite-link holder's — this door was
			// requireCredential:false with no check, so a private club's posts were readable signed-out.
			if (!(await this.clubService.mayReadClub(channel.id, me?.id ?? null, ps.accessToken ?? null))) throw new ApiError(meta.errors.clubPrivate);
			const packOpts = { readableChannelIds: [channel.id] };
			// CLUB-POST-AUDIENCE-V1 (lane club-posts-links): a members- / admins-only post is left OUT of the club's feed for a
			// reader outside its audience (the packer would only blank it) — the reader's club role, asked once per page.
			const role = await this.clubService.clubRole(channel.id, me?.id ?? null);
			const inAudience = (n: { userId: string; visibility: string }) => (n.visibility !== 'followers' && n.visibility !== 'specified') || (me != null && n.userId === me.id) || (n.visibility === 'specified' ? role.admin : role.member);

			if (me) this.activeUsersChart.read(me);

			if (!this.serverSettings.enableFanoutTimeline) {
				return await this.noteEntityService.packMany((await this.getFromDb({ untilId, sinceId, limit: ps.limit, channelId: channel.id }, me)).filter(inAudience), me, packOpts);
			}

			return await this.noteEntityService.packMany(await this.fanoutTimelineEndpointService.getMiNotes({
				untilId,
				sinceId,
				limit: ps.limit,
				allowPartial: ps.allowPartial,
				me,
				useDbFallback: true,
				redisTimelines: [`channelTimeline:${channel.id}`],
				excludePureRenotes: false,
				ignoreAuthorChannelFromMute: true,
				noteFilter: inAudience,
				dbFallback: async (untilId, sinceId, limit) => {
					return (await this.getFromDb({ untilId, sinceId, limit, channelId: channel.id }, me)).filter(inAudience);
				},
			}), me, packOpts);
		});
	}

	private async getFromDb(ps: {
		untilId: string | null,
		sinceId: string | null,
		limit: number,
		channelId: string
	}, me: MiLocalUser | null) {
		//#region fallback to database
		const query = this.queryService.makePaginationQuery(this.notesRepository.createQueryBuilder('note'), ps.sinceId, ps.untilId)
			.andWhere('note.channelId = :channelId', { channelId: ps.channelId })
			.innerJoinAndSelect('note.user', 'user')
			.leftJoinAndSelect('note.reply', 'reply')
			.leftJoinAndSelect('note.renote', 'renote')
			.leftJoinAndSelect('reply.user', 'replyUser')
			.leftJoinAndSelect('renote.user', 'renoteUser')
			.leftJoinAndSelect('note.channel', 'channel');

		this.queryService.generateBaseNoteFilteringQuery(query, me);

		if (me) {
			const mutingChannelIds = await this.channelMutingService
				.list({ requestUserId: me.id }, { idOnly: true })
				.then(x => x.map(x => x.id).filter(x => x !== ps.channelId));
			if (mutingChannelIds.length > 0) {
				query.andWhere('note.channelId NOT IN (:...mutingChannelIds)', { mutingChannelIds });
				query.andWhere(new Brackets(qb => {
					qb.orWhere('note.renoteChannelId IS NULL');
					qb.orWhere('note.renoteChannelId NOT IN (:...mutingChannelIds)', { mutingChannelIds });
				}));
			}
		}
		//#endregion

		return await query.limit(ps.limit).getMany();
	}
}

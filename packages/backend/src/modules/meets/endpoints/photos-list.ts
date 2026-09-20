/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Not, IsNull } from 'typeorm';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { MeetsRepository, ChatMessagesRepository, DriveFilesRepository } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import { MeetService } from '@/modules/meets/MeetService.js';
import { IdService } from '@/core/IdService.js';
import { DriveFileEntityService } from '@/core/entities/DriveFileEntityService.js';
import { UserEntityService } from '@/core/entities/UserEntityService.js';
import { ApiError } from '@/server/api/error.js';
import { meetErrors } from './_shared.js';

/*
 * NUKE-REVIEW-FIXES-V1 (review finding 5) — the meet's Photos pane, for the MEET's audience.
 *
 * NUKE-MEET-PHOTOS-V1 was right that a meet photo IS a file message in the meet's native chat room, and the WRITE and
 * DELETE doors stay native (chat/messages/create-to-room, chat/messages/delete — nothing is duplicated here). What it
 * lost with meets/media/list was the AUDIENCE: chat/messages/room-timeline is 401 for anyone outside the room, and
 * meet.chatRoomId is packed only for the host and CONFIRMED players, so the pane went blank for everyone else who can
 * see the meet — a waitlisted / requested / invited / maybe player on the roster, a spectator, someone holding the
 * share link, an anonymous reader of a public meet. Those are real people on a real meet page.
 *
 * Misskey has no concept of "who may see this meet", so this is G11 rule 3 (NEW for a GripBat concept), and it is a
 * READ PROJECTION only: no table, no second store, no write path. The gate is the one meets/show uses
 * (MeetService.mayViewPrivate, share-link accessToken included), so the photos are visible to exactly the audience of
 * the meet they belong to — which is where they were before the series and where they belong.
 */
export const meta = {
	tags: ['meets'],
	requireCredential: false,
	kind: 'read:meets',
	res: { type: 'array', optional: false, nullable: false, items: { type: 'object', optional: false, nullable: false } },
	errors: { ...meetErrors },
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		meetId: { type: 'string', format: 'misskey:id' },
		accessToken: { type: 'string', nullable: true, maxLength: 32 },
		limit: { type: 'integer', minimum: 1, maximum: 100, default: 100 },
	},
	required: ['meetId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.meetsRepository)
		private meetsRepository: MeetsRepository,
		@Inject(DI.chatMessagesRepository)
		private chatMessagesRepository: ChatMessagesRepository,
		@Inject(DI.driveFilesRepository)
		private driveFilesRepository: DriveFilesRepository,
		private meetService: MeetService,
		private idService: IdService,
		private driveFileEntityService: DriveFileEntityService,
		private userEntityService: UserEntityService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const meet = await this.meetsRepository.findOneBy({ id: ps.meetId });
			if (meet == null) throw new ApiError(meta.errors.noSuchMeet);
			if (!(await this.meetService.mayViewPrivate(meet, me?.id ?? null, ps.accessToken))) throw new ApiError(meta.errors.accessDenied);
			if (meet.chatRoomId == null) return [];

			// the file messages of the meet's room, newest first; `id` is the chat MESSAGE id, which is what
			// chat/messages/delete takes — the × on a photo still goes to the native door.
			const rows = await this.chatMessagesRepository.find({
				where: { toRoomId: meet.chatRoomId, fileId: Not(IsNull()) },
				order: { id: 'DESC' },
				take: ps.limit,
			});

			const isHost = me ? await this.meetService.assertHost(meet, me).then(() => true).catch(() => false) : false;
			const out: Record<string, unknown>[] = [];
			for (const r of rows) {
				if (r.fileId == null) continue;
				const file = await this.driveFilesRepository.findOneBy({ id: r.fileId });
				if (!file || !file.type.startsWith('image/')) continue;
				const packed = await this.driveFileEntityService.pack(file, { detail: false, self: false });
				const user = await this.userEntityService.pack(r.fromUserId, me, { schema: 'UserLite' }).catch(() => null);
				out.push({
					id: r.id, meetId: meet.id, fileId: r.fileId,
					url: packed.url, thumbnailUrl: packed.thumbnailUrl ?? packed.url, type: packed.type,
					width: packed.properties?.width ?? null, height: packed.properties?.height ?? null,
					userId: r.fromUserId, user,
					createdAt: this.idService.parse(r.id).date.toISOString(),
					canDelete: !!me && (isHost || r.fromUserId === me.id),
				});
			}
			return out;
		});
	}
}

/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Not, IsNull } from 'typeorm';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { ChatMessagesRepository, DriveFilesRepository } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import { IdService } from '@/core/IdService.js';
import { DriveFileEntityService } from '@/core/entities/DriveFileEntityService.js';
import { UserEntityService } from '@/core/entities/UserEntityService.js';
import { CompetitionService } from '@/modules/competitions/CompetitionService.js';
import { competitionErrors, toApiError } from './_shared.js';

/*
 * COMP-T3-V1 — the competition's Media pane (Reclub Results › Media: photo grid, Add photo), REUSED from the meet's
 * meets/photos/list (modules/meets/endpoints/photos-list.ts, NUKE-REVIEW-FIXES-V1): a competition photo IS an image file
 * message in the competition's native general chat room. WRITE and DELETE stay native (chat/messages/create-to-room,
 * chat/messages/delete); this is the READ, for the COMPETITION's audience (the gate competitions/show uses —
 * CompetitionService.assertVisible, share-link accessToken included), because room-timeline is 401 outside the room.
 * No table, no second store, no write path.
 */
export const meta = {
	tags: ['competitions'],
	requireCredential: false,
	kind: 'read:meets',
	res: { type: 'array', optional: false, nullable: false, items: { type: 'object', optional: false, nullable: false } },
	errors: { ...competitionErrors },
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		competitionId: { type: 'string', format: 'misskey:id' },
		accessToken: { type: 'string', nullable: true, maxLength: 32 },
		limit: { type: 'integer', minimum: 1, maximum: 100, default: 100 },
	},
	required: ['competitionId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.chatMessagesRepository)
		private chatMessagesRepository: ChatMessagesRepository,
		@Inject(DI.driveFilesRepository)
		private driveFilesRepository: DriveFilesRepository,
		private competitionService: CompetitionService,
		private idService: IdService,
		private driveFileEntityService: DriveFileEntityService,
		private userEntityService: UserEntityService,
	) {
		super(meta, paramDef, async (ps, me) => {
			try {
				const c = await this.competitionService.get(ps.competitionId);
				await this.competitionService.assertVisible(c, me, ps.accessToken);
				if (c.chatRoomId == null) return [];
				const rows = await this.chatMessagesRepository.find({ where: { toRoomId: c.chatRoomId, fileId: Not(IsNull()) }, order: { id: 'DESC' }, take: ps.limit });
				// the × follows the native door: the room's owner (the competition's creator) or the photo's author
				const isHost = !!me && this.competitionService.isOwner(c, me.id);
				const out: Record<string, unknown>[] = [];
				for (const r of rows) {
					if (r.fileId == null) continue;
					const file = await this.driveFilesRepository.findOneBy({ id: r.fileId });
					if (!file || !file.type.startsWith('image/')) continue;
					const packed = await this.driveFileEntityService.pack(file, { detail: false, self: false });
					const user = await this.userEntityService.pack(r.fromUserId, me, { schema: 'UserLite' }).catch(() => null);
					out.push({
						id: r.id, competitionId: c.id, fileId: r.fileId,
						url: packed.url, thumbnailUrl: packed.thumbnailUrl ?? packed.url, type: packed.type,
						width: packed.properties?.width ?? null, height: packed.properties?.height ?? null,
						userId: r.fromUserId, user,
						createdAt: this.idService.parse(r.id).date.toISOString(),
						canDelete: !!me && (isHost || r.fromUserId === me.id),
					});
				}
				return out;
			} catch (e) {
				return toApiError(e);
			}
		});
	}
}

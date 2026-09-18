/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import ms from 'ms';
import type { DataSource } from 'typeorm';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { MeetsRepository, MeetParticipantsRepository, DriveFilesRepository } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import { IdService } from '@/core/IdService.js';
import { MeetService } from '@/modules/meets/MeetService.js';
import { ApiError } from '@/server/api/error.js';
import { addMedia } from '@/modules/meets/MeetExtras.js';
import { meetErrors } from '../_shared.js';

/**
 * MEET-EXTRAS-V1 — "Add photo" on the meet's Photos pane (Reclub POST /media {media_id}): a drive image of the
 * caller's, attached by the host or any confirmed player. Answers the media row.
 */
export const meta = {
	tags: ['meets'],
	requireCredential: true,
	prohibitMoved: true,
	kind: 'write:meets',
	limit: { duration: ms('1hour'), max: 120 },
	res: { type: 'object', optional: false, nullable: false },
	errors: {
		...meetErrors,
		noSuchFile: { message: 'No such file.', code: 'NO_SUCH_FILE', id: '6b1d0a3e-8f41-4c0b-9b7e-1a0000000034' },
		notImage: { message: 'Only images can be added to a meet.', code: 'MEET_MEDIA_NOT_IMAGE', id: '6b1d0a3e-8f41-4c0b-9b7e-1a0000000035' },
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		meetId: { type: 'string', format: 'misskey:id' },
		fileId: { type: 'string', format: 'misskey:id' },
	},
	required: ['meetId', 'fileId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.db)
		private db: DataSource,
		@Inject(DI.meetsRepository)
		private meetsRepository: MeetsRepository,
		@Inject(DI.meetParticipantsRepository)
		private meetParticipantsRepository: MeetParticipantsRepository,
		@Inject(DI.driveFilesRepository)
		private driveFilesRepository: DriveFilesRepository,
		private idService: IdService,
		private meetService: MeetService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const meet = await this.meetsRepository.findOneBy({ id: ps.meetId });
			if (meet == null) throw new ApiError(meta.errors.noSuchMeet);
			const isHost = await this.meetService.assertHost(meet, me).then(() => true).catch(() => false);
			if (!isHost) {
				const mine = await this.meetParticipantsRepository.findOneBy({ meetId: meet.id, userId: me.id });
				if (!mine || mine.status !== 'confirmed') throw new ApiError(meta.errors.notParticipant);
			}
			const file = await this.driveFilesRepository.findOneBy({ id: ps.fileId, userId: me.id });
			if (file == null) throw new ApiError(meta.errors.noSuchFile);
			if (!file.type.startsWith('image/')) throw new ApiError(meta.errors.notImage);
			const row = await addMedia(this.db, { id: this.idService.gen(), meetId: meet.id, userId: me.id, fileId: file.id, createdAt: new Date() });
			return { id: row.id, meetId: row.meetId, fileId: row.fileId, url: file.url, thumbnailUrl: file.thumbnailUrl ?? file.url, userId: row.userId, createdAt: new Date(row.createdAt).toISOString(), canDelete: true };
		});
	}
}

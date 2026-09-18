/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { MeetsRepository } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import { MeetService } from '@/modules/meets/MeetService.js';
import { ApiError } from '@/server/api/error.js';
import { deleteMedia, findMedia } from '@/modules/meets/MeetExtras.js';
import { meetErrors } from '../_shared.js';

/** MEET-EXTRAS-V1 — remove a meet photo (Reclub DELETE /media/{id}): the uploader or a host. The drive file stays. */
export const meta = {
	tags: ['meets'],
	requireCredential: true,
	prohibitMoved: true,
	kind: 'write:meets',
	res: { type: 'object', optional: false, nullable: false, properties: { ok: { type: 'boolean', optional: false, nullable: false } } },
	errors: {
		...meetErrors,
		noSuchMedia: { message: 'No such photo.', code: 'NO_SUCH_MEDIA', id: '6b1d0a3e-8f41-4c0b-9b7e-1a0000000036' },
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		meetId: { type: 'string', format: 'misskey:id' },
		mediaId: { type: 'string', format: 'misskey:id' },
	},
	required: ['meetId', 'mediaId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.db)
		private db: DataSource,
		@Inject(DI.meetsRepository)
		private meetsRepository: MeetsRepository,
		private meetService: MeetService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const meet = await this.meetsRepository.findOneBy({ id: ps.meetId });
			if (meet == null) throw new ApiError(meta.errors.noSuchMeet);
			const row = await findMedia(this.db, meet.id, ps.mediaId);
			if (!row) throw new ApiError(meta.errors.noSuchMedia);
			const isHost = await this.meetService.assertHost(meet, me).then(() => true).catch(() => false);
			if (!isHost && row.userId !== me.id) throw new ApiError(meta.errors.notHost);
			await deleteMedia(this.db, row.id);
			return { ok: true };
		});
	}
}

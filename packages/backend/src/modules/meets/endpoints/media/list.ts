/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { MeetsRepository, DriveFilesRepository } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import { MeetService } from '@/modules/meets/MeetService.js';
import { DriveFileEntityService } from '@/core/entities/DriveFileEntityService.js';
import { UserEntityService } from '@/core/entities/UserEntityService.js';
import { ApiError } from '@/server/api/error.js';
import { listMedia } from '@/modules/meets/MeetExtras.js';
import { meetErrors } from '../_shared.js';

/** MEET-EXTRAS-V1 — the meet's Photos pane (Reclub GET /media): newest first, same visibility as meets/show. */
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
	},
	required: ['meetId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.db)
		private db: DataSource,
		@Inject(DI.meetsRepository)
		private meetsRepository: MeetsRepository,
		@Inject(DI.driveFilesRepository)
		private driveFilesRepository: DriveFilesRepository,
		private meetService: MeetService,
		private driveFileEntityService: DriveFileEntityService,
		private userEntityService: UserEntityService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const meet = await this.meetsRepository.findOneBy({ id: ps.meetId });
			if (meet == null) throw new ApiError(meta.errors.noSuchMeet);
			if (!(await this.meetService.mayViewPrivate(meet, me?.id ?? null, ps.accessToken))) throw new ApiError(meta.errors.accessDenied);
			const isHost = me ? await this.meetService.assertHost(meet, me).then(() => true).catch(() => false) : false;
			const rows = await listMedia(this.db, meet.id);
			const out: Record<string, unknown>[] = [];
			for (const r of rows) {
				const file = await this.driveFilesRepository.findOneBy({ id: r.fileId });
				if (!file) continue;
				const packed = await this.driveFileEntityService.pack(file, { detail: false, self: false });
				const user = await this.userEntityService.pack(r.userId, me, { schema: 'UserLite' }).catch(() => null);
				out.push({
					id: r.id, meetId: r.meetId, fileId: r.fileId,
					url: packed.url, thumbnailUrl: packed.thumbnailUrl ?? packed.url, type: packed.type,
					width: packed.properties?.width ?? null, height: packed.properties?.height ?? null,
					userId: r.userId, user,
					createdAt: new Date(r.createdAt).toISOString(),
					canDelete: !!me && (isHost || r.userId === me.id),
				});
			}
			return out;
		});
	}
}

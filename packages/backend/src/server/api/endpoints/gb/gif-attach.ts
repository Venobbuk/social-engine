/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import * as fs from 'node:fs';
import { Inject, Injectable } from '@nestjs/common';
import * as Redis from 'ioredis';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DI } from '@/di-symbols.js';
import { HttpRequestService } from '@/core/HttpRequestService.js';
import { DriveService } from '@/core/DriveService.js';
import { DriveFileEntityService } from '@/core/entities/DriveFileEntityService.js';
import { createTemp } from '@/misc/create-temp.js';
import { ApiError } from '@/server/api/error.js';
import { NOT_CONFIGURED, UPSTREAM_FAILED, PROVIDER_BUSY, gifMode, giphyGet, isGiphyMedia, mockGif, mockId } from '@/core/GbChatExtras.js';

// CHAT-EXTRAS-V1 (Reclub E-giphy.01) — gb/gif/attach {gifId}: the picked GIF becomes a file in the SENDER's drive, so the
// app sends it on the existing chat path (chat/messages/create-to-room|user with fileId — REUSED, nothing new in chat).
// The engine resolves the id through GIPHY itself (the client never names a URL: no fetch of arbitrary addresses) and
// downloads the "downsized" rendition (<= 2 MB) with Misskey's own DriveService.uploadFromUrl (REUSED). UAT mock: a drawn GIF.
export const meta = {
	tags: ['chat', 'drive'],
	requireCredential: true,
	kind: 'write:drive',
	limit: { duration: 60 * 1000, max: 10 },
	res: { type: 'object', optional: false, nullable: false, ref: 'DriveFile' },
	errors: {
		notConfigured: NOT_CONFIGURED,
		upstream: UPSTREAM_FAILED,
		busy: PROVIDER_BUSY,
		noSuchGif: { message: 'No such GIF.', code: 'NO_SUCH_GIF', id: 'c7e1a0b2-5d3f-4e8a-9b1c-2f6d0a4e8c04', httpStatusCode: 404 },
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: { gifId: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,64}$' } },
	required: ['gifId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.redis) private redisClient: Redis.Redis,
		private httpRequestService: HttpRequestService,
		private driveService: DriveService,
		private driveFileEntityService: DriveFileEntityService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const mode = gifMode();
			if (mode === 'off') throw new ApiError(meta.errors.notConfigured);
			if (mode === 'mock') {
				const n = mockId(ps.gifId); if (n == null) throw new ApiError(meta.errors.noSuchGif);
				const [path, cleanup] = await createTemp();
				try {
					await fs.promises.writeFile(path, await mockGif(n));
					const file = await this.driveService.addFile({ user: me, path, name: `gif-test-${n + 1}.gif`, force: true });
					return await this.driveFileEntityService.pack(file, { self: true });
				} finally { cleanup(); }
			}
			if (mockId(ps.gifId) != null) throw new ApiError(meta.errors.noSuchGif);
			let json: any;
			try {
				json = await giphyGet(this.httpRequestService, this.redisClient, '/v1/gifs/' + ps.gifId, {}, 86400);
			} catch {
				throw new ApiError(meta.errors.upstream);
			}
			if (json === 'busy') throw new ApiError(meta.errors.busy);
			const im = json?.data?.images;
			const url = String(im?.downsized?.url ?? im?.fixed_height?.url ?? '');
			if (!url || !isGiphyMedia(url)) throw new ApiError(meta.errors.noSuchGif);
			let file;
			try {
				file = await this.driveService.uploadFromUrl({ url, user: me, force: true, comment: 'GIPHY' });
			} catch {
				throw new ApiError(meta.errors.upstream);
			}
			return await this.driveFileEntityService.pack(file, { self: true });
		});
	}
}

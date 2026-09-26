/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import * as Redis from 'ioredis';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DI } from '@/di-symbols.js';
import { HttpRequestService } from '@/core/HttpRequestService.js';
import { ApiError } from '@/server/api/error.js';
import { NOT_CONFIGURED, UPSTREAM_FAILED, PROVIDER_BUSY, gifMode, giphyGet, packGiphy, mockPage } from '@/core/GbChatExtras.js';

// CHAT-EXTRAS-V1 (Reclub E-giphy.01) — gb/gif/trending: GIPHY v1 trending through the engine (the key stays here), rated
// pg-13, cached 300 s per query/page (GIPHY's beta key allows 100 calls an hour for the whole app, so the cache and an
// app-wide hourly budget sit in front of it), limited per user. 503 NOT_CONFIGURED without a key.
export const meta = {
	tags: ['chat'],
	requireCredential: true,
	kind: 'read:account',
	limit: { duration: 60 * 1000, max: 30 },
	res: { type: 'object', optional: false, nullable: false, properties: {
		items: { type: 'array', optional: false, nullable: false, items: { type: 'object', optional: false, nullable: false, properties: {
			id: { type: 'string', optional: false, nullable: false },
			title: { type: 'string', optional: false, nullable: false },
			previewUrl: { type: 'string', optional: false, nullable: false },
			width: { type: 'number', optional: false, nullable: false },
			height: { type: 'number', optional: false, nullable: false },
		} } },
		next: { type: 'number', optional: false, nullable: true },
	} },
	errors: { notConfigured: NOT_CONFIGURED, upstream: UPSTREAM_FAILED, busy: PROVIDER_BUSY },
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		
		offset: { type: 'integer', minimum: 0, maximum: 4999, default: 0 },
		limit: { type: 'integer', minimum: 1, maximum: 30, default: 24 },
		lang: { type: 'string', maxLength: 16 },
	},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.redis) private redisClient: Redis.Redis,
		private httpRequestService: HttpRequestService,
	) {
		super(meta, paramDef, async (ps) => {
			const mode = gifMode();
			if (mode === 'off') throw new ApiError(meta.errors.notConfigured);
			const offset = ps.offset ?? 0; const limit = ps.limit ?? 24;
			if (mode === 'mock') return await mockPage('', offset, limit);
			let json: any;
			try {
				json = await giphyGet(this.httpRequestService, this.redisClient, '/v1/gifs/trending', { limit: String(limit), offset: String(offset), rating: 'pg-13', bundle: 'messaging_non_clips' }, 300);
			} catch {
				throw new ApiError(meta.errors.upstream);
			}
			if (json === 'busy') throw new ApiError(meta.errors.busy);
			return packGiphy(json);
		});
	}
}

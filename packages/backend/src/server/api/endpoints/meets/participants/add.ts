/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { IsNull } from 'typeorm';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { MeetsRepository, UsersRepository } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import { MeetService } from '@/core/MeetService.js';
import { MeetEntityService } from '@/core/entities/MeetEntityService.js';
import { ApiError } from '../../../error.js';
import { meetErrors, toApiError } from '../_shared.js';

// Host adds a player: invite a user (userId) or reserve a spot for a non-app player (displayName).
export const meta = {
	tags: ['meets'],
	requireCredential: true,
	prohibitMoved: true,
	kind: 'write:meets',
	res: { type: 'object', optional: false, nullable: false, ref: 'Meet' },
	errors: {
		noSuchUser: { message: 'No such user.', code: 'NO_SUCH_USER', id: '6b1d0a3e-8f41-4c0b-9b7e-1a0000000012' },
		...meetErrors,
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		meetId: { type: 'string', format: 'misskey:id' },
		userId: { type: 'string', format: 'misskey:id', nullable: true },
		displayName: { type: 'string', nullable: true, maxLength: 128 },
		declaredLevel: { type: 'number', nullable: true, minimum: 0, maximum: 10 },
		status: { type: 'string', enum: ['confirmed', 'invited', 'waitlisted'], default: 'invited' },
	},
	required: ['meetId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.meetsRepository)
		private meetsRepository: MeetsRepository,
		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,
		private meetService: MeetService,
		private meetEntityService: MeetEntityService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const meet = await this.meetsRepository.findOneBy({ id: ps.meetId });
			if (meet == null) throw new ApiError(meta.errors.noSuchMeet);
			if (ps.userId) {
				const user = await this.usersRepository.findOneBy({ id: ps.userId, host: IsNull() });
				if (user == null) throw new ApiError(meta.errors.noSuchUser);
			}
			try {
				await this.meetService.assertHost(meet, me);
				const status = ps.userId ? ps.status : (ps.status === 'invited' ? 'confirmed' : ps.status);
				await this.meetService.hostAdd(meet, { userId: ps.userId ?? null, displayName: ps.displayName ?? null, declaredLevel: ps.declaredLevel ?? null, status });
				return await this.meetEntityService.pack(meet.id, me, { detailed: true });
			} catch (e) {
				return toApiError(e);
			}
		});
	}
}


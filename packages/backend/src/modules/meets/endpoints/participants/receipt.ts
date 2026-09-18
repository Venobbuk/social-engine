/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { MeetsRepository, MeetParticipantsRepository, DriveFilesRepository } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import { MeetMatchService } from '@/modules/meets/MeetMatchService.js';
import { MeetEntityService } from '@/modules/meets/MeetEntityService.js';
import { DriveFileEntityService } from '@/core/entities/DriveFileEntityService.js';
import { ApiError } from '@/server/api/error.js';
import { meetErrors, toApiError } from '../_shared.js';

// HOST-TOOLS-V1 — Reclub's proof of payment (spec_meets.md §6.1 PUT /payments/transactions, §6.4 Payments Manager
// "Upload receipt" / "See receipt", §6.5 see-receipt): the receipt is a drive file (uploaded the way club photos
// are: drive/files/create) pinned to the participant row. The host uploads on behalf of a player, or the player
// uploads their own. fileId null deletes it ("Are you sure you want to delete this proof of payment?").
export const meta = {
	tags: ['meets'],
	requireCredential: true,
	prohibitMoved: true,
	kind: 'write:meets',
	res: { type: 'object', optional: false, nullable: false, ref: 'MeetParticipant' },
	errors: {
		noSuchFile: { message: 'No such file.', code: 'NO_SUCH_FILE', id: '6b1d0a3e-8f41-4c0b-9b7e-1a0000000020' },
		...meetErrors,
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		meetId: { type: 'string', format: 'misskey:id' },
		participantId: { type: 'string', format: 'misskey:id' },
		fileId: { type: 'string', format: 'misskey:id', nullable: true },
	},
	required: ['meetId', 'participantId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.meetsRepository)
		private meetsRepository: MeetsRepository,
		@Inject(DI.meetParticipantsRepository)
		private meetParticipantsRepository: MeetParticipantsRepository,
		@Inject(DI.driveFilesRepository)
		private driveFilesRepository: DriveFilesRepository,
		private meetMatchService: MeetMatchService,
		private meetEntityService: MeetEntityService,
		private driveFileEntityService: DriveFileEntityService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const meet = await this.meetsRepository.findOneBy({ id: ps.meetId });
			if (meet == null) throw new ApiError(meta.errors.noSuchMeet);
			const p = await this.meetParticipantsRepository.findOneBy({ id: ps.participantId, meetId: meet.id });
			if (p == null) throw new ApiError(meta.errors.noSuchParticipant);
			const host = await this.meetMatchService.isHost(meet, me);
			if (!host && p.userId !== me.id) throw new ApiError(meta.errors.notHost);
			try {
				if (ps.fileId) {
					const file = await this.driveFilesRepository.findOneBy({ id: ps.fileId, userId: me.id });
					if (file == null) throw new ApiError(meta.errors.noSuchFile);
					await this.meetParticipantsRepository.update(p.id, { receiptFileId: file.id, receiptUrl: this.driveFileEntityService.getPublicUrl(file), receiptAt: new Date(), receiptById: me.id });
				} else {
					await this.meetParticipantsRepository.update(p.id, { receiptFileId: null, receiptUrl: null, receiptAt: null, receiptById: null });
				}
				const row = await this.meetParticipantsRepository.findOneByOrFail({ id: p.id });
				return await this.meetEntityService.packParticipant(row, meet, me);
			} catch (e) {
				return toApiError(e);
			}
		});
	}
}

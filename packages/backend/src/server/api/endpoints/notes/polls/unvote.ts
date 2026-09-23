/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import type { PollsRepository, PollVotesRepository } from '@/models/_.js';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { GetterService } from '@/server/api/GetterService.js';
import { NoteEntityService } from '@/core/entities/NoteEntityService.js';
import { GlobalEventService } from '@/core/GlobalEventService.js';
import { DI } from '@/di-symbols.js';
import { ApiError } from '../../../error.js';

/*
 * POLL-EXT-V1 (lane club-posts-links, 2026-09-23) — NEW: take my vote back (Reclub "vote / change vote": tapping my own
 * choice again un-selects it; Reclub PUT /poll {answers, to_delete}). Searched first: Misskey has notes/polls/vote and
 * notes/polls/recommendation only — votes are final upstream, there is no un-vote door or service method. `choice`
 * omitted = every vote I cast on this poll. Changing a single-choice vote in one call is notes/polls/vote {replace: true}.
 */
export const meta = {
	tags: ['notes'],
	requireCredential: true,
	prohibitMoved: true,
	kind: 'write:votes',
	res: {
		type: 'object', optional: false, nullable: false,
		properties: { removed: { type: 'number', optional: false, nullable: false } },
	},
	errors: {
		noSuchNote: { message: 'No such note.', code: 'NO_SUCH_NOTE', id: 'ecafbd2e-c283-4d6d-aecb-1a0a33b75396' },
		noPoll: { message: 'The note does not attach a poll.', code: 'NO_POLL', id: '5f979967-52d9-4314-a911-1c673727f92f' },
		alreadyExpired: { message: 'The poll is already expired.', code: 'ALREADY_EXPIRED', id: '1022a357-b085-4054-9083-8f8de358337e' },
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		noteId: { type: 'string', format: 'misskey:id' },
		choice: { type: 'integer', minimum: 0 },
	},
	required: ['noteId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.pollsRepository)
		private pollsRepository: PollsRepository,

		@Inject(DI.pollVotesRepository)
		private pollVotesRepository: PollVotesRepository,

		private getterService: GetterService,
		private noteEntityService: NoteEntityService,
		private globalEventService: GlobalEventService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const note = await this.getterService.getNote(ps.noteId).catch(err => {
				if (err.id === '9725d0ce-ba28-4dde-95a7-2cbb2c15de24') throw new ApiError(meta.errors.noSuchNote);
				throw err;
			});
			if (!(await this.noteEntityService.isVisibleForMe(note, me.id))) throw new ApiError(meta.errors.noSuchNote);
			if (!note.hasPoll) throw new ApiError(meta.errors.noPoll);
			const poll = await this.pollsRepository.findOneByOrFail({ noteId: note.id });
			if (poll.expiresAt && poll.expiresAt < new Date()) throw new ApiError(meta.errors.alreadyExpired);

			const mine = await this.pollVotesRepository.findBy({ noteId: note.id, userId: me.id });
			const gone = mine.filter(v => ps.choice == null || v.choice === ps.choice);
			for (const v of gone) {
				await this.pollVotesRepository.delete({ id: v.id });
				const i = Number(v.choice) + 1; // SQL arrays are 1-based
				await this.pollsRepository.query(`UPDATE poll SET votes[${i}] = GREATEST(votes[${i}] - 1, 0) WHERE "noteId" = $1`, [poll.noteId]);
			}
			if (gone.length) this.globalEventService.publishNoteStream(note, 'pollVoted', { choice: gone[0].choice, userId: me.id });
			return { removed: gone.length };
		});
	}
}

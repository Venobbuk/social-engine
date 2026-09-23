/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import type { PollsRepository } from '@/models/_.js';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { GetterService } from '@/server/api/GetterService.js';
import { NoteEntityService } from '@/core/entities/NoteEntityService.js';
import { ClubService } from '@/modules/clubs/ClubService.js';
import { DI } from '@/di-symbols.js';
import { ApiError } from '../../../error.js';

/*
 * POLL-EXT-V1 (lane club-posts-links, 2026-09-23) — NEW: a voter adds an option to a poll whose author allowed it (Reclub
 * community:addition_allowance "Allow adding new options"; its editor: "Write your option ...", duplicate refusal
 * "This option has been already exists", "Added by you"). Searched first: Misskey's poll is fixed at create (notes/create
 * poll.choices; PollService only votes / delivers) — nothing appends a choice. The poll row is Misskey's own (poll.choices /
 * poll.votes, extended with allowAddChoices + choiceAddedBy). In a club, only its members add (the club's posting rule).
 * Misskey's own cap of 10 choices holds.
 */
export const meta = {
	tags: ['notes'],
	requireCredential: true,
	prohibitMoved: true,
	kind: 'write:votes',
	res: { type: 'object', optional: false, nullable: false, ref: 'Note' },
	errors: {
		noSuchNote: { message: 'No such note.', code: 'NO_SUCH_NOTE', id: 'ecafbd2e-c283-4d6d-aecb-1a0a33b75396' },
		noPoll: { message: 'The note does not attach a poll.', code: 'NO_POLL', id: '5f979967-52d9-4314-a911-1c673727f92f' },
		alreadyExpired: { message: 'The poll is already expired.', code: 'ALREADY_EXPIRED', id: '1022a357-b085-4054-9083-8f8de358337e' },
		notAllowed: { message: 'This poll does not take new options.', code: 'POLL_ADD_NOT_ALLOWED', id: 'c1b00000-0000-4000-8000-0000000000b7', httpStatusCode: 403 },
		notMember: { message: 'Only members can do that.', code: 'CLUB_NOT_MEMBER', id: 'c1b00000-0000-4000-8000-000000000011' },
		duplicate: { message: 'This option already exists.', code: 'POLL_DUPLICATE_OPTION', id: 'c1b00000-0000-4000-8000-0000000000b9' },
		full: { message: 'A poll takes at most 10 options.', code: 'POLL_FULL', id: 'c1b00000-0000-4000-8000-0000000000ba' },
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		noteId: { type: 'string', format: 'misskey:id' },
		text: { type: 'string', minLength: 1, maxLength: 50 },
	},
	required: ['noteId', 'text'],
} as const;

const MAX_CHOICES = 10;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.pollsRepository)
		private pollsRepository: PollsRepository,

		private getterService: GetterService,
		private noteEntityService: NoteEntityService,
		private clubService: ClubService,
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
			if (!poll.allowAddChoices) throw new ApiError(meta.errors.notAllowed);
			if (note.channelId && note.userId !== me.id && !(await this.clubService.clubRole(note.channelId, me.id)).member) throw new ApiError(meta.errors.notMember);
			const text = ps.text.trim();
			if (!text) throw new ApiError(meta.errors.duplicate);
			if (poll.choices.some(c => c.trim().toLowerCase() === text.toLowerCase())) throw new ApiError(meta.errors.duplicate);
			if (poll.choices.length >= MAX_CHOICES) throw new ApiError(meta.errors.full);

			// one statement: append the choice, its 0 votes and who added it (padding choiceAddedBy for a poll made before it
			// existed); the cap and the duplicate are re-checked in SQL so two people adding at once cannot pass them together
			const r = await this.pollsRepository.query(`UPDATE "poll" SET
				"choices" = array_append("choices", $2::varchar),
				"votes" = array_append("votes", 0),
				"choiceAddedBy" = array_append(CASE WHEN cardinality("choiceAddedBy") < cardinality("choices") THEN "choiceAddedBy" || array_fill(''::varchar, ARRAY[cardinality("choices") - cardinality("choiceAddedBy")]) ELSE "choiceAddedBy" END, $3::varchar)
				WHERE "noteId" = $1 AND cardinality("choices") < ${MAX_CHOICES} AND NOT (lower(trim($2::varchar)) = ANY (SELECT lower(trim(x)) FROM unnest("choices") x))
				RETURNING "noteId"`, [note.id, text, me.id]) as unknown[];
			const updated = Array.isArray(r) && Array.isArray(r[0]) ? r[0] : r;
			if (!Array.isArray(updated) || updated.length === 0) throw new ApiError(meta.errors.duplicate);
			return await this.noteEntityService.pack(note, me);
		});
	}
}

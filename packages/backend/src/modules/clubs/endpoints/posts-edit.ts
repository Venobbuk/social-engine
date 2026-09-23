/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import type { NotesRepository } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { NoteEntityService } from '@/core/entities/NoteEntityService.js';
import { SearchService } from '@/core/SearchService.js';
import { ApiError } from '@/server/api/error.js';
import { IdentifiableError } from '@/misc/identifiable-error.js';
import type { DataSource } from 'typeorm';
import { ClubService } from '@/modules/clubs/ClubService.js';
import { outsideLinkRefusal, outsideLinksError } from '@/modules/clubs/club-post-rules.js';

// CLUB-ADMIN-V1 — see modules/clubs/ClubService.ts
const clubErrors = {
	noSuchClub: { message: 'No such club.', code: 'NO_SUCH_CLUB', id: 'c1b00000-0000-4000-8000-000000000001' },
	notAdmin: { message: 'Only the club owner or an admin can do that.', code: 'CLUB_NOT_ADMIN', id: 'c1b00000-0000-4000-8000-000000000002' },
	clubError: { message: 'Club error.', code: 'CLUB_ERROR', id: 'c1b00000-0000-4000-8000-000000000003' },
	outsideLinks: outsideLinksError, // CLUB-POSTS-LINKS-V1 (B-set-comms.03): an edit may not add another club's activity either
} as const;
function toApiError(e: unknown): never {
	if (e instanceof IdentifiableError) {
		if (e.id === 'club:no_such_club') throw new ApiError(clubErrors.noSuchClub);
		if (e.id === 'club:not_admin') throw new ApiError(clubErrors.notAdmin);
		throw new ApiError({ ...clubErrors.clubError, message: e.message });
	}
	throw e;
}

// CLUB-POST-EDIT-V1: Reclub's forum editor "Save" — the author rewrites the text of their own club post (a note in
// a club channel) or of their reply under one. Only `text` changes; cw, files, poll, visibility stay as posted.
// Errors (all CLUB_ERROR with the message): club:no_such_note, club:not_author, club:not_club_post.
export const meta = {
	tags: ['clubs'],
	requireCredential: true,
	kind: 'write:notes',
	res: { type: 'object', optional: false, nullable: false },
	errors: clubErrors,
} as const;

export const paramDef = {
	type: 'object',
	properties: { noteId: { type: 'string', format: 'misskey:id' }, text: { type: 'string', minLength: 1, maxLength: 3000 },
		// CLUB-POSTS-LINKS-V1 (B-content-editor.02): the post's optional title is Misskey's own cw; null clears it
		cw: { type: 'string', nullable: true, maxLength: 100 } },
	required: ['noteId', 'text'],
} as const;

const err = (id: string, message: string) => new IdentifiableError(`club:${id}`, message);

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.notesRepository) private notesRepository: NotesRepository,
		private noteEntityService: NoteEntityService,
		private searchService: SearchService,
		private clubService: ClubService,
		@Inject(DI.db) private db: DataSource,
	) {
		super(meta, paramDef, async (ps, me) => {
			try {
				const note = await this.notesRepository.findOneBy({ id: ps.noteId });
				if (!note) throw err('no_such_note', 'No such post.');
				if (note.userId !== me.id) throw err('not_author', 'Only the author can edit this post.');
				let clubPost = !!note.channelId;
				let clubId = note.channelId;
				if (!clubPost && note.replyId) {
					const parent = await this.notesRepository.findOne({ where: { id: note.replyId }, select: { id: true, channelId: true } });
					clubPost = !!(parent && parent.channelId);
					clubId = parent ? parent.channelId : null;
				}
				if (!clubPost) throw err('not_club_post', 'Only club posts can be edited here.');
				// MiNote has no updatedAt column in this fork — only the text is written.
				if (await outsideLinkRefusal(this.db, this.clubService, clubId, me.id, [ps.cw, ps.text].filter(Boolean).join(' '))) throw new ApiError(clubErrors.outsideLinks);
				await this.notesRepository.update({ id: note.id, userId: me.id }, ps.cw !== undefined ? { text: ps.text, cw: ps.cw && ps.cw.trim() ? ps.cw.trim() : null } : { text: ps.text });
				const fresh = await this.notesRepository.findOneByOrFail({ id: note.id });
				// Keep full-text search current the way NoteCreateService does (Meilisearch addDocuments upserts by id;
				// a no-op for the sqlLike provider, which reads note.text directly).
				this.searchService.indexNote(fresh).catch(() => {});
				// Batch-1 review fix: NO noteStream 'updated' broadcast — it carried the text past the club gate to any subscriber.
				// Readers see the edit on their next fetch (notes/show, timelines), which pack through the gate.
				return await this.noteEntityService.pack(fresh, me, { detail: true });
			} catch (e) {
				return toApiError(e);
			}
		});
	}
}

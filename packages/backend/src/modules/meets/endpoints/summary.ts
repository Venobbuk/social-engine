/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { In } from 'typeorm';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { MeetsRepository, MeetParticipantsRepository, MeetMatchesRepository } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import { MeetService } from '@/modules/meets/MeetService.js';
import { UserEntityService } from '@/core/entities/UserEntityService.js';
import { ApiError } from '@/server/api/error.js';
import { computeStandings, evaluateMatch, fmtWhen, scoringOf, type MatchLike } from '@/modules/meets/MeetExtras.js';
import { meetErrors } from './_shared.js';

/**
 * MEET-EXTRAS-V1 — the whole-meet summary (Reclub GET /meets/{id}/matches-summary + stats summary, spec §5.6):
 * standings computed by the meet's scoring rules (mode + tiebreakers + forfeit/draw values), every match with its
 * result, and the rules themselves. The app draws the share card from this; the Matches pane's standings can read it
 * too. Same visibility as meets/show.
 */
export const meta = {
	tags: ['meets'],
	requireCredential: false,
	kind: 'read:meets',
	res: { type: 'object', optional: false, nullable: false },
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
		@Inject(DI.meetParticipantsRepository)
		private meetParticipantsRepository: MeetParticipantsRepository,
		@Inject(DI.meetMatchesRepository)
		private meetMatchesRepository: MeetMatchesRepository,
		private meetService: MeetService,
		private userEntityService: UserEntityService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const meet = await this.meetsRepository.findOneBy({ id: ps.meetId });
			if (meet == null) throw new ApiError(meta.errors.noSuchMeet);
			if (!(await this.meetService.mayViewPrivate(meet, me?.id ?? null, ps.accessToken))) throw new ApiError(meta.errors.accessDenied);
			const rules = scoringOf(meet as unknown as Record<string, unknown>);

			const parts = await this.meetParticipantsRepository.find({ where: { meetId: meet.id, status: In(['confirmed', 'spectator']) }, order: { isHost: 'DESC', statusChangedAt: 'ASC' } });
			const rows = await this.meetMatchesRepository.find({ where: { meetId: meet.id }, order: { round: 'ASC', courtIndex: 'ASC', id: 'ASC' } });
			// forfeitTeam is a MEET-EXTRAS-V1 column read straight from the table (the entity stays other streams')
			let forfeits = new Map<string, number>();
			try {
				const f = await this.db.query(`SELECT "id", "forfeitTeam" FROM "meet_match" WHERE "meetId" = $1 AND "forfeitTeam" IS NOT NULL`, [meet.id]) as { id: string; forfeitTeam: number }[];
				forfeits = new Map(f.map((r) => [r.id, r.forfeitTeam]));
			} catch { /* column not migrated yet */ }
			const matches: MatchLike[] = rows.map((m) => ({ id: m.id, round: m.round, courtIndex: m.courtIndex, team1Ids: m.team1Ids, team2Ids: m.team2Ids, scores: m.scores, forfeitTeam: forfeits.get(m.id) ?? null }));

			const played = new Set(matches.flatMap((m) => [...m.team1Ids, ...m.team2Ids]));
			const ids = Array.from(new Set([...parts.filter((p) => p.status === 'confirmed').map((p) => p.id), ...played]));
			const byId = new Map(parts.map((p) => [p.id, p]));
			const missing = ids.filter((id) => !byId.has(id));
			if (missing.length) for (const p of await this.meetParticipantsRepository.find({ where: { id: In(missing) } })) byId.set(p.id, p);
			const nameOf = async (id: string): Promise<{ id: string; name: string; avatarUrl: string | null; userId: string | null }> => {
				const p = byId.get(id);
				if (!p) return { id, name: '?', avatarUrl: null, userId: null };
				if (p.userId) {
					const u = await this.userEntityService.pack(p.userId, me, { schema: 'UserLite' }).catch(() => null);
					return { id, name: p.displayName || (u && (u.name || u.username)) || '?', avatarUrl: u?.avatarUrl ?? null, userId: p.userId };
				}
				return { id, name: p.displayName || (p.kind === 'plusOne' ? '+1' : '?'), avatarUrl: null, userId: null };
			};
			const people = new Map<string, Awaited<ReturnType<typeof nameOf>>>();
			for (const id of ids) people.set(id, await nameOf(id));

			const standings = computeStandings(ids.filter((id) => byId.get(id)?.status === 'confirmed' || played.has(id)), matches, rules).map((r) => ({
				participantId: r.participantId,
				name: people.get(r.participantId)?.name ?? '?',
				avatarUrl: people.get(r.participantId)?.avatarUrl ?? null,
				userId: people.get(r.participantId)?.userId ?? null,
				place: r.place,
				played: r.played, wins: r.wins + r.tbWins, losses: r.losses + r.tbLosses, draws: r.draws, tbWins: r.tbWins, tbLosses: r.tbLosses,
				points: r.points, setsWon: r.setsWon, setsLost: r.setsLost, pointsFor: r.pointsFor, pointsAgainst: r.pointsAgainst,
				scoreDiff: r.scoreDiff, totalScore: r.totalScore, winPct: r.winPct, setsWinPct: r.setsWinPct,
			}));
			const list = matches.map((m) => {
				const e = evaluateMatch(m, rules);
				return {
					id: m.id, round: m.round, courtIndex: m.courtIndex,
					team1: m.team1Ids.map((id) => people.get(id) ?? { id, name: '?', avatarUrl: null, userId: null }),
					team2: m.team2Ids.map((id) => people.get(id) ?? { id, name: '?', avatarUrl: null, userId: null }),
					scores: m.scores, forfeitTeam: m.forfeitTeam, winnerTeam: e.winner || null, draw: e.draw, tiebreak: e.tiebreak, scored: e.scored,
				};
			});
			return {
				meetId: meet.id,
				name: meet.name,
				startAt: new Date(meet.startAt).toISOString(),
				when: fmtWhen(meet),
				venueName: meet.venueName,
				format: meet.format,
				rules,
				players: ids.length,
				scoredMatches: list.filter((m) => m.scored).length,
				standings,
				matches: list,
			};
		});
	}
}

/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { MeetService } from '@/modules/meets/MeetService.js';
import { MeetMatchService } from '@/modules/meets/MeetMatchService.js';
import { MeetEntityService } from '@/modules/meets/MeetEntityService.js';
import { ApiError } from '@/server/api/error.js';
import { parseIsoDate } from '@/modules/meets/endpoints/_shared.js';
import { meetErrors, toApiError } from '../_shared.js';

// CASUAL-V1: Reclub "Casual games — log a game for DUPR" in one door. A casual game is a meet flagged 'casual'
// (never listed in Discover: meets/list excludes the flag unless asked), private, already played, with the people who
// played it on its roster (accounts by id, anyone else by name) and ONE scored match.
//
// SEC-CASUAL-CONSENT-V1 (2026-09-20): a casual game is a claim about other people's results, so consent is required.
//   • the caller MUST be one of the players (a bystander cannot manufacture games between others);
//   • every OTHER account player joins as PENDING ('invited', not 'confirmed') and is asked to confirm through the
//     native invitation notification (MeetService.hostAdd status:'invited'); name-only guests carry no account so
//     nothing is claimed of them and they stay confirmed;
//   • a casual game with any pending (or declined) account player counts toward NOTHING — not GB rating, not stats,
//     not DUPR — until every account player is confirmed. That gate lives at the source in GbRating.pendingMatches
//     and stats/_shared.scoredMatchesOf (keyed on flag 'casual'), so it holds for every read path;
//   • submitDupr therefore does not fire on the spot when players are still pending: it is remembered on the meet
//     (submitMatches) and sent once everyone confirms (meets/respond → the deferred submit; the minute sweep is the
//     safety net). DUPR still goes only through hkpl's partner route (MeetMatchService.submitDupr) — never a scrape.
export const meta = {
	tags: ['meets'],
	requireCredential: true,
	prohibitMoved: true,
	kind: 'write:meets',
	res: {
		type: 'object', optional: false, nullable: false,
		properties: {
			meet: { type: 'object', optional: false, nullable: false, ref: 'Meet' },
			match: { type: 'object', optional: false, nullable: false, ref: 'MeetMatch' },
		},
	},
	errors: {
		...meetErrors,
		invalidDate: { message: 'playedAt is not a date.', code: 'INVALID_DATE', id: '6b1d0a3e-8f41-4c0b-9b7e-1a00000000c1' },
		badTeams: { message: 'Each team is one or two players; the teams are the same size.', code: 'CASUAL_BAD_TEAMS', id: '6b1d0a3e-8f41-4c0b-9b7e-1a00000000c2' },
		// SEC-CASUAL-CONSENT-V1: only a player may log the game (no manufacturing games between other people)
		mustBeAPlayer: { message: 'You can only log a casual game that you played in.', code: 'CASUAL_MUST_PLAY', id: '6b1d0a3e-8f41-4c0b-9b7e-1a00000000c3' },
		playedInFuture: { message: 'A casual game can only be logged once it has been played.', code: 'CASUAL_PLAYED_IN_FUTURE', id: '6b1d0a3e-8f41-4c0b-9b7e-1a00000000c4' },
	},
} as const;

const player = { type: 'object', properties: { userId: { type: 'string', format: 'misskey:id', nullable: true }, name: { type: 'string', nullable: true, maxLength: 64 } } } as const;

export const paramDef = {
	type: 'object',
	properties: {
		name: { type: 'string', nullable: true, maxLength: 128 },
		venueName: { type: 'string', nullable: true, maxLength: 256 },
		playedAt: { type: 'string', nullable: true },   // ISO; default now
		team1: { type: 'array', minItems: 1, maxItems: 2, items: player },
		team2: { type: 'array', minItems: 1, maxItems: 2, items: player },
		scores: { type: 'array', minItems: 1, maxItems: 5, items: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'integer', minimum: 0, maximum: 999 } } },
		submitDupr: { type: 'boolean', default: false },
	},
	required: ['team1', 'team2', 'scores'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private meetService: MeetService,
		private meetMatchService: MeetMatchService,
		private meetEntityService: MeetEntityService,
	) {
		super(meta, paramDef, async (ps, me) => {
			if (ps.team1.length !== ps.team2.length) throw new ApiError(meta.errors.badTeams);
			const playedAt = ps.playedAt ? parseIsoDate(ps.playedAt) : new Date();
			if (playedAt == null) throw new ApiError(meta.errors.invalidDate);
			// SEC-CASUAL-CONSENT-V1: a casual game is one ALREADY played — a future date would put the meet ahead of now,
			// where seat claims, host-side confirms and the invite sweep live. Five minutes of clock tolerance.
			if (playedAt.getTime() > Date.now() + 5 * 60_000) throw new ApiError(meta.errors.playedInFuture);
			const everyone = [...ps.team1, ...ps.team2];
			for (const p of everyone) if (!p.userId && !(p.name && p.name.trim())) throw new ApiError(meta.errors.badTeams);
			const ids = everyone.map(p => p.userId).filter((x): x is string => !!x);
			if (new Set(ids).size !== ids.length) throw new ApiError(meta.errors.badTeams);
			const mePlays = ids.includes(me.id);
			// SEC-CASUAL-CONSENT-V1: the caller must be one of the players
			if (!mePlays) throw new ApiError(meta.errors.mustBeAPlayer);
			// the OTHER account players who must confirm before the game counts
			const otherAccountIds = ids.filter(id => id !== me.id);
			try {
				// seats are claimed only on a meet that has not started: the game is created one minute ahead, filled, scored,
				// then dated to when it was played
				let meet = await this.meetService.create(me, {
					name: ps.name?.trim() || (ps.team1.length === 1 ? 'Casual singles' : 'Casual doubles'),
					sport: 'pickleball',
					startAt: new Date(Date.now() + 60_000),
					durationMinutes: 60,
					capacity: everyone.length,
					hostPlays: mePlays,
					autoApprove: true,
					visibility: 'private',
					feeType: 'none',
					venueName: ps.venueName?.trim() || null,
					sendNotifications: false,
					flags: ['casual'],
				});
				// the roster: participant ids in team order (the host's own row already exists when they play)
				const full = await this.meetEntityService.pack(meet, me, { detailed: true });
				const hostRow = (full.participants as Array<{ id: string; userId: string | null }>).find(p => p.userId === me.id);
				const rowFor = async (p: { userId?: string | null; name?: string | null }): Promise<string> => {
					if (p.userId === me.id && hostRow) return hostRow.id;
					// SEC-CASUAL-CONSENT-V1: another account player is PENDING ('invited') and asked to confirm through the
					// native invitation notification; a name-only guest carries no account, so nothing is claimed of them.
					const status = p.userId ? 'invited' as const : 'confirmed' as const;
					const row = await this.meetService.hostAdd(meet, { userId: p.userId ?? null, displayName: p.userId ? null : (p.name ?? '').trim(), status });
					return row.id;
				};
				const team1Ids: string[] = []; for (const p of ps.team1) team1Ids.push(await rowFor(p));
				const team2Ids: string[] = []; for (const p of ps.team2) team2Ids.push(await rowFor(p));
				let match = await this.meetMatchService.upsert(meet, me, { round: 1, courtIndex: 0, team1Ids, team2Ids, scores: ps.scores });
				// SEC-CASUAL-CONSENT-V1: DUPR is sent on the spot only when no account player is still pending (a game
				// against name-only guests, say). Otherwise the request is remembered on the meet and sent once every
				// account player confirms (meets/respond triggers it; the sweep is the safety net).
				meet = await this.meetService.update(meet, ps.submitDupr && otherAccountIds.length > 0 ? { startAt: playedAt, submitMatches: true } : { startAt: playedAt });
				if (ps.submitDupr && otherAccountIds.length === 0) match = await this.meetMatchService.submitDupr(meet, match, me);
				const packedMeet = await this.meetEntityService.pack(meet, me, { detailed: true });
				const packedMatch = await this.meetEntityService.packMatch(match, meet, me, { eligibility: true });
				return { meet: packedMeet, match: packedMatch };
			} catch (e) {
				return toApiError(e);
			}
		});
	}
}

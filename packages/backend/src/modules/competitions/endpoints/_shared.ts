/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { IdentifiableError } from '@/misc/identifiable-error.js';
import { ApiError } from '@/server/api/error.js';
import { competitionFormats, competitionParticipantTypes, competitionFeeTypes, competitionVisibilities, competitionPointCalculations, competitionTiebreakers, competitionGenders, competitionAgeGroups } from '../models/Competition.js';
import type { CompetitionErrorId } from '../CompetitionService.js';

// TOURNAMENT-V1: shared error catalogue for competitions/*; CompetitionService throws IdentifiableError('competition:<id>').
export const competitionErrors = {
	noSuchCompetition: { message: 'No such competition.', code: 'NO_SUCH_COMPETITION', id: '7c0a0000-0000-4000-8000-000000000001' },
	notHost: { message: 'Only the host can do this.', code: 'COMPETITION_NOT_HOST', id: '7c0a0000-0000-4000-8000-000000000002' },
	private: { message: 'This competition is private.', code: 'COMPETITION_PRIVATE', id: '7c0a0000-0000-4000-8000-000000000003' },
	invalidTransition: { message: 'Invalid status change.', code: 'COMPETITION_INVALID_TRANSITION', id: '7c0a0000-0000-4000-8000-000000000004' },
	registrationClosed: { message: 'Registration is closed.', code: 'COMPETITION_REGISTRATION_CLOSED', id: '7c0a0000-0000-4000-8000-000000000005' },
	full: { message: 'No spot left.', code: 'COMPETITION_FULL', id: '7c0a0000-0000-4000-8000-000000000006' },
	alreadyEntered: { message: 'Already entered.', code: 'COMPETITION_ALREADY_ENTERED', id: '7c0a0000-0000-4000-8000-000000000007' },
	notEntered: { message: 'You are not entered.', code: 'COMPETITION_NOT_ENTERED', id: '7c0a0000-0000-4000-8000-000000000008' },
	started: { message: 'The competition has started.', code: 'COMPETITION_STARTED', id: '7c0a0000-0000-4000-8000-000000000009' },
	badTeam: { message: 'Invalid team.', code: 'COMPETITION_BAD_TEAM', id: '7c0a0000-0000-4000-8000-00000000000a' },
	drawExists: { message: 'The draw is already generated.', code: 'COMPETITION_DRAW_EXISTS', id: '7c0a0000-0000-4000-8000-00000000000b' },
	notEnoughEntries: { message: 'Not enough entries.', code: 'COMPETITION_NOT_ENOUGH_ENTRIES', id: '7c0a0000-0000-4000-8000-00000000000c' },
	tooManyEntries: { message: 'Too many entries for this format.', code: 'COMPETITION_TOO_MANY_ENTRIES', id: '7c0a0000-0000-4000-8000-00000000000d' },
	noSuchMatch: { message: 'No such match.', code: 'NO_SUCH_MATCH', id: '7c0a0000-0000-4000-8000-00000000000e' },
	noSuchEntry: { message: 'No such entry.', code: 'NO_SUCH_ENTRY', id: '7c0a0000-0000-4000-8000-00000000000f' },
	needsWinner: { message: 'A winner is needed.', code: 'COMPETITION_NEEDS_WINNER', id: '7c0a0000-0000-4000-8000-000000000010' },
	bracketLocked: { message: 'The bracket refused this change.', code: 'COMPETITION_BRACKET_LOCKED', id: '7c0a0000-0000-4000-8000-000000000011' },
	stageIncomplete: { message: 'The current stage is not complete.', code: 'COMPETITION_STAGE_INCOMPLETE', id: '7c0a0000-0000-4000-8000-000000000012' },
	noSuchAward: { message: 'No such award.', code: 'NO_SUCH_AWARD', id: '7c0a0000-0000-4000-8000-000000000013' },
	forbidden: { message: 'Not allowed.', code: 'COMPETITION_FORBIDDEN', id: '7c0a0000-0000-4000-8000-000000000014' },
	invalidDate: { message: 'Invalid date.', code: 'COMPETITION_INVALID_DATE', id: '7c0a0000-0000-4000-8000-000000000015' },
} as const;

const map: Record<CompetitionErrorId, keyof typeof competitionErrors> = {
	not_found: 'noSuchCompetition', not_host: 'notHost', private: 'private', invalid_transition: 'invalidTransition', registration_closed: 'registrationClosed',
	full: 'full', already_entered: 'alreadyEntered', not_entered: 'notEntered', started: 'started', bad_team: 'badTeam', draw_exists: 'drawExists',
	not_enough_entries: 'notEnoughEntries', too_many_entries: 'tooManyEntries', no_such_match: 'noSuchMatch', no_such_entry: 'noSuchEntry',
	needs_winner: 'needsWinner', bracket_locked: 'bracketLocked', stage_incomplete: 'stageIncomplete', no_such_award: 'noSuchAward', forbidden: 'forbidden',
};

export function toApiError(e: unknown): never {
	if (e instanceof IdentifiableError && e.id.startsWith('competition:')) {
		const key = map[e.id.slice('competition:'.length) as CompetitionErrorId];
		if (key) throw new ApiError({ ...competitionErrors[key], message: e.message || competitionErrors[key].message });
	}
	throw e;
}

export function parseIsoDate(v: string | undefined | null): Date | null {
	if (v == null) return null;
	const d = new Date(v);
	return Number.isNaN(d.getTime()) ? null : d;
}

export const anyObject = { type: 'object', optional: false, nullable: false } as const;
export const anyArray = { type: 'array', optional: false, nullable: false, items: { type: 'object' } } as const;

/** The competition fields a host may set (create / update). Dates are ISO strings parsed in code (no 'date-time' format). */
export const competitionParamProps = {
	name: { type: 'string', minLength: 1, maxLength: 128 },
	notes: { type: 'string', nullable: true, maxLength: 4096 },
	channelId: { type: 'string', format: 'misskey:id', nullable: true },
	sport: { type: 'string', minLength: 1, maxLength: 32 },
	format: { type: 'string', enum: [...competitionFormats] },
	participantType: { type: 'string', enum: [...competitionParticipantTypes] },
	teamMinSize: { type: 'integer', minimum: 1, maximum: 20 },
	teamMaxSize: { type: 'integer', minimum: 1, maximum: 20 },
	maxEntries: { type: 'integer', minimum: 2, maximum: 256 },
	registrationOpenAt: { type: 'string', nullable: true, maxLength: 40 },
	registrationCloseAt: { type: 'string', nullable: true, maxLength: 40 },
	earlyBirdAt: { type: 'string', nullable: true, maxLength: 40 },
	startAt: { type: 'string', minLength: 10, maxLength: 40 },
	durationDays: { type: 'integer', minimum: 1, maximum: 365 },
	timezone: { type: 'string', maxLength: 64 },
	venueName: { type: 'string', nullable: true, maxLength: 256 },
	venueAddress: { type: 'string', nullable: true, maxLength: 512 },
	lat: { type: 'number', nullable: true, minimum: -90, maximum: 90 },
	lng: { type: 'number', nullable: true, minimum: -180, maximum: 180 },
	venueId: { type: 'string', nullable: true, maxLength: 32 },
	feeType: { type: 'string', enum: [...competitionFeeTypes] },
	feeAmount: { type: 'integer', nullable: true, minimum: 0 },
	feeEarlyBirdAmount: { type: 'integer', nullable: true, minimum: 0 },
	feeCurrency: { type: 'string', minLength: 3, maxLength: 3 },
	paymentInfo: { type: 'string', nullable: true, maxLength: 512 },
	visibility: { type: 'string', enum: [...competitionVisibilities] },
	minLevel: { type: 'number', nullable: true, minimum: 0, maximum: 10 },
	maxLevel: { type: 'number', nullable: true, minimum: 0, maximum: 10 },
	gender: { type: 'string', enum: [...competitionGenders] },
	ageGroup: { type: 'string', enum: [...competitionAgeGroups] },
	numGroups: { type: 'integer', minimum: 1, maximum: 32 },
	numContinue: { type: 'integer', minimum: 1, maximum: 16 },
	thirdPlaceMatch: { type: 'boolean' },
	setsPerMatch: { type: 'integer', minimum: 1, maximum: 7 },
	forfeitWinScore: { type: 'integer', minimum: 0, maximum: 99 },
	pointCalculationType: { type: 'string', enum: [...competitionPointCalculations] },
	standardWinPoint: { type: 'integer', minimum: 0, maximum: 99 },
	standardLossPoint: { type: 'integer', minimum: 0, maximum: 99 },
	drawPoint: { type: 'integer', minimum: 0, maximum: 99 },
	tiebreakerWinPoint: { type: 'integer', minimum: 0, maximum: 99 },
	tiebreakerLossPoint: { type: 'integer', minimum: 0, maximum: 99 },
	tiebreakers: { type: 'array', maxItems: 4, items: { type: 'string', enum: [...competitionTiebreakers] } },
	revealDraw: { type: 'boolean' },
	showSeeds: { type: 'boolean' },
	autoApprove: { type: 'boolean' },
} as const;

const DATE_KEYS = ['registrationOpenAt', 'registrationCloseAt', 'earlyBirdAt', 'startAt'] as const;

/** Copy only the competition fields from a request body (the token arrives as `i` — never spread ps). Dates parsed. */
export function pickCompetitionFields(ps: Record<string, unknown>): { fields: Record<string, unknown>; badDate: boolean } {
	const out: Record<string, unknown> = {};
	let badDate = false;
	for (const k of Object.keys(competitionParamProps)) {
		if (ps[k] === undefined) continue;
		if ((DATE_KEYS as readonly string[]).includes(k)) {
			if (ps[k] === null) { out[k] = null; continue; }
			const d = parseIsoDate(String(ps[k]));
			if (!d) { badDate = true; continue; }
			out[k] = d;
		} else out[k] = ps[k];
	}
	return { fields: out, badDate };
}

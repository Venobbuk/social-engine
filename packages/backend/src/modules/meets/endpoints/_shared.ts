/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { IdentifiableError } from '@/misc/identifiable-error.js';
import { ApiError } from '@/server/api/error.js';

// Shared error catalogue for meets/* endpoints; MeetService throws IdentifiableError('meet:<id>').
export const meetErrors = {
	noSuchMeet: { message: 'No such meet.', code: 'NO_SUCH_MEET', id: '6b1d0a3e-8f41-4c0b-9b7e-1a0000000001' },
	noSuchParticipant: { message: 'No such participant.', code: 'NO_SUCH_PARTICIPANT', id: '6b1d0a3e-8f41-4c0b-9b7e-1a0000000002' },
	notHost: { message: 'Only a host can do this.', code: 'MEET_NOT_HOST', id: '6b1d0a3e-8f41-4c0b-9b7e-1a0000000003' },
	meetNotActive: { message: 'This meet is not active.', code: 'MEET_NOT_ACTIVE', id: '6b1d0a3e-8f41-4c0b-9b7e-1a0000000004' },
	meetStarted: { message: 'This meet has already started.', code: 'MEET_STARTED', id: '6b1d0a3e-8f41-4c0b-9b7e-1a0000000005' },
	meetFull: { message: 'No spot left.', code: 'MEET_FULL', id: '6b1d0a3e-8f41-4c0b-9b7e-1a0000000006' },
	gateDenied: { message: 'You do not meet the requirements for this meet.', code: 'MEET_GATE_DENIED', id: '6b1d0a3e-8f41-4c0b-9b7e-1a0000000007' },
	alreadyParticipant: { message: 'You already have a status on this meet.', code: 'MEET_ALREADY_PARTICIPANT', id: '6b1d0a3e-8f41-4c0b-9b7e-1a0000000008' },
	notParticipant: { message: 'You are not on this meet.', code: 'MEET_NOT_PARTICIPANT', id: '6b1d0a3e-8f41-4c0b-9b7e-1a0000000009' },
	freezeWindow: { message: 'Cancellations are frozen this close to the start.', code: 'MEET_FREEZE_WINDOW', id: '6b1d0a3e-8f41-4c0b-9b7e-1a000000000a' },
	invalidTransition: { message: 'Invalid status change.', code: 'MEET_INVALID_TRANSITION', id: '6b1d0a3e-8f41-4c0b-9b7e-1a000000000b' },
	plusOneNotAllowed: { message: 'Guests are not allowed on this meet.', code: 'MEET_PLUS_ONE_NOT_ALLOWED', id: '6b1d0a3e-8f41-4c0b-9b7e-1a000000000c' },
	guestLimit: { message: 'Too many guests.', code: 'MEET_GUEST_LIMIT', id: '6b1d0a3e-8f41-4c0b-9b7e-1a000000000d' },
	accessDenied: { message: 'Access denied.', code: 'ACCESS_DENIED', id: '6b1d0a3e-8f41-4c0b-9b7e-1a000000000e' },
	// MEET-V4-RECLUB
	blocked: { message: "You can't join this meet because the host(s) has blocked you", code: 'MEET_BLOCKED', id: '6b1d0a3e-8f41-4c0b-9b7e-1a000000000f' },
	private: { message: 'This is a private meet, only invited people and participants can see.', code: 'MEET_PRIVATE', id: '6b1d0a3e-8f41-4c0b-9b7e-1a0000000010' },
	capacityBelowConfirmed: { message: 'Capacity cannot be below the confirmed count.', code: 'MEET_CAPACITY_BELOW_CONFIRMED', id: '6b1d0a3e-8f41-4c0b-9b7e-1a0000000011' },
	hostNeedsSeat: { message: 'The host cannot take a seat in a full meet.', code: 'MEET_HOST_NEEDS_SEAT', id: '6b1d0a3e-8f41-4c0b-9b7e-1a0000000012' },
	// MEET-MATCH-V1
	noSuchMatch: { message: 'No such match.', code: 'NO_SUCH_MATCH', id: '6b1d0a3e-8f41-4c0b-9b7e-1a0000000013' },
	duprLocked: { message: 'These matches have already been submitted to DUPR.', code: 'MEET_DUPR_LOCKED', id: '6b1d0a3e-8f41-4c0b-9b7e-1a0000000014', httpStatusCode: 409 }, // UAT-DUPR-CAGE-V1: 409
	// T3-MEET-HOST-V1: meets/delete
	hasMatches: { message: 'This meet has matches. Delete the matches first, or cancel the meet.', code: 'MEET_HAS_MATCHES', id: '6b1d0a3e-8f41-4c0b-9b7e-1a0000000015' },
	hasParticipants: { message: 'Players are on this meet. Cancel it instead, so they are told.', code: 'MEET_HAS_PARTICIPANTS', id: '6b1d0a3e-8f41-4c0b-9b7e-1a0000000016' },
} as const;

const map: Record<string, keyof typeof meetErrors> = {
	'meet:meet_not_active': 'meetNotActive',
	'meet:meet_started': 'meetStarted',
	'meet:meet_full': 'meetFull',
	'meet:gate_denied': 'gateDenied',
	'meet:already_participant': 'alreadyParticipant',
	'meet:not_participant': 'notParticipant',
	'meet:freeze_window': 'freezeWindow',
	'meet:not_host': 'notHost',
	'meet:invalid_transition': 'invalidTransition',
	'meet:plus_one_not_allowed': 'plusOneNotAllowed',
	'meet:guest_limit': 'guestLimit',
	'meet:blocked': 'blocked',
	'meet:private': 'private',
	'meet:capacity_below_confirmed': 'capacityBelowConfirmed',
	'meet:host_needs_seat': 'hostNeedsSeat',
	'meet:meet_not_found': 'noSuchMeet',
	'meet:no_such_match': 'noSuchMatch',
	'meet:no_such_participant': 'noSuchParticipant',
	'meet:dupr_locked': 'duprLocked',
	'meet:has_matches': 'hasMatches',             // T3-MEET-HOST-V1
	'meet:has_participants': 'hasParticipants',   // T3-MEET-HOST-V1
};

export function parseIsoDate(v: string | undefined | null): Date | null {
	if (v == null) return null;
	const d = new Date(v);
	return Number.isNaN(d.getTime()) ? null : d;
}

export function toApiError(e: unknown): never {
	if (e instanceof IdentifiableError && map[e.id]) {
		// carry the service's message: it is Reclub's own copy (freeze hours, host name, capacity), not the static default
		throw new ApiError({ ...meetErrors[map[e.id]], message: e.message || meetErrors[map[e.id]].message });
	}
	throw e;
}

export const meetParamProps = {
	name: { type: 'string', minLength: 1, maxLength: 128 },
	notes: { type: 'string', nullable: true, maxLength: 4096 },
	channelId: { type: 'string', format: 'misskey:id', nullable: true },
	type: { type: 'string', enum: ['listing', 'managed'] },
	sport: { type: 'string', minLength: 1, maxLength: 32 },
	format: { type: 'string', nullable: true, maxLength: 32 },
	startAt: { type: 'string', minLength: 10, maxLength: 40 }, // ISO 8601; parsed and validated in code (ajv here has no date-time format)
	durationMinutes: { type: 'integer', minimum: 15, maximum: 10080 },   // MEET-MULTIDAY-V1 (meets-fixes): Reclub's duration runs to days — up to 7
	timezone: { type: 'string', maxLength: 64 },
	venueName: { type: 'string', nullable: true, maxLength: 256 },
	venueAddress: { type: 'string', nullable: true, maxLength: 512 },
	lat: { type: 'number', nullable: true, minimum: -90, maximum: 90 },
	lng: { type: 'number', nullable: true, minimum: -180, maximum: 180 },
	venueRef: { type: 'string', nullable: true, maxLength: 64 },
	// T3-MEET-FORM (L6 S3 bug 2): the venue the form picked. It was in the model (meet.venueId) and sent by the app, but not
	// in this list, so pickMeetFields dropped it on create AND update: 0 of 165 UAT meets carried one. Checked to exist below.
	venueId: { type: 'string', nullable: true, maxLength: 32 },
	capacity: { type: 'integer', minimum: 1, maximum: 500 },
	hostPlays: { type: 'boolean' },
	visibility: { type: 'string', enum: ['public', 'private'] }, // MEET-V4: binary, as Reclub; a club meet = private + groups
	autoApprove: { type: 'boolean' },
	allowPlusOne: { type: 'boolean' },
	feeType: { type: 'string', enum: ['none', 'free', 'perPax', 'autoSplit'] },
	feeAmount: { type: 'integer', nullable: true, minimum: 0 },
	feeCurrency: { type: 'string', minLength: 3, maxLength: 3 },
	paymentInfo: { type: 'string', nullable: true, maxLength: 512 },
	duprAccountGate: { type: 'string', enum: ['guidance', 'autoApprove', 'strict'] },
	repeatInterval: { type: 'string', nullable: true, enum: ['weekly'] },
	repeatCount: { type: 'integer', nullable: true, minimum: 1, maximum: 4 },
	blindTeamsMinutes: { type: 'integer', nullable: true, minimum: 0, maximum: 10080 },
	allowPlayerScoring: { type: 'boolean' },
	sendNotifications: { type: 'boolean' },
	rosterVisibility: { type: 'array', items: { type: 'string', enum: ['show_gender', 'show_age_group', 'show_self_rating', 'show_participant_tags', 'show_club_tags', 'show_dupr_ratings', 'show_courts', 'show_friends', 'show_position'] } },
	cancellationFreezeHours: { type: 'integer', minimum: 0, maximum: 168 },
	gateType: { type: 'string', enum: ['guidance', 'autoApprove', 'strict'] },
	levelBasis: { type: 'string', enum: ['self', 'duprSingles', 'duprDoubles'] },
	minLevel: { type: 'number', nullable: true, minimum: 0, maximum: 10 },
	maxLevel: { type: 'number', nullable: true, minimum: 0, maximum: 10 },
	gender: { type: 'string', enum: ['any', 'coed', 'female', 'male'] },
	ageGroup: { type: 'string', enum: ['any', 'junior', 'adult', 'senior'] },
	submitMatches: { type: 'boolean' },
} as const;

/** Copy only the meet fields from a request body (Misskey passes the auth token as `i` inside the body). */
export function pickMeetFields(ps: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const k of Object.keys(meetParamProps)) if (ps[k] !== undefined) out[k] = ps[k];
	return out;
}

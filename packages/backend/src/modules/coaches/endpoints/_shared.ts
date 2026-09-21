/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { IdentifiableError } from '@/misc/identifiable-error.js';
import { ApiError } from '@/server/api/error.js';

// COACH-VERIFY-V1: one error catalogue for the coaches/* doors; CoachService throws IdentifiableError('coach:<id>').
// Same shape and the same NOT_GRIPBAT_STAFF id as clubs/endpoints/_shared.ts, so the app's staffReason() already
// speaks for these doors without a new case.
export const coachErrors = {
	coachError: { message: 'Coach error.', code: 'COACH_ERROR', id: 'c0ac0000-0000-4000-8000-000000000001' },
	noDetails: { message: 'Fill in your coaching experience or your rate first.', code: 'COACH_NO_DETAILS', id: 'c0ac0000-0000-4000-8000-000000000002' },
	noSuchClaim: { message: 'No such coach application.', code: 'COACH_NO_SUCH_CLAIM', id: 'c0ac0000-0000-4000-8000-000000000003' },
	claimDecided: { message: 'This application was already decided.', code: 'COACH_CLAIM_DECIDED', id: 'c0ac0000-0000-4000-8000-000000000004' },
	claimCooldown: { message: 'Your last application was declined; try again later.', code: 'COACH_CLAIM_COOLDOWN', id: 'c0ac0000-0000-4000-8000-000000000005' },
	noAccount: { message: 'That account is gone or suspended.', code: 'COACH_NO_ACCOUNT', id: 'c0ac0000-0000-4000-8000-000000000006' },
	// STAFF-ROLE-V1: the queue and the decision are for holders of the GripBat staff role only (403) — the SAME error
	// id clubs/claims/* answers with, because it is the same permission.
	notStaff: { message: 'Only GripBat staff can do this.', code: 'NOT_GRIPBAT_STAFF', id: 'a7c5f1a0-6b1e-4c1d-9e2f-5a7ff0000001', kind: 'permission', httpStatusCode: 403 },
	// COACHING-V1: the lesson-schedule / booking doors (CoachScheduleService throws coach:<id>). The club admin gate
	// it reuses throws club:not_admin / club:no_such_club — mapped here too so those keep their 403 / 404 shape.
	noSuchSchedule: { message: 'No such lesson schedule.', code: 'COACH_NO_SUCH_SCHEDULE', id: 'c0ac0000-0000-4000-8000-000000000011' },
	noSuchLesson: { message: 'No such lesson.', code: 'COACH_NO_SUCH_LESSON', id: 'c0ac0000-0000-4000-8000-000000000012' },
	noSuchEnrolment: { message: 'No such enrolment.', code: 'COACH_NO_SUCH_ENROLMENT', id: 'c0ac0000-0000-4000-8000-000000000013' },
	invalid: { message: 'Invalid input.', code: 'COACH_INVALID', id: 'c0ac0000-0000-4000-8000-000000000014' },
	notYours: { message: 'That is not yours.', code: 'COACH_NOT_YOURS', id: 'c0ac0000-0000-4000-8000-000000000015', kind: 'permission', httpStatusCode: 403 },
	notALesson: { message: 'This meet is not a coaching lesson.', code: 'COACH_NOT_A_LESSON', id: 'c0ac0000-0000-4000-8000-000000000016' },
	modeNotAllowed: { message: 'This coach does not offer that booking mode on this slot.', code: 'COACH_MODE_NOT_ALLOWED', id: 'c0ac0000-0000-4000-8000-000000000017' },
	alreadyEnrolled: { message: 'You already have an active enrolment on this slot.', code: 'COACH_ALREADY_ENROLLED', id: 'c0ac0000-0000-4000-8000-000000000018' },
	notAdmin: { message: 'Only the club owner or an admin can post lessons.', code: 'COACH_NOT_ADMIN', id: 'c0ac0000-0000-4000-8000-000000000019', kind: 'permission', httpStatusCode: 403 },
	noSuchClub: { message: 'No such club.', code: 'COACH_NO_SUCH_CLUB', id: 'c0ac0000-0000-4000-8000-00000000001a' },
	// COACHING-V1 flag OFF (default): the whole feature is invisible. 404 so it reads exactly as "no such endpoint".
	notAvailable: { message: 'Coaching is not available yet.', code: 'COACH_NOT_AVAILABLE', id: 'c0ac0000-0000-4000-8000-00000000001b', httpStatusCode: 404 },
	noSuchLessonMeet: { message: 'No such lesson.', code: 'COACH_NO_SUCH_LESSON_MEET', id: 'c0ac0000-0000-4000-8000-00000000001c' },
} as const;

const map: Record<string, keyof typeof coachErrors> = {
	'coach:no_details': 'noDetails',
	'coach:no_such_claim': 'noSuchClaim',
	'coach:claim_decided': 'claimDecided',
	'coach:cooldown': 'claimCooldown',
	'coach:no_account': 'noAccount',
	'coach:not_staff': 'notStaff',
	'coach:no_such_schedule': 'noSuchSchedule',
	'coach:no_such_lesson': 'noSuchLesson',
	'coach:no_such_enrolment': 'noSuchEnrolment',
	'coach:invalid': 'invalid',
	'coach:not_yours': 'notYours',
	'coach:not_a_lesson': 'notALesson',
	'coach:mode_not_allowed': 'modeNotAllowed',
	'coach:already_enrolled': 'alreadyEnrolled',
	'coach:not_available': 'notAvailable',
	// the reused club-admin gate
	'club:not_admin': 'notAdmin',
	'club:no_such_club': 'noSuchClub',
};

export function toApiError(e: unknown): never {
	if (e instanceof IdentifiableError) {
		const k = map[e.id];
		if (k) throw new ApiError({ ...coachErrors[k], message: e.message });
		throw new ApiError({ ...coachErrors.coachError, message: e.message });
	}
	throw e;
}

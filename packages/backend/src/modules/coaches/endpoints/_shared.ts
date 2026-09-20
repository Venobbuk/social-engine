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
} as const;

const map: Record<string, keyof typeof coachErrors> = {
	'coach:no_details': 'noDetails',
	'coach:no_such_claim': 'noSuchClaim',
	'coach:claim_decided': 'claimDecided',
	'coach:cooldown': 'claimCooldown',
	'coach:no_account': 'noAccount',
	'coach:not_staff': 'notStaff',
};

export function toApiError(e: unknown): never {
	if (e instanceof IdentifiableError) {
		const k = map[e.id];
		if (k) throw new ApiError({ ...coachErrors[k], message: e.message });
		throw new ApiError({ ...coachErrors.coachError, message: e.message });
	}
	throw e;
}

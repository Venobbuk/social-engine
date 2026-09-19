/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { IdentifiableError } from '@/misc/identifiable-error.js';
import { ApiError } from '@/server/api/error.js';

// CLUB-V3: one error catalogue for the clubs/* doors; ClubService / ClubScheduleService throw IdentifiableError('club:<id>').
export const clubErrors = {
	noSuchClub: { message: 'No such club.', code: 'NO_SUCH_CLUB', id: 'c1b00000-0000-4000-8000-000000000001' },
	notAdmin: { message: 'Only the club owner or an admin can do that.', code: 'CLUB_NOT_ADMIN', id: 'c1b00000-0000-4000-8000-000000000002' },
	clubError: { message: 'Club error.', code: 'CLUB_ERROR', id: 'c1b00000-0000-4000-8000-000000000003' },
	notMember: { message: 'Only members can do that.', code: 'CLUB_NOT_MEMBER', id: 'c1b00000-0000-4000-8000-000000000011' },
	chatOff: { message: 'This club has turned its chat off.', code: 'CLUB_CHAT_OFF', id: 'c1b00000-0000-4000-8000-000000000012' },
	inviteOnly: { message: 'This club is invite-only.', code: 'CLUB_INVITE_ONLY', id: 'c1b00000-0000-4000-8000-000000000013' },
	noSuchTag: { message: 'No such tag.', code: 'CLUB_NO_SUCH_TAG', id: 'c1b00000-0000-4000-8000-000000000021' },
	tagExists: { message: 'This tag has already existed', code: 'CLUB_TAG_EXISTS', id: 'c1b00000-0000-4000-8000-000000000022' },
	noSuchSchedule: { message: 'No such schedule.', code: 'CLUB_NO_SUCH_SCHEDULE', id: 'c1b00000-0000-4000-8000-000000000031' },
	noSuchNote: { message: 'No such post in this club.', code: 'CLUB_NO_SUCH_NOTE', id: 'c1b00000-0000-4000-8000-000000000041' },
	noAdmins: { message: 'This club has no admins to message.', code: 'CLUB_NO_ADMINS', id: 'c1b00000-0000-4000-8000-000000000051' },
	invalid: { message: 'Invalid input.', code: 'CLUB_INVALID', id: 'c1b00000-0000-4000-8000-000000000061' },
	// CLUB-CLAIM-VERIFY-V1.1 (W1): ownership claims
	hasOwner: { message: 'This club already has an owner.', code: 'CLUB_HAS_OWNER', id: 'c1b00000-0000-4000-8000-000000000071' },
	noSuchClaim: { message: 'No such claim.', code: 'CLUB_NO_SUCH_CLAIM', id: 'c1b00000-0000-4000-8000-000000000072' },
	claimDecided: { message: 'This claim was already decided.', code: 'CLUB_CLAIM_DECIDED', id: 'c1b00000-0000-4000-8000-000000000073' },
	claimCooldown: { message: 'Your last claim on this club was declined; try again later.', code: 'CLUB_CLAIM_COOLDOWN', id: 'c1b00000-0000-4000-8000-000000000074' },
	// STAFF-ROLE-V1 (batch-1 review fix): the claim queue / decide are for holders of the GripBat staff role only (403)
	notStaff: { message: 'Only GripBat staff can do this.', code: 'NOT_GRIPBAT_STAFF', id: 'a7c5f1a0-6b1e-4c1d-9e2f-5a7ff0000001', kind: 'permission', httpStatusCode: 403 },
} as const;

const map: Record<string, keyof typeof clubErrors> = {
	'club:no_such_club': 'noSuchClub', 'club:not_admin': 'notAdmin', 'club:not_member': 'notMember', 'club:chat_off': 'chatOff', 'club:invite_only': 'inviteOnly',
	'club:no_such_tag': 'noSuchTag', 'club:tag_exists': 'tagExists', 'club:no_such_schedule': 'noSuchSchedule', 'club:no_such_note': 'noSuchNote', 'club:no_admins': 'noAdmins', 'club:invalid': 'invalid',
	'club:has_owner': 'hasOwner', 'club:no_such_claim': 'noSuchClaim', 'club:claim_decided': 'claimDecided', 'club:claim_cooldown': 'claimCooldown', 'club:not_staff': 'notStaff',
};

export function toApiError(e: unknown): never {
	if (e instanceof IdentifiableError) {
		const k = map[e.id];
		if (k) throw new ApiError({ ...clubErrors[k], message: e.message });
		throw new ApiError({ ...clubErrors.clubError, message: e.message });
	}
	throw e;
}

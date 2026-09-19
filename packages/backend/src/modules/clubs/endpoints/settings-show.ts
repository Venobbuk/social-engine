/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ClubService } from '@/modules/clubs/ClubService.js';
import { ApiError } from '@/server/api/error.js';
import { IdentifiableError } from '@/misc/identifiable-error.js';

// CLUB-ADMIN-V1 — see modules/clubs/ClubService.ts
const clubErrors = {
	noSuchClub: { message: 'No such club.', code: 'NO_SUCH_CLUB', id: 'c1b00000-0000-4000-8000-000000000001' },
	notAdmin: { message: 'Only the club owner or an admin can do that.', code: 'CLUB_NOT_ADMIN', id: 'c1b00000-0000-4000-8000-000000000002' },
	clubError: { message: 'Club error.', code: 'CLUB_ERROR', id: 'c1b00000-0000-4000-8000-000000000003' },
} as const;
function toApiError(e: unknown): never {
	if (e instanceof IdentifiableError) {
		if (e.id === 'club:no_such_club') throw new ApiError(clubErrors.noSuchClub);
		if (e.id === 'club:not_admin') throw new ApiError(clubErrors.notAdmin);
		throw new ApiError({ ...clubErrors.clubError, message: e.message });
	}
	throw e;
}

export const meta = {
	tags: ['clubs'],
	requireCredential: false,
	res: { type: 'object', optional: false, nullable: false, properties: { refCode: { type: 'string', optional: false, nullable: true }, accessToken: { type: 'string', optional: false, nullable: true }, venues: { type: 'array', optional: false, nullable: false, items: { type: 'object', optional: false, nullable: false } }, tags: { type: 'array', optional: false, nullable: false, items: { type: 'object', optional: false, nullable: false } }, awards: { type: 'array', optional: false, nullable: false, items: { type: 'object', optional: false, nullable: false } }, myPinned: { type: 'boolean', optional: false, nullable: false }, myPaused: { type: 'boolean', optional: false, nullable: false }, pinnedNoteIds: { type: 'array', optional: false, nullable: false, items: { type: 'string' } }, hasAccess: { type: 'boolean', optional: false, nullable: false }, visibility: { type: 'string', optional: false, nullable: false }, gateType: { type: 'string', optional: false, nullable: false }, createMeetPermission: { type: 'string', optional: false, nullable: false }, sport: { type: 'string', optional: false, nullable: false }, level: { type: 'string', optional: false, nullable: true }, adminIds: { type: 'array', optional: false, nullable: false, items: { type: 'string' } }, venueIds: { type: 'array', optional: false, nullable: false, items: { type: 'string' } }, paymentInfo: { type: 'string', optional: false, nullable: true }, enableForum: { type: 'boolean', optional: false, nullable: false }, enableChat: { type: 'boolean', optional: false, nullable: false }, isAdmin: { type: 'boolean', optional: false, nullable: false }, isOwner: { type: 'boolean', optional: false, nullable: false }, isMember: { type: 'boolean', optional: false, nullable: false }, myRequest: { type: 'string', optional: false, nullable: true } } },
	errors: clubErrors,
} as const;

export const paramDef = {
	type: 'object',
	properties: { channelId: { type: 'string', format: 'misskey:id' }, accessToken: { type: 'string', nullable: true, maxLength: 32 } },
	required: ['channelId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private clubService: ClubService) {
		super(meta, paramDef, async (ps, me) => {
			try {
				const c = await this.clubService.channel(ps.channelId); const s = await this.clubService.ensureCodes(await this.clubService.settings(c.id));
			const isAdmin = me ? await this.clubService.isAdmin(c, me.id) : false;
			const isMember = me ? await this.clubService.isMember(c.id, me.id) : false;
			// CLUB-V3: the link token is the members' to share; a private club's page is readable with it (Reclub ?at=)
			const tokenOk = !!ps.accessToken && ps.accessToken === s.accessToken;
			const st = me ? await this.clubService.myState(c.id, me.id) : null;
			// CLUB-TIERS-V1: the follow (native channel_following) is its own relationship; both counts; my 'new meets' switch
			const isFollowing = me ? await this.clubService.isFollowing(c.id, me.id) : false;
			// CLUB-INVITE-V1: an invited player may see a private club to decide
			const myInvitation = me ? await this.clubService.myInvitation(c.id, me.id) : null;
			// SEC (review-batch2 #10): a PRIVATE club's audience size is its members' business - the same access rule its
			// accessToken and paymentInfo already use below. An outsider, anonymous included, gets null, not a number.
			const hasAccess = s.visibility === 'public' || isAdmin || isMember || tokenOk || myInvitation === 'pending';
			const counts = hasAccess ? await this.clubService.counts(c.id) : null;
			const tiers = { isFollowing, membersCount: counts ? counts.members : null, followersCount: counts ? counts.followers : null, myNotifyMeets: me && (isMember || isFollowing) ? !(await this.clubService.meetsMuted(c.id, me.id)) : null, tier: !me ? 'none' : c.userId === me.id ? 'owner' : isAdmin ? 'admin' : isMember ? 'member' : isFollowing ? 'follower' : 'none' };
			const tagsVisible = s.tags.filter(t => isAdmin || t.visibility === 'all').sort((a, b) => a.order - b.order).map(t => ({ id: t.id, name: t.name, visibility: t.visibility, order: t.order, count: Object.keys(t.members).length }));
			return { refCode: s.refCode, accessToken: isAdmin || isMember || tokenOk ? s.accessToken : null, venues: await this.clubService.venues(s), tags: tagsVisible, awards: s.awards, myPinned: !!me && (await this.clubService.pinnedChannelIds(me.id, [c.id])).has(c.id) /* NUKE-CLUB-PIN-V1: native channel_favorite */, myPaused: !!(st && st.pausedAt), pinnedNoteIds: c.pinnedNoteIds, hasAccess, /* CLUB-INVITE-V1: an invited player may see a private club to decide */ visibility: s.visibility, gateType: s.gateType, createMeetPermission: s.createMeetPermission, sport: s.sport, level: s.level, adminIds: isAdmin ? s.adminIds : [], venueIds: s.venueIds, paymentInfo: s.visibility === 'public' || isAdmin || isMember || tokenOk ? s.paymentInfo : null /* CLUB-PRIVATE-V1 (W1): a private club's payment details are its members' */, enableForum: s.enableForum, enableChat: s.enableChat, isAdmin, isOwner: !!me && c.userId === me.id, isMember, myRequest: me ? await this.clubService.myRequest(c.id, me.id) : null, myClaim: me && !c.userId ? await this.clubService.myClaim(c.id, me.id) : null, myInvitation, ...tiers }; // CLUB-CLAIM-VERIFY-V1: myClaim // CLUB-INVITE-V1: myInvitation
			} catch (e) {
				return toApiError(e);
			}
		});
	}
}

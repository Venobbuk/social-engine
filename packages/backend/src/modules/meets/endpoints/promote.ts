/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import ms from 'ms';
import type { DataSource } from 'typeorm';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { MeetsRepository } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import { MeetService } from '@/modules/meets/MeetService.js';
import { NotificationService } from '@/core/NotificationService.js';
import { UserEntityService } from '@/core/entities/UserEntityService.js';
import { ApiError } from '@/server/api/error.js';
import { promoteAudience, promoteBody, promoteGate, PROMOTE_RADIUS_KM, PROMOTE_WINDOW_HOURS } from '@/modules/meets/MeetExtras.js';
import type { PromoteAudienceKind } from '@/modules/meets/MeetExtras.js';
import { meetErrors, toApiError } from './_shared.js';

/**
 * MEET-EXTRAS-V1 — Reclub "Get more players → Promote meet" (spec_meets.md §8.1, §Y.6): one push to the host's
 * followers and to players whose saved home is within 20 km, limited to the meet's level band, public meets only,
 * ≤ 36 h before start, once. `preview` answers the reach without sending (Reclub's "{{num}} players" line).
 * A player with a 'promoted' notification mute (settings › Promoted community meets) is left out.
 */
export const meta = {
	tags: ['meets'],
	requireCredential: true,
	prohibitMoved: true,
	kind: 'write:meets',
	limit: { duration: ms('1hour'), max: 60 },
	res: {
		type: 'object', optional: false, nullable: false,
		properties: {
			gate: { type: 'string', optional: false, nullable: false },
			reach: { type: 'number', optional: false, nullable: false },
			followers: { type: 'number', optional: false, nullable: false },
			nearby: { type: 'number', optional: false, nullable: false },
			club: { type: 'number', optional: false, nullable: false },
			audience: { type: 'string', optional: false, nullable: false },
			sent: { type: 'boolean', optional: false, nullable: false },
			promotedAt: { type: 'string', optional: false, nullable: true },
			windowHours: { type: 'number', optional: false, nullable: false },
			radiusKm: { type: 'number', optional: false, nullable: false },
		},
	},
	errors: {
		...meetErrors,
		notPublic: { message: 'Only available for public meets.', code: 'MEET_PROMOTE_NOT_PUBLIC', id: '6b1d0a3e-8f41-4c0b-9b7e-1a0000000030' },
		tooEarly: { message: 'You can only promote to the community 36 hours before start.', code: 'MEET_PROMOTE_TOO_EARLY', id: '6b1d0a3e-8f41-4c0b-9b7e-1a00000000ca' /* ERR-ID-UNIQUE-V1 (meets-fixes): was …0031, shared with claim-payment notCharging */ },
		alreadyPromoted: { message: 'Promoted.', code: 'MEET_ALREADY_PROMOTED', id: '6b1d0a3e-8f41-4c0b-9b7e-1a0000000032' },
		notClubMeet: { message: 'This meet is not posted in a club.', code: 'MEET_PROMOTE_NOT_CLUB', id: '6b1d0a3e-8f41-4c0b-9b7e-1a0000000037' },
		noReach: { message: 'There are no players matching your filters to promote to.', code: 'MEET_PROMOTE_NO_REACH', id: '6b1d0a3e-8f41-4c0b-9b7e-1a0000000033' },
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		meetId: { type: 'string', format: 'misskey:id' },
		preview: { type: 'boolean', default: false },
		// PROMOTE-AUDIENCE-V1: Reclub "CHOOSE YOUR AUDIENCE" — club members / nearby; 'all' = followers + nearby (V1)
		audience: { type: 'string', enum: ['all', 'club', 'proximity'], default: 'all' },
		// PROMOTE-FILTERS-V1 (lane club-posts-links, A-promote-meet.04 — Reclub promote(meetId, {audience, sportLevelIds,
		// genders, ageGroups})): narrow the audience to these skill levels / genders / age groups. Empty or absent = no filter
		// (Reclub "Select All"). Read from the player's own level row (meet_player_level), the facts the meet gate reads.
		levels: { type: 'array', maxItems: 7, uniqueItems: true, items: { type: 'string', enum: ['2.0', '2.5', '3.0', '3.5', '4.0', '4.5', '5.0+'] } },
		genders: { type: 'array', maxItems: 2, uniqueItems: true, items: { type: 'string', enum: ['female', 'male'] } },
		ageGroups: { type: 'array', maxItems: 3, uniqueItems: true, items: { type: 'string', enum: ['junior', 'adult', 'senior'] } },
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
		private meetService: MeetService,
		private notificationService: NotificationService,
		private userEntityService: UserEntityService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const meet = await this.meetsRepository.findOneBy({ id: ps.meetId });
			if (meet == null) throw new ApiError(meta.errors.noSuchMeet);
			try { await this.meetService.assertHost(meet, me); } catch (e) { return toApiError(e); }
			const gate = promoteGate(meet);
			const kind = (ps.audience ?? 'all') as PromoteAudienceKind;
			const filters = { levels: ps.levels ?? [], genders: ps.genders ?? [], ageGroups: ps.ageGroups ?? [] }; // PROMOTE-FILTERS-V1
			const base = { audience: kind, gate, windowHours: PROMOTE_WINDOW_HOURS, radiusKm: PROMOTE_RADIUS_KM, promotedAt: meet.promotedAt ? new Date(meet.promotedAt).toISOString() : null };
			if (ps.preview) {
				const a = gate === 'ok' ? await promoteAudience(this.db, meet, kind, filters) : { userIds: [], followers: 0, nearby: 0, club: 0 };
				return { ...base, reach: a.userIds.length, followers: a.followers, nearby: a.nearby, club: a.club, sent: false };
			}
			if (gate === 'not_public') throw new ApiError(meta.errors.notPublic);
			if (gate === 'too_early') throw new ApiError(meta.errors.tooEarly);
			if (gate === 'already_promoted') throw new ApiError(meta.errors.alreadyPromoted);
			if (gate === 'started') throw new ApiError(meta.errors.meetStarted);
			if (gate === 'not_active') throw new ApiError(meta.errors.meetNotActive);

			if (kind === 'club' && !meet.channelId) throw new ApiError(meta.errors.notClubMeet);
			const audience = await promoteAudience(this.db, meet, kind, filters);
			// Reclub settings › "Promoted community meets": a 'promoted' notification mute leaves the player out (table may be another stream's, read defensively)
			let muted = new Set<string>();
			try {
				// SOCIAL-NOTIF-V1 (Reclub E-notif-settings.06): two switches — a CLUB audience asks 'promotedClub', the community one 'promoted'
				const rows = await this.db.query(`SELECT "userId" FROM "notification_mute" WHERE "scope" = $1 AND "targetId" = ''`, [kind === 'club' ? 'promotedClub' : 'promoted']) as { userId: string }[];
				muted = new Set(rows.map((r) => r.userId));
			} catch { /* no such table yet */ }
			const userIds = audience.userIds.filter((id) => !muted.has(id));
			if (!userIds.length) throw new ApiError(meta.errors.noReach);

			// claim the once-only flag first so a double tap cannot fan out twice
			const now = new Date();
			const claimed = await this.db.query(`UPDATE "meet" SET "promotedAt" = $2, "promotedReach" = $3, "flags" = array_append(array_remove("flags", 'COMMUNITY_PROMOTED'), 'COMMUNITY_PROMOTED') WHERE "id" = $1 AND "promotedAt" IS NULL RETURNING "id"`, [meet.id, now, userIds.length]) as { id: string }[];
			if (!claimed.length) throw new ApiError(meta.errors.alreadyPromoted);

			const host = await this.userEntityService.pack(meet.hostId, me, { schema: 'UserLite' }).catch(() => null);
			const hostName = (host && (host.name || host.username)) || 'A host';
			const spotsLeft = await this.meetService.spotsLeft(meet);
			const body = promoteBody(hostName, meet, spotsLeft);
			for (const userId of userIds) {
				this.notificationService.createNotification(userId, 'app', {
					customHeader: 'Looking for players',
					customBody: body,
					customIcon: null,
					appAccessTokenId: null,
					customLink: 'meet:' + meet.id,
				}, meet.hostId);
			}
			return { ...base, gate: 'ok', reach: userIds.length, followers: audience.followers, nearby: audience.nearby, club: audience.club, sent: true, promotedAt: now.toISOString() };
		});
	}
}

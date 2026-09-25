/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { DataSource, IsNull } from 'typeorm';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DI } from '@/di-symbols.js';
import type { UsersRepository, UserProfilesRepository } from '@/models/_.js';
import { ApiError } from '@/server/api/error.js';
import { GB_SANDBOX_MAIL, isReservedTestAddress } from '@/misc/gb-accounts.js';

/*
 * ROLE-SWITCH-V1 (lane role-switch, 2026-09-26; operator: "testers must be able to go into EACH ROLE and play around on
 * uat.gripbat.com") — gb/role-door: sign in as one of SIX FIXED tester personas, one tap, no code.
 *
 * NEW: Misskey has no impersonation door (searched endpoint-list.ts: admin/* has no sign-in-as; SigninService needs a
 * password / passkey). hkpl's /api/v1/auth/qa/:role is the league's IdP door, retired for GripBat by G15.15.
 *
 * FENCES (all must hold, each on its own):
 *   1. The container has GB_SANDBOX_MAIL=1 (web-uat ONLY, compose.uat.yml — the UAT cage the sandbox mail code and the
 *      kudos sandbox date already use). Production has no such env: the door answers 404 exactly like a missing endpoint.
 *   2. Only the six addresses below, chosen by a ROLE name — never an arbitrary user, never an id or email from the client.
 *   3. The account must hold that address, verified, on a reserved test domain (RFC 2606 .test — no real inbox exists),
 *      local, not deleted, not suspended. The personas exist only in se_sbx (made by /root/gen/uat-seed/role-personas.cjs
 *      after the nightly clone); production's database never has them.
 *   4. Rate-limited per IP (endpoint limit below; no probe exemption).
 * The answer carries the account's EXISTING native token (the credential a native sign-in returns) — not rotated,
 * because several testers share a persona at once (a rotation would sign the others out).
 * `start` tells the app where the role's own tools are (the host's next meet, the club, …); the app picks the page.
 */
export const ROLE_PERSONAS = {
	player: 'jamie@try.gripbat.test',
	host: 'ethan@try.gripbat.test',
	owner: 'sophie@try.gripbat.test',
	admin: 'kelvin@try.gripbat.test',
	coach: 'rachel@try.gripbat.test',
	staff: 'olivia@try.gripbat.test',
} as const;
type Role = keyof typeof ROLE_PERSONAS;

export const meta = {
	tags: ['auth'],
	requireCredential: false,
	limit: { duration: 60 * 60 * 1000, max: 40 },
	errors: {
		off: { message: 'Unknown API endpoint.', code: 'UNKNOWN_API_ENDPOINT', id: '2ca3b769-540a-4f08-9dd5-b5a825b6d0f1', kind: 'client', httpStatusCode: 404 },
		notReady: { message: 'This test persona is not set up right now.', code: 'ROLE_PERSONA_MISSING', id: '8f2b4c1e-5d0a-4e7b-9c3f-6a1d2e0f7b11', httpStatusCode: 409 },
	},
	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			i: { type: 'string', optional: false, nullable: false },
			id: { type: 'string', optional: false, nullable: false },
			role: { type: 'string', optional: false, nullable: false },
			name: { type: 'string', optional: false, nullable: true },
			start: { type: 'object', optional: false, nullable: false },
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		role: { type: 'string', enum: ['player', 'host', 'owner', 'admin', 'coach', 'staff'] },
	},
	required: ['role'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.db)
		private db: DataSource,

		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,

		@Inject(DI.userProfilesRepository)
		private userProfilesRepository: UserProfilesRepository,
	) {
		super(meta, paramDef, async (ps) => {
			if (!GB_SANDBOX_MAIL) throw new ApiError(meta.errors.off);
			const role = ps.role as Role;
			const email = ROLE_PERSONAS[role];
			if (!email || !isReservedTestAddress(email)) throw new ApiError(meta.errors.off);
			const profile = await this.userProfilesRepository.createQueryBuilder('p')
				.where('p.emailVerified = true')
				.andWhere('LOWER(p.email) = :e', { e: email })
				.getOne();
			const user = profile ? await this.usersRepository.findOneBy({ id: profile.userId, host: IsNull() }) : null;
			if (!user || user.isDeleted || user.isSuspended || !user.token) throw new ApiError(meta.errors.notReady);

			const one = async (q: string): Promise<string | null> => {
				const rows = await this.db.query(q, [user.id]) as { id: string }[];
				return rows.length ? String(rows[0].id) : null;
			};
			const start: Record<string, string | null> = {};
			if (role === 'host') {
				start.meetId = await one(`SELECT id FROM meet WHERE "hostId" = $1 AND status = 'active' AND "coachScheduleId" IS NULL AND "startAt" > now() ORDER BY "startAt" LIMIT 1`);
			} else if (role === 'owner') {
				start.clubId = await one(`SELECT c.id FROM channel c JOIN club_setting s ON s."channelId" = c.id WHERE c."userId" = $1 AND c."isArchived" = false ORDER BY c."createdAt" LIMIT 1`);
			} else if (role === 'admin') {
				start.clubId = await one(`SELECT c.id FROM club_setting s JOIN channel c ON c.id = s."channelId" WHERE $1 = ANY(s."adminIds") AND c."userId" <> $1 AND c."isArchived" = false ORDER BY c."createdAt" LIMIT 1`);
			}
			return { i: user.token, id: user.id, role, name: user.name ?? null, start };
		});
	}
}

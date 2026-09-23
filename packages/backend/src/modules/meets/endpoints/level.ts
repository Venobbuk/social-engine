/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DI } from '@/di-symbols.js';
import { IdService } from '@/core/IdService.js';
import { MeetLevelService } from '@/modules/meets/MeetLevelService.js';

// The signed-in player sets their own self rating / gender / age group for a sport (DUPR values come from the host adapter).
export const meta = {
	tags: ['meets'],
	requireCredential: true,
	prohibitMoved: true,
	kind: 'write:meets',
	res: {
		type: 'object', optional: false, nullable: false,
		properties: {
			sport: { type: 'string', optional: false, nullable: false },
			selfLevel: { type: 'number', optional: false, nullable: true },
			duprSingles: { type: 'number', optional: false, nullable: true },
			duprDoubles: { type: 'number', optional: false, nullable: true },
			gender: { type: 'string', optional: false, nullable: true },
			ageGroup: { type: 'string', optional: false, nullable: true },
			onboarded: { type: 'boolean', optional: false, nullable: false },
			// GB-CONSENT-V1: the member's latest accepted terms / privacy version and when (ISO, server clock); null = never
			// accepted. Per ACCOUNT (the same whatever sport this call names); history in gb_terms_acceptance.
			termsVersion: { type: 'string', optional: false, nullable: true },
			termsAcceptedAt: { type: 'string', optional: false, nullable: true },
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		sport: { type: 'string', minLength: 1, maxLength: 32, default: 'pickleball' },
		selfLevel: { type: 'number', nullable: true, minimum: 0, maximum: 10 },
		// LEVEL-CLEAR-V1 (meets-fixes, 2026-09-23): a nullable + enum param REJECTS null (ajv — AGENT_RULES Misskey traps), so
		// gender / age group could never be cleared once set. 'none' is the clear sentinel: it stores null.
		gender: { type: 'string', nullable: true, enum: ['male', 'female', 'nonbinary', 'none'] },
		ageGroup: { type: 'string', nullable: true, enum: ['junior', 'adult', 'senior', 'none'] },
		// ONBOARDED-V1: true stamps onboardedAt (once; later trues keep the first stamp). false/absent leaves it alone.
		onboarded: { type: 'boolean' },
		// GB-CONSENT-V1: the member accepts this version of the GripBat terms + privacy policy. The server stamps the time and
		// APPENDS a row (history kept); accepting the version that is already the latest keeps its first stamp.
		acceptTerms: { type: 'string', minLength: 1, maxLength: 32 },
		// DUPR-UNLINK-V1 (W2-S): true = the player unlinked DUPR on the host (hkpl PATCH /me/profile {dupr_id: null}); forget the
		// DUPR id here too so GripBat stops calling them connected. Only ever the caller's own row; the rating value stays (as on hkpl).
		unlinkDupr: { type: 'boolean' },
	},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private meetLevelService: MeetLevelService,
		private idService: IdService,
		@Inject(DI.db) private db: DataSource,
	) {
		super(meta, paramDef, async (ps, me) => {
			const patch: Record<string, unknown> = {};
			if (ps.selfLevel !== undefined) patch.selfLevel = ps.selfLevel;
			if (ps.gender !== undefined) patch.gender = ps.gender === 'none' ? null : ps.gender;         // LEVEL-CLEAR-V1
			if (ps.ageGroup !== undefined) patch.ageGroup = ps.ageGroup === 'none' ? null : ps.ageGroup; // LEVEL-CLEAR-V1
			if (ps.unlinkDupr === true) patch.duprId = null;
			if (ps.onboarded === true) {
				const current = await this.meetLevelService.getLevel(me.id, ps.sport);
				if (current?.onboardedAt == null) patch.onboardedAt = new Date();
			}
			const latest = async () => (await this.db.query(`SELECT "version", "acceptedAt" FROM "gb_terms_acceptance" WHERE "userId" = $1 ORDER BY "acceptedAt" DESC, "id" DESC LIMIT 1`, [me.id]) as { version: string; acceptedAt: Date }[])[0] ?? null;
			let terms = await latest();
			if (ps.acceptTerms !== undefined && terms?.version !== ps.acceptTerms) {
				await this.db.query(`INSERT INTO "gb_terms_acceptance" ("id", "userId", "version") VALUES ($1, $2, $3)`, [this.idService.gen(), me.id, ps.acceptTerms]);
				terms = await latest();
			}
			const level = await this.meetLevelService.upsertLevel(me.id, ps.sport, patch);
			return {
				sport: level.sport,
				selfLevel: level.selfLevel,
				duprSingles: level.duprSingles,
				duprDoubles: level.duprDoubles,
				gender: level.gender,
				ageGroup: level.ageGroup,
				onboarded: !!level.onboardedAt,
				termsVersion: terms?.version ?? null,
				termsAcceptedAt: terms ? new Date(terms.acceptedAt).toISOString() : null,
			};
		});
	}
}

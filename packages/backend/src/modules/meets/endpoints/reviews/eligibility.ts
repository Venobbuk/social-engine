/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DI } from '@/di-symbols.js';

// KUDOS-CHAT-V1 (A-review-player.04) — Reclub checkReviewEligibility (`/reviews/eligibility`): may I review this player
// from their profile? Yes when we both played a meet that has started (confirmed, or its host — the same rule as
// MeetService.assertPlayedTogether, which meets/reviews/upsert applies again on write). Answers the most recent such
// meet, so the review is filed against it exactly as one given from the meet page. NEW: Misskey has no reviews; this
// is GripBat's meets module. Only the caller's own eligibility is answered (nothing about third parties).
export const meta = {
	tags: ['meets'],
	requireCredential: true,
	kind: 'read:meets',
	res: { type: 'object', optional: false, nullable: false, properties: {
		eligible: { type: 'boolean', optional: false, nullable: false },
		meet: { type: 'object', optional: false, nullable: true, properties: {
			id: { type: 'string', optional: false, nullable: false },
			name: { type: 'string', optional: false, nullable: false },
			startAt: { type: 'string', optional: false, nullable: false },
		} },
		playedTogether: { type: 'number', optional: false, nullable: false },
	} },
} as const;

export const paramDef = {
	type: 'object',
	properties: { userId: { type: 'string', format: 'misskey:id' } },
	required: ['userId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(@Inject(DI.db) private db: DataSource) {
		super(meta, paramDef, async (ps, me) => {
			if (ps.userId === me.id) return { eligible: false, meet: null, playedTogether: 0 };
			const rows = await this.db.query(
				`SELECT m.id, m.name, m."startAt"
				   FROM meet m
				  WHERE m.status <> 'cancelled' AND m."startAt" <= now()
				    AND EXISTS (SELECT 1 FROM meet_participant a WHERE a."meetId" = m.id AND a."userId" = $1 AND (a.status = 'confirmed' OR a."isHost"))
				    AND EXISTS (SELECT 1 FROM meet_participant b WHERE b."meetId" = m.id AND b."userId" = $2 AND (b.status = 'confirmed' OR b."isHost"))
				  ORDER BY m."startAt" DESC LIMIT 50`, [me.id, ps.userId]) as { id: string; name: string; startAt: Date }[];
			const m = rows[0];
			return { eligible: !!m, meet: m ? { id: m.id, name: m.name, startAt: new Date(m.startAt).toISOString() } : null, playedTogether: rows.length };
		});
	}
}

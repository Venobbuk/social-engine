/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DI } from '@/di-symbols.js';
import { UserEntityService } from '@/core/entities/UserEntityService.js';

// GB-FRIEND-SUGGEST-V1 (2026-09-21): friend suggestions that carry their REASON.
//
// Reclub's friends are DECLARED — you assert you know someone, and the best it can offer as a reason is a count of
// mutual friends. GripBat already knows who actually PLAYED together, so a suggestion here is EVIDENCED: "you have
// played with Ken 6 times", "you and Amy are 7-2 together". A request that arrives with a shared history gets
// accepted; a cold one gets ignored. The engine returns the evidence as NUMBERS and a `kind`; the app writes the
// sentence, so the reason localises (EN / 繁 / 简) without the engine holding any copy.
//
// PRIVACY — why this door cannot leak, and the rule any future edit must keep:
//  · Every candidate is drawn ONLY from meets THE VIEWER was a confirmed participant of. The viewer stood on that
//    court, so everyone there was already visible to them. A private meet, a private club or a person the viewer
//    could not already see can never enter a suggestion, because the door never reads a meet the viewer missed.
//  · No meet, club, venue, or match is ever NAMED in the response. The evidence is a count over the viewer's own
//    history — nothing that could identify a private gathering.
//  · Partner chemistry obeys SEC-ANON-CHEM-V1 (gb-pairs.ts) and SEC-ANON-FIELDS-V1 (gb-edge.ts) and goes STRICTLY
//    further: a chemistry reason is built only when the viewer is ONE OF THE PAIR **and** the edge is >= 0. A
//    NEGATIVE chemistry score is private to the two players — here it never becomes a reason at all, so it cannot
//    reach a card, a tooltip or a sort order. It is excluded before ranking, not merely omitted from the text.
//  · Blocked (either direction), muted, suspended and deleted accounts are dropped, as is anyone the viewer already
//    follows — they are already a friend or an outstanding request of theirs.
//
// CONTRACT: every number is computed from live rows at read time. There is no stored running total anywhere.
// A chemistry reason needs at least this many rated matches together, so "7-2 together" rests on a real record and
// not on one lucky game. Set to 2 from the live distribution (2026-09-21: the deepest partnership on prod has 2
// rated matches, so a higher bar would make the reason unreachable); raise it as match volume grows.
const MIN_CHEM_MATCHES = 2;

export const meta = {
	tags: ['stats'],
	requireCredential: true,
	kind: 'read:meets',
	res: { type: 'array', optional: false, nullable: false, items: { type: 'object', optional: false, nullable: false, properties: {
		userId: { type: 'string', optional: false, nullable: false },
		user: { type: 'object', optional: false, nullable: true, ref: 'UserLite' },
		state: { type: 'string', optional: false, nullable: false },     // 'none' | 'incoming' (they already follow me)
		score: { type: 'number', optional: false, nullable: false },
		reason: { type: 'object', optional: false, nullable: false, properties: {
			kind: { type: 'string', optional: false, nullable: false },  // 'chemistry' | 'played_together' | 'played_once'
			meets: { type: 'number', optional: false, nullable: false },
			matches: { type: 'number', optional: false, nullable: false },
			wins: { type: 'number', optional: true, nullable: true },
			losses: { type: 'number', optional: true, nullable: true },
		} },
		evidence: { type: 'object', optional: false, nullable: false, properties: {
			meetsTogether: { type: 'number', optional: false, nullable: false },
			matchesTogether: { type: 'number', optional: false, nullable: false },
			lastPlayedAt: { type: 'string', optional: false, nullable: true },
		} },
	} } },
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		sport: { type: 'string', default: 'pickleball', maxLength: 32 },
		limit: { type: 'integer', minimum: 1, maximum: 50, default: 12 },
	},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.db)
		private db: DataSource,
		private userEntityService: UserEntityService,
	) {
		super(meta, paramDef, async (ps, me) => {
			// Co-attendance, restricted to meets THE VIEWER attended (see PRIVACY above). `mine` is the viewer's own
			// past, confirmed, non-cancelled meets; `peer` is who else was confirmed on those same meets.
			const rows = await this.db.query(
				`WITH mine AS (
				   SELECT p."meetId" AS mid
				     FROM meet_participant p JOIN meet m ON m.id = p."meetId"
				    WHERE p."userId" = $1 AND p.status = 'confirmed'
				      AND m.status <> 'cancelled' AND m."startAt" < now()
				 ), peer AS (
				   SELECT p."userId" AS uid,
				          count(DISTINCT p."meetId")::int AS meets,
				          max(m."startAt") AS last_at
				     FROM meet_participant p
				     JOIN meet m ON m.id = p."meetId"
				     JOIN mine ON mine.mid = p."meetId"
				    WHERE p.status = 'confirmed' AND p."userId" IS NOT NULL AND p."userId" <> $1
				    GROUP BY 1
				 )
				 SELECT peer.uid, peer.meets, peer.last_at,
				        EXISTS (SELECT 1 FROM following f2
				                 WHERE f2."followerId" = peer.uid AND f2."followeeId" = $1) AS follows_me
				   FROM peer
				   JOIN "user" u ON u.id = peer.uid
				  WHERE u."isSuspended" = false AND u."isDeleted" = false
				    -- already following = already a friend, or already my outstanding request
				    AND NOT EXISTS (SELECT 1 FROM following f
				                     WHERE f."followerId" = $1 AND f."followeeId" = peer.uid)
				    AND NOT EXISTS (SELECT 1 FROM blocking b
				                     WHERE (b."blockerId" = $1 AND b."blockeeId" = peer.uid)
				                        OR (b."blockerId" = peer.uid AND b."blockeeId" = $1))
				    AND NOT EXISTS (SELECT 1 FROM muting mu
				                     WHERE mu."muterId" = $1 AND mu."muteeId" = peer.uid)`,
				[me.id]) as { uid: string; meets: number; last_at: Date | null; follows_me: boolean }[];
			if (!rows.length) return [];

			// The viewer's OWN partner record, per partner — the viewer is one of the pair by construction ($1 = me).
			const chem = await this.db.query(
				`SELECT "partnerId" AS pid, count(*)::int AS n,
				        coalesce(sum(CASE WHEN won THEN 1 ELSE 0 END), 0)::int AS w,
				        coalesce(sum(expected), 0)::float AS e
				   FROM gb_rating_log
				  WHERE "userId" = $1 AND sport = $2 AND NOT skipped AND "partnerId" IS NOT NULL
				  GROUP BY 1`,
				[me.id, ps.sport]) as { pid: string; n: number; w: number; e: number }[];
			const chemBy = new Map(chem.map(c => [c.pid, c]));

			const out = rows.map(r => {
				const c = chemBy.get(r.uid);
				const matches = c ? c.n : 0;
				// SEC-ANON-CHEM-V1, applied harder: only a NON-NEGATIVE edge may become a reason. A negative one is
				// private to the two players — it is dropped here, before ranking, so it cannot leak through order.
				const edge = c && c.n > 0 ? (c.w - c.e) / c.n : 0;
				const positive = c != null && c.n >= MIN_CHEM_MATCHES && edge >= 0;
				const reason = positive
					? { kind: 'chemistry', meets: r.meets, matches, wins: c!.w, losses: c!.n - c!.w }
					: { kind: r.meets >= 2 ? 'played_together' : 'played_once', meets: r.meets, matches, wins: null, losses: null };
				return {
					userId: r.uid,
					user: null as unknown,
					state: r.follows_me ? 'incoming' : 'none',
					score: (r.meets * 10) + (matches * 2) + (positive ? 5 : 0),
					reason,
					evidence: {
						meetsTogether: r.meets,
						matchesTogether: matches,
						lastPlayedAt: r.last_at ? new Date(r.last_at).toISOString() : null,
					},
				};
			});
			// Real evidence first: most shared meets, then most matches, then most recent.
			out.sort((a, b) => b.score - a.score
				|| b.evidence.matchesTogether - a.evidence.matchesTogether
				|| String(b.evidence.lastPlayedAt ?? '').localeCompare(String(a.evidence.lastPlayedAt ?? '')));
			const top = out.slice(0, ps.limit);
			for (const s of top) s.user = await this.userEntityService.pack(s.userId, me, { schema: 'UserLite' }).catch(() => null);
			return top;
		});
	}
}

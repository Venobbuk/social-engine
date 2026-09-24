/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DI } from '@/di-symbols.js';

/*
 * VENUES-REST-V1 (C-community-detail.01) — Reclub's community page (5854: metrics Activities / Clubs / Players / Sports
 * "Based on data from the last 6 months.", sport chips, the club list with "{n} members", the Create club card).
 *
 * WHAT A "COMMUNITY" IS IN GRIPBAT (decision, G15.0 + G15.15, recorded in probes/venues-discover-rest.verdict.json):
 * the whole GripBat server — every public club and public meet on it. Why not Reclub's many geographic communities:
 *   1. GripBat owns its accounts and its data (G15.15); there is no league or partner "community" to import, and
 *      switching between communities is operator-OOS (GRIPBAT_BACKLOG §5 "one-community-per-tenant switching").
 *   2. Reclub itself retired community borders for distance ("Community borders are out, flexibility is in. Reclub now
 *      automatically shows you meets and clubs based on how close they are to your home, work, or favorite spots.") —
 *      GripBat already has that part (saved locations + radius on Discover).
 *   3. What the page is FOR survives: a new player sees how alive the scene is (activities, clubs, players, sports in
 *      six months) and which clubs to join — and a host sees where to start one. `lat/lng/radiusKm` narrows it to "near
 *      me" (the Discover place), which is the one thing a single community lacked.
 * PRIVATE MEANS PRIVATE (G15.5): private meets and private clubs are not counted and not listed. Players = distinct
 * people CONFIRMED on a counted meet. Read-only aggregate, computed in the DB (never the full history in memory).
 */
export const meta = {
	tags: ['discover'],
	requireCredential: false,
	res: { type: 'object', optional: false, nullable: false },
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		sport: { type: 'string', nullable: true, maxLength: 32 },
		lat: { type: 'number', nullable: true, minimum: -90, maximum: 90 },
		lng: { type: 'number', nullable: true, minimum: -180, maximum: 180 },
		radiusKm: { type: 'number', nullable: true, minimum: 1, maximum: 200 },
		limit: { type: 'integer', minimum: 1, maximum: 100, default: 30 },
	},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(@Inject(DI.db) private db: DataSource) {
		super(meta, paramDef, async (ps) => {
			const since = new Date(Date.now() - 183 * 24 * 3600 * 1000);
			const near = ps.lat != null && ps.lng != null;
			const r = ps.radiusKm ?? 20;
			// the counted meets: public, not cancelled, started in the last six months (or later), optionally within r km
			const args: unknown[] = [since];
			let where = `m.visibility = 'public' AND m.status <> 'cancelled' AND m."startAt" >= $1`;
			if (ps.sport) { args.push(ps.sport); where += ` AND m.sport = $${args.length}`; }
			if (near) {
				args.push(ps.lat, ps.lng, r);
				const la = `$${args.length - 2}`, ln = `$${args.length - 1}`, rk = `$${args.length}`;
				where += ` AND m.lat IS NOT NULL AND m.lng IS NOT NULL AND 6371 * 2 * asin(least(1, sqrt(power(sin(radians(m.lat - ${la}) / 2), 2) + cos(radians(${la})) * cos(radians(m.lat)) * power(sin(radians(m.lng - ${ln}) / 2), 2)))) <= ${rk}`;
			}
			const [agg] = await this.db.query(`
				SELECT count(*)::int AS activities,
					count(DISTINCT m.sport)::int AS sports,
					(SELECT count(DISTINCT p."userId")::int FROM meet_participant p WHERE p.status = 'confirmed' AND p."meetId" IN (SELECT m.id FROM meet m WHERE ${where})) AS players
				FROM meet m WHERE ${where}`, args) as { activities: number; sports: number; players: number }[];
			const sports = (await this.db.query(`SELECT m.sport, count(*)::int AS n FROM meet m WHERE ${where} GROUP BY m.sport ORDER BY n DESC`, args) as { sport: string; n: number }[]);
			// the clubs: public, not archived; near = a club with a counted meet in range. Ordered by members.
			const cargs: unknown[] = [];
			let cwhere = `c."isArchived" = false AND coalesce(cs.visibility, 'public') = 'public'`;
			if (ps.sport) { cargs.push(ps.sport); cwhere += ` AND coalesce(cs.sport, 'pickleball') = $${cargs.length}`; }
			if (near) {
				const off = cargs.length;
				const nearWhere = where.replace(/\$(\d+)/g, (_, d) => '$' + (Number(d) + off));
				cargs.push(...args);
				cwhere += ` AND c.id IN (SELECT m."channelId" FROM meet m WHERE m."channelId" IS NOT NULL AND ${nearWhere})`;
			}
			const [{ n: clubCount }] = await this.db.query(`SELECT count(*)::int AS n FROM channel c JOIN club_setting cs ON cs."channelId" = c.id WHERE ${cwhere}`, cargs) as { n: number }[];
			cargs.push(since, ps.limit);
			const clubs = await this.db.query(`
				SELECT c.id, c.name, c."usersCount", c."bannerId", coalesce(cs.sport, 'pickleball') AS sport,
					(SELECT count(*)::int FROM meet m2 WHERE m2."channelId" = c.id AND m2.visibility = 'public' AND m2.status <> 'cancelled' AND m2."startAt" >= $${cargs.length - 1}) AS activities
				FROM channel c JOIN club_setting cs ON cs."channelId" = c.id
				WHERE ${cwhere}
				ORDER BY c."usersCount" DESC, c.id ASC LIMIT $${cargs.length}`, cargs) as { id: string; name: string; usersCount: number; bannerId: string | null; sport: string; activities: number }[];
			return {
				since: since.toISOString(),
				scope: near ? { lat: ps.lat, lng: ps.lng, radiusKm: r } : null,
				metrics: { activities: Number(agg?.activities) || 0, clubs: Number(clubCount) || 0, players: Number(agg?.players) || 0, sports: Math.max(Number(agg?.sports) || 0, sports.length) },
				sports: sports.map(s => ({ sport: s.sport, activities: s.n })),
				clubs: clubs.map(c => ({ id: c.id, name: c.name, membersCount: Number(c.usersCount) || 0, activities: Number(c.activities) || 0, sport: c.sport })),
			};
		});
	}
}

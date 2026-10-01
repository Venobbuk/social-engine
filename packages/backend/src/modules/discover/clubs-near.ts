/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { DataSource } from 'typeorm';
import { memberExistsSql, adminExistsSql } from '@/modules/clubs/club-tiers.js';

// DISCOVER-W2D (Reclub triage C-discover.15): "clubs near you" + the club card's facts. Used by the native
// channels/search (G11 EXTEND: lat/lng/radiusKm/club params) and by discover/search. A club (Misskey channel +
// club_setting) has no address of its own, so its position is read, in this order, from
//   1. its first club venue with a point (club_setting.venueIds → venue.lat/lng — CLUB-V3 club venues), else
//   2. the place its active meets of the last 180 days / upcoming use MOST (where the club actually plays; ties -> the latest).
//      CO-FIX CLUB-POS-MODE-V1 (2026-10-01): this was the AVERAGE of those points. A club that plays in Tuen Mun, Tai Po, Sha Tin
//      and Kowloon averaged to a hillside no one plays on, "6.6 km from Kowloon" (stranger walk CO-03). A real place it uses is
//      never further from the truth than the mean of several.
// A club with neither has no position: it is listed only when the reader asked for no location (Everywhere).
// The level is the club's own band (club_setting.level, free text) — null prints "All levels" (Reclub's default).

export interface ClubNearRow { id: string; level: string | null; visibility: string; lat: number | null; lng: number | null; upcomingMeets: number; usersCount: number; distanceKm: number | null }
type Raw = { id: string; usersCount: number; level: string | null; visibility: string; lat: number | null; lng: number | null; upcoming: number };

function km(aLat: number, aLng: number, bLat: number, bLng: number): number {
	const R = 6371, d2r = Math.PI / 180;
	const dLat = (bLat - aLat) * d2r, dLng = (bLng - aLng) * d2r;
	const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * d2r) * Math.cos(bLat * d2r) * Math.sin(dLng / 2) ** 2;
	return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** SEC (review-batch2 #3): a PRIVATE club is not discoverable. The rule is the one the rest of this series states -
 *  ClubService.assertMayFollow ("No one can see, request to join, or follow a private club, unless invited") and
 *  clubs/of-user:69-70 - so only its members (the owner included) and its admins get the row; to everyone else,
 *  every anonymous caller included, a private club is not there at all. Without this, discover/search and the lat/lng
 *  path on channels/search publish a private club's name, level, visibility, upcoming meets and its DISTANCE from the
 *  caller. `viewerExpr` is the viewer parameter ('' = anonymous). */
const notPrivateToThisViewer = (viewerExpr: string): string => `(COALESCE(cs.visibility, 'public') <> 'private'
		OR (${viewerExpr} <> '' AND (${memberExistsSql('c."id"', viewerExpr)} OR ${adminExistsSql('c."id"', viewerExpr)})))`;

/** THE facts query — one SELECT, the caller supplies the WHERE (on channel c) and its parameters. */
function facts(db: DataSource, where: string, args: unknown[], viewerExpr: string, tail = ''): Promise<Raw[]> {
	return db.query(`
		SELECT c.id, c."usersCount" AS "usersCount", cs.level, COALESCE(cs.visibility, 'public') AS visibility,
			COALESCE(vp.lat, mp.lat) AS lat, COALESCE(vp.lng, mp.lng) AS lng, COALESCE(up.n, 0) AS upcoming
		FROM channel c
		LEFT JOIN club_setting cs ON cs."channelId" = c.id
		LEFT JOIN LATERAL (SELECT v.lat, v.lng FROM venue v WHERE cs."venueIds" IS NOT NULL AND v.id = ANY(cs."venueIds") AND v.lat IS NOT NULL AND v.lng IS NOT NULL LIMIT 1) vp ON true
		LEFT JOIN LATERAL (SELECT m.lat, m.lng FROM meet m WHERE m."channelId" = c.id AND m.lat IS NOT NULL AND m.lng IS NOT NULL AND m.status = 'active' AND m."startAt" > now() - interval '180 days' GROUP BY m.lat, m.lng ORDER BY count(*) DESC, max(m."startAt") DESC LIMIT 1) mp ON true
		LEFT JOIN LATERAL (SELECT count(*)::int AS n FROM meet m WHERE m."channelId" = c.id AND m.status = 'active' AND m."startAt" >= now() AND NOT ('casual' = ANY(m.flags))) up ON true
		WHERE ${where} AND ${notPrivateToThisViewer(viewerExpr)} ${tail}`, args) as Promise<Raw[]>;
}

function toRow(r: Raw, here: { lat: number; lng: number } | null): ClubNearRow {
	const lat = r.lat != null ? Number(r.lat) : null, lng = r.lng != null ? Number(r.lng) : null;
	return { id: r.id, level: r.level, visibility: r.visibility, lat, lng, upcomingMeets: Number(r.upcoming) || 0, usersCount: Number(r.usersCount) || 0, distanceKm: here && lat != null && lng != null ? Math.round(km(here.lat, here.lng, lat, lng) * 10) / 10 : null };
}

/** Live clubs matching the keyword; with a point, only those within radiusKm, nearest first. */
export async function clubsNear(db: DataSource, q: { q?: string | null; lat?: number | null; lng?: number | null; radiusKm?: number | null; limit: number; offset?: number; viewerId?: string | null }): Promise<ClubNearRow[]> {
	const kw = (q.q ?? '').trim().replace(/[%_\\]/g, '');
	const rows = await facts(db, `c."isArchived" = false AND ($1 = '' OR c.name ILIKE $2 OR c.description ILIKE $2)`,
		[kw, `%${kw}%`, q.viewerId ?? ''], '$3', 'ORDER BY c."usersCount" DESC, c.id DESC LIMIT 1000');
	const here = q.lat != null && q.lng != null ? { lat: q.lat, lng: q.lng } : null;
	const radius = q.radiusKm ?? 20;
	let out = rows.map((r) => toRow(r, here));
	// DISCOVER-UNPLACED-V1 (L6-DISCOVER-HOME 2026-09-27, orchestrator): a club with NO position (no club venue, no placed meet —
	// every new club) is kept in a near list, after the near ones: it was dropped, so a player with a saved home never saw a
	// club created a minute ago. A typed name is explicit intent: with a keyword the radius does not cut, it only orders.
	if (here) {
		const near = out.filter((r) => r.distanceKm != null && (kw !== '' || r.distanceKm <= radius)).sort((a, b) => (a.distanceKm! - b.distanceKm!) || (b.usersCount - a.usersCount));
		out = near.concat(out.filter((r) => r.distanceKm == null));
	}
	const off = q.offset ?? 0;
	return out.slice(off, off + q.limit);
}

/** The same facts for given clubs (the native channels/search keyword path), by id. A private club the viewer is not
 *  in gets NO facts row: the native channel row stays exactly as Misskey answers it, with no level / visibility /
 *  upcoming meets added to it (review-batch2 #3). */
export async function clubFacts(db: DataSource, ids: string[], viewerId: string | null = null): Promise<Map<string, ClubNearRow>> {
	const out = new Map<string, ClubNearRow>();
	if (!ids.length) return out;
	for (const r of await facts(db, 'c.id = ANY($1)', [ids, viewerId ?? ''], '$2')) out.set(r.id, toRow(r, null));
	return out;
}

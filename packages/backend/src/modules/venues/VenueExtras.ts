/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { In } from 'typeorm';
import type { DataSource } from 'typeorm';
import type { DriveFilesRepository } from '@/models/_.js';
import type { DriveFileEntityService } from '@/core/entities/DriveFileEntityService.js';
import { isGripbatStaff } from '@/modules/staff.js';

/*
 * VENUES-REST-V1 (lane venues-discover-rest, 2026-09-23) — the venue doors Reclub has and the engine lacked:
 *   media   (Reclub 7374 media.tsx: month grid, Add, select-delete, download; 6263 gallery: Pin to carousel top)
 *   owners  (Reclub 7379 venue-owner.tsx: several owners; 6263 owner/staff Edit Venue / Delete Venue / Manage Owners)
 *   pins    (Reclub pinVenue / unpinVenue: the venue in the Home pinned quick bar)
 * Plain functions over raw SQL (tables from migration 1789099200000), like modules/staff.ts — no entity, so no shared
 * registry file (postgres.ts, RepositoryModule, CoreModule) is touched. G11: a photo IS a native drive file, uploaded
 * through the native drive/files/create; these rows only tie it to a venue. A venue is a GripBat concept (rule 3).
 */

export const venueRestErrors = {
	noSuchVenue: { message: 'No such venue.', code: 'NO_SUCH_VENUE', id: '7c2e1b4f-9a52-4d1c-8c8f-2b0000000001' },
	notManager: { message: 'Only the venue owners or GripBat staff can do this.', code: 'NOT_VENUE_MANAGER', id: '7c2e1b4f-9a52-4d1c-8c8f-2b0000000010', kind: 'permission', httpStatusCode: 403 },
	notDeleter: { message: 'Only GripBat staff, or the owner of a player-added venue, can delete it.', code: 'NOT_VENUE_DELETER', id: '7c2e1b4f-9a52-4d1c-8c8f-2b0000000011', kind: 'permission', httpStatusCode: 403 },
	noSuchFile: { message: 'The photo must be an image in your own drive.', code: 'NO_SUCH_FILE', id: '7c2e1b4f-9a52-4d1c-8c8f-2b0000000012' },
	tooManyPhotos: { message: 'You can add up to 40 photos to one venue.', code: 'VENUE_TOO_MANY_PHOTOS', id: '7c2e1b4f-9a52-4d1c-8c8f-2b0000000013' },
	noSuchMedia: { message: 'No such photo.', code: 'NO_SUCH_VENUE_MEDIA', id: '7c2e1b4f-9a52-4d1c-8c8f-2b0000000014' },
	notMediaDeleter: { message: 'Only the person who added a photo, the venue owners or GripBat staff can delete it.', code: 'NOT_MEDIA_DELETER', id: '7c2e1b4f-9a52-4d1c-8c8f-2b0000000015', kind: 'permission', httpStatusCode: 403 },
	tooManyPins: { message: 'You can pin up to 12 venues.', code: 'VENUE_TOO_MANY_PINS', id: '7c2e1b4f-9a52-4d1c-8c8f-2b0000000016' },
	noSuchUser: { message: 'No such user.', code: 'NO_SUCH_USER', id: '7c2e1b4f-9a52-4d1c-8c8f-2b0000000017' },
} as const;

export const PER_USER_PHOTOS = 40;
export const MAX_PINS = 12;

export interface VenueRow { id: string; name: string; source: string; ownerUserId: string | null; coOwnerIds: string[] }

export async function venueRow(db: DataSource, venueId: string): Promise<VenueRow | null> {
	const r = await db.query(`SELECT id, name, source, "ownerUserId", "coOwnerIds" FROM venue WHERE id = $1`, [venueId]) as VenueRow[];
	if (!r.length) return null;
	return { ...r[0], coOwnerIds: Array.isArray(r[0].coOwnerIds) ? r[0].coOwnerIds : [] };
}

/** Who this reader is to the venue: an owner (primary or co-owner), GripBat staff, both, or neither. */
export async function roleOn(db: DataSource, v: VenueRow, userId: string | null | undefined): Promise<{ owner: boolean; primary: boolean; staff: boolean; manager: boolean }> {
	if (!userId) return { owner: false, primary: false, staff: false, manager: false };
	const primary = v.ownerUserId === userId;
	const owner = primary || v.coOwnerIds.includes(userId);
	const staff = await isGripbatStaff(db, userId);
	return { owner, primary, staff, manager: owner || staff };
}

export interface MediaOut { id: string; venueId: string; fileId: string; url: string; thumbnailUrl: string; type: string; width: number | null; height: number | null; userId: string; isPinned: boolean; createdAt: string; canDelete: boolean; canPin: boolean }

/** A venue's photos: pinned first, then newest. canDelete / canPin are this reader's rights (the app hides the rest). */
export async function listMedia(db: DataSource, files: DriveFilesRepository, dfes: DriveFileEntityService, venueId: string, reader: { id: string; manager: boolean } | null, limit = 100): Promise<MediaOut[]> {
	const rows = await db.query(`SELECT m.id, m."fileId", m."userId", m."isPinned", m."createdAt" FROM venue_media m WHERE m."venueId" = $1 ORDER BY m."isPinned" DESC, m."createdAt" DESC LIMIT $2`, [venueId, Math.min(Math.max(limit, 1), 200)]) as { id: string; fileId: string; userId: string; isPinned: boolean; createdAt: Date }[];
	if (!rows.length) return [];
	const byId = new Map((await files.findBy({ id: In(rows.map(r => r.fileId)) })).map(f => [f.id, f]));
	const out: MediaOut[] = [];
	for (const r of rows) {
		const f = byId.get(r.fileId);
		if (!f || !f.type.startsWith('image/')) continue;
		const url = dfes.getPublicUrl(f);
		const props = dfes.getPublicProperties(f);
		out.push({
			id: r.id, venueId, fileId: r.fileId, url, thumbnailUrl: dfes.getThumbnailUrl(f) ?? url, type: f.type,
			width: props.width ?? null, height: props.height ?? null, userId: r.userId, isPinned: !!r.isPinned,
			createdAt: new Date(r.createdAt).toISOString(),
			canDelete: !!reader && (reader.manager || reader.id === r.userId), canPin: !!reader && reader.manager,
		});
	}
	return out;
}

/** Up to `per` photo thumbnails for each of these venues (the Discover card carousel), pinned first then newest. */
export async function coversOf(db: DataSource, files: DriveFilesRepository, dfes: DriveFileEntityService, venueIds: string[], per = 5): Promise<Record<string, { url: string; thumbnailUrl: string }[]>> {
	const out: Record<string, { url: string; thumbnailUrl: string }[]> = {};
	if (!venueIds.length) return out;
	const rows = await db.query(`SELECT "venueId", "fileId" FROM (
		SELECT m."venueId", m."fileId", row_number() OVER (PARTITION BY m."venueId" ORDER BY m."isPinned" DESC, m."createdAt" DESC) AS rn
		FROM venue_media m WHERE m."venueId" = ANY($1)) x WHERE rn <= $2`, [venueIds, per]) as { venueId: string; fileId: string }[];
	if (!rows.length) return out;
	const byId = new Map((await files.findBy({ id: In(rows.map(r => r.fileId)) })).map(f => [f.id, f]));
	for (const r of rows) {
		const f = byId.get(r.fileId);
		if (!f || !f.type.startsWith('image/')) continue;
		const url = dfes.getPublicUrl(f);
		(out[r.venueId] = out[r.venueId] || []).push({ url, thumbnailUrl: dfes.getThumbnailUrl(f) ?? url });
	}
	return out;
}

export async function mediaCount(db: DataSource, venueId: string): Promise<number> {
	const r = await db.query(`SELECT count(*)::int AS n FROM venue_media WHERE "venueId" = $1`, [venueId]) as { n: number }[];
	return Number(r[0]?.n) || 0;
}

export async function isPinnedBy(db: DataSource, venueId: string, userId: string | null | undefined): Promise<boolean> {
	if (!userId) return false;
	const r = await db.query(`SELECT 1 FROM venue_pin WHERE "venueId" = $1 AND "userId" = $2 LIMIT 1`, [venueId, userId]) as unknown[];
	return r.length > 0;
}

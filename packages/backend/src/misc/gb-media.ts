/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { GB_PUBLIC_ORIGIN } from '@/misc/gb-accounts.js';

/*
 * GB-MEDIA-HOST-V1 (lane G2-HOSTS, 2026-09-25, GLOBAL_CONTRACT G2) — the media a GripBat user sees loads from the GripBat
 * host, never from the engine's storage host. Measured before: every uploaded photo (drive file url / thumbnailUrl, an
 * avatar, a club cover, a coach photo, a receipt) was https://media.social.silkvo.com/files/<key>, an avatar went
 * through https://social.silkvo.com/proxy/avatar.webp?url=…, and a default avatar was https://social.silkvo.com/identicon/….
 *
 * What changes is only the URL the engine EMITS, on a GripBat engine (env GB_PUBLIC_ORIGIN — server config, one value per
 * container, never a request header, G15.13):
 *   <meta.objectStorageBaseUrl>/<key>  →  <GB_PUBLIC_ORIGIN>/media/<key>
 * nginx serves /media/files/ on gripbat.com and uat.gripbat.com from the same bucket (sites-enabled/gripbat.com.conf), so
 * no new DNS. Nothing is rewritten in the database: stored rows keep the storage host, which keeps answering, so every old
 * URL anywhere (a copied link, a profile field) still loads. Without GB_PUBLIC_ORIGIN the engine behaves as stock Misskey.
 */
export const GB_MEDIA_PATH = '/media';

/** The live meta row (DI.meta is updated in place on metaUpdated), registered once by DriveFileEntityService. */
let metaRef: { objectStorageBaseUrl: string | null } | null = null;
export function gbMediaUseMeta(meta: { objectStorageBaseUrl: string | null }): void {
	metaRef = meta;
}

/** A URL on the object-storage base → the same object under <GB_PUBLIC_ORIGIN>/media/. Anything else is returned as is. */
export function gbMediaUrl<T extends string | null | undefined>(url: T): T {
	if (!GB_PUBLIC_ORIGIN || typeof url !== 'string' || url === '') return url;
	const base = (metaRef?.objectStorageBaseUrl ?? '').replace(/\/+$/, '');
	if (!base || !url.startsWith(base + '/')) return url;
	return (GB_PUBLIC_ORIGIN + GB_MEDIA_PATH + url.slice(base.length)) as T;
}

/** The engine's own media proxy / identicon base on a GripBat engine: the GripBat origin (nginx passes /proxy/ and
 *  /identicon/ through to this engine), else the stock value. */
export function gbEngineOrigin(configUrl: string): string {
	return GB_PUBLIC_ORIGIN || configUrl.replace(/\/+$/, '');
}

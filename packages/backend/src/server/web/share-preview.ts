/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/* OG-SHARE-V1 — the share-link preview card (OG_PREVIEW_PLAN.md, 2026-09-18).
 *
 * `GET /share/:kind/:id` (kind = meet | club | player) answers a crawler (WhatsApp, WeChat, Telegram, iMessage…) with
 * a ~1 KB head-only page: og:title / og:description / og:image / og:url + a `<meta refresh>` to the app page, so a
 * human who lands on it goes to the app. nginx rewrites the app URLs to this route ONLY for crawler user agents
 * (`map $http_user_agent $gb_crawler`); humans keep the static app index exactly as before.
 *
 * The meet art and the initials avatar copy the app's `src/lib/boyau-art.ts` (ART.action / ART.club pools, the FNV-1a
 * hash, the ACCENT palette, accentKey) so a card shows the same photo / the same colour the app shows for that id.
 * Keep the two in step by hand: there is no shared package between the Taro app and the engine.
 */

const ART_BASE = '/app/static/boyau/img/';

/** boyau-art.ts `ART.action` — the photo a MEET carries. Order matters: the pick is `hash(id) % length`. */
export const ART_ACTION = ['jardim-kovalova-net', 'dupr-nights-doubles', 'spanish-armada-and-u-s-armed-forces-comp-2', 'newport-doubles-shootout', 'spanish-armada-and-u-s-armed-forces-comp-3', 'willy-chung-playing', 'spanish-armada-and-u-s-armed-forces-comp-4', 'pickleball-pros'] as const;
/** boyau-art.ts `ART.club` — the banner a CLUB carries when its owner has not uploaded one. */
export const ART_CLUB = ['newport-doubles-shootout', 'uah-pickleball-club-nationals-2026-bid-w', 'dupr-nights-doubles', 'pickleball-pros', 'outdoor-pickleball-courts', 'sports-court-harmony-of-the-seas-2025', 'aerial-pickleball-courts', 'hunter-s-pt-community-pk-td-2023-08-21-0'] as const;

/** boyau-art.ts `hash` — FNV-1a over UTF-16 code units, int32 multiply, abs. */
export function artHash(id: string): number {
	let h = 2166136261;
	for (let i = 0; i < id.length; i++) {
		h ^= id.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return Math.abs(h);
}

function pick(list: readonly string[], id: string): string {
	return list[artHash(id) % list.length];
}

/** boyau-art.ts `meetArt(id, 'card')` — path only; the caller prefixes the instance url. */
export function meetArtPath(meetId: string): string {
	return ART_BASE + pick(ART_ACTION, meetId) + '-card.jpg';
}

/** boyau-art.ts `clubArt(id, 'card')`. */
export function clubArtPath(clubId: string): string {
	return ART_BASE + pick(ART_CLUB, clubId) + '-card.jpg';
}

/* boyau-art.ts ACCENT + accentFor + accentKey — the avatar ground for a person without a photo. */
const ACCENT_PAIRS = [['#1FA971', '#DCF5E8'], ['#3B82F6', '#DCEAFE'], ['#8B5CF6', '#EDE6FE'], ['#FF6B4A', '#FFE3DB'], ['#B8860B', '#FFF4C2']] as const;

export function accentKey(id: string, name?: string | null): string {
	const n = String(name ?? '').trim().toLowerCase();
	return n || id;
}

export function accentFor(key: string): { fg: string; bg: string } {
	const p = ACCENT_PAIRS[artHash(key) % ACCENT_PAIRS.length];
	return { fg: p[0], bg: p[1] };
}

function escapeXml(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** boyau-art.ts `initialAvatar` / `personAvatar`, as a 256×256 SVG document (not a data URI): the initial on the
 *  person's accent, or the neutral silhouette when the name yields no letter. */
export function initialAvatarSvg(id: string, name: string | null | undefined): string {
	const ch = String(name ?? '').trim().replace(/^[^\p{L}\p{N}]+/u, '').slice(0, 1).toUpperCase();
	if (!ch) {
		const a = id ? accentFor(id) : { fg: '#9AA5A0', bg: '#EEF0EF' };
		return '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 64 64"><circle cx="32" cy="32" r="32" fill="' + a.bg + '"/><circle cx="32" cy="26" r="11" fill="' + a.fg + '"/><path d="M12 56c2-12 10-18 20-18s18 6 20 18" fill="' + a.fg + '"/></svg>';
	}
	const a = accentFor(accentKey(id, name));
	return '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 64 64"><circle cx="32" cy="32" r="32" fill="' + a.fg + '"/><text x="32" y="41" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="28" font-weight="700" fill="#FFFFFF">' + escapeXml(ch) + '</text></svg>';
}

/** "Wed 24 Sep · 20:00" in the meet's own timezone (en-US parts, so September is "Sep", not en-GB's "Sept"). */
export function formatMeetStart(iso: string, timeZone: string): string {
	const d = new Date(iso);
	let tz = timeZone;
	try {
		Intl.DateTimeFormat('en-US', { timeZone: tz });
	} catch {
		tz = 'UTC';
	}
	const part = (opts: Intl.DateTimeFormatOptions, type: string) =>
		new Intl.DateTimeFormat('en-US', { timeZone: tz, ...opts }).formatToParts(d).find(p => p.type === type)?.value ?? '';
	const weekday = part({ weekday: 'short' }, 'weekday');
	const day = part({ day: 'numeric' }, 'day');
	const month = part({ month: 'short' }, 'month');
	const hour = part({ hour: '2-digit', hourCycle: 'h23' }, 'hour');
	const minute = part({ minute: '2-digit' }, 'minute');
	return `${weekday} ${day} ${month} · ${hour}:${minute.padStart(2, '0')}`;
}

export function truncate(s: string, max: number): string {
	const t = s.replace(/\s+/g, ' ').trim();
	return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t;
}

export type ShareCard = {
	title: string;
	description: string | null;
	image: string;
	/** og:url — the app page the card opens. */
	url: string;
	card: 'summary' | 'summary_large_image';
};

export const SHARE_SITE_NAME = 'GripBat 抓拍';

/** The whole page: head-only metadata + an instant refresh + a plain link (for a human without meta-refresh). */
export function renderShareHtml(c: ShareCard): string {
	const e = escapeXml;
	const lines = [
		'<!DOCTYPE html>',
		'<html lang="en"><head>',
		'<meta charset="utf-8">',
		`<title>${e(c.title)} · ${e(SHARE_SITE_NAME)}</title>`,
		'<meta name="viewport" content="width=device-width, initial-scale=1">',
		'<meta name="robots" content="noindex">',
		'<meta property="og:type" content="website">',
		`<meta property="og:site_name" content="${e(SHARE_SITE_NAME)}">`,
		`<meta property="og:title" content="${e(c.title)}">`,
		c.description != null ? `<meta property="og:description" content="${e(c.description)}">` : null,
		`<meta property="og:image" content="${e(c.image)}">`,
		`<meta property="og:url" content="${e(c.url)}">`,
		`<meta name="twitter:card" content="${c.card}">`,
		`<meta name="twitter:title" content="${e(c.title)}">`,
		c.description != null ? `<meta name="twitter:description" content="${e(c.description)}">` : null,
		`<meta name="twitter:image" content="${e(c.image)}">`,
		`<meta http-equiv="refresh" content="0;url=${e(c.url)}">`,
		'</head><body>',
		`<p><a href="${e(c.url)}">${e(c.title)}</a></p>`,
		'</body></html>',
	];
	return lines.filter(l => l != null).join('\n') + '\n';
}

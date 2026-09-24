/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { HttpRequestService } from '@/core/HttpRequestService.js';

// DISCOVER-W2D (Reclub triage C-select-location.01 / E-upsert-location.01 / C-venue-create.02 / C-map-picker.02):
// ONE geocoder door for every place field in the app — the Discover location sheet, saved locations, venue create.
//
//   1. a pasted map link or a typed "lat, lng" is read locally (Google / Apple / OSM link shapes; a short
//      maps.app.goo.gl / goo.gl link is followed once to its long form);
//   2. otherwise, with GOOGLE_PLACES_API_KEY set, Google Places Text Search (New) — the provider Reclub uses;
//   3. otherwise Photon (photon.komoot.io, OpenStreetMap data, no key; ODbL — the app's map already credits
//      "© OpenStreetMap contributors"). Fair use: every answer is cached here for an hour and the endpoints are rate
//      limited per caller, so a typing player costs the provider one call per settled query, not per keystroke.
// The geocoder never writes: it returns candidate points; the caller saves what the person confirmed.

const PLACES_KEY = process.env.GOOGLE_PLACES_API_KEY ?? '';
const PHOTON = process.env.GEOCODER_PHOTON_URL ?? 'https://photon.komoot.io';
const TTL_MS = 60 * 60 * 1000;
const MAX_CACHE = 1000;

export interface GeoHit { label: string; address: string | null; lat: number; lng: number; source: 'link' | 'places' | 'photon'; externalId: string | null; kind: string | null }

const cache = new Map<string, { at: number; v: unknown }>();
function cached<T>(key: string): T | undefined {
	const c = cache.get(key);
	if (!c) return undefined;
	if (Date.now() - c.at > TTL_MS) { cache.delete(key); return undefined; }
	return c.v as T;
}
function remember(key: string, v: unknown): void {
	if (cache.size >= MAX_CACHE) { const first = cache.keys().next().value; if (first !== undefined) cache.delete(first); }
	cache.set(key, { at: Date.now(), v });
}

const okLat = (n: number) => Number.isFinite(n) && n >= -90 && n <= 90;
const okLng = (n: number) => Number.isFinite(n) && n >= -180 && n <= 180;
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/** decodeURIComponent throws URIError on a bare '%' - "100% Club Road" made geo/search answer 500 (review-batch2 #7).
 *  A string that is not percent-encoded is used exactly as it was typed. */
function decodeOnce(s: string): string {
	try { return decodeURIComponent(s); } catch { return s; }
}

/** A point written in the text itself: "22.2998, 114.1725", a Google link (@lat,lng · !3dlat!4dlng · q= / ll= /
 *  query= / destination=), an Apple link (ll= / q= / sll=), an OSM link (mlat/mlon or #map=z/lat/lng). */
export function pointInText(raw: string): { lat: number; lng: number } | null {
	const s = decodeOnce(String(raw || '').trim().replace(/\+/g, ' '));
	const pairs: RegExp[] = [
		/!3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+)/,                                   // Google place data (the pin, not the viewport)
		/[?&](?:q|query|ll|sll|daddr|destination|center)=(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/,
		/@(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/,                                       // Google viewport centre
		/[?&]mlat=(-?\d{1,2}\.\d+)&mlon=(-?\d{1,3}\.\d+)/,                          // OpenStreetMap marker
		/#map=\d+\/(-?\d{1,2}\.\d+)\/(-?\d{1,3}\.\d+)/,                             // OpenStreetMap view
		// typed "lat, lng". INT-BATCH2: was \d{3,} decimals on BOTH parts, so "22.3, 114.17" — a perfectly ordinary
		// way to type a point — fell through to the text geocoder and came back as a street in Bangkok (probed).
		// One decimal place each is enough: the string must be the pair and nothing else, and no address looks like this.
		/^(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)$/,
	];
	for (const re of pairs) {
		const m = s.match(re);
		if (m) { const lat = Number(m[1]), lng = Number(m[2]); if (okLat(lat) && okLng(lng)) return { lat: round6(lat), lng: round6(lng) }; }
	}
	return null;
}

// The share links we follow once to their long form. SEC (review-batch2 #2): the old regex did not anchor the END of
// the host, so `https://maps.app.goo.gl.attacker.example/x` matched and this unauthenticated door (60/min) fetched an
// attacker's URL - a request-forgery and scanning door. The host is parsed and compared EXACTLY now, https only, no
// credentials in the URL; anything else is not followed.
const SHORT_LINK_HOSTS = new Set(['maps.app.goo.gl', 'goo.gl', 'maps.apple.com']);
export function shortLinkToFollow(raw: string): string | null {
	let u: URL;
	try { u = new URL(String(raw || '').trim()); } catch { return null; }
	if (u.protocol !== 'https:') return null;                     // https only (the regex took http too)
	if (u.username !== '' || u.password !== '') return null;      // no user:pass@host
	const host = u.hostname.toLowerCase();                        // the WHOLE host, not a prefix of one
	if (!SHORT_LINK_HOSTS.has(host)) return null;
	if (host === 'goo.gl' && !/^\/maps(\/|$)/.test(u.pathname)) return null;   // goo.gl is a general shortener
	if (host === 'maps.apple.com' && u.search === '') return null;             // the point lives in the query
	return u.toString();
}

export async function geoSearch(http: HttpRequestService, q: { query: string; lat?: number | null; lng?: number | null; language?: string | null; limit?: number }): Promise<GeoHit[]> {
	const query = q.query.trim().slice(0, 300);
	const limit = Math.max(1, Math.min(q.limit ?? 6, 10));
	if (!query) return [];
	const direct = pointInText(query);
	if (direct) return [{ label: `${direct.lat.toFixed(5)}, ${direct.lng.toFixed(5)}`, address: null, lat: direct.lat, lng: direct.lng, source: 'link', externalId: null, kind: 'point' }];
	const follow = shortLinkToFollow(query);
	if (follow) {
		// a share link from a phone: follow it once (no body read) and read the point from where it lands
		const res = await http.send(follow, { method: 'GET', timeout: 6_000 }, { throwErrorWhenResponseNotOk: false }).catch(() => null);
		const landed = res ? pointInText(res.url) : null;
		return landed ? [{ label: `${landed.lat.toFixed(5)}, ${landed.lng.toFixed(5)}`, address: null, lat: landed.lat, lng: landed.lng, source: 'link', externalId: null, kind: 'point' }] : [];
	}
	if (/^https?:\/\//i.test(query)) return [];   // some other link: nothing to search for
	const bias = q.lat != null && q.lng != null ? `${round6(q.lat).toFixed(2)},${round6(q.lng).toFixed(2)}` : '';
	const key = `s|${PLACES_KEY ? 'g' : 'p'}|${q.language ?? ''}|${bias}|${limit}|${query.toLowerCase()}`;
	const hit = cached<GeoHit[]>(key);
	if (hit) return hit;
	const out = PLACES_KEY ? await placesText(http, query, q, limit) : await photonSearch(http, query, q, limit);
	remember(key, out);
	return out;
}

export async function geoReverse(http: HttpRequestService, q: { lat: number; lng: number; language?: string | null }): Promise<GeoHit | null> {
	const key = `r|${q.language ?? ''}|${q.lat.toFixed(5)}|${q.lng.toFixed(5)}`;
	const hit = cached<GeoHit | null>(key);
	if (hit !== undefined) return hit;
	const lang = photonLang(q.language);
	const url = `${PHOTON}/reverse?lat=${q.lat}&lon=${q.lng}&limit=1${lang ? `&lang=${lang}` : ''}`;
	const res = await http.send(url, { method: 'GET', timeout: 6_000 }, { throwErrorWhenResponseNotOk: false });
	if (res.status !== 200) throw new Error(`geocoder ${res.status}`);
	const j = await res.json().catch(() => ({})) as PhotonCollection;
	const f = (j.features ?? [])[0];
	const out = f ? fromPhoton(f) : null;
	remember(key, out);
	return out;
}

// ------------------------------------------------------------------------------- providers
interface PhotonFeature { geometry?: { coordinates?: [number, number] }; properties?: Record<string, string | number | undefined> }
interface PhotonCollection { features?: PhotonFeature[] }

/** Photon speaks en / de / fr (+ default = local names). Chinese UIs get the local (Chinese) names. */
function photonLang(language?: string | null): string {
	const l = String(language || '').toLowerCase();
	return l.startsWith('en') ? 'en' : l.startsWith('fr') ? 'fr' : l.startsWith('de') ? 'de' : '';
}

function fromPhoton(f: PhotonFeature): GeoHit | null {
	const c = f.geometry?.coordinates;
	const p = f.properties ?? {};
	if (!c || !okLat(c[1]) || !okLng(c[0])) return null;
	const street = [p.housenumber, p.street].filter(Boolean).join(' ');
	const name = String(p.name ?? '') || street || String(p.district ?? p.locality ?? p.city ?? '');
	// GEO-LABEL-V1 (fix-S4, C-map-picker.02): OSM sometimes carries an ADDRESS in locality ("27 Magazine Gap Road" on the
	// house at 50 Magazine Gap Road) — the pin read "50 Magazine Gap Road, 27 Magazine Gap Road, Wan Chai District". An area
	// part that names the label's own street again is dropped; the street line itself (when the feature has a name) stays.
	const streetLc = String(p.street ?? '').trim().toLowerCase();
	const area = [p.locality, p.district, p.city].filter((x) => !(streetLc && String(x ?? '').toLowerCase().includes(streetLc)));
	const address = [p.name && street ? street : null, ...area].filter((x) => x != null && String(x) !== '' && String(x) !== name).map(String).join(', ') || null;
	return { label: name || `${c[1].toFixed(5)}, ${c[0].toFixed(5)}`, address, lat: round6(c[1]), lng: round6(c[0]), source: 'photon', externalId: p.osm_type && p.osm_id ? `osm:${p.osm_type}${p.osm_id}` : null, kind: p.osm_value != null ? String(p.osm_value) : null };
}

async function photonSearch(http: HttpRequestService, query: string, q: { lat?: number | null; lng?: number | null; language?: string | null }, limit: number): Promise<GeoHit[]> {
	const lang = photonLang(q.language);
	let url = `${PHOTON}/api/?q=${encodeURIComponent(query)}&limit=${limit}`;
	if (lang) url += `&lang=${lang}`;
	if (q.lat != null && q.lng != null) url += `&lat=${q.lat}&lon=${q.lng}&location_bias_scale=0.4`;
	const res = await http.send(url, { method: 'GET', timeout: 6_000 }, { throwErrorWhenResponseNotOk: false });
	if (res.status !== 200) throw new Error(`geocoder ${res.status}`);
	const j = await res.json().catch(() => ({})) as PhotonCollection;
	const seen = new Set<string>();
	return (j.features ?? []).map(fromPhoton).filter((h): h is GeoHit => {
		if (!h) return false;
		const k = `${h.label}|${h.lat.toFixed(4)}|${h.lng.toFixed(4)}`;
		if (seen.has(k)) return false;
		seen.add(k); return true;
	});
}

async function placesText(http: HttpRequestService, query: string, q: { lat?: number | null; lng?: number | null; language?: string | null }, limit: number): Promise<GeoHit[]> {
	const body: Record<string, unknown> = { textQuery: query, pageSize: limit };
	if (q.language) body.languageCode = q.language;
	if (q.lat != null && q.lng != null) body.locationBias = { circle: { center: { latitude: q.lat, longitude: q.lng }, radius: 50_000 } };
	const res = await http.send('https://places.googleapis.com/v1/places:searchText', {
		method: 'POST', timeout: 8_000,
		headers: { 'content-type': 'application/json', 'X-Goog-Api-Key': PLACES_KEY, 'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.primaryType' },
		body: JSON.stringify(body),
	}, { throwErrorWhenResponseNotOk: false });
	if (res.status !== 200) throw new Error(`geocoder ${res.status}`);
	const j = await res.json().catch(() => ({})) as { places?: { id?: string; displayName?: { text?: string }; formattedAddress?: string; location?: { latitude: number; longitude: number }; primaryType?: string }[] };
	return (j.places ?? []).filter((p) => p.location).map((p) => ({ label: p.displayName?.text ?? p.formattedAddress ?? '', address: p.formattedAddress ?? null, lat: round6(p.location!.latitude), lng: round6(p.location!.longitude), source: 'places' as const, externalId: p.id ?? null, kind: p.primaryType ?? null }));
}

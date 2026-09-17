// Runs ON kaka (node 20): VENUE-V1 + CLUB-SYNC-V1 against the live engine (127.0.0.1:3960) with the demo users.
//   V1  adapter/venues/sync without the secret → ADAPTER_UNAUTHORIZED; with it, 3 venues for tenant probe-tn → created 3
//   V2  sync again: one renamed, one active:false → updated 2, closed 1; the closed one leaves search
//   V3  venues/search near Tsim Sha Tsui, 5 km → the 2 verified probe venues, nearest first, distanceKm present
//   V4  venues/create (community) by a player → under_review; default search hides it, includeUnderReview shows it
//   V5  the same Google place id again → the same row (no duplicate)
//   V6  staff-update by a plain user → refused (moderator only)
//   V7  locations: home saved twice → one row; two favourites; list 3; delete one → 2; radius 80 accepted, 200 rejected
//   V8  adapter/clubs/sync 2 clubs → created 2 channels (externalRef hkpl:probe-tn:<id>); again with one inactive → archived 1
//   V9  venues/autocomplete without GOOGLE_PLACES_API_KEY → VENUE_PLACES_UNCONFIGURED (fails closed)
'use strict';
const fs = require('fs');
const { execFileSync } = require('child_process');
const BASE = 'http://127.0.0.1:3960/api';
const demo = JSON.parse(fs.readFileSync('/root/social-engine.demo-users', 'utf8'));
const names = Object.keys(demo);
const tok = (n) => demo[n].token;
const HKPL_ENV = Object.fromEntries(fs.readFileSync('/root/social-engine.hkpl.env', 'utf8').split('\n').filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const SECRET = HKPL_ENV.ADAPTER_HKPL_S2S_SECRET;
const out = { steps: {} };
function step(k, ok, ev) { out.steps[k] = { ok: !!ok, ...ev }; }
async function api(path, body, token, headers = {}) {
	const r = await fetch(`${BASE}/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ ...body, ...(token ? { i: token } : {}) }) });
	let json = {}; try { json = await r.json(); } catch {}
	return { status: r.status, json };
}
const code = (r) => r.json.error?.code ?? r.json.error?.id ?? null;
function esql(q) {
	return execFileSync('docker', ['exec', 'social-engine-db-1', 'psql', '-U', 'social', '-d', 'social', '-tA', '-F', '|', '-c', q]).toString().trim();
}

(async () => {
	const T = 'probe-tn';
	const u1 = names[1], u2 = names[2];
	// TST 22.2988,114.1722; Jordan 22.3049,114.1717 (~0.7 km); Kwun Tong 22.3121,114.2260 (~5.7 km)
	const venues = [
		{ externalRef: 'pv1', name: 'Probe Court TST', address: 'Salisbury Rd', district: 'Tsim Sha Tsui', country: 'HK', lat: 22.2988, lng: 114.1722, courtCount: 4, active: true },
		{ externalRef: 'pv2', name: 'Probe Court Jordan', district: 'Jordan', lat: 22.3049, lng: 114.1717, active: true },
		{ externalRef: 'pv3', name: 'Probe Court Kwun Tong', district: 'Kwun Tong', lat: 22.3121, lng: 114.2260, active: true },
	];
	try {
		// V1
		let r = await api('adapter/venues/sync', { tenantId: T, venues }, null);
		const r1b = await api('adapter/venues/sync', { tenantId: T, venues }, null, { 'x-social-secret': SECRET });
		step('V1_sync_secret_gate_and_create', r.status !== 200 && code(r) === 'ADAPTER_UNAUTHORIZED' && r1b.status === 200 && r1b.json.created === 3, { noSecret: code(r), withSecret: r1b.json });

		// V2
		r = await api('adapter/venues/sync', { tenantId: T, venues: [{ ...venues[0], name: 'Probe Court TST (renamed)' }, venues[1], { ...venues[2], active: false }] }, null, { 'x-social-secret': SECRET });
		const rows = esql(`select "externalRef", name, status from venue where "curatedByTenant"='${T}' order by 1`);
		step('V2_sync_upserts_and_closes', r.status === 200 && r.json.updated === 2 && r.json.closed === 1 && rows.includes('pv1|Probe Court TST (renamed)|verified') && rows.includes('pv3|Probe Court Kwun Tong|closed'), { result: r.json, rows });

		// V3
		r = await api('venues/search', { lat: 22.2988, lng: 114.1722, radiusKm: 5 }, tok(u1));
		const mine = (r.json || []).filter(v => v.curatedByTenant === T);
		step('V3_search_nearby_verified_sorted', r.status === 200 && mine.length === 2 && mine[0].name.startsWith('Probe Court TST') && mine[1].name === 'Probe Court Jordan' && mine[0].distanceKm < 0.05 && mine[1].distanceKm > 0.5 && mine.every(v => v.status === 'verified'), { got: mine.map(v => [v.name, Number(v.distanceKm?.toFixed(2)), v.status]) });

		// V4
		r = await api('venues/create', { name: 'Community Court Yau Ma Tei', address: 'Nathan Rd', lat: 22.3080, lng: 114.1700, externalId: 'ChIJprobe-ymt', country: 'HK' }, tok(u1));
		const cid = r.json.id;
		const hidden = await api('venues/search', { lat: 22.2988, lng: 114.1722, radiusKm: 5 }, tok(u1));
		const shown = await api('venues/search', { lat: 22.2988, lng: 114.1722, radiusKm: 5, includeUnderReview: true }, tok(u1));
		step('V4_community_under_review_visibility', r.status === 200 && r.json.source === 'community' && r.json.status === 'under_review' && !(hidden.json || []).some(v => v.id === cid) && (shown.json || []).some(v => v.id === cid), { status: r.json.status, source: r.json.source, hidden: !(hidden.json || []).some(v => v.id === cid), shown: (shown.json || []).some(v => v.id === cid) });

		// V5
		r = await api('venues/create', { name: 'Community Court Yau Ma Tei (dup)', lat: 22.3080, lng: 114.1700, externalId: 'ChIJprobe-ymt' }, tok(u2));
		step('V5_same_place_id_same_row', r.status === 200 && r.json.id === cid, { first: cid, second: r.json.id });

		// V6
		r = await api('venues/staff-update', { venueId: cid, status: 'verified' }, tok(u2));
		step('V6_staff_update_needs_moderator', r.status !== 200, { status: r.status, code: code(r) });

		// V7
		await api('venues/locations/save', { kind: 'home', label: 'Home v1', lat: 22.28, lng: 114.16, radiusKm: 10 }, tok(u1));
		await api('venues/locations/save', { kind: 'home', label: 'Home v2', lat: 22.29, lng: 114.17, radiusKm: 80 }, tok(u1));
		await api('venues/locations/save', { kind: 'favourite', label: 'Fav A', lat: 22.30, lng: 114.18 }, tok(u1));
		const fb = await api('venues/locations/save', { kind: 'favourite', label: 'Fav B', lat: 22.31, lng: 114.19 }, tok(u1));
		const tooFar = await api('venues/locations/save', { kind: 'favourite', label: 'Too far', lat: 22.31, lng: 114.19, radiusKm: 200 }, tok(u1));
		let list = await api('venues/locations/list', {}, tok(u1));
		const homes = (list.json || []).filter(l => l.kind === 'home');
		await api('venues/locations/delete', { id: fb.json.id }, tok(u1));
		const list2 = await api('venues/locations/list', {}, tok(u1));
		step('V7_locations', homes.length === 1 && homes[0].label === 'Home v2' && homes[0].radiusKm === 80 && (list.json || []).length === 3 && tooFar.status !== 200 && (list2.json || []).length === 2, { count: (list.json || []).length, home: homes[0] && [homes[0].label, homes[0].radiusKm], tooFar: tooFar.status, after: (list2.json || []).length });

		// V8
		r = await api('adapter/clubs/sync', { tenantId: T, clubs: [{ externalRef: '901', name: 'Probe Club A', description: 'A' }, { externalRef: '902', name: 'Probe Club B' }] }, null, { 'x-social-secret': SECRET });
		const r8b = await api('adapter/clubs/sync', { tenantId: T, clubs: [{ externalRef: '901', name: 'Probe Club A', active: true }, { externalRef: '902', name: 'Probe Club B', active: false }] }, null, { 'x-social-secret': SECRET });
		const ch = esql(`select "externalRef", name, "isArchived" from channel where "externalRef" like 'hkpl:${T}:%' order by 1`);
		step('V8_clubs_sync_channels', r.status === 200 && r.json.created === 2 && r8b.status === 200 && r8b.json.updated === 1 && r8b.json.archived === 1 && ch.includes('hkpl:probe-tn:901|Probe Club A|f') && ch.includes('hkpl:probe-tn:902|Probe Club B|t'), { first: r.json, second: r8b.json, channels: ch });

		// V9
		r = await api('venues/autocomplete', { query: 'pickleball', country: 'HK' }, tok(u1));
		step('V9_places_fails_closed', r.status !== 200 && code(r) === 'VENUE_PLACES_UNCONFIGURED', { status: r.status, code: code(r) });
	} catch (e) {
		out.error = String(e && e.stack || e);
	} finally {
		esql(`delete from venue where "curatedByTenant"='probe-tn' or "externalId"='ChIJprobe-ymt'`);
		esql(`delete from channel where "externalRef" like 'hkpl:probe-tn:%'`);
		esql(`delete from user_location where "userId"='${demo[names[1]].id}'`);
	}
	out.pass = !out.error && Object.values(out.steps).length === 9 && Object.values(out.steps).every(x => x.ok);
	console.log(JSON.stringify(out));
	process.exit(out.pass ? 0 : 1);
})();

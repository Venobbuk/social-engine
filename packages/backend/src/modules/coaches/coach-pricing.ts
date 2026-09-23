/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/*
 * COACHING-V1 (2026-09-22) — the two value objects the coaching feature keeps LOOSELY COUPLED so the research's
 * later refinements (class packs / credits, late-cancel fees, no-show rules) can land without a schema rewrite.
 * marker string below is greppable in the built tree (comments are stripped): SHIP verifies coaching-v1-a7f3.
 *
 *  1. PRICE  — an ordered list of per-person bands by group size (operator decision 3). NEW model (G11: NEW only for
 *              the price-tier model + the two dashboards). It is a self-contained blob stored on the schedule and
 *              COPIED onto each lesson, so a lesson prices itself and a later re-tier of the schedule never re-prices
 *              a booked student (research #2: price is LOCKED AT BOOKING on the participant row). Adding packs/credits
 *              later means a new field on this blob, not a migration of every meet.
 *
 *  2. CANCELLATION POLICY — a window in hours (default 24). The seam the research asked for: late-cancel FEES and
 *              no-show rules are deferred to when a gateway lands; today the window maps straight onto the NATIVE
 *              meet.cancellationFreezeHours, and auto-promotion of the waitlist on a cancel is NATIVE (MeetService
 *              .leave → promoteLocked). Storing it as its own blob keeps room for { lateFeePct, noShowFee } later.
 */

export const COACHING_V1_MARK = 'coaching-v1-a7f3';

export type PriceBand = {
	/** inclusive lower bound of the group size this per-person price applies to (private = 1). */
	minParticipants: number;
	/** inclusive upper bound; the last band may repeat the schedule capacity. */
	maxParticipants: number;
	/** per-person price in MINOR units (cents), like meet.feeAmount. */
	pricePerPerson: number;
	/** ISO-4217, e.g. 'HKD'. */
	currency: string;
};

/** The stored price blob. `version` lets a later shape (packs, credits) be told apart on read. */
export type PriceTiers = {
	version: 1;
	tiers: PriceBand[];
};

export type CancellationPolicy = {
	/** hours before start after which a student self-cancel is blocked (they contact the coach). 0 = never blocked. */
	windowHours: number;
};

export const DEFAULT_CANCELLATION: CancellationPolicy = { windowHours: 24 };

const MAX_TIERS = 3;              // research: keep it to <= 3 coach-set tiers
const MAX_PRICE = 100_000_00;     // 100k of a currency, in cents — a sanity ceiling, not a business rule

export function normaliseCurrency(c: unknown): string {
	const s = typeof c === 'string' ? c.trim().toUpperCase() : '';
	return /^[A-Z]{3}$/.test(s) ? s : 'HKD';
}

/**
 * Validate + normalise the coach's tiers into the stored blob. Throws a plain Error with a stable message the
 * endpoint maps to COACH_INVALID. Rules: 1..3 bands, ascending non-overlapping ranges starting at 1, prices >= 0.
 */
export function normalisePriceTiers(input: unknown, fallbackCurrency = 'HKD'): PriceTiers {
	const cur = normaliseCurrency(fallbackCurrency);
	const raw = Array.isArray(input) ? input : (input && typeof input === 'object' && Array.isArray((input as PriceTiers).tiers) ? (input as PriceTiers).tiers : null);
	if (!raw || raw.length < 1) throw new Error('Set at least one price band.');
	if (raw.length > MAX_TIERS) throw new Error(`At most ${MAX_TIERS} price bands.`);
	const tiers: PriceBand[] = [];
	let expectMin = 1;
	for (const b0 of raw) {
		const b = b0 as Partial<PriceBand>;
		const minP = Number(b.minParticipants);
		const maxP = Number(b.maxParticipants);
		const price = Number(b.pricePerPerson);
		if (!Number.isInteger(minP) || !Number.isInteger(maxP) || minP < 1 || maxP < minP) throw new Error('Each band needs a valid participant range (min <= max, from 1).');
		if (minP !== expectMin) throw new Error('Price bands must start at 1 and be contiguous (e.g. 1-1, 2-4, 5-8).');
		if (!Number.isFinite(price) || price < 0 || price > MAX_PRICE) throw new Error('Each band needs a per-person price of 0 or more.');
		tiers.push({ minParticipants: minP, maxParticipants: maxP, pricePerPerson: Math.round(price), currency: normaliseCurrency(b.currency ?? cur) });
		expectMin = maxP + 1;
	}
	return { version: 1, tiers };
}

/** The per-person price for a group of `count` people. Falls to the last band above its range. Null blob → null. */
export function priceForGroup(blob: PriceTiers | null | undefined, count: number): PriceBand | null {
	if (!blob || !Array.isArray(blob.tiers) || blob.tiers.length === 0) return null;
	const n = Math.max(1, count);
	for (const b of blob.tiers) if (n >= b.minParticipants && n <= b.maxParticipants) return b;
	// above every band: the cheapest (largest-group) band applies
	return blob.tiers[blob.tiers.length - 1];
}

/*
 * GROUP-PRICE-V1 (2026-09-23, operator decision on coaching-ui needs_operator #2): a student booking into a GROUP
 * slot is never surprised. Before this, the first booker into an empty group slot was locked at the band for a group
 * of ONE — the private rate — although they had booked a group lesson. Now:
 *   • A GROUP slot is one whose capacity is > 1 and whose coach set a band for 2+ people inside that capacity.
 *   • A booker in a group slot is priced at the band the booking LANDS in, floored at the smallest group band — the
 *     group rate they chose — never the private band. The price is still LOCKED at booking (research #2).
 *   • If the slot ends up running private, nothing here raises the price: the coach agrees the private rate with the
 *     student first (the app says so on the confirm sheet and on the coach's roster). No automatic solo-band charge.
 * A private-only slot (capacity 1, or no group band) prices exactly as before.
 */
export const GROUP_PRICE_V1_MARK = 'group-price-v1-b2c9';

/** The smallest group size (>= 2) the coach priced inside this capacity, or null when this is not a group slot. */
export function groupFloor(blob: PriceTiers | null | undefined, capacity: number): number | null {
	if (!blob || !Array.isArray(blob.tiers) || capacity <= 1) return null;
	const b = blob.tiers.find(t => t.minParticipants >= 2 && t.minParticipants <= capacity);
	return b ? b.minParticipants : null;
}

/** The band a booking lands in when the lesson will hold `count` confirmed students (the booker included). */
export function bookingBand(blob: PriceTiers | null | undefined, capacity: number, count: number): PriceBand | null {
	const floor = groupFloor(blob, capacity);
	return priceForGroup(blob, floor != null ? Math.max(count, floor) : count);
}

export function normaliseCancellation(input: unknown): CancellationPolicy {
	const o = (input && typeof input === 'object') ? input as Partial<CancellationPolicy> : {};
	let h = Number(o.windowHours);
	if (!Number.isFinite(h) || h < 0) h = DEFAULT_CANCELLATION.windowHours;
	h = Math.min(Math.round(h), 24 * 14); // cap at two weeks
	return { windowHours: h };
}

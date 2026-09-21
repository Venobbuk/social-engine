/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { HttpRequestService } from '@/core/HttpRequestService.js';
import { bindThis } from '@/decorators.js';

/**
 * COMP-DUPR-V1 (2026-09-21) — THE ONE DOOR to DUPR, lifted out of MeetMatchService.submitDupr without a change of
 * behaviour so a tournament match and a meet match go through the SAME submitter. There is no second submitter.
 *
 * hkpl owns everything about DUPR: the partner key, the write queue, the sandbox guard and the retries
 * (routes/social-dupr.js — POST /api/v1/social/dupr/submit, GET /api/v1/social/dupr/status). The engine owns only
 * the receipt it keeps on the match row.
 *
 * THE SCRAPE RULE (operator, stated twice): GripBat reaches DUPR through the PARTNER API only and must never
 * trigger the dashboard reader. Safe by construction on hkpl's side and re-verified at source for this lane:
 *   lib/dupr/partner-only.js  DEFAULT = ['boyau','boyau-uat'] — the consumer tenants are pinned partner-only, and
 *                             idIsGripbatOnly() FAILS CLOSED (a lookup error answers partner-only).
 *   lib/dupr/index.js:51      _readRoute(): `if (partnerOnly.blocked()) return partner.isConfigured() ? partner : null`
 *                             — there is no reader fallback anywhere on that branch (also :160, :165, :199, :201).
 *   lib/dupr/route-richard.js:451  canWrite() { return false; }  and :640 submitMatch() →
 *                             richard_route_cannot_write / 405. The scraper cannot write at all.
 * This service posts to that one social door and to nothing else, so nothing here can reach the scrape.
 *
 * Both facts come from the environment and FAIL CLOSED: unset → the match is marked failed with a visible reason.
 */
const HKPL_URL = (process.env.ADAPTER_HKPL_URL ?? '').replace(/\/+$/, '');
const HKPL_SECRET = process.env.ADAPTER_HKPL_S2S_SECRET ?? '';
// hkpl-app runs on the same box (host.docker.internal:3939): the SSRF guard must admit that private address.
const HKPL_ALLOW_LOCAL = process.env.ADAPTER_HKPL_ALLOW_LOCAL === '1';

/** What the engine sends. `games` is one entry per game, [side0, side1]; `duprIds` is [team1, team2]. */
export type DuprSubmission = {
	matchId: string;
	format: 'SINGLES' | 'DOUBLES';
	playedAt: Date;
	event: string;
	location: string | null;
	duprIds: [string[], string[]];
	games: [number, number][];
};

/** The columns to write back. `stamp` = also record who sent it and when (exactly when the meet path did). */
export type DuprPatch = { duprStatus: 'queued' | 'submitted' | 'failed'; duprRef?: string | null; duprError: string | null };
export type DuprResult = { patch: DuprPatch; stamp: boolean };

@Injectable()
export class DuprSubmitService {
	constructor(
		private httpRequestService: HttpRequestService,
	) {
	}

	@bindThis
	public isConfigured(): boolean { return HKPL_URL !== '' && HKPL_SECRET !== ''; }

	/**
	 * The exact JSON body hkpl will receive. Public so a CONFIRMATION STEP can show the host what is about to leave
	 * the engine before anything is sent — the preview and the submission cannot drift, they are the same function.
	 */
	@bindThis
	public body(s: DuprSubmission): Record<string, unknown> {
		const team = (duprIds: string[], side: 0 | 1) => {
			const t: Record<string, unknown> = { player1: { dupr_id: duprIds[0] } };
			if (duprIds[1]) t.player2 = { dupr_id: duprIds[1] };
			s.games.forEach((g, i) => { t[`game${i + 1}`] = g[side]; });
			return t;
		};
		return {
			match_id: `boyau:${s.matchId}`,
			format: s.format,
			played_at: new Date(s.playedAt).toISOString(),
			event: s.event,
			location: s.location,
			teams: [team(s.duprIds[0], 0), team(s.duprIds[1], 1)],
		};
	}

	/** Never throws for a remote failure — the caller writes the returned patch onto its own row. */
	@bindThis
	public async submit(s: DuprSubmission): Promise<DuprResult> {
		if (!this.isConfigured()) return { patch: { duprStatus: 'failed', duprError: 'hkpl_unconfigured' }, stamp: false };
		try {
			const res = await this.httpRequestService.send(`${HKPL_URL}/api/v1/social/dupr/submit`, {
				method: 'POST',
				headers: { 'content-type': 'application/json', 'x-social-secret': HKPL_SECRET },
				body: JSON.stringify(this.body(s)),
				timeout: 10_000,
				isLocalAddressAllowed: HKPL_ALLOW_LOCAL,
			}, { throwErrorWhenResponseNotOk: false });
			const json = await res.json().catch(() => ({})) as { ok?: boolean; via?: string; queue_id?: string | null; dupr_match_id?: string | null; error?: string; sandbox?: boolean };
			if (res.status !== 200 || !json.ok) return { patch: { duprStatus: 'failed', duprError: `hkpl ${res.status} ${json.error ?? ''}`.trim().slice(0, 512) }, stamp: false };
			const submitted = json.via === 'partner' && !!json.dupr_match_id;
			return { patch: { duprStatus: submitted ? 'submitted' : 'queued', duprRef: (json.dupr_match_id ?? json.queue_id ?? null), duprError: null }, stamp: true };
		} catch (err) {
			// FAIL-SOFT-V1: the league server being down is not the player's failure — keep the row queued (no ref yet)
			// and let the lazy refresh retry it; the badge reads 'Submitting' until hkpl answers.
			return { patch: { duprStatus: 'queued', duprRef: null, duprError: `hkpl unreachable: ${(err as Error).message}`.slice(0, 512) }, stamp: true };
		}
	}

	/** Ask hkpl how a queued row went. Returns the columns to update (never the whole row). */
	@bindThis
	public async refresh(matchId: string, currentRef: string | null): Promise<{ duprStatus?: 'submitted'; duprRef?: string | null; duprError?: string | null }> {
		if (!this.isConfigured()) return {};
		const res = await this.httpRequestService.send(`${HKPL_URL}/api/v1/social/dupr/status?match_id=${encodeURIComponent(`boyau:${matchId}`)}`, {
			headers: { 'x-social-secret': HKPL_SECRET },
			timeout: 5_000,
			isLocalAddressAllowed: HKPL_ALLOW_LOCAL,
		}, { throwErrorWhenResponseNotOk: false });
		const json = await res.json().catch(() => ({})) as { ok?: boolean; found?: boolean; status?: string; dupr_match_id?: string | null; last_error?: string | null };
		if (res.status === 200 && json.found && json.status === 'DONE') return { duprStatus: 'submitted', duprRef: json.dupr_match_id ?? currentRef, duprError: null };
		if (res.status === 200 && json.found && json.last_error) return { duprError: String(json.last_error).slice(0, 512) }; // still retrying at hkpl
		return {};
	}
}

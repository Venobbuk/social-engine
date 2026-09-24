/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { DI } from '@/di-symbols.js';
import type { Config } from '@/config.js';
import { HttpRequestService } from '@/core/HttpRequestService.js';
import { bindThis } from '@/decorators.js';
import type { DataSource } from 'typeorm';

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

/*
 * UAT-DUPR-CAGE-V1 (2026-09-23) — the UAT engine must never reach real DUPR.
 * Measured: web and web-uat call the SAME hkpl URL with the SAME secret, and hkpl stamps every social DUPR write with
 * findConsumerTenant() (a findFirst over TWO consumer tenants, boyau and boyau-uat, no order) — so a UAT submit could be
 * stamped `boyau`, pass hkpl's sandbox guard and go straight to production DUPR (DUPR_PARTNER_ENV=production).
 * So the engine cages itself, before any HTTP:
 *   'sandbox' — DUPR_SUBMIT_SANDBOX=1 (compose.uat.yml, web-uat ONLY): no call to hkpl's DUPR door at all; the match is
 *               marked the way hkpl marks a sandbox tenant's write (routes/social-dupr.js:89 answers
 *               { ok, via:'sandbox-suppressed', sandbox:true }) — submitted, ref `sandbox:<id>`, reason sandbox_not_sent —
 *               so the host sees the real flow and the lock, and the app labels it "Test only — not sent to DUPR".
 *   'refuse'  — the env is NOT set but this engine is a UAT one (its own configured host starts `uat.`, or its tenant has
 *               hkpl's sandbox suffix, lib/sandbox-guard.js:25): a forgotten env var fails CLOSED — nothing is sent and
 *               the match reads failed / uat_cage_env_missing.
 *   'live'    — production, unchanged.
 * The tenant is the one the SSO adapter already binds (adapter/sso.ts:103 ADAPTER_SSO_TENANT, else :107
 * ADAPTER_SSO_STAFF_TENANTS, default 'boyau') and is sent to hkpl as `tenant` so hkpl can stamp the CALLER's tenant
 * instead of guessing (additive: today's hkpl validate() ignores the field).
 */
const DUPR_SANDBOX = process.env.DUPR_SUBMIT_SANDBOX === '1';
const DUPR_TENANT = process.env.ADAPTER_SSO_TENANT || (process.env.ADAPTER_SSO_STAFF_TENANTS ?? 'boyau').split(',').map(x => x.trim()).filter(Boolean)[0] || 'boyau';
const SANDBOX_TENANT_RE = /-(uat|sandbox|test)$/i; // hkpl lib/sandbox-guard.js:25 _SANDBOX_SUFFIX — the same rule
const UAT_HOST_RE = /^uat[.-]/i;
/** The reason stored on a caged match (also the app's i18n key). */
export const DUPR_SANDBOX_REASON = 'sandbox_not_sent';
/** The reason stored when a UAT engine was started without its cage env. */
export const DUPR_CAGE_ENV_MISSING = 'uat_cage_env_missing';
export type DuprCageMode = 'live' | 'sandbox' | 'refuse';

/** What the engine sends. `games` is one entry per game, [side0, side1]; `duprIds` is [team1, team2]. */
export type DuprSubmission = {
	matchId: string;
	format: 'SINGLES' | 'DOUBLES';
	playedAt: Date;
	event: string;
	location: string | null;
	duprIds: [string[], string[]];
	games: [number, number][];
	/** DUPR-OPTIONS-V1 (Reclub DUPR confirm sheet): 'sets' = each set is sent as its own DUPR match. Absent = one match (today). */
	basis?: DuprBasis | null;
	/** DUPR-OPTIONS-V1: Sideout / Rally — DUPR's matchType SIDE_ONLY / RALLY. Absent = not stated (today). */
	scoring?: DuprScoring | null;
};
export type DuprBasis = 'matches' | 'sets';
export type DuprScoring = 'sideout' | 'rally';
export type DuprOptions = { basis?: DuprBasis | null; scoring?: DuprScoring | null };

/** The columns to write back. `stamp` = also record who sent it and when (exactly when the meet path did). */
export type DuprPatch = { duprStatus: 'queued' | 'submitted' | 'failed'; duprRef?: string | null; duprError: string | null };
export type DuprResult = { patch: DuprPatch; stamp: boolean };

@Injectable()
export class DuprSubmitService {
	constructor(
		@Inject(DI.config)
		private config: Config,

		private httpRequestService: HttpRequestService,

		@Inject(DI.db)
		private db: DataSource,   // DUPR-OPTIONS-V1: the host's choice is kept on the match row
	) {
	}

	/**
	 * DUPR-OPTIONS-V1 (lane account-rest, S7 D-dupr-confirm-submit.01/.02): what the host chose on the confirm sheet is written
	 * to the match row ("duprBasis" / "duprScoring", migration 1789099300000) when given, and read back when not — so the
	 * lazy retry and the auto-submit send exactly what the host confirmed. Raw SQL: the columns are not on the entities.
	 */
	@bindThis
	public async rememberOptions(table: 'meet_match' | 'competition_match', matchId: string, given?: DuprOptions | null): Promise<DuprOptions> {
		if (given && (given.basis || given.scoring)) {
			await this.db.query(`UPDATE "${table}" SET "duprBasis" = COALESCE($2, "duprBasis"), "duprScoring" = COALESCE($3, "duprScoring") WHERE "id" = $1`, [matchId, given.basis ?? null, given.scoring ?? null]);
		}
		try {
			const r = (await this.db.query(`SELECT "duprBasis", "duprScoring" FROM "${table}" WHERE "id" = $1`, [matchId]) as { duprBasis: string | null; duprScoring: string | null }[])[0];
			return { basis: r?.duprBasis === 'sets' || r?.duprBasis === 'matches' ? r.duprBasis : null, scoring: r?.duprScoring === 'rally' || r?.duprScoring === 'sideout' ? r.duprScoring : null };
		} catch { return { basis: given?.basis ?? null, scoring: given?.scoring ?? null }; }   // before the migration ran
	}

	@bindThis
	public isConfigured(): boolean { return HKPL_URL !== '' && HKPL_SECRET !== ''; }

	/** UAT-DUPR-CAGE-V1: which of the three the engine is — decided from facts the engine holds, never from a request. */
	@bindThis
	public cageMode(): DuprCageMode {
		if (DUPR_SANDBOX) return 'sandbox';
		if (UAT_HOST_RE.test(String(this.config.host ?? '')) || SANDBOX_TENANT_RE.test(DUPR_TENANT)) return 'refuse';
		return 'live';
	}

	/** The tenant this engine submits for (sent to hkpl as `tenant`). */
	@bindThis
	public tenant(): string { return DUPR_TENANT; }

	/** A caged match: the real lock, an honest ref, and the reason the app turns into "Test only — not sent to DUPR". */
	private sandboxResult(matchId: string): DuprResult {
		return { patch: { duprStatus: 'submitted', duprRef: `sandbox:${matchId}`, duprError: DUPR_SANDBOX_REASON }, stamp: true };
	}

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
			tenant: DUPR_TENANT, // UAT-DUPR-CAGE-V1: the caller's tenant, so hkpl need not guess (ignored by today's hkpl)
			format: s.format,
			played_at: new Date(s.playedAt).toISOString(),
			event: s.event,
			location: s.location,
			teams: [team(s.duprIds[0], 0), team(s.duprIds[1], 1)],
			// DUPR-OPTIONS-V1 — additive: a key is sent only when the host chose it, and today's hkpl ignores both (its
			// validate() reads neither); the staged hkpl door (worktree hkpl-wt-account-rest) splits `sets` and passes matchType
			...(s.basis ? { basis: s.basis } : {}),
			...(s.scoring ? { match_type: s.scoring === 'rally' ? 'RALLY' : 'SIDE_ONLY' } : {}),
		};
	}

	/** Never throws for a remote failure — the caller writes the returned patch onto its own row. */
	@bindThis
	public async submit(s: DuprSubmission): Promise<DuprResult> {
		// UAT-DUPR-CAGE-V1: decided BEFORE any HTTP — the caged engine makes zero calls to the DUPR door (retries included:
		// MeetMatchService.list / CompetitionDuprService.refreshQueued re-submit through this same method)
		const mode = this.cageMode();
		if (mode === 'sandbox') return this.sandboxResult(s.matchId);
		if (mode === 'refuse') {
			console.warn('[dupr-cage] REFUSED: a UAT engine without DUPR_SUBMIT_SANDBOX=1 tried to submit', s.matchId);
			return { patch: { duprStatus: 'failed', duprError: DUPR_CAGE_ENV_MISSING }, stamp: false };
		}
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
			// UAT-DUPR-CAGE-V1: hkpl's own sandbox answer (a sandbox tenant's write, suppressed there) is the same honest state
			// — before, it read 'queued' with no ref and the lazy retry re-sent it every minute, forever
			if (json.sandbox === true) return this.sandboxResult(s.matchId);
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
		// UAT-DUPR-CAGE-V1: a caged engine never calls the door (not even the read); a sandbox ref has nothing to ask about
		if (this.cageMode() !== 'live' || String(currentRef ?? '').startsWith('sandbox:')) return {};
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

	/**
	 * GRIPBAT-ACCOUNTS-V1 (spec §7, G15.15) — the DUPR CONNECT doors. With GripBat owning its accounts there is no hkpl
	 * user to hang a DUPR link on, so hkpl performs the partner consent check / partner rating read for a GripBat user
	 * through S2S doors keyed by the GripBat user id + tenant (hkpl routes/social-dupr-connect.js, staged for the hkpl
	 * window). Same URL, same secret, same local-address rule as the submit door — the hkpl facts stay in THIS file.
	 * Only paths under /api/v1/social/dupr/ (sso-url | verify | ratings) — never the submit path, never the reader.
	 * Never throws: { status: 0 } when hkpl is unreachable or unconfigured.
	 */
	@bindThis
	public async connectDoor(path: 'sso-url' | 'verify' | 'ratings', body: Record<string, unknown> | null): Promise<{ status: number; json: Record<string, unknown> }> {
		if (!this.isConfigured()) return { status: 0, json: { reason: 'hkpl_unconfigured' } };
		try {
			const res = await this.httpRequestService.send(`${HKPL_URL}/api/v1/social/dupr/${path}`, {
				method: body == null ? 'GET' : 'POST',
				headers: body == null ? { 'x-social-secret': HKPL_SECRET } : { 'content-type': 'application/json', 'x-social-secret': HKPL_SECRET },
				...(body == null ? {} : { body: JSON.stringify({ ...body, tenant: DUPR_TENANT }) }),
				timeout: 15_000,
				isLocalAddressAllowed: HKPL_ALLOW_LOCAL,
			}, { throwErrorWhenResponseNotOk: false });
			const json = await res.json().catch(() => ({})) as Record<string, unknown>;
			return { status: res.status, json: (json && typeof json === 'object') ? json : {} };
		} catch (err) {
			return { status: 0, json: { reason: 'hkpl_unreachable', detail: (err as Error).message } };
		}
	}
}

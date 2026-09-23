/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { In } from 'typeorm';
import { DI } from '@/di-symbols.js';
import type { CompetitionEntriesRepository, CompetitionMatchesRepository, UsersRepository } from '@/models/_.js';
import type { MiUser } from '@/models/User.js';
import { IdentifiableError } from '@/misc/identifiable-error.js';
import { bindThis } from '@/decorators.js';
import { MeetLevelService } from '@/modules/meets/MeetLevelService.js';
import { DuprSubmitService } from '@/core/DuprSubmitService.js';
import type { DuprEligibility } from '@/modules/meets/MeetMatchService.js';
import type { MiCompetition } from './models/Competition.js';
import type { MiCompetitionEntry } from './models/CompetitionEntry.js';
import type { MiCompetitionMatch } from './models/CompetitionMatch.js';

/**
 * COMP-DUPR-V1 (2026-09-21) — a TOURNAMENT match goes to DUPR down the SAME path a meet match takes.
 * Copied from modules/meets/MeetMatchService.ts:250-336 (eligibility + submitDupr) and :74-85 (the 60-second lazy
 * refresh); the hkpl call itself is not copied at all — it is the shared core/DuprSubmitService both paths use.
 * The only thing this file re-derives is how a SIDE resolves to people: a meet side is a list of participant ids,
 * a tournament side is ONE entry id (a team), so entry -> userIds -> MeetPlayerLevel.duprId.
 *
 * CONSENT — the meet path refuses a match while any account player on it has not confirmed
 * (SEC-CASUAL-CONSENT-V1, MeetMatchService.ts:291 + casualPending). The same rule, on the tournament's own record of
 * a player's participation: an entry is the participation record, so a side is consented when the entry is
 * 'confirmed', the match's own side status is 'confirmed' (never a bye / forfeit / pending), and the team has no
 * partner still sitting in invitedUserIds (COMP-W1B4: nobody is seated in a team without saying yes).
 * The meet applies it to casual games only because an organised meet's roster is already confirmed by joining; a
 * tournament entry is exactly that kind of record, so the check runs on EVERY tournament match — stricter, never
 * weaker, than the path it is copied from.
 *
 * SCRAPE RULE: nothing here talks to DUPR. DuprSubmitService posts to hkpl's one social door, hkpl pins the boyau
 * tenants to the Partner API (lib/dupr/partner-only.js) and its dashboard reader cannot write
 * (lib/dupr/route-richard.js:451 canWrite() === false).
 */
const COMP_UNCONFIRMED = 'Every player must be a confirmed entrant before this match can be sent to DUPR.';

export type CompetitionDuprSide = {
	entryId: string | null;
	entryName: string | null;
	status: string;
	players: { userId: string; name: string; duprId: string | null }[];
};
export type CompetitionDuprPreview = {
	confirmed: false;
	matchId: string;
	competitionId: string;
	event: string;
	location: string | null;
	playedAt: string;
	format: 'SINGLES' | 'DOUBLES' | null;
	games: [number, number][];
	sides: [CompetitionDuprSide, CompetitionDuprSide];
	eligibility: DuprEligibility;
	consent: { ok: boolean; pendingEntryIds: string[]; message: string | null };
	willSubmit: boolean;
	/** The exact JSON hkpl would receive — null when the match is not eligible, so nothing is invented. */
	body: Record<string, unknown> | null;
};

@Injectable()
export class CompetitionDuprService {
	constructor(
		@Inject(DI.competitionMatchesRepository)
		private matchesRepository: CompetitionMatchesRepository,

		@Inject(DI.competitionEntriesRepository)
		private entriesRepository: CompetitionEntriesRepository,

		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,

		private meetLevelService: MeetLevelService,
		private duprSubmitService: DuprSubmitService,
	) {
	}

	private err(id: string, message: string): IdentifiableError {
		return new IdentifiableError(`competition:${id}`, message);
	}

	private async entriesOf(match: MiCompetitionMatch): Promise<[MiCompetitionEntry | null, MiCompetitionEntry | null]> {
		const ids = [match.entry1Id, match.entry2Id].filter((x): x is string => x != null);
		const rows = ids.length ? await this.entriesRepository.findBy({ id: In(ids), competitionId: match.competitionId }) : [];
		const byId = new Map(rows.map(r => [r.id, r]));
		return [match.entry1Id ? byId.get(match.entry1Id) ?? null : null, match.entry2Id ? byId.get(match.entry2Id) ?? null : null];
	}

	/**
	 * SEC-CASUAL-CONSENT-V1, on a tournament: the entry ids on this match whose players have not all consented.
	 * [] means every side is a confirmed entry, confirmed on this match, with nobody still merely invited.
	 */
	@bindThis
	public async pendingConsent(c: MiCompetition, match: MiCompetitionMatch): Promise<string[]> {
		const [e1, e2] = await this.entriesOf(match);
		const out: string[] = [];
		const check = (e: MiCompetitionEntry | null, sideStatus: string, id: string | null) => {
			if (e == null) { if (id != null) out.push(id); return; }
			if (e.status !== 'confirmed' || sideStatus !== 'confirmed' || (e.invitedUserIds ?? []).length > 0) out.push(e.id);
		};
		check(e1, match.entry1Status, match.entry1Id);
		check(e2, match.entry2Status, match.entry2Id);
		return out;
	}

	/** Reclub's eligibility record for one tournament match. Pure: no side effects. Same codes as the meet path. */
	@bindThis
	public async eligibility(c: MiCompetition, match: MiCompetitionMatch): Promise<DuprEligibility & { format: 'SINGLES' | 'DOUBLES' | null; duprIds: [string[], string[]]; sides: [CompetitionDuprSide, CompetitionDuprSide] }> {
		const errors: DuprEligibility['errors'] = [];
		const [e1, e2] = await this.entriesOf(match);
		const members = (e: MiCompetitionEntry | null) => (e?.userIds ?? []).filter(Boolean);
		let m1 = members(e1), m2 = members(e2);
		// COMP-FIXES-B (Reclub "Assign players" → score participants; hkpl routes/captain.js:1277-1305 PRESERVE-LINEUP-V1 /
		// ANTI-CHEAT-PLAYERS-SERVER-V2: DUPR is told who played from the line-up on file, never guessed from the roster): when the
		// games carry line-ups, the players sent are the line-up's. One DUPR match holds one set of players, so every game must
		// have the SAME line-up; a team that changed its players between games is refused with the reason (lineup_varies) rather
		// than sent under the wrong names. A team entry of 3+ without line-ups is told to assign them (lineup_missing).
		const games = (match.scores ?? []).slice(0, 5);
		const lined = games.filter((s) => (s.p1?.length ?? 0) > 0 || (s.p2?.length ?? 0) > 0);
		let lineupError: string | null = null;
		if (lined.length) {
			const key = (s: { p1?: string[]; p2?: string[] }) => [...(s.p1 ?? [])].sort().join(',') + '|' + [...(s.p2 ?? [])].sort().join(',');
			if (lined.length !== games.length || games.some((s) => !(s.p1?.length) || !(s.p2?.length))) lineupError = 'lineup_incomplete';
			else if (new Set(games.map(key)).size > 1) lineupError = 'lineup_varies';
			else { m1 = games[0].p1 ?? []; m2 = games[0].p2 ?? []; }
		} else if (m1.length > 2 || m2.length > 2) lineupError = 'lineup_missing';
		// the three line-up codes are tournament-only; the shared union lives in the meets module (MeetMatchService.ts:24), which
		// this lane does not own — the value is a plain string in the JSON either way
		if (lineupError) errors.push({ code: lineupError as unknown as DuprEligibility['errors'][number]['code'], affectedParticipantIds: [] });
		const n1 = m1.length, n2 = m2.length;
		if (!lineupError && (n1 !== n2 || n1 === 0)) errors.push({ code: 'uneven_teams', affectedParticipantIds: [] });
		const format = !lineupError && n1 === n2 && n1 === 1 ? 'SINGLES' : !lineupError && n1 === n2 && n1 === 2 ? 'DOUBLES' : null;
		if (!lineupError && n1 === n2 && n1 > 0 && format == null) errors.push({ code: 'not_singles_doubles', affectedParticipantIds: [] });
		if ((match.scores ?? []).length === 0) errors.push({ code: 'no_scores', affectedParticipantIds: [] });

		const ids = [...m1, ...m2];
		const users = ids.length ? await this.usersRepository.findBy({ id: In(ids) }) : [];
		const byId = new Map(users.map(u => [u.id, u]));
		const noAccount: string[] = [], notConnected: string[] = [];
		const duprOf = new Map<string, string>();
		const nameOf = new Map<string, string>();
		for (const uid of ids) {
			const u = byId.get(uid);
			if (!u) { noAccount.push(uid); continue; }
			nameOf.set(uid, u.name ?? u.username);
			const level = await this.meetLevelService.getLevel(uid, c.sport);
			if (!level?.duprId) { notConnected.push(uid); continue; }
			duprOf.set(uid, level.duprId);
		}
		if (noAccount.length) errors.push({ code: 'no_account', affectedParticipantIds: noAccount });
		if (notConnected.length) errors.push({ code: 'not_connected', affectedParticipantIds: notConnected });

		const side = (e: MiCompetitionEntry | null, ms: string[], status: string): CompetitionDuprSide => ({
			entryId: e?.id ?? null,
			entryName: e?.name ?? null,
			status,
			players: ms.map(uid => ({ userId: uid, name: nameOf.get(uid) ?? '', duprId: duprOf.get(uid) ?? null })),
		});
		return {
			isEligible: errors.length === 0,
			errors,
			format,
			duprIds: [m1.map(i => duprOf.get(i) ?? ''), m2.map(i => duprOf.get(i) ?? '')],
			sides: [side(e1, m1, match.entry1Status), side(e2, m2, match.entry2Status)],
		};
	}

	/** Score sets as the submitter wants them: one [side0, side1] per game (the meet's own shape). */
	private games(match: MiCompetitionMatch): [number, number][] {
		return (match.scores ?? []).slice(0, 5).map(s => [s.t1, s.t2] as [number, number]);
	}

	private playedAt(c: MiCompetition, match: MiCompetitionMatch): Date {
		return match.startAt ?? c.startAt;
	}

	/**
	 * THE CONFIRMATION STEP. What would be sent, and whether it may be — and NOTHING is sent. The endpoint returns
	 * this whenever the caller has not said confirm:true, so no tournament result can reach DUPR without the host
	 * having been shown, on this same data, exactly what leaves the engine.
	 */
	@bindThis
	public async preview(c: MiCompetition, match: MiCompetitionMatch): Promise<CompetitionDuprPreview> {
		const e = await this.eligibility(c, match);
		const pending = await this.pendingConsent(c, match);
		const games = this.games(match);
		const body = (e.isEligible && pending.length === 0 && e.format != null)
			? this.duprSubmitService.body({ matchId: match.id, format: e.format, playedAt: this.playedAt(c, match), event: c.name, location: c.venueName ?? null, duprIds: e.duprIds, games })
			: null;
		return {
			confirmed: false,
			matchId: match.id,
			competitionId: c.id,
			event: c.name,
			location: c.venueName ?? null,
			playedAt: this.playedAt(c, match).toISOString(),
			format: e.format,
			games,
			sides: e.sides,
			eligibility: { isEligible: e.isEligible, errors: e.errors },
			consent: { ok: pending.length === 0, pendingEntryIds: pending, message: pending.length ? COMP_UNCONFIRMED : null },
			willSubmit: e.isEligible && pending.length === 0,
			body,
		};
	}

	/**
	 * Send one tournament match to hkpl's DUPR queue. Never throws for a remote failure — the row records what
	 * happened (queued / submitted / failed / ineligible + duprError) so the pane can show it and the host can retry.
	 * Copied from MeetMatchService.submitDupr: same consent refusal first, same eligibility gate, same marking.
	 */
	@bindThis
	public async submitDupr(c: MiCompetition, match: MiCompetitionMatch, by: MiUser): Promise<MiCompetitionMatch> {
		// the ONE door: refuse while any player on this match is not a confirmed entrant
		if ((await this.pendingConsent(c, match)).length > 0) throw this.err('invalid_transition', COMP_UNCONFIRMED);
		const e = await this.eligibility(c, match);
		const mark = async (patch: Partial<MiCompetitionMatch>) => {
			await this.matchesRepository.update(match.id, { ...patch, updatedAt: new Date() });
			return await this.matchesRepository.findOneByOrFail({ id: match.id });
		};
		if (!e.isEligible || e.format == null) return await mark({ duprStatus: 'ineligible', duprError: e.errors.map(x => x.code).join(',') || 'not_singles_doubles' });

		const r = await this.duprSubmitService.submit({
			matchId: match.id,
			format: e.format,
			playedAt: this.playedAt(c, match),
			event: c.name,
			location: c.venueName ?? null,
			duprIds: e.duprIds,
			games: this.games(match),
		});
		return await mark({ ...r.patch, ...(r.stamp ? { duprSubmittedById: by.id, duprSubmittedAt: new Date() } : {}) });
	}

	/** MeetMatchService.refreshDupr, on a tournament row. */
	@bindThis
	public async refreshDupr(match: MiCompetitionMatch): Promise<MiCompetitionMatch> {
		const patch = await this.duprSubmitService.refresh(match.id, match.duprRef);
		if (Object.keys(patch).length === 0) return match;
		await this.matchesRepository.update(match.id, { ...patch, updatedAt: new Date() });
		return await this.matchesRepository.findOneByOrFail({ id: match.id });
	}

	/**
	 * MeetMatchService.list's lazy badge refresh, unchanged: at most once a minute per row, a queued row WITHOUT a
	 * ref never reached hkpl (retry the submission); with a ref, ask hkpl how it went.
	 */
	@bindThis
	public async refreshQueued(c: MiCompetition, rows: MiCompetitionMatch[]): Promise<MiCompetitionMatch[]> {
		const out = rows.slice();
		for (let i = 0; i < out.length; i++) {
			const r = out[i];
			if (r.duprStatus === 'queued' && Date.now() - new Date(r.updatedAt).getTime() > 60_000) {
				const by = r.duprSubmittedById ? await this.usersRepository.findOneBy({ id: r.duprSubmittedById }) : null;
				out[i] = (!r.duprRef && by ? await this.submitDupr(c, r, by).catch(() => r) : await this.refreshDupr(r).catch(() => r));
			}
		}
		return out;
	}
}

/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { DI } from '@/di-symbols.js';
import type { MeetMatchesRepository, MeetParticipantsRepository, MeetsRepository, UsersRepository } from '@/models/_.js';
import type { MiMeet } from '@/modules/meets/models/Meet.js';
import type { MiMeetMatch } from '@/modules/meets/models/MeetMatch.js';
import type { MiMeetParticipant } from '@/modules/meets/models/MeetParticipant.js';
import type { MiUser } from '@/models/User.js';
import { IdService } from '@/core/IdService.js';
import { HttpRequestService } from '@/core/HttpRequestService.js';
import { MeetService } from '@/modules/meets/MeetService.js';
import { MeetLevelService } from '@/modules/meets/MeetLevelService.js';
import { IdentifiableError } from '@/misc/identifiable-error.js';
import { bindThis } from '@/decorators.js';
import { generate as runGenerator, type Scheme, type RankingCriteria, type PlayerStat } from '@/modules/meets/MeetMatchGenerator.js';

/** Reclub DUPRMatchEligibilityErrorCode, verbatim. */
export type DuprEligibilityCode = 'no_account' | 'no_scores' | 'not_connected' | 'not_singles_doubles' | 'uneven_teams';
export type DuprEligibility = { isEligible: boolean; errors: { code: DuprEligibilityCode; affectedParticipantIds: string[] }[] };

// The one hkpl door (SOCIAL-DUPR-V1): POST /api/v1/social/dupr/submit, GET /api/v1/social/dupr/status.
// Both facts come from the environment and FAIL CLOSED: unset → the match is marked failed with a visible reason.
const HKPL_URL = (process.env.ADAPTER_HKPL_URL ?? '').replace(/\/+$/, '');
const HKPL_SECRET = process.env.ADAPTER_HKPL_S2S_SECRET ?? '';
// hkpl-app runs on the same box (host.docker.internal:3939): the SSRF guard must admit that private address.
const HKPL_ALLOW_LOCAL = process.env.ADAPTER_HKPL_ALLOW_LOCAL === '1';
const CASUAL_UNCONFIRMED = 'Every player must confirm this casual game before it can be sent to DUPR.'; // SEC-CASUAL-CONSENT-V1

/**
 * MEET-MATCH-V1: Reclub's Matches pane (spec_meets.md §4.1, §4.6) and its DUPR hand-off.
 *   canManage      — a host: create/delete matches, set round/court/teams, edit any score
 *   canUpdateScore — a host, or a player OF THAT MATCH when meet.allowPlayerScoring
 *   locked         — duprStatus 'submitted': "These matches have already been submitted to DUPR."
 * When meet.submitMatches ("Matches will be submitted") is on, a scored match is sent to hkpl at once; hkpl owns the
 * partner key, the queue and the retries. The engine keeps the receipt (queued → submitted) for the badge.
 */
@Injectable()
export class MeetMatchService {
	constructor(
		@Inject(DI.meetMatchesRepository)
		private meetMatchesRepository: MeetMatchesRepository,

		@Inject(DI.meetParticipantsRepository)
		private meetParticipantsRepository: MeetParticipantsRepository,

		@Inject(DI.meetsRepository)
		private meetsRepository: MeetsRepository,

		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,

		@Inject(DI.db)
		private db: DataSource,

		private idService: IdService,
		private httpRequestService: HttpRequestService,
		private meetService: MeetService,
		private meetLevelService: MeetLevelService,
	) {
	}

	private async usersRepositoryLite(id: string): Promise<MiUser | null> { return await this.usersRepository.findOneBy({ id }); }

	private err(id: string, message: string): IdentifiableError {
		return new IdentifiableError(`meet:${id}`, message);
	}

	@bindThis
	public async list(meet: MiMeet): Promise<MiMeetMatch[]> {
		const rows = await this.meetMatchesRepository.find({ where: { meetId: meet.id }, order: { round: 'ASC', courtIndex: 'ASC', id: 'ASC' } });
		// lazily refresh the badge for rows hkpl is still draining (at most once a minute per row)
		for (let i = 0; i < rows.length; i++) {
			const r = rows[i];
			if (r.duprStatus === 'queued' && Date.now() - new Date(r.updatedAt).getTime() > 60_000) {
				// FAIL-SOFT-V1: a queued row WITHOUT a ref never reached hkpl — retry the submission; with a ref, ask hkpl how it went
				const by = r.duprSubmittedById ? await this.usersRepositoryLite(r.duprSubmittedById) : null;
				rows[i] = (!r.duprRef && by ? await this.submitDupr(meet, r, by).catch(() => r) : await this.refreshDupr(r).catch(() => r));
			}
		}
		return rows;
	}

	@bindThis
	public async isHost(meet: MiMeet, user: MiUser): Promise<boolean> {
		try { await this.meetService.assertHost(meet, user); return true; } catch { return false; }
	}

	private async myParticipantId(meet: MiMeet, user: MiUser): Promise<string | null> {
		const p = await this.meetParticipantsRepository.findOne({ where: { meetId: meet.id, userId: user.id }, select: { id: true } });
		return p?.id ?? null;
	}

	/** Reclub canUpdateScore: host, or a player of this match when the meet allows player scoring. */
	@bindThis
	public async canUpdateScore(meet: MiMeet, match: MiMeetMatch, user: MiUser): Promise<boolean> {
		if (await this.isHost(meet, user)) return true;
		if (!meet.allowPlayerScoring) return false;
		const mine = await this.myParticipantId(meet, user);
		return mine != null && (match.team1Ids.includes(mine) || match.team2Ids.includes(mine));
	}

	private async assertTeams(meet: MiMeet, team1Ids: string[], team2Ids: string[]): Promise<void> {
		const ids = [...team1Ids, ...team2Ids];
		if (new Set(ids).size !== ids.length) throw this.err('invalid_transition', 'A player cannot be on both teams.');
		if (ids.length === 0) return;
		const found = await this.meetParticipantsRepository.createQueryBuilder('p').select('p.id').where('p.meetId = :meetId', { meetId: meet.id }).andWhere('p.id IN (:...ids)', { ids }).getMany();
		if (found.length !== ids.length) throw this.err('no_such_participant', 'No such participant.');
	}

	private cleanScores(scores: unknown): [number, number][] {
		if (!Array.isArray(scores)) return [];
		return scores
			.filter((s): s is [number, number] => Array.isArray(s) && s.length === 2 && Number.isInteger(s[0]) && Number.isInteger(s[1]) && s[0] >= 0 && s[1] >= 0)
			.slice(0, 5); // DUPR takes game1..game5
	}

	/**
	 * Create or edit a match. Structure (round, court, teams) is the host's; scores follow canUpdateScore.
	 * A submitted match is locked. If the meet submits to DUPR and the match now has scores, it is sent.
	 */
	@bindThis
	public async upsert(meet: MiMeet, user: MiUser, data: { matchId?: string | null; round?: number | null; courtIndex?: number | null; team1Ids?: string[]; team2Ids?: string[]; scores?: unknown }): Promise<MiMeetMatch> {
		const host = await this.isHost(meet, user);
		let match = data.matchId ? await this.meetMatchesRepository.findOneBy({ id: data.matchId, meetId: meet.id }) : null;
		if (data.matchId && !match) throw this.err('no_such_match', 'No such match.');
		if (match?.duprStatus === 'submitted') throw this.err('dupr_locked', 'These matches have already been submitted to DUPR.  Please note that manual submission through DUPR will not be reflected here.');

		const structural = data.round !== undefined || data.courtIndex !== undefined || data.team1Ids !== undefined || data.team2Ids !== undefined;
		if (!match || structural) {
			if (!host) throw this.err('not_host', 'Only a host can do that.');
		}
		if (data.scores !== undefined && match && !(await this.canUpdateScore(meet, match, user))) throw this.err('not_host', 'Only a host or a player of this match can score it.');
		// SEC-CASUAL-CONSENT-V1: once another player has confirmed a casual game, its result is what they agreed to —
		// no score or team edits (withdrawing the record by delete/cancel stays possible; it never fakes a result).
		if (match && (structural || data.scores !== undefined)) await this.assertCasualUnlocked(meet, match);

		const team1Ids = data.team1Ids ?? match?.team1Ids ?? [];
		const team2Ids = data.team2Ids ?? match?.team2Ids ?? [];
		if (data.team1Ids !== undefined || data.team2Ids !== undefined) await this.assertTeams(meet, team1Ids, team2Ids);

		if (!match) {
			match = await this.meetMatchesRepository.insertOne({
				id: this.idService.gen(),
				meetId: meet.id,
				round: data.round ?? null,
				courtIndex: data.courtIndex ?? null,
				team1Ids,
				team2Ids,
				scores: this.cleanScores(data.scores),
				createdById: user.id,
				duprStatus: null,
				duprSubmittedById: null,
				duprSubmittedAt: null,
				duprRef: null,
				duprError: null,
				updatedAt: new Date(),
			});
		} else {
			const patch: Partial<MiMeetMatch> = { updatedAt: new Date() };
			if (data.round !== undefined) patch.round = data.round;
			if (data.courtIndex !== undefined) patch.courtIndex = data.courtIndex;
			if (data.team1Ids !== undefined) patch.team1Ids = team1Ids;
			if (data.team2Ids !== undefined) patch.team2Ids = team2Ids;
			if (data.scores !== undefined) patch.scores = this.cleanScores(data.scores);
			// a re-scored match that failed or was ineligible gets a fresh attempt; a queued one is refreshed at hkpl
			if (data.scores !== undefined && match.duprStatus != null && match.duprStatus !== 'queued') { patch.duprStatus = null; patch.duprError = null; }
			await this.meetMatchesRepository.update(match.id, patch);
			match = await this.meetMatchesRepository.findOneByOrFail({ id: match.id });
		}

		if (meet.submitMatches && match.scores.length > 0 && data.scores !== undefined && (await this.casualPending(meet, match)).length === 0) {
			match = await this.submitDupr(meet, match, user);
		}
		return match;
	}

	// ------------------------------------------------------------------------------------------ MEET-GEN-V1
	/** Per-participant tallies from the meet's scored matches: the generator's memory (partners, opponents, points). */
	@bindThis
	public async playerStats(meet: MiMeet, only?: MiMeetMatch[]): Promise<Record<string, PlayerStat>> {
		const rows = only ?? await this.meetMatchesRepository.find({ where: { meetId: meet.id } });
		const st: Record<string, PlayerStat> = {};
		const get = (id: string) => st[id] ??= { id, played: 0, wins: 0, pointsFor: 0, pointsAgainst: 0, partners: {}, opponents: {} };
		for (const m of rows) {
			let w1 = 0, w2 = 0, p1 = 0, p2 = 0;
			for (const [a, b] of m.scores) { if (a > b) w1++; else if (b > a) w2++; p1 += a; p2 += b; }
			const scored = m.scores.length > 0;
			[m.team1Ids, m.team2Ids].forEach((team, ti) => {
				const other = ti === 0 ? m.team2Ids : m.team1Ids;
				for (const id of team) {
					const s = get(id); s.played++;
					if (scored) { if ((ti === 0 ? w1 > w2 : w2 > w1)) s.wins++; s.pointsFor += ti === 0 ? p1 : p2; s.pointsAgainst += ti === 0 ? p2 : p1; }
					for (const mate of team) if (mate !== id) s.partners[mate] = (s.partners[mate] ?? 0) + 1;
					for (const o of other) s.opponents[o] = (s.opponents[o] ?? 0) + 1;
				}
			});
		}
		return st;
	}

	/**
	 * Reclub's match generator (POST /matches/generate). Host only. persist=false previews; reset clears the
	 * unscored, unsubmitted matches first; new rounds continue after the highest existing round.
	 */
	@bindThis
	public async generate(meet: MiMeet, user: MiUser, o: { scheme: Scheme; courts: number; participantIds: string[] | null; limitRounds: number | null; persist: boolean; reset: boolean; prioritizeLeastMatches: boolean; rankingCriteria: RankingCriteria | null; seed: number | null }): Promise<{ persisted: boolean; matches: MiMeetMatch[]; rounds: number; fullRounds: number; players: number; warnings: string[] }> {
		if (!(await this.isHost(meet, user))) throw this.err('not_host', 'Only a host can do that.');
		const confirmed = await this.meetParticipantsRepository.find({ where: { meetId: meet.id, status: 'confirmed' }, order: { id: 'ASC' } });
		const allowed = new Set(confirmed.map((p) => p.id));
		const ids = (o.participantIds ?? confirmed.map((p) => p.id)).filter((id) => allowed.has(id));
		if (o.participantIds && ids.length !== o.participantIds.length) throw this.err('no_such_participant', 'No such participant.');
		// PRESET_TEAMS: a team is the participants sharing a teamKey
		const teams: string[][] = [];
		if (o.scheme === 'PRESET_TEAMS') { const by = new Map<string, string[]>(); for (const p of confirmed) if (p.teamKey && ids.includes(p.id)) by.set(p.teamKey, [...(by.get(p.teamKey) ?? []), p.id]); teams.push(...by.values()); }
		const existing = await this.meetMatchesRepository.find({ where: { meetId: meet.id } });
		const clearable = o.reset ? existing.filter((m) => m.scores.length === 0 && m.duprStatus !== 'submitted') : [];
		const kept = existing.filter((m) => !clearable.includes(m));
		const startRound = kept.reduce((n, m) => Math.max(n, m.round ?? 0), 0) + 1;
		// the history the generator balances against is what will REMAIN: a reset starts every count from zero
		// (graded 2026-09-17: "Clear current matches keeps the old counts as the baseline")
		const stats = await this.playerStats(meet, kept);
		const seed = o.seed ?? Math.floor(Math.random() * 2 ** 31);
		const gen = runGenerator({ scheme: o.scheme, participantIds: ids, teams, courts: o.courts, limitRounds: o.limitRounds, prioritizeLeastMatches: o.prioritizeLeastMatches, rankingCriteria: o.rankingCriteria ?? undefined, stats, startRound, seed });
		const now = new Date();
		const rows: MiMeetMatch[] = gen.matches.map((g) => ({
			id: this.idService.gen(), meetId: meet.id, round: g.round, courtIndex: g.courtIndex, team1Ids: g.team1Ids, team2Ids: g.team2Ids, scores: [],
			createdById: user.id, duprStatus: null, duprSubmittedById: null, duprSubmittedAt: null, duprRef: null, duprError: null, updatedAt: now,
		} as unknown as MiMeetMatch));
		if (!o.persist) return { persisted: false, matches: rows, rounds: gen.rounds, fullRounds: gen.fullRounds, players: gen.players, warnings: gen.warnings };
		if (clearable.length) await this.meetMatchesRepository.delete(clearable.map((m) => m.id));
		if (rows.length) await this.meetMatchesRepository.insert(rows);
		return { persisted: true, matches: rows, rounds: gen.rounds, fullRounds: gen.fullRounds, players: gen.players, warnings: gen.warnings };
	}

	@bindThis
	public async delete(meet: MiMeet, user: MiUser, matchId: string): Promise<void> {
		if (!(await this.isHost(meet, user))) throw this.err('not_host', 'Only a host can do that.');
		const match = await this.meetMatchesRepository.findOneBy({ id: matchId, meetId: meet.id });
		if (!match) throw this.err('no_such_match', 'No such match.');
		if (match.duprStatus === 'submitted') throw this.err('dupr_locked', 'These matches have already been submitted to DUPR.  Please note that manual submission through DUPR will not be reflected here.');
		await this.meetMatchesRepository.delete(match.id);
	}

	// ------------------------------------------------------------------------------------------ DUPR
	/** Reclub's eligibility record for one match. Pure: no side effects. */
	@bindThis
	public async eligibility(meet: MiMeet, match: MiMeetMatch): Promise<DuprEligibility & { format: 'SINGLES' | 'DOUBLES' | null; duprIds: [string[], string[]] }> {
		const errors: DuprEligibility['errors'] = [];
		const n1 = match.team1Ids.length, n2 = match.team2Ids.length;
		if (n1 !== n2) errors.push({ code: 'uneven_teams', affectedParticipantIds: [] });
		const format = n1 === n2 && n1 === 1 ? 'SINGLES' : n1 === n2 && n1 === 2 ? 'DOUBLES' : null;
		if (n1 === n2 && format == null) errors.push({ code: 'not_singles_doubles', affectedParticipantIds: [] });
		if (match.scores.length === 0) errors.push({ code: 'no_scores', affectedParticipantIds: [] });

		const ids = [...match.team1Ids, ...match.team2Ids];
		const rows: MiMeetParticipant[] = ids.length ? await this.meetParticipantsRepository.createQueryBuilder('p').where('p.meetId = :meetId', { meetId: meet.id }).andWhere('p.id IN (:...ids)', { ids }).getMany() : [];
		const byId = new Map(rows.map(r => [r.id, r]));
		const noAccount: string[] = [], notConnected: string[] = [];
		const duprOf = new Map<string, string>();
		for (const pid of ids) {
			const p = byId.get(pid);
			if (!p || !p.userId) { noAccount.push(pid); continue; }
			const level = await this.meetLevelService.getLevel(p.userId, meet.sport);
			if (!level?.duprId) { notConnected.push(pid); continue; }
			duprOf.set(pid, level.duprId);
		}
		if (noAccount.length) errors.push({ code: 'no_account', affectedParticipantIds: noAccount });
		if (notConnected.length) errors.push({ code: 'not_connected', affectedParticipantIds: notConnected });
		return {
			isEligible: errors.length === 0,
			errors,
			format,
			duprIds: [match.team1Ids.map(i => duprOf.get(i) ?? ''), match.team2Ids.map(i => duprOf.get(i) ?? '')],
		};
	}

	/**
	 * Send one match to hkpl's DUPR queue. Never throws for a remote failure — the row records what happened
	 * (queued / submitted / failed / ineligible + duprError) so the pane can show it and the host can retry.
	 */
	@bindThis
	public async submitDupr(meet: MiMeet, match: MiMeetMatch, by: MiUser): Promise<MiMeetMatch> {
		// SEC-CASUAL-CONSENT-V1: the ONE door to DUPR refuses a casual game while any account player on the match has
		// not confirmed (invited / declined / anything else) — every caller (submit-dupr, submit-dupr-all, upsert,
		// the deferred submit, the sweep, list() retries) goes through here.
		if ((await this.casualPending(meet, match)).length > 0) throw this.err('invalid_transition', CASUAL_UNCONFIRMED);
		const e = await this.eligibility(meet, match);
		const mark = async (patch: Partial<MiMeetMatch>) => {
			await this.meetMatchesRepository.update(match.id, { ...patch, updatedAt: new Date() });
			return await this.meetMatchesRepository.findOneByOrFail({ id: match.id });
		};
		if (!e.isEligible) return await mark({ duprStatus: 'ineligible', duprError: e.errors.map(x => x.code).join(',') });
		if (!HKPL_URL || !HKPL_SECRET) return await mark({ duprStatus: 'failed', duprError: 'hkpl_unconfigured' });

		const team = (duprIds: string[], side: 0 | 1) => {
			const t: Record<string, unknown> = { player1: { dupr_id: duprIds[0] } };
			if (duprIds[1]) t.player2 = { dupr_id: duprIds[1] };
			match.scores.forEach((s, i) => { t[`game${i + 1}`] = s[side]; });
			return t;
		};
		const body = {
			match_id: `boyau:${match.id}`,
			format: e.format,
			played_at: new Date(meet.startAt).toISOString(),
			event: meet.name,
			location: meet.venueName ?? null,
			teams: [team(e.duprIds[0], 0), team(e.duprIds[1], 1)],
		};
		try {
			const res = await this.httpRequestService.send(`${HKPL_URL}/api/v1/social/dupr/submit`, {
				method: 'POST',
				headers: { 'content-type': 'application/json', 'x-social-secret': HKPL_SECRET },
				body: JSON.stringify(body),
				timeout: 10_000,
				isLocalAddressAllowed: HKPL_ALLOW_LOCAL,
			}, { throwErrorWhenResponseNotOk: false });
			const json = await res.json().catch(() => ({})) as { ok?: boolean; via?: string; queue_id?: string | null; dupr_match_id?: string | null; error?: string; sandbox?: boolean };
			if (res.status !== 200 || !json.ok) return await mark({ duprStatus: 'failed', duprError: `hkpl ${res.status} ${json.error ?? ''}`.trim().slice(0, 512) });
			const submitted = json.via === 'partner' && !!json.dupr_match_id;
			return await mark({
				duprStatus: submitted ? 'submitted' : 'queued',
				duprRef: (json.dupr_match_id ?? json.queue_id ?? null),
				duprError: null,
				duprSubmittedById: by.id,
				duprSubmittedAt: new Date(),
			});
		} catch (err) {
			// FAIL-SOFT-V1: the league server being down is not the player's failure — keep the row queued (no ref yet) and
			// let list() retry it; the badge reads 'Submitting' until hkpl answers
			return await mark({ duprStatus: 'queued', duprRef: null, duprSubmittedById: by.id, duprSubmittedAt: new Date(), duprError: `hkpl unreachable: ${(err as Error).message}`.slice(0, 512) });
		}
	}

	/**
	 * SEC-CASUAL-CONSENT-V1: submit the still-unsent matches of casual games that asked for DUPR (meet.submitMatches)
	 * and are now fully confirmed — no account player on the match is still pending or declined. Idempotent: only
	 * matches with duprStatus IS NULL are touched, and submitDupr never throws (it records the outcome on the row).
	 * Called with a meetId from meets/respond the moment the last player confirms, and with no argument from the
	 * minute sweep as a safety net. Returns how many matches were submitted.
	 */
	/** SEC-CASUAL-CONSENT-V1: participant ids of ACCOUNT players on a casual match who have not confirmed ([] if not casual). */
	@bindThis
	public async casualPending(meet: MiMeet, match: MiMeetMatch): Promise<string[]> {
		if (!(meet.flags ?? []).includes('casual')) return [];
		const ids = [...match.team1Ids, ...match.team2Ids];
		if (!ids.length) return [];
		const rows = await this.meetParticipantsRepository.createQueryBuilder('p').where('p.meetId = :meetId', { meetId: meet.id }).andWhere('p.id IN (:...ids)', { ids }).getMany();
		return rows.filter(r => r.userId != null && r.status !== 'confirmed').map(r => r.id);
	}

	/**
	 * SEC-CASUAL-CONSENT-V1 (round-3 review): a casual match's result is frozen once it has COUNTED — it is rated
	 * (a gb_rating_log row for this match id) or it has gone to DUPR (duprStatus queued / submitted). Before that a
	 * correction is an ordinary edit.
	 *   Why not "any other player confirmed": gb_rating_log is append-only per match id and delete / cancel never
	 *   un-rate, so locking at confirmation forced a cancel-and-re-log — which rates the SAME game a second time under
	 *   a new match id and inflates everyone's match count. Keying on rated/sent keeps one game = one rating.
	 *   Consent is unaffected: an unconfirmed player still keeps the game out of rating, stats and DUPR, so an edit
	 *   before rating is an edit of something that has counted for nobody.
	 *   Accepted behaviour: the host CAN release this lock for a not-yet-rated game by declining or removing the
	 *   confirmed player (that un-counts the game by consent), and may then edit. DUPR stays blocked while anyone is
	 *   unconfirmed, and an already-rated or already-sent match cannot be edited at all. Withdrawing the record
	 *   (matches/delete, meets/cancel) stays open — it never fabricates a result.
	 */
	@bindThis
	public async casualLockReason(meet: MiMeet, match: MiMeetMatch): Promise<'rated' | 'dupr' | null> {
		if (!(meet.flags ?? []).includes('casual')) return null;
		if (match.duprStatus === 'submitted' || match.duprStatus === 'queued') return 'dupr';
		// NOT skipped: a "skipped" row means the rating declined to count the game (a guest, a drawn score), so nothing
		// counted and a correction stays an ordinary edit (the sweep will not re-read it either way).
		const rated = await this.db.query('SELECT 1 FROM gb_rating_log WHERE source = $1 AND "matchId" = $2 AND NOT skipped LIMIT 1', ['meet', match.id]) as unknown[];
		return rated.length > 0 ? 'rated' : null;
	}

	@bindThis
	public async assertCasualUnlocked(meet: MiMeet, match: MiMeetMatch): Promise<void> {
		const why = await this.casualLockReason(meet, match);
		if (why === 'rated') throw this.err('invalid_transition', 'This casual game has already counted towards the GripBat rating and can no longer be edited. Delete it if it should not stand.');
		if (why === 'dupr') throw this.err('invalid_transition', 'This casual game has been sent to DUPR and can no longer be edited.');
	}

	@bindThis
	public async submitDeferredCasual(meetId?: string): Promise<number> {
		const rows = await this.db.query(
			`SELECT mm.id, mm."meetId"
			   FROM meet_match mm JOIN meet m ON m.id = mm."meetId"
			  WHERE 'casual' = ANY(m.flags) AND m."submitMatches" = true AND m.status = 'active' AND m."startAt" < now()
			    AND jsonb_array_length(mm.scores) > 0 AND mm."duprStatus" IS NULL
			    ${meetId ? 'AND mm."meetId" = $1' : ''}
			    AND NOT EXISTS (
			          SELECT 1 FROM meet_participant pu
			           WHERE pu."meetId" = mm."meetId"
			             AND (pu.id = ANY(mm."team1Ids") OR pu.id = ANY(mm."team2Ids"))
			             AND pu."userId" IS NOT NULL AND pu.status <> 'confirmed')
			  LIMIT 50`, meetId ? [meetId] : []) as { id: string; meetId: string }[];
		let sent = 0;
		for (const r of rows) {
			const meet = await this.meetsRepository.findOneBy({ id: r.meetId });
			const host = meet ? await this.usersRepository.findOneBy({ id: meet.hostId }) : null;
			if (!meet || !host) continue;
			// claim the row BEFORE the HTTP call so respond(accept) and the sweep cannot both submit it: only the caller
			// whose UPDATE flips NULL → 'queued' goes on (a claimed row without a ref is retried by list(), FAIL-SOFT-V1)
			const claimed = await this.db.query(
				`UPDATE meet_match SET "duprStatus" = 'queued', "duprRef" = NULL, "updatedAt" = now() WHERE id = $1 AND "duprStatus" IS NULL RETURNING id`, [r.id]) as unknown;
			const won = Array.isArray(claimed) && (Array.isArray(claimed[0]) ? claimed[0].length > 0 : claimed.length > 0);
			if (!won) continue;
			const match = await this.meetMatchesRepository.findOneBy({ id: r.id });
			if (!match) continue;
			try {
				await this.submitDupr(meet, match, host);
				sent++;
			} catch {
				// consent changed after the select (e.g. the host declined a player): release the claim, never leave it 'queued'
				await this.db.query(`UPDATE meet_match SET "duprStatus" = NULL, "updatedAt" = now() WHERE id = $1 AND "duprStatus" = 'queued' AND "duprRef" IS NULL`, [r.id]);
			}
		}
		return sent;
	}

	/** Ask hkpl whether a queued match has been drained to DUPR. */
	@bindThis
	public async refreshDupr(match: MiMeetMatch): Promise<MiMeetMatch> {
		if (!HKPL_URL || !HKPL_SECRET) return match;
		const res = await this.httpRequestService.send(`${HKPL_URL}/api/v1/social/dupr/status?match_id=${encodeURIComponent(`boyau:${match.id}`)}`, {
			headers: { 'x-social-secret': HKPL_SECRET },
			timeout: 5_000,
			isLocalAddressAllowed: HKPL_ALLOW_LOCAL,
		}, { throwErrorWhenResponseNotOk: false });
		const json = await res.json().catch(() => ({})) as { ok?: boolean; found?: boolean; status?: string; dupr_match_id?: string | null; last_error?: string | null };
		const patch: Partial<MiMeetMatch> = { updatedAt: new Date() };
		if (res.status === 200 && json.found && json.status === 'DONE') { patch.duprStatus = 'submitted'; patch.duprRef = json.dupr_match_id ?? match.duprRef; patch.duprError = null; }
		else if (res.status === 200 && json.found && json.last_error) patch.duprError = String(json.last_error).slice(0, 512); // still retrying at hkpl
		await this.meetMatchesRepository.update(match.id, patch);
		return await this.meetMatchesRepository.findOneByOrFail({ id: match.id });
	}
}

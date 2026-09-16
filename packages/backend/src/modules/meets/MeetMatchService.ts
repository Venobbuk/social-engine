/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { DI } from '@/di-symbols.js';
import type { MeetMatchesRepository, MeetParticipantsRepository } from '@/models/_.js';
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

/** Reclub DUPRMatchEligibilityErrorCode, verbatim. */
export type DuprEligibilityCode = 'no_account' | 'no_scores' | 'not_connected' | 'not_singles_doubles' | 'uneven_teams';
export type DuprEligibility = { isEligible: boolean; errors: { code: DuprEligibilityCode; affectedParticipantIds: string[] }[] };

// The one hkpl door (SOCIAL-DUPR-V1): POST /api/v1/social/dupr/submit, GET /api/v1/social/dupr/status.
// Both facts come from the environment and FAIL CLOSED: unset → the match is marked failed with a visible reason.
const HKPL_URL = (process.env.ADAPTER_HKPL_URL ?? '').replace(/\/+$/, '');
const HKPL_SECRET = process.env.ADAPTER_HKPL_S2S_SECRET ?? '';
// hkpl-app runs on the same box (host.docker.internal:3939): the SSRF guard must admit that private address.
const HKPL_ALLOW_LOCAL = process.env.ADAPTER_HKPL_ALLOW_LOCAL === '1';

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

		private idService: IdService,
		private httpRequestService: HttpRequestService,
		private meetService: MeetService,
		private meetLevelService: MeetLevelService,
	) {
	}

	private err(id: string, message: string): IdentifiableError {
		return new IdentifiableError(`meet:${id}`, message);
	}

	@bindThis
	public async list(meet: MiMeet): Promise<MiMeetMatch[]> {
		const rows = await this.meetMatchesRepository.find({ where: { meetId: meet.id }, order: { round: 'ASC', courtIndex: 'ASC', id: 'ASC' } });
		// lazily refresh the badge for rows hkpl is still draining (at most once a minute per row)
		for (let i = 0; i < rows.length; i++) {
			const r = rows[i];
			if (r.duprStatus === 'queued' && Date.now() - new Date(r.updatedAt).getTime() > 60_000) rows[i] = await this.refreshDupr(r).catch(() => r);
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

		if (meet.submitMatches && match.scores.length > 0 && data.scores !== undefined) {
			match = await this.submitDupr(meet, match, user);
		}
		return match;
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
			return await mark({ duprStatus: 'failed', duprError: `hkpl unreachable: ${(err as Error).message}`.slice(0, 512) });
		}
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

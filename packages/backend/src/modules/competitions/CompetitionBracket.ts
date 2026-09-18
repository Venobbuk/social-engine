/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import bracketsManager from 'brackets-manager';
import bracketsMemoryDb from 'brackets-memory-db';
import type { Database, Match as BracketMatch, Participant as BracketParticipant, Round as BracketRound, Group as BracketGroup, Stage as BracketStage } from 'brackets-model';

/**
 * TOURNAMENT-V1 — the knockout engine adapter (research_match_generation.md §5: brackets-manager for single / double
 * elimination, BYEs, seeding, consolation final; storage-agnostic). The whole brackets database of one competition is
 * kept as JSON on competition.bracketData: every operation imports it into an in-memory CrudInterface, runs the
 * manager, and exports it back. Participants are registered by NAME = our entry id, so a bracket slot maps to an
 * entry without a second table. Match ids inside the JSON are brackets-manager's (competition_match.bracketId).
 *
 * Both packages are CommonJS; under nodenext ESM they are imported as default (module.exports) and destructured.
 */
const { BracketsManager } = bracketsManager;
const { InMemoryDatabase } = bracketsMemoryDb;

export type BracketDb = Database;
export type BracketType = 'single_elimination' | 'double_elimination';
export interface BracketSlotView { entryId: string | null; bye: boolean; forfeit: boolean; score: number | null; win: boolean }
export interface BracketMatchView {
	bracketId: number; stageId: number; groupNumber: number; groupKind: 'single' | 'third' | 'winner' | 'loser' | 'final';
	roundNumber: number; roundCount: number; number: number; status: number;
	opponent1: BracketSlotView | null; opponent2: BracketSlotView | null;
}

const TOURNAMENT_ID = 1;

async function open(data: BracketDb | null): Promise<InstanceType<typeof BracketsManager>> {
	const storage = new InMemoryDatabase();
	const manager = new BracketsManager(storage);
	if (data) await manager.import(data as Database);
	return manager;
}

export function emptyBracketDb(): BracketDb {
	return { participant: [], stage: [], group: [], round: [], match: [], match_game: [] };
}

/** Next power of two ≥ n (2 minimum). */
export function bracketSize(n: number): number { let s = 2; while (s < n) s *= 2; return s; }

/**
 * Creates a knockout stage seeded with the entry ids in seed order (index 0 = seed 1). The seeding is padded with
 * BYEs to a power of two and balanced (a BYE for the top seeds first). Returns the new database and stage id.
 */
export async function createKnockoutStage(data: BracketDb | null, opts: { name: string; type: BracketType; entryIds: string[]; consolationFinal: boolean }): Promise<{ data: BracketDb; stageId: number }> {
	const manager = await open(data);
	const seeding: (string | null)[] = opts.entryIds.slice();
	const size = bracketSize(seeding.length);
	while (seeding.length < size) seeding.push(null);
	const stage = await manager.create.stage({
		tournamentId: TOURNAMENT_ID,
		name: opts.name,
		type: opts.type,
		seeding,
		settings: { balanceByes: true, consolationFinal: opts.type === 'single_elimination' ? opts.consolationFinal : false, grandFinal: opts.type === 'double_elimination' ? 'simple' : 'none' },
	});
	return { data: await manager.export(), stageId: Number(stage.id) };
}

/** Drops every stage (a reset of the knockout). */
export async function clearStages(data: BracketDb | null): Promise<BracketDb> {
	if (!data) return emptyBracketDb();
	const manager = await open(data);
	for (const s of data.stage) await manager.delete.stage(s.id);
	return await manager.export();
}

export interface ReportInput {
	bracketId: number;
	/** sets won per side (or any two numbers where the greater wins) */
	score1: number; score2: number;
	forfeit1: boolean; forfeit2: boolean;
	winner: 'entry1' | 'entry2' | null;
}

/** Reports a match result to the bracket (advances the winner, drops the loser). Throws the manager's Error when the match is locked. */
export async function reportBracketMatch(data: BracketDb, r: ReportInput): Promise<BracketDb> {
	const manager = await open(data);
	const opponent1: Record<string, unknown> = { score: r.score1 };
	const opponent2: Record<string, unknown> = { score: r.score2 };
	if (r.forfeit1) opponent1.forfeit = true;
	if (r.forfeit2) opponent2.forfeit = true;
	if (!r.forfeit1 && !r.forfeit2) {
		if (r.winner === 'entry1') { opponent1.result = 'win'; opponent2.result = 'loss'; }
		else if (r.winner === 'entry2') { opponent2.result = 'win'; opponent1.result = 'loss'; }
	}
	await manager.update.match({ id: r.bracketId, opponent1, opponent2 } as never);
	return await manager.export();
}

/** Undoes a reported result (the match and everything after it goes back to pending). */
export async function resetBracketMatch(data: BracketDb, bracketId: number): Promise<BracketDb> {
	const manager = await open(data);
	await manager.reset.matchResults(bracketId);
	return await manager.export();
}

function groupKind(stage: BracketStage, groups: BracketGroup[], g: BracketGroup): BracketMatchView['groupKind'] {
	const idx = groups.filter((x) => x.stage_id === stage.id).sort((a, b) => a.number - b.number).findIndex((x) => x.id === g.id);
	if (stage.type === 'single_elimination') return idx === 0 ? 'single' : 'third';
	return idx === 0 ? 'winner' : idx === 1 ? 'loser' : 'final';
}

/** A flat, entry-keyed view of every match of a stage. */
export function viewStage(data: BracketDb, stageId: number): BracketMatchView[] {
	const stage = data.stage.find((s) => Number(s.id) === stageId);
	if (!stage) return [];
	const byId = new Map<string, BracketParticipant>(data.participant.map((p) => [String(p.id), p]));
	const rounds = data.round.filter((r) => r.stage_id === stage.id);
	const groups = data.group.filter((g) => g.stage_id === stage.id);
	const roundCountByGroup = new Map<string, number>();
	for (const r of rounds) roundCountByGroup.set(String(r.group_id), Math.max(roundCountByGroup.get(String(r.group_id)) ?? 0, r.number));
	const slot = (o: BracketMatch['opponent1']): BracketSlotView | null => {
		if (o === null) return null;
		const p = o.id != null ? byId.get(String(o.id)) : null;
		return { entryId: p ? p.name : null, bye: false, forfeit: !!o.forfeit, score: o.score ?? null, win: o.result === 'win' };
	};
	return data.match.filter((m) => m.stage_id === stage.id).map((m) => {
		const round = rounds.find((r) => r.id === m.round_id) as BracketRound;
		const group = groups.find((g) => g.id === m.group_id) as BracketGroup;
		return {
			bracketId: Number(m.id), stageId, groupNumber: group.number, groupKind: groupKind(stage, groups, group),
			roundNumber: round.number, roundCount: roundCountByGroup.get(String(group.id)) ?? 1, number: m.number, status: m.status,
			opponent1: slot(m.opponent1), opponent2: slot(m.opponent2),
		};
	});
}

/** Final placements of a completed knockout stage (rank → entry ids); null while the final is undecided. */
export async function bracketFinalStandings(data: BracketDb, stageId: number): Promise<{ entryId: string; rank: number }[] | null> {
	try {
		const manager = await open(data);
		const items = await manager.get.finalStandings(stageId);
		return items.map((it) => ({ entryId: it.name, rank: it.rank }));
	} catch {
		return null;
	}
}

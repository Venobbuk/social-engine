/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * HOST-TOOLS-V1 — Reclub's "Generate teams" (spec_meets.md §4.8, module 6940: generateBlankTeams, getMajorGender,
 * prepPlayers, generate, SKILL_VALUE_MAP). Reclub runs it on the phone; here it is a pure function the endpoint
 * calls with persist=false (preview) or persist=true (write teamKey per participant), same seed both times so the
 * host confirms exactly what was shown.
 *
 *   forced      players carrying a "Force team" go in first and never move
 *   balanceSkill  the rest are dealt by skill, high to low, in a snake (1..N, N..1) — the classic even split;
 *                 an unrated player counts as the group's median so they neither sink nor lift a team
 *   balanceGender the deal runs per gender bucket (majority gender first) so each team gets the same mix
 *   neither     a seeded shuffle, dealt round-robin
 */

export const TEAM_KEYS = ['red', 'blue', 'yellow', 'grey', 'white', 'black', 'cyan', 'green', 'orange', 'purple', 'pink', 'brown', 'navy', 'teal', 'lime', 'magenta', 'gold', 'silver', 'maroon', 'olive', 'coral', 'indigo', 'violet', 'tan', 'celtic', 'crimson'] as const;
export type TeamKey = typeof TEAM_KEYS[number];

export type TeamPlayer = { id: string; skill: number | null; gender: string | null; forceTeam: string | null; position?: string | null };
export type GeneratedTeam = { teamKey: string; participantIds: string[]; avgSkill: number | null };

function rng(seed: number): () => number {
	let s = (seed >>> 0) || 1;
	return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
function shuffle<T>(arr: T[], r: () => number): T[] {
	const a = arr.slice();
	for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
	return a;
}
function median(xs: number[]): number | null {
	if (!xs.length) return null;
	const s = xs.slice().sort((a, b) => a - b);
	const m = Math.floor(s.length / 2);
	return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function generateTeams(input: { players: TeamPlayer[]; numTeams: number; balanceSkill: boolean; balanceGender: boolean; balancePositions?: boolean; seed: number; teamKeys?: string[] }): GeneratedTeam[] {
	const n = Math.max(2, Math.min(TEAM_KEYS.length, Math.floor(input.numTeams)));
	const keys = (input.teamKeys && input.teamKeys.length >= n ? input.teamKeys : TEAM_KEYS).slice(0, n);
	const r = rng(input.seed);
	const teams: Record<string, string[]> = {};
	const sum: Record<string, number> = {};
	for (const k of keys) { teams[k] = []; sum[k] = 0; }
	const rated = input.players.map(p => p.skill).filter((x): x is number => x != null && !Number.isNaN(x));
	const fill = median(rated) ?? 0;
	const skillOf = (p: TeamPlayer) => (p.skill != null && !Number.isNaN(p.skill)) ? p.skill : fill;

	// 1. forced players
	const free: TeamPlayer[] = [];
	for (const p of input.players) {
		if (p.forceTeam && teams[p.forceTeam]) { teams[p.forceTeam].push(p.id); sum[p.forceTeam] += skillOf(p); }
		else free.push(p);
	}

	// the team that should take the next player: fewest members first, then (balanceSkill) the lowest total skill
	const next = (): string => keys.slice().sort((a, b) => teams[a].length - teams[b].length || (input.balanceSkill ? sum[a] - sum[b] : 0) || (r() < 0.5 ? -1 : 1))[0];
	const deal = (bucket: TeamPlayer[]) => {
		const order = input.balanceSkill ? shuffle(bucket, r).sort((a, b) => skillOf(b) - skillOf(a)) : shuffle(bucket, r);
		for (const p of order) { const k = next(); teams[k].push(p.id); sum[k] += skillOf(p); }
	};

	// 2. the rest, per gender bucket when balancing genders (majority gender first, as Reclub's getMajorGender)
	// FIX-S5 BALANCE-POSITIONS-V1 (Reclub meets:balance_positions, onToggleBalancePositions): the deal also runs per position
	// (the host's Force position, else the assigned one), so each team gets the same spread of Left / Right side players;
	// with both switches on, the bucket is gender x position. Players with no position form their own bucket.
	if (input.balanceGender || input.balancePositions) {
		const buckets = new Map<string, TeamPlayer[]>();
		for (const p of free) { const g = (input.balanceGender ? (p.gender || 'unknown') : '') + '|' + (input.balancePositions ? (p.position || 'none') : ''); buckets.set(g, [...(buckets.get(g) ?? []), p]); }
		for (const b of [...buckets.values()].sort((a, b) => b.length - a.length)) deal(b);
	} else {
		deal(free);
	}

	return keys.map(k => {
		const ids = teams[k];
		const skills = ids.map(id => input.players.find(p => p.id === id)).filter((p): p is TeamPlayer => !!p && p.skill != null).map(p => p.skill as number);
		return { teamKey: k, participantIds: ids, avgSkill: skills.length ? Math.round((skills.reduce((a, b) => a + b, 0) / skills.length) * 100) / 100 : null };
	});
}

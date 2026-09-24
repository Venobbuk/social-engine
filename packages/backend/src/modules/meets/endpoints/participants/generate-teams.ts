/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { In } from 'typeorm';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { MeetsRepository, MeetParticipantsRepository } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import { MeetService } from '@/modules/meets/MeetService.js';
import { MeetEntityService } from '@/modules/meets/MeetEntityService.js';
import { MeetLevelService } from '@/modules/meets/MeetLevelService.js';
import { generateTeams, TEAM_KEYS } from '@/modules/meets/MeetTeamGenerator.js';
import { ApiError } from '@/server/api/error.js';
import { meetErrors, toApiError } from '../_shared.js';

// HOST-TOOLS-V1 — Reclub "Generate teams" sheet (spec_meets.md §4.8): number of teams (min 2), Balance skill levels,
// Balance genders, Blind teams (reveal N minutes before start), Force team per player; Generate → preview → Confirm.
// persist=false previews; persist=true writes teamKey per participant (and blindTeamsMinutes on the meet).
// reset=true clears every team ("Reset teams"). The Matches pane's PRESET_TEAMS scheme reads the same teamKey.
export const meta = {
	tags: ['meets'],
	requireCredential: true,
	prohibitMoved: true,
	kind: 'write:meets',
	res: {
		type: 'object', optional: false, nullable: false,
		properties: {
			teams: { type: 'array', optional: false, nullable: false, items: { type: 'object', optional: false, nullable: false, properties: {
				teamKey: { type: 'string', optional: false, nullable: false },
				participantIds: { type: 'array', optional: false, nullable: false, items: { type: 'string', optional: false, nullable: false } },
				avgSkill: { type: 'number', optional: false, nullable: true },
			} } },
			persisted: { type: 'boolean', optional: false, nullable: false },
			meet: { type: 'object', optional: true, nullable: false, ref: 'Meet' },
		},
	},
	errors: { ...meetErrors },
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		meetId: { type: 'string', format: 'misskey:id' },
		numTeams: { type: 'integer', minimum: 2, maximum: 26, default: 2 },
		balanceSkill: { type: 'boolean', default: false },
		balanceGender: { type: 'boolean', default: false },
		blindTeamsMinutes: { type: 'integer', nullable: true, minimum: 0, maximum: 10080 },
		force: { type: 'array', items: { type: 'object', properties: { participantId: { type: 'string', format: 'misskey:id' }, teamKey: { type: 'string', maxLength: 32 } }, required: ['participantId', 'teamKey'] }, maxItems: 200 },
		participantIds: { type: 'array', items: { type: 'string', format: 'misskey:id' }, maxItems: 200, uniqueItems: true },
		seed: { type: 'integer', minimum: 0, maximum: 2147483647 },
		persist: { type: 'boolean', default: false },
		reset: { type: 'boolean', default: false },
		// FIX-S5 (A-generate-teams.04): Reclub "Balance positions" and "Reset positions" (onResetForcePositions)
		balancePositions: { type: 'boolean', default: false },
		resetPositions: { type: 'boolean', default: false },
	},
	required: ['meetId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.meetsRepository)
		private meetsRepository: MeetsRepository,
		@Inject(DI.meetParticipantsRepository)
		private meetParticipantsRepository: MeetParticipantsRepository,
		private meetService: MeetService,
		private meetEntityService: MeetEntityService,
		private meetLevelService: MeetLevelService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const meet = await this.meetsRepository.findOneBy({ id: ps.meetId });
			if (meet == null) throw new ApiError(meta.errors.noSuchMeet);
			try {
				await this.meetService.assertHost(meet, me);
				if (ps.reset) {
					await this.meetParticipantsRepository.update({ meetId: meet.id }, { teamKey: null });
					return { teams: [], persisted: true, meet: await this.meetEntityService.pack(meet.id, me, { detailed: true }) };
				}
				if (ps.resetPositions) {
					await this.meetParticipantsRepository.update({ meetId: meet.id }, { forcePosition: null });
					return { teams: [], persisted: true, meet: await this.meetEntityService.pack(meet.id, me, { detailed: true }) };
				}
				const rows = ps.participantIds && ps.participantIds.length
					? await this.meetParticipantsRepository.find({ where: { meetId: meet.id, id: In(ps.participantIds) } })
					: await this.meetParticipantsRepository.find({ where: { meetId: meet.id, status: 'confirmed' } });
				const userIds = rows.map(r => r.userId).filter((x): x is string => !!x);
				const levels = new Map((await this.meetLevelService.getLevels(userIds, meet.sport)).map(l => [l.userId, l]));
				const forced = new Map((ps.force ?? []).map(f => [f.participantId, f.teamKey]));
				const players = rows.map(p => {
					const l = p.userId ? levels.get(p.userId) ?? null : null;
					const skill = p.forceSkill ?? p.declaredLevel ?? this.meetLevelService.levelValue(l, meet.levelBasis) ?? l?.duprDoubles ?? l?.selfLevel ?? null;
					return { id: p.id, skill, gender: p.extGender ?? l?.gender ?? null, forceTeam: forced.get(p.id) ?? null, position: p.forcePosition ?? p.positionId ?? null };
				});
				const teams = generateTeams({ players, numTeams: ps.numTeams, balanceSkill: ps.balanceSkill, balanceGender: ps.balanceGender, balancePositions: ps.balancePositions, seed: ps.seed ?? Math.floor(Math.random() * 2147483647), teamKeys: [...TEAM_KEYS] });
				if (!ps.persist) return { teams, persisted: false };
				for (const t of teams) if (t.participantIds.length) await this.meetParticipantsRepository.update({ id: In(t.participantIds) }, { teamKey: t.teamKey });
				if (ps.blindTeamsMinutes !== undefined && ps.blindTeamsMinutes !== meet.blindTeamsMinutes) await this.meetsRepository.update(meet.id, { blindTeamsMinutes: ps.blindTeamsMinutes });
				return { teams, persisted: true, meet: await this.meetEntityService.pack(meet.id, me, { detailed: true }) };
			} catch (e) {
				return toApiError(e);
			}
		});
	}
}

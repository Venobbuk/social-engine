/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { DI } from '@/di-symbols.js';
import type { MeetPlayerLevelsRepository } from '@/models/_.js';
import type { MiMeet } from '@/modules/meets/models/Meet.js';
import type { MiMeetPlayerLevel } from '@/modules/meets/models/MeetPlayerLevel.js';
import type { MiUser } from '@/models/User.js';
import { IdService } from '@/core/IdService.js';
import { bindThis } from '@/decorators.js';

export type GateVerdict = 'approved' | 'requestOnly' | 'denied';

/**
 * MEET-V4 (dry-run S8): the player-level store and the level/DUPR gates, in their OWN service.
 * adapter/sso.ts imports this — not MeetService — so sign-in never depends on the roster module and the
 * roster module can be rewritten or removed without touching login. Behaviour of the level store is
 * unchanged from v1; the gate maps Reclub's getParticipantLevelRequirementStatus:
 *   Guidance     → informational, everyone may request           (Approved if inside the band, else RequestOnly)
 *   AutoApprove  → inside the band skips approval                  (Approved / RequestOnly)
 *   Strict       → outside the band is refused                     (Approved / Denied)
 */
@Injectable()
export class MeetLevelService {
	constructor(
		@Inject(DI.meetPlayerLevelsRepository)
		private meetPlayerLevelsRepository: MeetPlayerLevelsRepository,

		private idService: IdService,
	) {
	}

	@bindThis
	public async getLevel(userId: MiUser['id'], sport: string): Promise<MiMeetPlayerLevel | null> {
		return await this.meetPlayerLevelsRepository.findOneBy({ userId, sport });
	}

	@bindThis
	public levelValue(level: MiMeetPlayerLevel | null, basis: MiMeet['levelBasis']): number | null {
		if (level == null) return null;
		switch (basis) {
			case 'duprSingles': return level.duprSingles;
			case 'duprDoubles': return level.duprDoubles;
			default: return level.selfLevel;
		}
	}

	/** Reclub MeetParticipantRequirementStatus: Approved(0) / RequestOnly(1) / Denied(2). */
	@bindThis
	public gateVerdict(meet: MiMeet, level: MiMeetPlayerLevel | null): GateVerdict {
		const v = this.levelValue(level, meet.levelBasis);
		const noBand = meet.minLevel == null && meet.maxLevel == null;
		const inBand = v != null && (meet.minLevel == null || v >= meet.minLevel) && (meet.maxLevel == null || v <= meet.maxLevel);
		const levelOk = noBand || inBand;
		// DUPR account gate: an account is "linked" when a duprId is on file for the sport
		const duprLinked = level?.duprId != null;
		const duprOk = meet.duprAccountGate === 'strict' ? duprLinked : true;
		// gender / age-group restrictions are hard gates (Reclub: "This meet has {{inf}} restrictions")
		if (meet.gender !== 'any' && meet.gender !== 'coed' && (level?.gender == null || level.gender !== meet.gender)) return 'denied';
		if (meet.ageGroup !== 'any' && (level?.ageGroup == null || level.ageGroup !== meet.ageGroup)) return 'denied';
		if (meet.gateType === 'strict' && !levelOk) return 'denied';
		if (!duprOk) return 'denied';
		if (!levelOk) return 'requestOnly';
		if (meet.duprAccountGate === 'autoApprove' && !duprLinked) return 'requestOnly';
		return 'approved';
	}

	@bindThis
	public async upsertLevel(userId: MiUser['id'], sport: string, patch: Partial<Pick<MiMeetPlayerLevel, 'selfLevel' | 'duprSingles' | 'duprDoubles' | 'duprId' | 'gender' | 'ageGroup' | 'source' | 'onboardedAt'>>): Promise<MiMeetPlayerLevel> {
		const existing = await this.meetPlayerLevelsRepository.findOneBy({ userId, sport });
		if (existing) {
			await this.meetPlayerLevelsRepository.update(existing.id, { ...patch, updatedAt: new Date() });
			return await this.meetPlayerLevelsRepository.findOneByOrFail({ id: existing.id });
		}
		return await this.meetPlayerLevelsRepository.insertOne({
			id: this.idService.gen(),
			userId,
			sport,
			selfLevel: patch.selfLevel ?? null,
			duprSingles: patch.duprSingles ?? null,
			duprDoubles: patch.duprDoubles ?? null,
			duprId: patch.duprId ?? null,
			gender: patch.gender ?? null,
			ageGroup: patch.ageGroup ?? null,
			source: patch.source ?? null,
			onboardedAt: patch.onboardedAt ?? null,
			updatedAt: new Date(),
		});
	}
}

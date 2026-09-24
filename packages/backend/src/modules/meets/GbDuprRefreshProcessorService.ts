/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type Logger from '@/logger.js';
import { DI } from '@/di-symbols.js';
import { bindThis } from '@/decorators.js';
import { QueueLoggerService } from '@/queue/QueueLoggerService.js';
import { DuprSubmitService } from '@/core/DuprSubmitService.js';

/*
 * GB-DUPR-REFRESH-V1 (2026-09-24, orchestrator decision under G15.15) — GripBat's DUPR Rankings read the ENGINE: the
 * members who linked DUPR (meet_player_level.duprId), ranked by the rating stored beside it. This job keeps that rating
 * fresh: every 6 hours it asks hkpl — server-to-server, PARTNER API ONLY (routes/social-dupr-connect.js /ratings-batch →
 * lib/dupr/hybrid.ratingsViaApi, G15.1: never the reader / scrape) — for the current doubles / singles of every linked
 * DUPR id, 100 at a time, and writes them back. NEW (searched: meetSweep / clubScheduleSweep / coachScheduleSweep and
 * MeetLevelService have no rating refresh; the SSO seam refreshed ratings only at sign-in, and that seam is retired).
 *
 * Which links: source 'dupr-partner' (verified through gb/dupr/connect) and 'hkpl' (linked on hkpl before G15.15 — hkpl
 * verified those). A seeded or self-declared rating without a verified link is never sent to DUPR.
 * UAT cage: a caged engine (DuprSubmitService.cageMode() !== 'live') never calls it — UAT's ratings are seeded
 * (/root/uat-dupr-seed.sql) and its ids are not real DUPR players.
 * Fails soft: hkpl down or the door not yet live → one log line, nothing changed, the next run tries again.
 */
@Injectable()
export class GbDuprRefreshProcessorService {
	private logger: Logger;

	constructor(
		@Inject(DI.db)
		private db: DataSource,

		private duprSubmitService: DuprSubmitService,
		private queueLoggerService: QueueLoggerService,
	) {
		this.logger = this.queueLoggerService.logger.createSubLogger('gb-dupr-refresh');
	}

	@bindThis
	public async process(): Promise<void> {
		if (this.duprSubmitService.cageMode() !== 'live') return;
		if (!this.duprSubmitService.isConfigured()) return;
		const rows = await this.db.query(`SELECT DISTINCT UPPER("duprId") AS id FROM "meet_player_level" WHERE "sport" = 'pickleball' AND "duprId" IS NOT NULL AND "source" IN ('dupr-partner', 'hkpl')`) as { id: string }[];
		const ids = rows.map(r => r.id).filter(id => /^[A-Z0-9]{4,7}$/.test(id) && !/^\d{8,}$/.test(id));
		let updated = 0;
		for (let i = 0; i < ids.length; i += 100) {
			const batch = ids.slice(i, i + 100);
			const r = await this.duprSubmitService.connectDoor('ratings-batch', { duprIds: batch });
			if (r.status !== 200 || r.json.ok !== true) {
				this.logger.warn(`DUPR rating refresh stopped: hkpl ${r.status} ${String(r.json.reason ?? r.json.error ?? '')}`);
				return;
			}
			const ratings = (r.json.ratings ?? {}) as Record<string, { doubles?: unknown; singles?: unknown }>;
			for (const [id, v] of Object.entries(ratings)) {
				const num = (x: unknown) => { const n = Number(x); return x != null && Number.isFinite(n) && n > 0 && n < 9 ? n : null; };
				const d = num(v.doubles); const s = num(v.singles);
				if (d == null && s == null) continue;
				const res = await this.db.query(`UPDATE "meet_player_level" SET "duprDoubles" = COALESCE($2, "duprDoubles"), "duprSingles" = COALESCE($3, "duprSingles"), "updatedAt" = now() WHERE "sport" = 'pickleball' AND UPPER("duprId") = $1 AND "source" IN ('dupr-partner', 'hkpl')`, [id, d, s]) as unknown[];
				updated += Array.isArray(res) && typeof res[1] === 'number' ? res[1] : 1;
			}
		}
		if (ids.length) this.logger.info(`DUPR rating refresh: ${ids.length} linked ids asked, ${updated} rows updated`);
	}
}

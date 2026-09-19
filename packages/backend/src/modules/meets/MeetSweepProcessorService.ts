/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import type Logger from '@/logger.js';
import { MeetService } from '@/modules/meets/MeetService.js';
import { bindThis } from '@/decorators.js';
import { QueueLoggerService } from '@/queue/QueueLoggerService.js';
import { Inject } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { DI } from '@/di-symbols.js';
import { NotificationService } from '@/core/NotificationService.js';
import { remindUpcoming } from '@/modules/meets/MeetExtras.js'; // MEET-EXTRAS-V1
import { processRatings, importOpenPlay } from '@/modules/stats/GbRating.js'; // GB-RATING-V1
import type { Config } from '@/config.js';

// Runs every minute from the system queue: purges maybes 2 h before start, auto-confirms 3-day-old invitations (MEET-V4: no holds to expire — Reclub has no hold timer).
@Injectable()
export class MeetSweepProcessorService {
	private logger: Logger;

	constructor(
		private meetService: MeetService,
		private queueLoggerService: QueueLoggerService,
		@Inject(DI.db)
		private db: DataSource,
		private notificationService: NotificationService,
		@Inject(DI.config)
		private config: Config,
	) {
		this.logger = this.queueLoggerService.logger.createSubLogger('meet-sweep');
	}

	@bindThis
	public async process(): Promise<void> {
		const r = await this.meetService.sweep();
		// MEET-EXTRAS-V1: reminders 24 h / 2 h before start, to confirmed players (receipts on meet.reminded24At / reminded2At)
		// GB-RATING-V1: rate newly scored GripBat matches (meets, casual, competitions) — idempotent, 200 a minute
		await importOpenPlay(this.db, new URL(this.config.url).host).then((n) => { if (n) this.logger.info('open play imported: ' + n); }).catch((e) => this.logger.warn('open play import: ' + (e as Error).message));   // GB-OPENPLAY-V1
		await processRatings(this.db, 200).then((r) => { if (r.rated || r.skipped) this.logger.info('gb ratings: ' + r.rated + ' rated, ' + r.skipped + ' skipped'); }).catch((e) => this.logger.warn('gb ratings: ' + (e as Error).message));
		const rem = await remindUpcoming(this.db, (userId, header, body, link) => this.notificationService.createNotification(userId, 'app', { customHeader: header, customBody: body, customIcon: null, appAccessTokenId: null, customLink: link }), new Date()).catch((e) => { this.logger.warn('meet reminders: ' + (e as Error).message); return null; });
		if (rem && rem.sent) this.logger.info(`meet reminders: ${rem.meets24} meets at 24 h, ${rem.meets2} at 2 h, ${rem.sent} notifications`);
		if (r.purgedMaybes || r.autoConfirmedInvites || r.waitlistedInvites) {
			this.logger.info(`meet sweep: maybes purged ${r.purgedMaybes}, invites auto-confirmed ${r.autoConfirmedInvites}, invites waitlisted (meet full) ${r.waitlistedInvites}`);
		}
	}
}

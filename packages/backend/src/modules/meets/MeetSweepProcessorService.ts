/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import type Logger from '@/logger.js';
import { MeetService } from '@/modules/meets/MeetService.js';
import { MeetMatchService } from '@/modules/meets/MeetMatchService.js';
import { bindThis } from '@/decorators.js';
import { QueueLoggerService } from '@/queue/QueueLoggerService.js';
import { Inject } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { DI } from '@/di-symbols.js';
import { NotificationService } from '@/core/NotificationService.js';
import { remindUpcoming } from '@/modules/meets/MeetExtras.js'; // MEET-EXTRAS-V1
import { meetUpdatesMuted } from '@/modules/meets/meet-updates-mute.js';   // ACCOUNT-BUGS-V1
import { processRatings, importOpenPlay, rebuildRatingsIfStale } from '@/modules/stats/GbRating.js'; // GB-RATING-V1 · RATING-REBUILD-V1
import type { Config } from '@/config.js';
import { DeleteAccountService } from '@/core/DeleteAccountService.js';   // ACCOUNT-GRACE-V1
import { purgeDue } from '@/modules/account/deletion.js';   // ACCOUNT-GRACE-V1

// Runs every minute from the system queue: purges maybes 2 h before start, auto-confirms 3-day-old invitations (MEET-V4: no holds to expire — Reclub has no hold timer).
@Injectable()
export class MeetSweepProcessorService {
	private logger: Logger;

	constructor(
		private meetService: MeetService,
		private meetMatchService: MeetMatchService,
		private queueLoggerService: QueueLoggerService,
		@Inject(DI.db)
		private db: DataSource,
		private notificationService: NotificationService,
		@Inject(DI.config)
		private config: Config,
		private deleteAccountService: DeleteAccountService,   // ACCOUNT-GRACE-V1
	) {
		this.logger = this.queueLoggerService.logger.createSubLogger('meet-sweep');
	}

	@bindThis
	public async process(): Promise<void> {
		const r = await this.meetService.sweep();
		// MEET-EXTRAS-V1: reminders 24 h / 2 h before start, to confirmed players (receipts on meet.reminded24At / reminded2At)
		// GB-RATING-V1: rate newly scored GripBat matches (meets, casual, competitions) — idempotent, 200 a minute
		await importOpenPlay(this.db, new URL(this.config.url).host).then((n) => { if (n) this.logger.info('open play imported: ' + n); }).catch((e) => this.logger.warn('open play import: ' + (e as Error).message));   // GB-OPENPLAY-V1
		await rebuildRatingsIfStale(this.db).then((b) => { if (b.rebuilt) this.logger.info('gb ratings REBUILT from live matches: ' + b.rated + ' rated'); }).catch((e) => this.logger.warn('gb ratings rebuild: ' + (e as Error).message));   // RATING-REBUILD-V1
		await processRatings(this.db, 200).then((r) => { if (r.rated || r.skipped) this.logger.info('gb ratings: ' + r.rated + ' rated, ' + r.skipped + ' skipped'); }).catch((e) => this.logger.warn('gb ratings: ' + (e as Error).message));
		// SEC-CASUAL-CONSENT-V1: send the deferred DUPR submissions of casual games that are now fully confirmed (safety
		// net; meets/respond submits at the moment of the last confirmation). Idempotent — only unsent matches are touched.
		await this.meetMatchService.submitDeferredCasual().then((n) => { if (n) this.logger.info('casual dupr submitted after consent: ' + n); }).catch((e) => this.logger.warn('casual deferred dupr: ' + (e as Error).message));
		const rem = await remindUpcoming(this.db, (userId, header, body, link) => { void meetUpdatesMuted(this.db, userId).then((muted) => { if (!muted) this.notificationService.createNotification(userId, 'app', { customHeader: header, customBody: body, customIcon: null, appAccessTokenId: null, customLink: link }); }); }, new Date()).catch((e) => { this.logger.warn('meet reminders: ' + (e as Error).message); return null; });
		// ACCOUNT-GRACE-V1: accounts whose 7-day deletion grace has run out are purged with Misskey's DeleteAccountService
		await purgeDue(this.db, (u) => this.deleteAccountService.deleteAccount(u)).then((n) => { if (n) this.logger.info('accounts purged after the deletion grace: ' + n); }).catch((e) => this.logger.warn('account purge: ' + (e as Error).message));
		if (rem && rem.sent) this.logger.info(`meet reminders: ${rem.meets24} meets at 24 h, ${rem.meets2} at 2 h, ${rem.sent} notifications`);
		if (r.purgedMaybes || r.autoConfirmedInvites || r.waitlistedInvites) {
			this.logger.info(`meet sweep: maybes purged ${r.purgedMaybes}, invites auto-confirmed ${r.autoConfirmedInvites}, invites waitlisted (meet full) ${r.waitlistedInvites}`);
		}
	}
}

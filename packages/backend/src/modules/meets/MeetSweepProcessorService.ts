/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import type Logger from '@/logger.js';
import { MeetService } from '@/modules/meets/MeetService.js';
import { bindThis } from '@/decorators.js';
import { QueueLoggerService } from '@/queue/QueueLoggerService.js';

// Runs every minute from the system queue: purges maybes 2 h before start, auto-confirms 3-day-old invitations (MEET-V4: no holds to expire — Reclub has no hold timer).
@Injectable()
export class MeetSweepProcessorService {
	private logger: Logger;

	constructor(
		private meetService: MeetService,
		private queueLoggerService: QueueLoggerService,
	) {
		this.logger = this.queueLoggerService.logger.createSubLogger('meet-sweep');
	}

	@bindThis
	public async process(): Promise<void> {
		const r = await this.meetService.sweep();
		if (r.purgedMaybes || r.autoConfirmedInvites || r.waitlistedInvites) {
			this.logger.info(`meet sweep: maybes purged ${r.purgedMaybes}, invites auto-confirmed ${r.autoConfirmedInvites}, invites waitlisted (meet full) ${r.waitlistedInvites}`);
		}
	}
}

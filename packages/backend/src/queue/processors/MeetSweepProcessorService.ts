/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import type Logger from '@/logger.js';
import { MeetService } from '@/core/MeetService.js';
import { bindThis } from '@/decorators.js';
import { QueueLoggerService } from '../QueueLoggerService.js';

// Runs every minute from the system queue: expires holds, purges maybes, auto-confirms stale invitations.
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
		if (r.expiredHolds || r.purgedMaybes || r.autoConfirmedInvites) {
			this.logger.info(`meet sweep: holds expired ${r.expiredHolds}, maybes purged ${r.purgedMaybes}, invites auto-confirmed ${r.autoConfirmedInvites}`);
		}
	}
}

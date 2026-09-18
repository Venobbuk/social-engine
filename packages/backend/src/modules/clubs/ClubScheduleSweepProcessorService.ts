/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import type Logger from '@/logger.js';
import { ClubScheduleService } from '@/modules/clubs/ClubScheduleService.js';
import { bindThis } from '@/decorators.js';
import { QueueLoggerService } from '@/queue/QueueLoggerService.js';

// CLUB-V3: runs every 5 minutes from the system queue (clubScheduleSweep): every active club schedule whose next
// occurrence is inside its publish lead window gets its meet created and the members invited.
@Injectable()
export class ClubScheduleSweepProcessorService {
	private logger: Logger;

	constructor(
		private clubScheduleService: ClubScheduleService,
		private queueLoggerService: QueueLoggerService,
	) {
		this.logger = this.queueLoggerService.logger.createSubLogger('club-schedule-sweep');
	}

	@bindThis
	public async process(): Promise<void> {
		const r = await this.clubScheduleService.sweep();
		if (r.created) this.logger.info(`club schedule sweep: ${r.schedules} active schedules, ${r.created} meets created`);
	}
}

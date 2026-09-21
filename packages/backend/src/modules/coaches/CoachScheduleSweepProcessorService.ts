/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import type Logger from '@/logger.js';
import { CoachScheduleService } from '@/modules/coaches/CoachScheduleService.js';
import { bindThis } from '@/decorators.js';
import { QueueLoggerService } from '@/queue/QueueLoggerService.js';

// COACHING-V1: runs every 5 minutes (coachScheduleSweep). Every active coach schedule whose next occurrence is
// inside its publish lead window gets its lesson created and its active enrollees booked. Mirrors clubScheduleSweep.
@Injectable()
export class CoachScheduleSweepProcessorService {
	private logger: Logger;

	constructor(
		private coachScheduleService: CoachScheduleService,
		private queueLoggerService: QueueLoggerService,
	) {
		this.logger = this.queueLoggerService.logger.createSubLogger('coach-schedule-sweep');
	}

	@bindThis
	public async process(): Promise<void> {
		const r = await this.coachScheduleService.sweep();
		if (r.created) this.logger.info(`coach schedule sweep: ${r.schedules} active schedules, ${r.created} lessons created`);
	}
}

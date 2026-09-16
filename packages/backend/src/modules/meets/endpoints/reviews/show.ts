/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { MeetService } from '@/modules/meets/MeetService.js';
import { UserEntityService } from '@/core/entities/UserEntityService.js';

// SAFETY-V1: what the viewer may see about a person — public endorsements (kudos), their own private feedback,
// warnings only when public (≥5 distinct authors) or their own, plus the 30-day no-show count. Reclub's
// view-player-review + street-cred data in one read. Anonymous viewers get the public part.
export const meta = {
	tags: ['meets'],
	requireCredential: false,
	res: { type: 'object', optional: false, nullable: false, ref: 'PlayerReviews' },
} as const;

export const paramDef = {
	type: 'object',
	properties: { userId: { type: 'string', format: 'misskey:id' } },
	required: ['userId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private meetService: MeetService, private userEntityService: UserEntityService) {
		super(meta, paramDef, async (ps, me) => {
			return await this.meetService.packReviews(ps.userId, me ? me.id : null, this.userEntityService);
		});
	}
}

/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import ms from 'ms';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { ChannelsRepository } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import { ApiError } from '@/server/api/error.js';
import { CompetitionService } from '@/modules/competitions/CompetitionService.js';
import { CompetitionEntityService } from '@/modules/competitions/CompetitionEntityService.js';
import type { MiCompetition } from '@/modules/competitions/models/Competition.js';
import { competitionErrors, competitionParamProps, pickCompetitionFields, toApiError, anyObject } from './_shared.js';

// TOURNAMENT-V1: Reclub POST /competitions — the create-competition wizard's save (status draft; publish opens it).
export const meta = {
	tags: ['competitions'],
	requireCredential: true,
	prohibitMoved: true,
	kind: 'write:meets',
	limit: { duration: ms('1hour'), max: 30 },
	// COMP-FIXES-A (Reclub canCreateCompetition / meets:competition_create_restricted): the native role-policy gate, as
	// channels/create has canCreateChannel. Default true (anyone creates); a moderator restricts an account with a role.
	requiredRolePolicy: 'canCreateCompetition',
	res: anyObject,
	errors: { noSuchChannel: { message: 'No such channel.', code: 'NO_SUCH_CHANNEL', id: '7c0a0000-0000-4000-8000-000000000020' }, ...competitionErrors },
} as const;

export const paramDef = {
	type: 'object',
	properties: { ...competitionParamProps, publish: { type: 'boolean' } },
	required: ['name', 'startAt', 'format', 'participantType', 'maxEntries'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.channelsRepository)
		private channelsRepository: ChannelsRepository,
		private competitionService: CompetitionService,
		private competitionEntityService: CompetitionEntityService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const { fields, badDate } = pickCompetitionFields(ps as Record<string, unknown>);
			if (badDate || !(fields.startAt instanceof Date)) throw new ApiError(meta.errors.invalidDate);
			if (ps.channelId && !(await this.channelsRepository.existsBy({ id: ps.channelId }))) throw new ApiError(meta.errors.noSuchChannel);
			try {
				let c = await this.competitionService.create(me, { ...(fields as Partial<MiCompetition>), name: ps.name, startAt: fields.startAt });
				if (ps.publish) c = await this.competitionService.setStatus(c, me, 'publish');
				return await this.competitionEntityService.pack(c, me, { detailed: true });
			} catch (e) {
				return toApiError(e);
			}
		});
	}
}

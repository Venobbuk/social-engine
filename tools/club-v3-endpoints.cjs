// CLUB-V3: writes the clubs/* endpoint files (all owned by the CLUB-V3 stream). Overwrites its own files only.
'use strict';
const fs = require('fs'), path = require('path');
const D = path.join(__dirname, '..', 'packages', 'backend', 'src', 'modules', 'clubs', 'endpoints');
const HEAD = `/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ClubService } from '@/modules/clubs/ClubService.js';
import { clubErrors, toApiError } from '@/modules/clubs/endpoints/_shared.js';
`;
const files = {};

files['_shared.ts'] = `/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { IdentifiableError } from '@/misc/identifiable-error.js';
import { ApiError } from '@/server/api/error.js';

// CLUB-V3: one error catalogue for the clubs/* doors; ClubService / ClubScheduleService throw IdentifiableError('club:<id>').
export const clubErrors = {
	noSuchClub: { message: 'No such club.', code: 'NO_SUCH_CLUB', id: 'c1b00000-0000-4000-8000-000000000001' },
	notAdmin: { message: 'Only the club owner or an admin can do that.', code: 'CLUB_NOT_ADMIN', id: 'c1b00000-0000-4000-8000-000000000002' },
	clubError: { message: 'Club error.', code: 'CLUB_ERROR', id: 'c1b00000-0000-4000-8000-000000000003' },
	notMember: { message: 'Only members can do that.', code: 'CLUB_NOT_MEMBER', id: 'c1b00000-0000-4000-8000-000000000011' },
	chatOff: { message: 'This club has turned its chat off.', code: 'CLUB_CHAT_OFF', id: 'c1b00000-0000-4000-8000-000000000012' },
	inviteOnly: { message: 'This club is invite-only.', code: 'CLUB_INVITE_ONLY', id: 'c1b00000-0000-4000-8000-000000000013' },
	noSuchTag: { message: 'No such tag.', code: 'CLUB_NO_SUCH_TAG', id: 'c1b00000-0000-4000-8000-000000000021' },
	tagExists: { message: 'This tag has already existed', code: 'CLUB_TAG_EXISTS', id: 'c1b00000-0000-4000-8000-000000000022' },
	noSuchSchedule: { message: 'No such schedule.', code: 'CLUB_NO_SUCH_SCHEDULE', id: 'c1b00000-0000-4000-8000-000000000031' },
	noSuchNote: { message: 'No such post in this club.', code: 'CLUB_NO_SUCH_NOTE', id: 'c1b00000-0000-4000-8000-000000000041' },
	noAdmins: { message: 'This club has no admins to message.', code: 'CLUB_NO_ADMINS', id: 'c1b00000-0000-4000-8000-000000000051' },
	invalid: { message: 'Invalid input.', code: 'CLUB_INVALID', id: 'c1b00000-0000-4000-8000-000000000061' },
} as const;

const map: Record<string, keyof typeof clubErrors> = {
	'club:no_such_club': 'noSuchClub', 'club:not_admin': 'notAdmin', 'club:not_member': 'notMember', 'club:chat_off': 'chatOff', 'club:invite_only': 'inviteOnly',
	'club:no_such_tag': 'noSuchTag', 'club:tag_exists': 'tagExists', 'club:no_such_schedule': 'noSuchSchedule', 'club:no_such_note': 'noSuchNote', 'club:no_admins': 'noAdmins', 'club:invalid': 'invalid',
};

export function toApiError(e: unknown): never {
	if (e instanceof IdentifiableError) {
		const k = map[e.id];
		if (k) throw new ApiError({ ...clubErrors[k], message: e.message });
		throw new ApiError({ ...clubErrors.clubError, message: e.message });
	}
	throw e;
}
`;

const ep = (name, { imports = '', kind = 'write:channels', cred = true, res = "{ type: 'object', optional: false, nullable: false }", props, required = ['channelId'], ctor = 'private clubService: ClubService', body }) => `${HEAD}${imports}
// CLUB-V3 — see modules/clubs/ClubService.ts / ClubScheduleService.ts
export const meta = {
	tags: ['clubs'],
	requireCredential: ${cred},
${kind ? `	kind: '${kind}',\n` : ''}	res: ${res},
	errors: clubErrors,
} as const;

export const paramDef = {
	type: 'object',
	properties: ${props},
	required: ${JSON.stringify(required)},
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(${ctor}) {
		super(meta, paramDef, async (ps, me) => {
			try {
${body}
			} catch (e) {
				return toApiError(e);
			}
		});
	}
}
`;

files['mine.ts'] = ep('mine', {
	imports: "import { ChannelEntityService } from '@/core/entities/ChannelEntityService.js';\n",
	kind: 'read:channels', res: "{ type: 'array', optional: false, nullable: false, items: { type: 'object', optional: false, nullable: false } }",
	props: '{}', required: [],
	ctor: 'private clubService: ClubService, private channelEntityService: ChannelEntityService',
	body: `				// the clubs I am in (owned or joined), pinned first, each with my state — the Home pinned row and the kebab read this
				const rows = await this.clubService.mine(me);
				const out = [];
				for (const r of rows) out.push({ ...(await this.channelEntityService.pack(r.channel, me, false)), pinned: r.pinned, paused: r.paused, role: r.role });
				return out;`,
});

files['me-update.ts'] = ep('me-update', {
	props: "{ channelId: { type: 'string', format: 'misskey:id' }, pinned: { type: 'boolean', nullable: true }, paused: { type: 'boolean', nullable: true } }",
	body: `				// Reclub club kebab: Pin to home screen / Take a break (PUT /users/<id> {is_pinned} / {is_active})
				const c = await this.clubService.channel(ps.channelId);
				const st = await this.clubService.updateMyState(c, me, { pinned: ps.pinned, paused: ps.paused });
				return { pinned: !!st.pinnedAt, paused: !!st.pausedAt, pinnedAt: st.pinnedAt ? st.pinnedAt.toISOString() : null, pausedAt: st.pausedAt ? st.pausedAt.toISOString() : null };`,
});

files['by-code.ts'] = ep('by-code', {
	imports: "import { ChannelEntityService } from '@/core/entities/ChannelEntityService.js';\nimport { IdentifiableError } from '@/misc/identifiable-error.js';\n",
	kind: '', cred: false,
	props: "{ code: { type: 'string', minLength: 4, maxLength: 8 } }", required: ['code'],
	ctor: 'private clubService: ClubService, private channelEntityService: ChannelEntityService',
	body: `				// Reclub GET /groups/by-code/<code> (onboard/club-code): the club behind a six-char code; a wrong code is NO_SUCH_CLUB
				const r = await this.clubService.byCode(ps.code);
				if (!r) throw new IdentifiableError('club:no_such_club', 'The code you\\'ve entered is invalid. Please try again');
				return { ...(await this.channelEntityService.pack(r.channel, me ?? null, false)), gateType: r.settings.gateType, visibility: r.settings.visibility, sport: r.settings.sport, level: r.settings.level, refCode: r.settings.refCode };`,
});

files['tags-list.ts'] = ep('tags-list', {
	kind: 'read:channels', res: "{ type: 'array', optional: false, nullable: false, items: { type: 'object', optional: false, nullable: false } }",
	props: "{ channelId: { type: 'string', format: 'misskey:id' } }",
	body: `				const c = await this.clubService.channel(ps.channelId);
				return await this.clubService.tags(c, me);`,
});
files['tags-upsert.ts'] = ep('tags-upsert', {
	props: "{ channelId: { type: 'string', format: 'misskey:id' }, tagId: { type: 'string', nullable: true }, name: { type: 'string', nullable: true, maxLength: 32 }, visibility: { type: 'string', enum: ['all', 'admins'], nullable: true }, order: { type: 'integer', nullable: true, minimum: 0, maximum: 200 } }",
	body: `				// Reclub POST /tags {tag, visibility, order} / PUT /tags/<id> / PUT /tags/update/order
				const c = await this.clubService.channel(ps.channelId);
				const t = await this.clubService.upsertTag(c, me, { tagId: ps.tagId, name: ps.name, visibility: ps.visibility, order: ps.order });
				return { id: t.id, name: t.name, visibility: t.visibility, order: t.order, count: Object.keys(t.members).length };`,
});
files['tags-delete.ts'] = ep('tags-delete', {
	props: "{ channelId: { type: 'string', format: 'misskey:id' }, tagId: { type: 'string' } }", required: ['channelId', 'tagId'],
	body: `				const c = await this.clubService.channel(ps.channelId);
				await this.clubService.deleteTag(c, me, ps.tagId);
				return { ok: true };`,
});
files['tags-member.ts'] = ep('tags-member', {
	props: "{ channelId: { type: 'string', format: 'misskey:id' }, tagId: { type: 'string' }, userId: { type: 'string', format: 'misskey:id' }, on: { type: 'boolean' }, expiresAt: { type: 'string', nullable: true, maxLength: 40 } }", required: ['channelId', 'tagId', 'userId', 'on'],
	body: `				// Reclub tag-member / untag / PUT /users/<id> {expired_at}: expiresAt is an ISO string (never format: date-time — the paramDef trap)
				const c = await this.clubService.channel(ps.channelId);
				await this.clubService.setTagMember(c, me, ps.tagId, ps.userId, ps.on, ps.expiresAt ?? null);
				return { ok: true };`,
});

files['posts-announce.ts'] = ep('posts-announce', {
	kind: 'write:notes',
	props: "{ channelId: { type: 'string', format: 'misskey:id' }, noteId: { type: 'string', format: 'misskey:id' }, on: { type: 'boolean', default: true } }", required: ['channelId', 'noteId'],
	body: `				// Reclub forum:post_announcement — the post is pinned to the club's top and every active member is notified
				const c = await this.clubService.channel(ps.channelId);
				return await this.clubService.announce(c, me, ps.noteId, ps.on);`,
});

files['admins-chat.ts'] = ep('admins-chat', {
	kind: 'write:chat', res: "{ type: 'object', optional: false, nullable: false, properties: { roomId: { type: 'string', optional: false, nullable: false } } }",
	props: "{ channelId: { type: 'string', format: 'misskey:id' } }",
	body: `				// Reclub "Message Admins": a thread between this person and the club's admins (one room per member, minted on first open)
				const c = await this.clubService.channel(ps.channelId);
				return await this.clubService.adminsRoom(c, me);`,
});

const schedImports = "import { ClubScheduleService } from '@/modules/clubs/ClubScheduleService.js';\n";
const schedFields = "name: { type: 'string', maxLength: 128 }, weekday: { type: 'integer', minimum: 1, maximum: 7 }, startTime: { type: 'string', maxLength: 5 }, durationMinutes: { type: 'integer', minimum: 15, maximum: 1440 }, venueId: { type: 'string', nullable: true }, venueName: { type: 'string', nullable: true, maxLength: 256 }, venueAddress: { type: 'string', nullable: true, maxLength: 512 }, lat: { type: 'number', nullable: true }, lng: { type: 'number', nullable: true }, capacity: { type: 'integer', minimum: 1, maximum: 500 }, hostPlays: { type: 'boolean' }, visibility: { type: 'string', enum: ['public', 'private'] }, autoApprove: { type: 'boolean' }, allowPlusOne: { type: 'boolean' }, feeType: { type: 'string', enum: ['none', 'free', 'perPax', 'autoSplit'] }, feeAmount: { type: 'integer', nullable: true, minimum: 0 }, feeCurrency: { type: 'string', maxLength: 3 }, paymentInfo: { type: 'string', nullable: true, maxLength: 512 }, gateType: { type: 'string', enum: ['guidance', 'autoApprove', 'strict'] }, levelBasis: { type: 'string', enum: ['self', 'duprSingles', 'duprDoubles'] }, minLevel: { type: 'number', nullable: true }, maxLevel: { type: 'number', nullable: true }, gender: { type: 'string', enum: ['any', 'coed', 'female', 'male'] }, ageGroup: { type: 'string', enum: ['any', 'junior', 'adult', 'senior'] }, submitMatches: { type: 'boolean' }, publishLeadHours: { type: 'integer', minimum: 1, maximum: 672 }, status: { type: 'string', enum: ['active', 'paused'] }, tagIds: { type: 'array', items: { type: 'string' }, maxItems: 20 }, notes: { type: 'string', nullable: true, maxLength: 4096 }, sendNotifications: { type: 'boolean' }";
const schedKeys = "['name', 'weekday', 'startTime', 'durationMinutes', 'venueId', 'venueName', 'venueAddress', 'lat', 'lng', 'capacity', 'hostPlays', 'visibility', 'autoApprove', 'allowPlusOne', 'feeType', 'feeAmount', 'feeCurrency', 'paymentInfo', 'gateType', 'levelBasis', 'minLevel', 'maxLevel', 'gender', 'ageGroup', 'submitMatches', 'publishLeadHours', 'status', 'tagIds', 'notes', 'sendNotifications'] as const";
const schedCtor = 'private clubService: ClubService, private clubScheduleService: ClubScheduleService';

files['schedules-list.ts'] = ep('schedules-list', {
	imports: schedImports, kind: '', cred: false, res: "{ type: 'array', optional: false, nullable: false, items: { type: 'object', optional: false, nullable: false } }",
	props: "{ channelId: { type: 'string', format: 'misskey:id' } }", ctor: schedCtor,
	body: `				// Reclub club-schedules/<groupId>: the club's weekly slots (public, like the club page's REGULAR SCHEDULE block)
				const c = await this.clubService.channel(ps.channelId);
				const rows = await this.clubScheduleService.list(c);
				const out = [];
				for (const s of rows) out.push(await this.clubScheduleService.pack(s, me ?? null));
				return out;`,
});
files['schedules-show.ts'] = ep('schedules-show', {
	imports: schedImports, kind: '', cred: false,
	props: "{ scheduleId: { type: 'string', format: 'misskey:id' } }", required: ['scheduleId'], ctor: schedCtor,
	body: `				const s = await this.clubScheduleService.get(ps.scheduleId);
				return await this.clubScheduleService.pack(s, me ?? null);`,
});
files['schedules-create.ts'] = ep('schedules-create', {
	imports: schedImports, kind: 'write:channels',
	props: `{ channelId: { type: 'string', format: 'misskey:id' }, ${schedFields} }`, required: ['channelId', 'name', 'weekday', 'startTime'], ctor: schedCtor,
	body: `				// Reclub POST /schedules (CREATE SCHEDULE) — then the sweep (or clubs/schedules/run) publishes the meets
				const c = await this.clubService.channel(ps.channelId);
				const data: Record<string, unknown> = {};
				for (const k of ${schedKeys}) if (ps[k] !== undefined) data[k] = ps[k];
				const s = await this.clubScheduleService.create(c, me, data as Parameters<ClubScheduleService['create']>[2]);
				return await this.clubScheduleService.pack(s, me);`,
});
files['schedules-update.ts'] = ep('schedules-update', {
	imports: schedImports, kind: 'write:channels',
	props: `{ scheduleId: { type: 'string', format: 'misskey:id' }, ${schedFields} }`, required: ['scheduleId'], ctor: schedCtor,
	body: `				// Reclub PUT /schedules/<id> — and Pause / Make active (status)
				const s0 = await this.clubScheduleService.get(ps.scheduleId);
				const c = await this.clubService.channel(s0.channelId);
				const patch: Record<string, unknown> = {};
				for (const k of ${schedKeys}) if (ps[k] !== undefined) patch[k] = ps[k];
				const s = await this.clubScheduleService.update(c, me, s0, patch as Parameters<ClubScheduleService['update']>[3]);
				return await this.clubScheduleService.pack(s, me);`,
});
files['schedules-delete.ts'] = ep('schedules-delete', {
	imports: schedImports, kind: 'write:channels',
	props: "{ scheduleId: { type: 'string', format: 'misskey:id' } }", required: ['scheduleId'], ctor: schedCtor,
	body: `				// Reclub DELETE /schedules/<id>: the slot goes; meets already created stay
				const s = await this.clubScheduleService.get(ps.scheduleId);
				const c = await this.clubService.channel(s.channelId);
				await this.clubScheduleService.remove(c, me, s);
				return { ok: true };`,
});
files['schedules-run.ts'] = ep('schedules-run', {
	imports: schedImports, kind: 'write:channels',
	props: "{ channelId: { type: 'string', format: 'misskey:id' } }", ctor: schedCtor,
	body: `				// the sweep for one club, now (an admin's "Create now"; the probe's "run the job once")
				const c = await this.clubService.channel(ps.channelId);
				return await this.clubScheduleService.runForClub(c, me);`,
});

for (const [f, src] of Object.entries(files)) fs.writeFileSync(path.join(D, f), src);
console.log('wrote ' + Object.keys(files).length + ' files');

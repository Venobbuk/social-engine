/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { DI } from '@/di-symbols.js';
import type { ChannelsRepository, ChannelFollowingsRepository, ClubSettingsRepository, ClubJoinRequestsRepository, UsersRepository } from '@/models/_.js';
import type { MiChannel } from '@/models/Channel.js';
import type { MiUser, MiLocalUser } from '@/models/User.js';
import type { MiClubSetting, MiClubJoinRequest } from '@/modules/clubs/models/ClubSetting.js';
import { IdService } from '@/core/IdService.js';
import { NotificationService } from '@/core/NotificationService.js';
import { ChannelFollowingService } from '@/core/ChannelFollowingService.js';
import { UserEntityService } from '@/core/entities/UserEntityService.js';
import { IdentifiableError } from '@/misc/identifiable-error.js';
import { bindThis } from '@/decorators.js';

// CLUB-ADMIN-V1: Reclub's club management (spec_clubs_discover_home §clubs/[groupId]/settings, groups/manage-*,
// group-user, tags, insights, claim-club-ownership) on a Misskey channel. The channel's userId is the owner;
// adminIds are the committee; membership is channel_following. Everything a member can see stays public; what
// only an admin can do is gated here in one place (assertAdmin).
export type ClubTimeframe = 'CURRENT_MONTH' | 'LAST_MONTH' | 'LAST_3_MONTHS' | 'YTD' | 'LAST_YEAR' | 'ALL_TIME';

@Injectable()
export class ClubService {
	constructor(
		@Inject(DI.db) private db: DataSource,
		@Inject(DI.channelsRepository) private channelsRepository: ChannelsRepository,
		@Inject(DI.channelFollowingsRepository) private channelFollowingsRepository: ChannelFollowingsRepository,
		@Inject(DI.clubSettingsRepository) private clubSettingsRepository: ClubSettingsRepository,
		@Inject(DI.clubJoinRequestsRepository) private clubJoinRequestsRepository: ClubJoinRequestsRepository,
		@Inject(DI.usersRepository) private usersRepository: UsersRepository,
		private idService: IdService,
		private notificationService: NotificationService,
		private channelFollowingService: ChannelFollowingService,
		private userEntityService: UserEntityService,
	) {}

	private err(id: string, message: string): IdentifiableError { return new IdentifiableError(`club:${id}`, message); }

	@bindThis
	public async channel(channelId: string): Promise<MiChannel> {
		const c = await this.channelsRepository.findOneBy({ id: channelId });
		if (!c) throw this.err('no_such_club', 'No such club.');
		return c;
	}

	/** The settings row, created with defaults on first read. */
	@bindThis
	public async settings(channelId: string): Promise<MiClubSetting> {
		const s = await this.clubSettingsRepository.findOneBy({ channelId });
		if (s) return s;
		return await this.clubSettingsRepository.insertOne({ channelId, visibility: 'public', gateType: 'open', createMeetPermission: 'members', sport: 'pickleball', level: null, adminIds: [], memberTags: {}, venueIds: [], paymentInfo: null, enableForum: true, enableChat: true, updatedAt: new Date() });
	}

	@bindThis
	public async isAdmin(channel: MiChannel, userId: string): Promise<boolean> {
		if (channel.userId === userId) return true;
		const s = await this.settings(channel.id);
		return s.adminIds.includes(userId);
	}

	@bindThis
	public async assertAdmin(channel: MiChannel, userId: string): Promise<void> {
		if (!(await this.isAdmin(channel, userId))) throw this.err('not_admin', 'Only the club owner or an admin can do that.');
	}

	@bindThis
	public async isMember(channelId: string, userId: string): Promise<boolean> {
		return await this.channelFollowingsRepository.exists({ where: { followeeId: channelId, followerId: userId } });
	}

	/** Owner / admins may change these; the channel's own name/description/banner go through channels/update. */
	@bindThis
	public async updateSettings(channel: MiChannel, by: MiUser, patch: Partial<Pick<MiClubSetting, 'visibility' | 'gateType' | 'createMeetPermission' | 'sport' | 'level' | 'venueIds' | 'paymentInfo' | 'enableForum' | 'enableChat'>>): Promise<MiClubSetting> {
		await this.assertAdmin(channel, by.id);
		const s = await this.settings(channel.id);
		await this.clubSettingsRepository.update(s.channelId, { ...patch, updatedAt: new Date() });
		return await this.clubSettingsRepository.findOneByOrFail({ channelId: channel.id });
	}

	// ------------------------------------------------------------------------------------- members
	/** Members = channel followers, with role (owner / admin / member), tags, joinedAt. Admin-only (Reclub group-user). */
	@bindThis
	public async members(channel: MiChannel, viewer: MiUser, opts: { limit?: number; offset?: number; query?: string } = {}) {
		await this.assertAdmin(channel, viewer.id);
		const s = await this.settings(channel.id);
		const rows = await this.channelFollowingsRepository.find({ where: { followeeId: channel.id }, order: { id: 'ASC' } });
		const ids = rows.map(r => r.followerId);
		if (channel.userId && !ids.includes(channel.userId)) ids.unshift(channel.userId);
		const users = ids.length ? await this.usersRepository.find({ where: { id: In(ids) } }) : [];
		const byId = new Map(users.map(u => [u.id, u]));
		let out = [] as { user: unknown; userId: string; role: 'owner' | 'admin' | 'member'; tags: string[]; joinedAt: string | null }[];
		for (const id of ids) {
			const u = byId.get(id); if (!u) continue;
			if (opts.query && !`${u.name ?? ''} ${u.username}`.toLowerCase().includes(opts.query.toLowerCase())) continue;
			const row = rows.find(r => r.followerId === id);
			out.push({ user: await this.userEntityService.pack(u, viewer, { schema: 'UserLite' }), userId: id, role: channel.userId === id ? 'owner' : s.adminIds.includes(id) ? 'admin' : 'member', tags: s.memberTags[id] ?? [], joinedAt: row ? this.idService.parse(row.id).date.toISOString() : null });
		}
		const total = out.length;
		out = out.slice(opts.offset ?? 0, (opts.offset ?? 0) + (opts.limit ?? 100));
		return { total, members: out, tags: Array.from(new Set(Object.values(s.memberTags).flat())).sort() };
	}

	/** Promote / demote / tag / remove a member. The owner cannot be removed or demoted. */
	@bindThis
	public async updateMember(channel: MiChannel, by: MiUser, userId: string, patch: { role?: 'admin' | 'member'; tags?: string[]; remove?: boolean }): Promise<void> {
		await this.assertAdmin(channel, by.id);
		if (userId === channel.userId) throw this.err('invalid', 'The owner cannot be changed here.');
		const s = await this.settings(channel.id);
		const upd: Partial<MiClubSetting> = { updatedAt: new Date() };
		if (patch.role) upd.adminIds = patch.role === 'admin' ? Array.from(new Set([...s.adminIds, userId])) : s.adminIds.filter(x => x !== userId);
		if (patch.tags) upd.memberTags = { ...s.memberTags, [userId]: patch.tags.map(t => t.trim()).filter(Boolean).slice(0, 12) };
		if (patch.remove) {
			upd.adminIds = (upd.adminIds ?? s.adminIds).filter(x => x !== userId);
			const mt = { ...(upd.memberTags ?? s.memberTags) }; delete mt[userId]; upd.memberTags = mt;
			const u = await this.usersRepository.findOneBy({ id: userId });
			if (u) await this.channelFollowingService.unfollow(u as MiLocalUser, channel);
		}
		await this.clubSettingsRepository.update(channel.id, upd);
	}

	// ------------------------------------------------------------------------------------- joining
	/** Reclub GroupGateType: open → member now; approval → a request the admins decide; invite → refused. */
	@bindThis
	public async join(channel: MiChannel, user: MiLocalUser, message: string | null): Promise<{ status: 'member' | 'requested' }> {
		const s = await this.settings(channel.id);
		if (await this.isMember(channel.id, user.id)) return { status: 'member' };
		if (s.gateType === 'open') { await this.channelFollowingService.follow(user, channel); return { status: 'member' }; }
		if (s.gateType === 'invite') throw this.err('invite_only', 'This club is invite-only.');
		const existing = await this.clubJoinRequestsRepository.findOneBy({ channelId: channel.id, userId: user.id });
		if (existing) { if (existing.status === 'pending') return { status: 'requested' }; await this.clubJoinRequestsRepository.update(existing.id, { status: 'pending', message, decidedById: null, decidedAt: null, createdAt: new Date() }); }
		else await this.clubJoinRequestsRepository.insertOne({ id: this.idService.gen(), channelId: channel.id, userId: user.id, status: 'pending', message, decidedById: null, decidedAt: null, createdAt: new Date() });
		for (const adminId of [channel.userId, ...s.adminIds].filter((x): x is string => !!x)) this.notify(adminId, 'New join request', `${user.name ?? user.username} asked to join ${channel.name}.`, channel.id);
		return { status: 'requested' };
	}

	@bindThis
	public async joinRequests(channel: MiChannel, viewer: MiUser, status: MiClubJoinRequest['status'] = 'pending') {
		await this.assertAdmin(channel, viewer.id);
		const rows = await this.clubJoinRequestsRepository.find({ where: { channelId: channel.id, status }, order: { createdAt: 'DESC' } });
		const out = [];
		for (const r of rows) out.push({ id: r.id, user: await this.userEntityService.pack(r.userId, viewer, { schema: 'UserLite' }).catch(() => null), userId: r.userId, message: r.message, status: r.status, createdAt: r.createdAt.toISOString() });
		return out;
	}

	@bindThis
	public async decide(channel: MiChannel, by: MiUser, requestId: string, approve: boolean): Promise<void> {
		await this.assertAdmin(channel, by.id);
		const r = await this.clubJoinRequestsRepository.findOneBy({ id: requestId, channelId: channel.id });
		if (!r) throw this.err('no_such_request', 'No such request.');
		await this.clubJoinRequestsRepository.update(r.id, { status: approve ? 'approved' : 'declined', decidedById: by.id, decidedAt: new Date() });
		if (approve) { const u = await this.usersRepository.findOneBy({ id: r.userId }); if (u) await this.channelFollowingService.follow(u as MiLocalUser, channel); }
		this.notify(r.userId, approve ? 'Welcome to the club' : 'Join request declined', approve ? `You are now a member of ${channel.name}.` : `${channel.name} declined your request to join.`, channel.id);
	}

	/** My own request state for a club (for the Join button). */
	@bindThis
	public async myRequest(channelId: string, userId: string): Promise<MiClubJoinRequest['status'] | null> {
		const r = await this.clubJoinRequestsRepository.findOneBy({ channelId, userId });
		return r ? r.status : null;
	}

	// ------------------------------------------------------------------------------------- insights
	/** Reclub GroupReports: total members / followers / activities / active members / fill rate; most active; most rewarded (kudos). */
	@bindThis
	public async insights(channel: MiChannel, viewer: MiUser, timeframe: ClubTimeframe) {
		await this.assertAdmin(channel, viewer.id);
		const now = new Date(); const y = now.getFullYear(), m = now.getMonth();
		const range = (() => { switch (timeframe) {
			case 'CURRENT_MONTH': return [new Date(y, m, 1), new Date(y, m + 1, 1)];
			case 'LAST_MONTH': return [new Date(y, m - 1, 1), new Date(y, m, 1)];
			case 'LAST_3_MONTHS': return [new Date(y, m - 3, 1), new Date(y, m + 1, 1)];
			case 'YTD': return [new Date(y, 0, 1), new Date(y + 1, 0, 1)];
			case 'LAST_YEAR': return [new Date(y - 1, 0, 1), new Date(y, 0, 1)];
			default: return [new Date(2000, 0, 1), new Date(2100, 0, 1)];
		} })();
		const [from, to] = range;
		// members = followers ∪ the owner (channels/create does not follow the owner; Reclub counts them)
		const followerCount = await this.channelFollowingsRepository.countBy({ followeeId: channel.id });
		const ownerFollows = channel.userId ? await this.channelFollowingsRepository.exists({ where: { followeeId: channel.id, followerId: channel.userId } }) : true;
		const totalMembers = followerCount + (ownerFollows ? 0 : 1);
		const acts = await this.db.query(`SELECT m."id", m."capacity", m."confirmed", m."startAt" FROM "meet" m WHERE m."channelId" = $1 AND m."status" <> 'cancelled' AND m."startAt" >= $2 AND m."startAt" < $3`, [channel.id, from, to]) as { id: string; capacity: number; confirmed: number; startAt: Date }[];
		const totalActivities = acts.length;
		const fillRate = acts.length ? Math.round(100 * acts.reduce((n, a) => n + Math.min(1, (a.confirmed ?? 0) / Math.max(1, a.capacity ?? 1)), 0) / acts.length) : 0;
		const active = acts.length ? await this.db.query(`SELECT p."userId", count(*)::int AS n FROM "meet_participant" p WHERE p."meetId" = ANY($1) AND p."status" = 'confirmed' AND p."userId" IS NOT NULL GROUP BY p."userId" ORDER BY n DESC`, [acts.map(a => a.id)]) as { userId: string; n: number }[] : [];
		const rewarded = acts.length ? await this.db.query(`SELECT r."targetUserId" AS "userId", count(*)::int AS n FROM "meet_review" r WHERE r."meetId" = ANY($1) AND r."type" = 'endorsement' AND r."archivedAt" IS NULL GROUP BY r."targetUserId" ORDER BY n DESC LIMIT 5`, [acts.map(a => a.id)]) as { userId: string; n: number }[] : [];
		const pack = async (rows: { userId: string; n: number }[]) => { const out = []; for (const r of rows.slice(0, 5)) out.push({ user: await this.userEntityService.pack(r.userId, viewer, { schema: 'UserLite' }).catch(() => null), count: r.n }); return out; };
		return { timeframe, totalMembers, totalFollowers: totalMembers, totalActivities, activeMembers: active.length, fillRate, mostActive: await pack(active), mostRewarded: await pack(rewarded) };
	}

	// ------------------------------------------------------------------------------------- ownership
	/** Reclub claim-club-ownership: a mirrored / orphaned club (no owner) is claimed by a member; the staff can reassign. */
	@bindThis
	public async claim(channel: MiChannel, user: MiUser): Promise<void> {
		if (channel.userId) throw this.err('has_owner', 'This club already has an owner.');
		if (!(await this.isMember(channel.id, user.id))) throw this.err('not_member', 'Join the club first.');
		await this.channelsRepository.update(channel.id, { userId: user.id });
	}

	private notify(userId: string, header: string, body: string, channelId?: string): void {
		this.notificationService.createNotification(userId, 'app', { customHeader: header, customBody: body, customIcon: null, appAccessTokenId: null, customLink: channelId ? 'club:' + channelId : null });
	}
}

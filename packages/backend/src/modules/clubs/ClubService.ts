/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { DI } from '@/di-symbols.js';
import type { ChannelsRepository, ChannelFollowingsRepository, ClubSettingsRepository, ClubJoinRequestsRepository, ClubMemberStatesRepository, NotesRepository, VenuesRepository, UsersRepository } from '@/models/_.js';
import type { MiChannel } from '@/models/Channel.js';
import type { MiUser, MiLocalUser } from '@/models/User.js';
import type { MiClubSetting, MiClubJoinRequest, MiClubMemberState, ClubTag, ClubAward } from '@/modules/clubs/models/ClubSetting.js';
import { secureRndstr } from '@/misc/secure-rndstr.js';
import { IdService } from '@/core/IdService.js';
import { NotificationService } from '@/core/NotificationService.js';
import { ChatService } from '@/core/ChatService.js';
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
		@Inject(DI.clubMemberStatesRepository) private clubMemberStatesRepository: ClubMemberStatesRepository,
		@Inject(DI.notesRepository) private notesRepository: NotesRepository,
		@Inject(DI.venuesRepository) private venuesRepository: VenuesRepository,
		private idService: IdService,
		private notificationService: NotificationService,
		private chatService: ChatService,
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
		return await this.clubSettingsRepository.insertOne({ channelId, visibility: 'public', gateType: 'open', createMeetPermission: 'members', sport: 'pickleball', level: null, adminIds: [], memberTags: {}, venueIds: [], paymentInfo: null, enableForum: true, enableChat: true, chatRoomId: null, refCode: await this.freshRefCode(), accessToken: secureRndstr(16), tags: [], awards: [], updatedAt: new Date() });
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
	public async updateSettings(channel: MiChannel, by: MiUser, patch: Partial<Pick<MiClubSetting, 'visibility' | 'gateType' | 'createMeetPermission' | 'sport' | 'level' | 'venueIds' | 'paymentInfo' | 'enableForum' | 'enableChat' | 'awards'>>): Promise<MiClubSetting> {
		await this.assertAdmin(channel, by.id);
		const s = await this.settings(channel.id);
		await this.clubSettingsRepository.update(s.channelId, { ...patch, updatedAt: new Date() });
		return await this.clubSettingsRepository.findOneByOrFail({ channelId: channel.id });
	}

	// ------------------------------------------------------------------------------------- members
	/** Members = channel followers, with role (owner / admin / member), tags, joinedAt. Members and admins may look
	 *  (Reclub's group member list is visible to members); the tags column is the admins' — a member sees []. */
	@bindThis
	public async members(channel: MiChannel, viewer: MiUser, opts: { limit?: number; offset?: number; query?: string } = {}) {
		const admin = await this.isAdmin(channel, viewer.id);
		if (!admin && !(await this.isMember(channel.id, viewer.id))) throw this.err('not_member', 'Only members can see the member list.');
		const s = await this.settings(channel.id);
		const rows = await this.channelFollowingsRepository.find({ where: { followeeId: channel.id }, order: { id: 'ASC' } });
		const ids = rows.map(r => r.followerId);
		if (channel.userId && !ids.includes(channel.userId)) ids.unshift(channel.userId);
		const users = ids.length ? await this.usersRepository.find({ where: { id: In(ids) } }) : [];
		const byId = new Map(users.map(u => [u.id, u]));
		// CLUB-V3: a member on a break (Take a break) is off the roster for members; admins see them flagged
		const paused = new Set((await this.clubMemberStatesRepository.find({ where: { channelId: channel.id }, select: { userId: true, pausedAt: true } })).filter(x => x.pausedAt).map(x => x.userId));
		const tagsOf = this.memberTagsOf(s, admin);
		let out = [] as { user: unknown; userId: string; role: 'owner' | 'admin' | 'member'; tags: string[]; tagDetails: { id: string; name: string; expiresAt: string | null }[]; joinedAt: string | null; lastActiveAt: string | null; paused: boolean }[];
		for (const id of ids) {
			const u = byId.get(id); if (!u) continue;
			if (opts.query && !`${u.name ?? ''} ${u.username}`.toLowerCase().includes(opts.query.toLowerCase())) continue;
			if (paused.has(id) && !admin && id !== viewer.id) continue;
			const row = rows.find(r => r.followerId === id);
			const td = tagsOf(id);
			out.push({ user: await this.userEntityService.pack(u, viewer, { schema: 'UserLite' }), userId: id, role: channel.userId === id ? 'owner' : s.adminIds.includes(id) ? 'admin' : 'member', tags: td.map(t => t.name), tagDetails: td, joinedAt: row ? this.idService.parse(row.id).date.toISOString() : null, lastActiveAt: u.lastActiveDate ? new Date(u.lastActiveDate).toISOString() : null, paused: paused.has(id) });
		}
		const total = out.length;
		out = out.slice(opts.offset ?? 0, (opts.offset ?? 0) + (opts.limit ?? 100));
		const visibleTags = s.tags.filter(t => admin || t.visibility === 'all').sort((a, b) => a.order - b.order);
		return { total, members: out, tags: visibleTags.map(t => t.name), tagDefs: visibleTags.map(t => ({ id: t.id, name: t.name, visibility: t.visibility, order: t.order, count: Object.keys(t.members).length })) };
	}

	/** Promote / demote / tag / remove a member. The owner cannot be removed or demoted. */
	@bindThis
	public async updateMember(channel: MiChannel, by: MiUser, userId: string, patch: { role?: 'admin' | 'member'; tags?: string[]; remove?: boolean }): Promise<void> {
		await this.assertAdmin(channel, by.id);
		if (userId === channel.userId) throw this.err('invalid', 'The owner cannot be changed here.');
		const s = await this.settings(channel.id);
		const upd: Partial<MiClubSetting> = { updatedAt: new Date() };
		if (patch.role) upd.adminIds = patch.role === 'admin' ? Array.from(new Set([...s.adminIds, userId])) : s.adminIds.filter(x => x !== userId);
		if (patch.tags) {
			// CLUB-V3: the names are the truth for THIS member — a name not in the club's tag list becomes a tag
			const names = patch.tags.map(t => t.trim()).filter(Boolean).slice(0, 12);
			const tags = s.tags.map(t => ({ ...t, members: { ...t.members } }));
			for (const n of names) if (!tags.some(t => t.name.toLowerCase() === n.toLowerCase())) tags.push({ id: this.idService.gen(), name: n.slice(0, 32), visibility: 'all', order: tags.length, members: {} });
			for (const t of tags) { const on = names.some(n => n.toLowerCase() === t.name.toLowerCase()); if (on) { if (!(userId in t.members)) t.members[userId] = null; } else delete t.members[userId]; }
			upd.tags = tags; upd.memberTags = this.deriveMemberTags(tags);
		}
		if (patch.remove) {
			upd.adminIds = (upd.adminIds ?? s.adminIds).filter(x => x !== userId);
			const tags = (upd.tags ?? s.tags).map(t => { const m = { ...t.members }; delete m[userId]; return { ...t, members: m }; }); upd.tags = tags; upd.memberTags = this.deriveMemberTags(tags);
			await this.clubMemberStatesRepository.delete({ channelId: channel.id, userId });
			const u = await this.usersRepository.findOneBy({ id: userId });
			if (u) await this.channelFollowingService.unfollow(u as MiLocalUser, channel);
		}
		await this.clubSettingsRepository.update(channel.id, upd);
	}

	// ------------------------------------------------------------------------------------- joining
	/** Reclub GroupGateType: open → member now; approval → a request the admins decide; invite → refused. */
	@bindThis
	public async join(channel: MiChannel, user: MiLocalUser, message: string | null, accessToken: string | null = null): Promise<{ status: 'member' | 'requested' }> {
		const s = await this.settings(channel.id);
		if (await this.isMember(channel.id, user.id)) return { status: 'member' };
		// CLUB-V3: the invite link's ?at= token is the admins' invitation — it seats the person in any gate
		if (accessToken && s.accessToken && accessToken === s.accessToken) { await this.channelFollowingService.follow(user, channel); await this.clubJoinRequestsRepository.delete({ channelId: channel.id, userId: user.id }); return { status: 'member' }; }
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

	/** CLUB-CHAT-V1: the club's chat room for a member — minted on first open (owned by the club owner, else the
	 *  opener), and the member is added to it. Members only; off when the admins disabled chat. */
	@bindThis
	public async chatRoom(channel: MiChannel, user: MiUser): Promise<{ roomId: string }> {
		if (!(await this.isMember(channel.id, user.id)) && !(await this.isAdmin(channel, user.id))) throw this.err('not_member', 'Only members can open the club chat.');
		const s = await this.settings(channel.id);
		if (!s.enableChat) throw this.err('chat_off', 'This club has turned its chat off.');
		let room = s.chatRoomId ? await this.chatService.findRoomById(s.chatRoomId) : null;
		if (!room) {
			const ownerId = channel.userId ?? user.id;
			const owner = await this.usersRepository.findOneByOrFail({ id: ownerId });
			room = await this.chatService.createRoom(owner, { name: channel.name, description: 'Club chat' });
			await this.clubSettingsRepository.update({ channelId: channel.id }, { chatRoomId: room.id });
		}
		if (room.ownerId !== user.id && !(await this.chatService.isRoomMember(room, user.id))) {
			await this.chatService.createRoomInvitation(room.ownerId, room.id, user.id);
			await this.chatService.joinToRoom(user.id, room.id);
		}
		return { roomId: room.id };
	}

	// ------------------------------------------------------------------------------------- CLUB-V3: codes, tokens, tags
	private async freshRefCode(): Promise<string> {
		let code = secureRndstr(6, { chars: 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' });
		while (await this.clubSettingsRepository.existsBy({ refCode: code })) code = secureRndstr(6, { chars: 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' });
		return code;
	}

	/** Every club carries a code and a link token; rows from before CLUB-V3 get theirs on first read. */
	@bindThis
	public async ensureCodes(s: MiClubSetting): Promise<MiClubSetting> {
		if (s.refCode && s.accessToken) return s;
		const upd: Partial<MiClubSetting> = {};
		if (!s.refCode) upd.refCode = await this.freshRefCode();
		if (!s.accessToken) upd.accessToken = secureRndstr(16);
		await this.clubSettingsRepository.update(s.channelId, upd);
		return { ...s, ...upd } as MiClubSetting;
	}

	/** Reclub GET /groups/by-code: the club behind a six-char code (case-insensitive). */
	@bindThis
	public async byCode(code: string): Promise<{ channel: MiChannel; settings: MiClubSetting } | null> {
		const s = await this.clubSettingsRepository.findOneBy({ refCode: code.trim().toUpperCase() });
		if (!s) return null;
		const c = await this.channelsRepository.findOneBy({ id: s.channelId });
		return c && !c.isArchived ? { channel: c, settings: s } : null;
	}

	private deriveMemberTags(tags: ClubTag[]): Record<string, string[]> {
		const out: Record<string, string[]> = {};
		const now = Date.now();
		for (const t of tags.slice().sort((a, b) => a.order - b.order)) for (const [uid, exp] of Object.entries(t.members)) { if (exp && new Date(exp).getTime() < now) continue; (out[uid] ??= []).push(t.name); }
		return out;
	}

	/** userId → the tags on them now (expired ones drop off; admin-only tags stay the admins'). */
	private memberTagsOf(s: MiClubSetting, admin: boolean): (userId: string) => { id: string; name: string; expiresAt: string | null }[] {
		const now = Date.now();
		const list = s.tags.filter(t => admin || t.visibility === 'all').sort((a, b) => a.order - b.order);
		return (userId) => list.filter(t => userId in t.members && !(t.members[userId] && new Date(t.members[userId] as string).getTime() < now)).map(t => ({ id: t.id, name: t.name, expiresAt: t.members[userId] }));
	}

	/** Reclub GroupTag: the club's tags with counts (admins see all; members the visible ones). */
	@bindThis
	public async tags(channel: MiChannel, viewer: MiUser) {
		const admin = await this.isAdmin(channel, viewer.id);
		if (!admin && !(await this.isMember(channel.id, viewer.id))) throw this.err('not_member', 'Only members can see the tags.');
		const s = await this.settings(channel.id);
		return s.tags.filter(t => admin || t.visibility === 'all').sort((a, b) => a.order - b.order).map(t => ({ id: t.id, name: t.name, visibility: t.visibility, order: t.order, count: Object.keys(t.members).length, members: admin ? Object.entries(t.members).map(([userId, expiresAt]) => ({ userId, expiresAt })) : [] }));
	}

	/** Create (no tagId) or rename / re-order / re-scope a tag. Names are unique per club. */
	@bindThis
	public async upsertTag(channel: MiChannel, by: MiUser, patch: { tagId?: string | null; name?: string | null; visibility?: 'all' | 'admins' | null; order?: number | null }): Promise<ClubTag> {
		await this.assertAdmin(channel, by.id);
		const s = await this.settings(channel.id);
		const tags = s.tags.map(t => ({ ...t, members: { ...t.members } }));
		const name = patch.name?.trim().slice(0, 32);
		let t = patch.tagId ? tags.find(x => x.id === patch.tagId) : undefined;
		if (patch.tagId && !t) throw this.err('no_such_tag', 'No such tag.');
		if (name && tags.some(x => x !== t && x.name.toLowerCase() === name.toLowerCase())) throw this.err('tag_exists', 'This tag has already existed');
		if (!t) { if (!name) throw this.err('invalid', 'A tag needs a name.'); t = { id: this.idService.gen(), name, visibility: patch.visibility ?? 'all', order: tags.length, members: {} }; tags.push(t); }
		else { if (name) t.name = name; if (patch.visibility) t.visibility = patch.visibility; }
		if (patch.order != null) { const me = t; const others = tags.filter(x => x !== me).sort((a, b) => a.order - b.order); others.splice(Math.max(0, Math.min(others.length, patch.order)), 0, me); others.forEach((x, i) => { x.order = i; }); }
		await this.clubSettingsRepository.update(s.channelId, { tags, memberTags: this.deriveMemberTags(tags), updatedAt: new Date() });
		return t;
	}

	@bindThis
	public async deleteTag(channel: MiChannel, by: MiUser, tagId: string): Promise<void> {
		await this.assertAdmin(channel, by.id);
		const s = await this.settings(channel.id);
		const tags = s.tags.filter(t => t.id !== tagId).sort((a, b) => a.order - b.order).map((t, i) => ({ ...t, order: i }));
		await this.clubSettingsRepository.update(s.channelId, { tags, memberTags: this.deriveMemberTags(tags), updatedAt: new Date() });
	}

	/** Tag / untag one member, with an optional expiry (Reclub PUT /users/<id> {expired_at}). */
	@bindThis
	public async setTagMember(channel: MiChannel, by: MiUser, tagId: string, userId: string, on: boolean, expiresAt: string | null): Promise<void> {
		await this.assertAdmin(channel, by.id);
		const s = await this.settings(channel.id);
		const tags = s.tags.map(t => ({ ...t, members: { ...t.members } }));
		const t = tags.find(x => x.id === tagId); if (!t) throw this.err('no_such_tag', 'No such tag.');
		if (on) { if (expiresAt && Number.isNaN(new Date(expiresAt).getTime())) throw this.err('invalid', 'Bad expiry date.'); t.members[userId] = expiresAt ? new Date(expiresAt).toISOString() : null; }
		else delete t.members[userId];
		await this.clubSettingsRepository.update(s.channelId, { tags, memberTags: this.deriveMemberTags(tags), updatedAt: new Date() });
	}

	// ------------------------------------------------------------------------------------- CLUB-V3: per-member state
	@bindThis
	public async myState(channelId: string, userId: string): Promise<MiClubMemberState | null> {
		return await this.clubMemberStatesRepository.findOneBy({ channelId, userId });
	}

	/** Pin to home / Take a break (Reclub PUT /users/<id> {is_pinned} / {is_active}). Members only. */
	@bindThis
	public async updateMyState(channel: MiChannel, user: MiUser, patch: { pinned?: boolean | null; paused?: boolean | null }): Promise<MiClubMemberState> {
		if (!(await this.isMember(channel.id, user.id)) && !(await this.isAdmin(channel, user.id))) throw this.err('not_member', 'Join the club first.');
		let st = await this.myState(channel.id, user.id);
		if (!st) st = await this.clubMemberStatesRepository.insertOne({ id: this.idService.gen(), channelId: channel.id, userId: user.id, pinnedAt: null, pausedAt: null, adminRoomId: null, updatedAt: new Date() });
		const upd: Partial<MiClubMemberState> = { updatedAt: new Date() };
		if (patch.pinned != null) upd.pinnedAt = patch.pinned ? new Date() : null;
		if (patch.paused != null) upd.pausedAt = patch.paused ? new Date() : null;
		await this.clubMemberStatesRepository.update(st.id, upd);
		return await this.clubMemberStatesRepository.findOneByOrFail({ id: st.id });
	}

	/** The clubs I am in, each with my state — the Home pinned row reads this. */
	@bindThis
	public async mine(user: MiUser): Promise<{ channel: MiChannel; pinned: boolean; paused: boolean; role: 'owner' | 'admin' | 'member' }[]> {
		const follows = await this.channelFollowingsRepository.find({ where: { followerId: user.id }, order: { id: 'DESC' } });
		const owned = await this.channelsRepository.find({ where: { userId: user.id, isArchived: false } });
		const ids = Array.from(new Set([...owned.map(c => c.id), ...follows.map(f => f.followeeId)]));
		if (!ids.length) return [];
		const channels = await this.channelsRepository.find({ where: { id: In(ids), isArchived: false } });
		const states = await this.clubMemberStatesRepository.find({ where: { userId: user.id, channelId: In(ids) } });
		const settings = await this.clubSettingsRepository.find({ where: { channelId: In(ids) } });
		const byId = new Map(channels.map(c => [c.id, c]));
		const out: { channel: MiChannel; pinned: boolean; paused: boolean; role: 'owner' | 'admin' | 'member' }[] = [];
		for (const id of ids) {
			const c = byId.get(id); if (!c) continue;
			const st = states.find(x => x.channelId === id); const s = settings.find(x => x.channelId === id);
			out.push({ channel: c, pinned: !!(st && st.pinnedAt), paused: !!(st && st.pausedAt), role: c.userId === user.id ? 'owner' : s && s.adminIds.includes(user.id) ? 'admin' : 'member' });
		}
		return out.sort((a, b) => Number(b.pinned) - Number(a.pinned));
	}

	/** Member ids to notify / auto-invite: followers ∪ owner, minus those on a break, filtered to the tags when given. */
	@bindThis
	public async activeMemberIds(channel: MiChannel, tagIds: string[] = []): Promise<string[]> {
		const s = await this.settings(channel.id);
		const rows = await this.channelFollowingsRepository.find({ where: { followeeId: channel.id }, select: { followerId: true } });
		const ids = new Set(rows.map(r => r.followerId)); if (channel.userId) ids.add(channel.userId);
		const paused = (await this.clubMemberStatesRepository.find({ where: { channelId: channel.id }, select: { userId: true, pausedAt: true } })).filter(x => x.pausedAt).map(x => x.userId);
		for (const p of paused) ids.delete(p);
		if (tagIds.length) {
			const now = Date.now(); const tagged = new Set<string>();
			for (const t of s.tags) if (tagIds.includes(t.id)) for (const [uid, exp] of Object.entries(t.members)) if (!(exp && new Date(exp).getTime() < now)) tagged.add(uid);
			for (const id of Array.from(ids)) if (!tagged.has(id)) ids.delete(id);
		}
		return Array.from(ids);
	}

	// ------------------------------------------------------------------------------------- CLUB-V3: announcements, admins thread, venues
	/** Reclub "Post announcement": the note is pinned at the top of the club (channel.pinnedNoteIds) and every active
	 *  member is told. Off = unpin. Admins only; the note must belong to this club. */
	@bindThis
	public async announce(channel: MiChannel, by: MiUser, noteId: string, on: boolean): Promise<{ pinnedNoteIds: string[] }> {
		await this.assertAdmin(channel, by.id);
		const note = await this.notesRepository.findOneBy({ id: noteId });
		if (!note || note.channelId !== channel.id) throw this.err('no_such_note', 'No such post in this club.');
		const fresh = await this.channelsRepository.findOneByOrFail({ id: channel.id });
		const ids = fresh.pinnedNoteIds.filter(x => x !== noteId);
		if (on) ids.unshift(noteId);
		await this.channelsRepository.update(channel.id, { pinnedNoteIds: ids.slice(0, 10) });
		if (on) {
			const text = (note.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
			for (const uid of await this.activeMemberIds(channel)) if (uid !== by.id) this.notify(uid, `Announcement · ${channel.name}`, text || 'A new announcement was posted.', channel.id);
		}
		return { pinnedNoteIds: ids.slice(0, 10) };
	}

	/** Reclub "Message Admins": one chat room per member with the club's admins (owner + adminIds), minted on first open. */
	@bindThis
	public async adminsRoom(channel: MiChannel, user: MiUser): Promise<{ roomId: string }> {
		const s = await this.settings(channel.id);
		const adminIds = Array.from(new Set([channel.userId, ...s.adminIds].filter((x): x is string => !!x && x !== user.id)));
		if (!adminIds.length) throw this.err('no_admins', 'This club has no admins to message.');
		let st = await this.myState(channel.id, user.id);
		let room = st && st.adminRoomId ? await this.chatService.findRoomById(st.adminRoomId) : null;
		if (!room) {
			const owner = await this.usersRepository.findOneByOrFail({ id: channel.userId ?? adminIds[0] });
			room = await this.chatService.createRoom(owner, { name: `${channel.name} · admins`, description: `${user.name ?? user.username} ↔ the admins of ${channel.name}` });
			if (!st) st = await this.clubMemberStatesRepository.insertOne({ id: this.idService.gen(), channelId: channel.id, userId: user.id, pinnedAt: null, pausedAt: null, adminRoomId: room.id, updatedAt: new Date() });
			else await this.clubMemberStatesRepository.update(st.id, { adminRoomId: room.id, updatedAt: new Date() });
		}
		for (const uid of [user.id, ...adminIds]) {
			if (uid === room.ownerId || await this.chatService.isRoomMember(room, uid)) continue;
			await this.chatService.createRoomInvitation(room.ownerId, room.id, uid);
			await this.chatService.joinToRoom(uid, room.id);
		}
		return { roomId: room.id };
	}

	/** The club's venues, packed for the page (name, address, district, status). */
	@bindThis
	public async venues(s: MiClubSetting): Promise<{ id: string; name: string; address: string | null; district: string | null; lat: number | null; lng: number | null; status: string }[]> {
		if (!s.venueIds.length) return [];
		const rows = await this.venuesRepository.find({ where: { id: In(s.venueIds) } });
		return s.venueIds.map(id => rows.find(v => v.id === id)).filter((v): v is NonNullable<typeof v> => !!v).map(v => ({ id: v.id, name: v.name, address: v.address, district: v.district, lat: v.lat, lng: v.lng, status: v.status }));
	}

	/** The club's awards (ClubAward[]), validated. */
	@bindThis
	public cleanAwards(list: unknown): ClubAward[] {
		if (!Array.isArray(list)) return [];
		return list.slice(0, 50).map((a: Record<string, unknown>) => ({ title: String(a.title ?? '').slice(0, 96), event: a.event ? String(a.event).slice(0, 96) : null, date: a.date ? String(a.date).slice(0, 10) : null, placement: a.placement ? String(a.placement).slice(0, 32) : null })).filter(a => a.title);
	}

	private notify(userId: string, header: string, body: string, channelId?: string): void {
		this.notificationService.createNotification(userId, 'app', { customHeader: header, customBody: body, customIcon: null, appAccessTokenId: null, customLink: channelId ? 'club:' + channelId : null });
	}
}

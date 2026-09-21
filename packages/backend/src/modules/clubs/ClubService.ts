/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { DI } from '@/di-symbols.js';
import type { ChannelsRepository, ChannelFollowingsRepository, ChannelFavoritesRepository, ClubSettingsRepository, ClubJoinRequestsRepository, ClubMemberStatesRepository, NotesRepository, VenuesRepository, UsersRepository } from '@/models/_.js';
import type { MiChannel } from '@/models/Channel.js';
import type { MiUser, MiLocalUser } from '@/models/User.js';
import type { MiClubSetting, MiClubJoinRequest, MiClubMemberState, ClubTag, ClubAward } from '@/modules/clubs/models/ClubSetting.js';
import { secureRndstr } from '@/misc/secure-rndstr.js';
import { IdService } from '@/core/IdService.js';
import { NotificationService } from '@/core/NotificationService.js';
import { ChatService } from '@/core/ChatService.js';
import { ChannelFollowingService } from '@/core/ChannelFollowingService.js';
import { UserEntityService } from '@/core/entities/UserEntityService.js';
import { isGripbatStaff, gripbatStaffIds } from '@/modules/staff.js';
import { IdentifiableError } from '@/misc/identifiable-error.js';
import { bindThis } from '@/decorators.js';
import { clubCounts } from '@/modules/clubs/club-tiers.js';

// CLUB-ADMIN-V1: Reclub's club management (spec_clubs_discover_home §clubs/[groupId]/settings, groups/manage-*,
// group-user, tags, insights, claim-club-ownership) on a Misskey channel. The channel's userId is the owner;
// adminIds are the committee. Everything a member can see stays public; what only an admin can do is gated here in
// one place (assertAdmin).
// CLUB-TIERS-V1 (2026-09-20): Reclub's two relationships. FOLLOW = Misskey's native channel_following (channels/follow)
// — a follower sees the club's public content and hears about new public meets. MEMBER = club_member (GripBat's
// extension, see club-tiers.ts) — joined through the gate; members-only meets, chat, tags, forum posting. Every
// membership read in the engine goes through isMember / club-tiers.ts; a member is also a follower.
// INT-BATCH2: this supersedes CLUB-GATE-V1 (INTERIM, batch 1) — membership is no longer channel_following.
/** CLUB-CLAIM-VERIFY-V1.1 (W1): after a declined claim the same person may claim the same club again only after this. */
export const CLAIM_COOLDOWN_DAYS = 7;

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
		// NUKE-CLUB-PIN-V1: "Pin to home screen" IS Misskey's channel favourite — one store, the native one
		@Inject(DI.channelFavoritesRepository) private channelFavoritesRepository: ChannelFavoritesRepository,
		@Inject(DI.notesRepository) private notesRepository: NotesRepository,
		@Inject(DI.venuesRepository) private venuesRepository: VenuesRepository,
		private idService: IdService,
		private notificationService: NotificationService,
		private chatService: ChatService,
		private channelFollowingService: ChannelFollowingService,
		private userEntityService: UserEntityService,
	) {}

	private err(id: string, message: string): IdentifiableError { return new IdentifiableError(`club:${id}`, message); }

	// CLUB-PRIVATE-V1 (W1): the private clubs (visibility 'private') with who may read them, cached 30 s — the note packer asks
	// for every club note it packs, so this is one small map, not a query per note. updateSettings() drops it.
	private privateClubsCache: { at: number; map: Map<string, { ownerId: string | null; adminIds: string[]; accessToken: string | null }> } | null = null;

	@bindThis
	public async privateClubs(): Promise<Map<string, { ownerId: string | null; adminIds: string[]; accessToken: string | null }>> {
		if (this.privateClubsCache && Date.now() - this.privateClubsCache.at < 30_000) return this.privateClubsCache.map;
		const rows = await this.db.query(`SELECT s."channelId", s."adminIds", s."accessToken", c."userId" FROM "club_setting" s JOIN "channel" c ON c."id" = s."channelId" WHERE s."visibility" = 'private'`) as { channelId: string; adminIds: string[] | null; accessToken: string | null; userId: string | null }[];
		const map = new Map(rows.map(r => [r.channelId, { ownerId: r.userId, adminIds: r.adminIds ?? [], accessToken: r.accessToken }]));
		this.privateClubsCache = { at: Date.now(), map };
		return map;
	}

	/** CLUB-PRIVATE-V1 (batch-1 review fix): THE write gate for a club's content — posting or commenting into a PRIVATE
	 *  club is for its owner, its admins and its members only (an invite-link holder or an invited player may read, not
	 *  write). A public club (or a channel with no club row) is open as before. */
	@bindThis
	public async mayPostInClub(channelId: string, userId: string): Promise<boolean> {
		const p = (await this.privateClubs()).get(channelId);
		if (!p) return true;
		if (p.ownerId === userId || p.adminIds.includes(userId)) return true;
		return await this.isMember(channelId, userId);
	}

	/** CLUB-PRIVATE-V1 (W1): THE read gate for a club's content (posts, comments, members-only reads). A public club (or a
	 *  channel with no club row) is readable by anyone; a private one by its owner, its admins, its members, and whoever holds
	 *  the club's invite-link token (Reclub ?at=). Used by the note packer (every note door), isVisibleForMe, channels/timeline and
	 *  the renote check in notes/create; WRITING uses mayPostInClub.
	 *  Membership is asked of isMember() only — never channel_following directly — so a new member model applies here as is. */
	@bindThis
	public async mayReadClub(channelId: string, userId: string | null | undefined, accessToken?: string | null): Promise<boolean> {
		const p = (await this.privateClubs()).get(channelId);
		if (!p) return true;
		if (accessToken && p.accessToken && accessToken === p.accessToken) return true;
		if (!userId) return false;
		if (p.ownerId === userId || p.adminIds.includes(userId)) return true;
		if (await this.isMember(channelId, userId)) return true; // the ONE member definition (the club-tiers lane owns it)
		return (await this.myInvitation(channelId, userId)) === 'pending'; // CLUB-INVITE-V1: an invited player reads the club to decide
	}

	/** INVITE-ACCESS-V1 (2026-09-21): does THIS invite-link token open THIS club? The token half of mayReadClub, asked
	 *  on its own, so a door that has already let a token holder in can tell the PACKER "this caller proved access"
	 *  instead of the packer re-deriving it or the door re-deriving counts. It never widens mayReadClub: a public club
	 *  (or a channel with no club row) has no token here, answers false, and the packer falls back to membership. */
	@bindThis
	public async clubTokenGrants(channelId: string, accessToken: string | null | undefined): Promise<boolean> {
		if (!accessToken) return false;
		const p = (await this.privateClubs()).get(channelId);
		return !!p && !!p.accessToken && p.accessToken === accessToken;
	}

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

	/** CLUB-TIERS-V1: a member = a club_member row, or the club's owner. (Was: any follower.) */
	@bindThis
	public async isMember(channelId: string, userId: string): Promise<boolean> {
		const r = await this.db.query(`SELECT 1 FROM "club_member" WHERE "channelId" = $1 AND "userId" = $2
			UNION ALL SELECT 1 FROM "channel" WHERE "id" = $1 AND "userId" = $2 LIMIT 1`, [channelId, userId]) as unknown[];
		return r.length > 0;
	}

	/** CLUB-TIERS-V1: the follow — Misskey's own channel_following, read as is. */
	@bindThis
	public async isFollowing(channelId: string, userId: string): Promise<boolean> {
		return await this.channelFollowingsRepository.exists({ where: { followeeId: channelId, followerId: userId } });
	}

	// ------------------------------------------------------------------------------------- CLUB-TIERS-V1: the two tiers
	/** Seat a member (the ONE door every gate goes through: open, approval, invite, the ?at= link, a claim). Idempotent.
	 *  Joining also follows (a member is a follower), closes the person's pending join request, and records whether they
	 *  followed before (the insights' follower → member conversion). Their notification mutes are untouched. */
	@bindThis
	public async addMember(channel: MiChannel, user: MiUser, via: 'open' | 'approval' | 'invite' | 'link' | 'owner' | 'claim', invitedById: string | null = null): Promise<void> {
		const wasFollower = await this.isFollowing(channel.id, user.id);
		await this.db.query(`INSERT INTO "club_member" ("id", "channelId", "userId", "via", "fromFollower", "invitedById") VALUES ($1, $2, $3, $4, $5, $6)
			ON CONFLICT ("channelId", "userId") DO NOTHING`, [this.idService.gen(), channel.id, user.id, via, wasFollower, invitedById]);
		if (!wasFollower) await this.channelFollowingService.follow(user as MiLocalUser, channel).catch((e: unknown) => { if (!(e instanceof IdentifiableError)) throw e; /* already following */ });
		if (via !== 'approval') await this.clubJoinRequestsRepository.delete({ channelId: channel.id, userId: user.id, status: 'pending' });
	}

	/** Un-seat a member: the row, their admin role and tags, their seat in the club chat; `unfollow` also drops the follow
	 *  (always for a private club — nobody follows a private club from outside). The owner is never removed here. */
	@bindThis
	public async removeMember(channel: MiChannel, userId: string, opts: { unfollow: boolean }): Promise<void> {
		if (channel.userId === userId) throw this.err('owner_cannot_leave', 'The owner cannot leave the club.');
		const s = await this.settings(channel.id);
		await this.db.query(`DELETE FROM "club_member" WHERE "channelId" = $1 AND "userId" = $2`, [channel.id, userId]);
		const tags = s.tags.map(t => { const m = { ...t.members }; delete m[userId]; return { ...t, members: m }; });
		await this.clubSettingsRepository.update(channel.id, { adminIds: s.adminIds.filter(x => x !== userId), tags, memberTags: this.deriveMemberTags(tags), updatedAt: new Date() });
		if (s.chatRoomId) await this.chatService.leaveRoom(userId, s.chatRoomId).catch(() => undefined);
		if (opts.unfollow || s.visibility === 'private') {
			await this.clubMemberStatesRepository.delete({ channelId: channel.id, userId });
			const u = await this.usersRepository.findOneBy({ id: userId });
			if (u) await this.channelFollowingService.unfollow(u as MiLocalUser, channel);
		}
	}

	/** channels/follow (native) for a club: any public club, whatever its gate — the follow gives no member rights. A
	 *  private club cannot be followed from outside (Reclub groups:privateTip "No one can see, request to join, or follow
	 *  a private club, unless invited by admin"). The endpoint then runs the native follow unchanged. */
	@bindThis
	public async assertMayFollow(channel: MiChannel, user: MiUser): Promise<void> {
		const s = await this.settings(channel.id);
		if (s.visibility !== 'private') return;
		if (await this.isMember(channel.id, user.id) || await this.isAdmin(channel, user.id)) return;
		if (await this.myInvitation(channel.id, user.id)) return;   // CLUB-TIERS-V1 × CLUB-INVITE-V1: "unless invited by admin"
		throw this.err('private_club', 'This club is private — only its members can follow it.');
	}

	/** channels/unfollow (native) for a club: a member who unfollows leaves (a member is always a follower); anyone else
	 *  just stops following. Returns true when the membership was ended here (the native unfollow already ran). */
	@bindThis
	public async unfollowMeansLeave(channel: MiChannel, user: MiUser): Promise<boolean> {
		if (channel.userId === user.id) return false;
		const member = (await this.db.query(`SELECT 1 FROM "club_member" WHERE "channelId" = $1 AND "userId" = $2`, [channel.id, user.id]) as unknown[]).length > 0;
		if (!member) return false;
		await this.removeMember(channel, user.id, { unfollow: true });
		return true;
	}

	/** Leave the club (Reclub groups:title_leave_group). keepFollowing: stay a follower of a public club. */
	@bindThis
	public async leave(channel: MiChannel, user: MiUser, keepFollowing = false): Promise<{ member: false; following: boolean }> {
		if (channel.userId === user.id) throw this.err('owner_cannot_leave', 'The owner cannot leave the club.');
		if (!(await this.isMember(channel.id, user.id))) throw this.err('not_member', 'You are not a member of this club.');
		await this.removeMember(channel, user.id, { unfollow: !keepFollowing });
		return { member: false, following: await this.isFollowing(channel.id, user.id) };
	}

	/** Reclub common:cancel_request — the player withdraws a pending join request (the follow stays). */
	@bindThis
	public async cancelRequest(channel: MiChannel, user: MiUser): Promise<{ status: 'cancelled' }> {
		const r = await this.clubJoinRequestsRepository.findOneBy({ channelId: channel.id, userId: user.id, status: 'pending' });
		if (!r) throw this.err('no_such_request', 'No pending request to this club.');
		await this.clubJoinRequestsRepository.delete(r.id);
		return { status: 'cancelled' };
	}

	/** Reclub ClubFollower list (5769): the follower tier only (members are in the member list). Admins only. */
	@bindThis
	public async followers(channel: MiChannel, viewer: MiUser, opts: { limit?: number; offset?: number } = {}) {
		await this.assertAdmin(channel, viewer.id);
		// review-batch2 #9: the WHOLE follower list used to be read and sliced in JS, one pack() per row. Paged in SQL,
		// counted in SQL, packed in ONE call - a club with many followers no longer costs a query per follower.
		const limit = Math.max(1, Math.min(200, opts.limit ?? 100));
		const offset = Math.max(0, opts.offset ?? 0);
		const where = `f."followeeId" = $1 AND f."followerId" IS DISTINCT FROM $2
			AND NOT EXISTS (SELECT 1 FROM "club_member" m WHERE m."channelId" = f."followeeId" AND m."userId" = f."followerId")`;
		const total = Number((await this.db.query(`SELECT count(*)::int AS n FROM "channel_following" f WHERE ${where}`, [channel.id, channel.userId]) as { n: number }[])[0]?.n ?? 0);
		const rows = await this.db.query(`SELECT f."id", f."followerId" AS "userId" FROM "channel_following" f
			WHERE ${where} ORDER BY f."id" DESC LIMIT $3 OFFSET $4`, [channel.id, channel.userId, limit, offset]) as { id: string; userId: string }[];
		const packed = new Map<string, unknown>();
		if (rows.length) for (const u of await this.userEntityService.packMany(rows.map(r => r.userId), viewer, { schema: 'UserLite' })) packed.set(u.id, u);
		return { total, followers: rows.map(r => ({ userId: r.userId, followedAt: this.idService.parse(r.id).date.toISOString(), user: packed.get(r.userId) ?? null })) };
	}

	/** Reclub groups:remove_from_club on a follower: the admins end someone's follow of their club. */
	@bindThis
	public async removeFollower(channel: MiChannel, by: MiUser, userId: string): Promise<void> {
		await this.assertAdmin(channel, by.id);
		if (await this.isMember(channel.id, userId)) throw this.err('is_member', 'This player is a member — remove them from the member list.');
		const u = await this.usersRepository.findOneBy({ id: userId });
		if (u) await this.channelFollowingService.unfollow(u as MiLocalUser, channel);
	}

	/** Members and followers of one club (club-tiers.ts, the same numbers every surface prints). */
	@bindThis
	public async counts(channelId: string): Promise<{ members: number; followers: number }> {
		return (await clubCounts(this.db, [channelId])).get(channelId) ?? { members: 0, followers: 0 };
	}

	/** Reclub meets:no_club_note — "you must be an admin of the club or the club allows members to create meets". */
	@bindThis
	public async canCreateMeet(channel: MiChannel, userId: string): Promise<boolean> {
		if (await this.isAdmin(channel, userId)) return true;
		const s = await this.settings(channel.id);
		return s.createMeetPermission === 'members' && await this.isMember(channel.id, userId);
	}

	/** Reclub club forum: admins post (announcements), members post when the forum is on; followers read. */
	@bindThis
	public async canPost(channel: MiChannel, userId: string): Promise<boolean> {
		if (await this.isAdmin(channel, userId)) return true;
		const s = await this.settings(channel.id);
		return s.enableForum !== false && await this.isMember(channel.id, userId);
	}

	/** "Tell me about new meets" for one club (notification_mute scope 'clubMeets'); the person's row, whatever the tier. */
	@bindThis
	public async setMeetsMuted(channel: MiChannel, user: MiUser, muted: boolean): Promise<void> {
		if (!(await this.isFollowing(channel.id, user.id)) && !(await this.isMember(channel.id, user.id))) throw this.err('not_following', 'Follow the club first.');
		if (muted) await this.db.query(`INSERT INTO "notification_mute" ("id", "userId", "scope", "targetId") VALUES ($1, $2, 'clubMeets', $3) ON CONFLICT DO NOTHING`, [this.idService.gen(), user.id, channel.id]);
		else await this.db.query(`DELETE FROM "notification_mute" WHERE "userId" = $1 AND "scope" = 'clubMeets' AND "targetId" = $2`, [user.id, channel.id]);
	}

	@bindThis
	public async meetsMuted(channelId: string, userId: string): Promise<boolean> {
		return (await this.db.query(`SELECT 1 FROM "notification_mute" WHERE "userId" = $1 AND "scope" = 'clubMeets' AND "targetId" = $2 LIMIT 1`, [userId, channelId]) as unknown[]).length > 0;
	}

	/** Of these users, the ones who turned club notifications off — every club (settings toggle, scope 'club') or this
	 *  club's meets (scope 'clubMeets'). CHAT-V2's mute table; nothing new. */
	private async mutedForClub(channelId: string, userIds: string[]): Promise<Set<string>> {
		if (!userIds.length) return new Set();
		const rows = await this.db.query(`SELECT DISTINCT "userId" FROM "notification_mute" WHERE "userId" = ANY($1)
			AND (("scope" = 'club' AND "targetId" = '') OR ("scope" = 'clubMeets' AND "targetId" = $2))`, [userIds, channelId]) as { userId: string }[];
		return new Set(rows.map(r => r.userId));
	}

	/** A new club meet is announced (Reclub "Members of your club will automatically be invited and notified", and the
	 *  follow's point: hearing about the club's public meets). Public meet → active members + followers; members-only
	 *  meet → active members. Never the creator; honours the meet's "Send notifications" switch, members on a break,
	 *  and the person's club mutes. `skipMembers`: the members were already invited (a schedule's auto-invite). */
	@bindThis
	public async notifyNewMeet(meet: { id: string; name: string; channelId: string | null; visibility: string; hostId: string; startAt: Date; timezone?: string | null; sendNotifications?: boolean }, opts: { skipMembers?: boolean } = {}): Promise<number> {
		if (!meet.channelId || meet.sendNotifications === false) return 0;
		const channel = await this.channelsRepository.findOneBy({ id: meet.channelId });
		if (!channel || channel.isArchived) return 0;
		const to = new Set<string>(opts.skipMembers ? [] : await this.activeMemberIds(channel));
		if (meet.visibility === 'public') {
			const f = await this.db.query(`SELECT f."followerId" AS "userId" FROM "channel_following" f WHERE f."followeeId" = $1
				AND NOT EXISTS (SELECT 1 FROM "club_member" m WHERE m."channelId" = f."followeeId" AND m."userId" = f."followerId")`, [channel.id]) as { userId: string }[];
			for (const r of f) to.add(r.userId);
		}
		to.delete(meet.hostId);
		const muted = await this.mutedForClub(channel.id, Array.from(to));
		let when = '';
		try { when = new Date(meet.startAt).toLocaleString('en-GB', { timeZone: meet.timezone || 'Asia/Hong_Kong', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch { /* bad tz */ }
		let n = 0;
		for (const uid of to) {
			if (muted.has(uid)) continue;
			this.notificationService.createNotification(uid, 'app', { customHeader: `New meet · ${channel.name}`, customBody: when ? `${meet.name} · ${when}` : meet.name, customIcon: null, appAccessTokenId: null, customLink: 'meet:' + meet.id });
			n++;
		}
		return n;
	}

	/** Owner / admins may change these; the channel's own name/description/banner go through channels/update. */
	@bindThis
	public async updateSettings(channel: MiChannel, by: MiUser, patch: Partial<Pick<MiClubSetting, 'visibility' | 'gateType' | 'createMeetPermission' | 'sport' | 'level' | 'venueIds' | 'paymentInfo' | 'enableForum' | 'enableChat' | 'awards'>>): Promise<MiClubSetting> {
		await this.assertAdmin(channel, by.id);
		const s = await this.settings(channel.id);
		await this.clubSettingsRepository.update(s.channelId, { ...patch, updatedAt: new Date() });
		this.privateClubsCache = null; // CLUB-PRIVATE-V1: visibility / admins may have changed
		return await this.clubSettingsRepository.findOneByOrFail({ channelId: channel.id });
	}

	// ------------------------------------------------------------------------------------- members
	/** Members (club_member, CLUB-TIERS-V1 — followers are not members), with role (owner / admin / member), tags,
	 *  joinedAt. Members and admins may look (Reclub's group member list is visible to members); the tags column is the
	 *  admins' — a member sees []. */
	@bindThis
	public async members(channel: MiChannel, viewer: MiUser, opts: { limit?: number; offset?: number; query?: string } = {}) {
		const admin = await this.isAdmin(channel, viewer.id);
		if (!admin && !(await this.isMember(channel.id, viewer.id))) throw this.err('not_member', 'Only members can see the member list.');
		const s = await this.settings(channel.id);
		const rows = (await this.db.query(`SELECT "id", "userId" AS "followerId" FROM "club_member" WHERE "channelId" = $1 ORDER BY "id" ASC`, [channel.id])) as { id: string; followerId: string }[];
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
		// CLUB-TIERS-V1: removal is the one removeMember door (row, role, tags, chat seat, follow)
		if (patch.remove) { await this.removeMember(channel, userId, { unfollow: true }); return; }
		await this.clubSettingsRepository.update(channel.id, upd);
		this.privateClubsCache = null; // CLUB-PRIVATE-V1: the admins may have changed
	}

	// ------------------------------------------------------------------------------------- joining
	/** Reclub GroupGateType: open → member now; approval → a request the admins decide; invite → refused.
	 *  CLUB-GATE-V1 (W1) → CLUB-TIERS-V1 (INT-BATCH2): the ONE membership door is clubs/join; the stock channels/follow no
	 *  longer lands here (it is a follow again, ungated) and nothing else may insert club_member. decide() seats an approved
	 *  request. Seating goes through addMember (member + follower); a request to a public club also follows it, so the player
	 *  sees the club's public meets while the admins decide (and stays a follower if declined). */
	@bindThis
	public async join(channel: MiChannel, user: MiLocalUser, message: string | null, accessToken: string | null = null): Promise<{ status: 'member' | 'requested' }> {
		const s = await this.settings(channel.id);
		if (await this.isMember(channel.id, user.id)) return { status: 'member' };
		// CLUB-GATE-V1: the club's owner and admins are never gated (the stock follow door let them in; keep it so)
		if (channel.userId === user.id || s.adminIds.includes(user.id)) { await this.channelFollowingService.follow(user, channel); return { status: 'member' }; }
		// INT-BATCH1 (CLUB-GATE x CLUB-INVITE): a player an admin invited (clubs/invitations/create) who taps Join / follows is
		// accepting that invitation — seated in any gate, the invitation closed, the inviter told (respondInvitation)
		if ((await this.myInvitation(channel.id, user.id)) === 'pending') { await this.respondInvitation(channel, user, true); return { status: 'member' }; }
		// CLUB-V3: the invite link's ?at= token is the admins' invitation — it seats the person in any gate
		if (accessToken && s.accessToken && accessToken === s.accessToken) { await this.addMember(channel, user, 'link'); return { status: 'member' }; }
		if (s.gateType === 'open') { await this.addMember(channel, user, 'open'); return { status: 'member' }; }
		if (s.gateType === 'invite') throw this.err('invite_only', 'This club is invite-only.');
		if (s.visibility === 'public' && !(await this.isFollowing(channel.id, user.id))) await this.channelFollowingService.follow(user, channel).catch((e: unknown) => { if (!(e instanceof IdentifiableError)) throw e; });
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
		if (approve) { const u = await this.usersRepository.findOneBy({ id: r.userId }); if (u) await this.addMember(channel, u, 'approval'); }   // CLUB-TIERS-V1
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
		// CLUB-TIERS-V1: members (club_member + the owner) and followers (the follower tier only) are separate numbers
		// (Reclub groups:total_members / groups:total_followers); conversion = followers who joined in the timeframe
		const { members: totalMembers, followers: totalFollowers } = await this.counts(channel.id);
		const joined = (await this.db.query(`SELECT "id", "fromFollower" FROM "club_member" WHERE "channelId" = $1 AND "via" NOT IN ('owner', 'migration')`, [channel.id]) as { id: string; fromFollower: boolean }[])
			.filter(r => { const t = this.idService.parse(r.id).date; return t >= from && t < to; });
		const followed = (await this.db.query(`SELECT "id" FROM "channel_following" WHERE "followeeId" = $1`, [channel.id]) as { id: string }[])
			.filter(r => { const t = this.idService.parse(r.id).date; return t >= from && t < to; }).length;
		const fromFollowers = joined.filter(r => r.fromFollower).length;
		const conversion = { newFollowers: followed, newMembers: joined.length, newMembersFromFollowers: fromFollowers, followerToMemberPct: fromFollowers + totalFollowers > 0 ? Math.round(100 * fromFollowers / (fromFollowers + totalFollowers)) : 0 };
		const acts = await this.db.query(`SELECT m."id", m."capacity", m."confirmed", m."startAt" FROM "meet" m WHERE m."channelId" = $1 AND m."status" <> 'cancelled' AND m."startAt" >= $2 AND m."startAt" < $3`, [channel.id, from, to]) as { id: string; capacity: number; confirmed: number; startAt: Date }[];
		const totalActivities = acts.length;
		const fillRate = acts.length ? Math.round(100 * acts.reduce((n, a) => n + Math.min(1, (a.confirmed ?? 0) / Math.max(1, a.capacity ?? 1)), 0) / acts.length) : 0;
		const active = acts.length ? await this.db.query(`SELECT p."userId", count(*)::int AS n FROM "meet_participant" p WHERE p."meetId" = ANY($1) AND p."status" = 'confirmed' AND p."userId" IS NOT NULL GROUP BY p."userId" ORDER BY n DESC`, [acts.map(a => a.id)]) as { userId: string; n: number }[] : [];
		const rewarded = acts.length ? await this.db.query(`SELECT r."targetUserId" AS "userId", count(*)::int AS n FROM "meet_review" r WHERE r."meetId" = ANY($1) AND r."type" = 'endorsement' AND r."archivedAt" IS NULL GROUP BY r."targetUserId" ORDER BY n DESC LIMIT 5`, [acts.map(a => a.id)]) as { userId: string; n: number }[] : [];
		const pack = async (rows: { userId: string; n: number }[]) => { const out = []; for (const r of rows.slice(0, 5)) out.push({ user: await this.userEntityService.pack(r.userId, viewer, { schema: 'UserLite' }).catch(() => null), count: r.n }); return out; };
		return { timeframe, totalMembers, totalFollowers, conversion, totalActivities, activeMembers: active.length, fillRate, mostActive: await pack(active), mostRewarded: await pack(rewarded) };
	}

	// ---- invitations (CLUB-INVITE-V1)
	/** Reclub "Invite to a club": an admin invites one player; the player sees "You have been invited to this club"
	 *  with Accept / Decline. Rows live in club_invitation (raw SQL, no entity); one pending row per club+player.
	 *  A pending join request by the same player is kept — accepting the invitation closes it. */
	@bindThis
	public async invite(channel: MiChannel, by: MiUser, userId: string): Promise<{ status: 'invited' }> {
		await this.assertAdmin(channel, by.id);
		const target = await this.usersRepository.findOneBy({ id: userId });
		if (!target || target.host != null) throw this.err('no_such_user', 'No such user.');
		if (channel.userId === userId || await this.isMember(channel.id, userId)) throw this.err('already_member', 'This player is already a member of the club.');
		const blocked = await this.db.query(`SELECT 1 FROM "blocking" WHERE ("blockerId" = $1 AND "blockeeId" = $2) OR ("blockerId" = $2 AND "blockeeId" = $1) LIMIT 1`, [by.id, userId]) as unknown[];
		if (blocked.length) throw this.err('blocked', 'You cannot invite this player.');
		// already invited → no second row, no second notification
		if (await this.myInvitation(channel.id, userId)) return { status: 'invited' };
		await this.db.query(`INSERT INTO "club_invitation" ("id", "channelId", "userId", "invitedById") VALUES ($1, $2, $3, $4)
			ON CONFLICT ("channelId", "userId") WHERE "status" = 'pending' DO NOTHING`, [this.idService.gen(), channel.id, userId, by.id]);
		this.notify(userId, 'Club invitation', `${by.name ?? by.username} invited you to join ${channel.name}.`, channel.id);
		return { status: 'invited' };
	}

	/** The invitee's answer. Accept seats the player in ANY gate (like the ?at= link token in join()) and closes their
	 *  pending join request; decline just records it. */
	@bindThis
	public async respondInvitation(channel: MiChannel, user: MiLocalUser, accept: boolean): Promise<{ status: 'member' | 'declined' }> {
		const inv = (await this.db.query(`SELECT "id", "invitedById" FROM "club_invitation" WHERE "channelId" = $1 AND "userId" = $2 AND "status" = 'pending' LIMIT 1`, [channel.id, user.id]) as { id: string; invitedById: string }[])[0];
		if (!inv) throw this.err('no_such_invitation', 'No pending invitation to this club.');
		if (!accept) {
			await this.db.query(`UPDATE "club_invitation" SET "status" = 'declined', "decidedAt" = now() WHERE "id" = $1 AND "status" = 'pending'`, [inv.id]);
			return { status: 'declined' };
		}
		// CLUB-TIERS-V1: the invitation seats through the one member door (member + follower, via 'invite')
		if (channel.userId !== user.id && !(await this.isMember(channel.id, user.id))) await this.addMember(channel, user, 'invite', inv.invitedById);
		await this.db.query(`UPDATE "club_invitation" SET "status" = 'accepted', "decidedAt" = now() WHERE "id" = $1 AND "status" = 'pending'`, [inv.id]);
		await this.clubJoinRequestsRepository.delete({ channelId: channel.id, userId: user.id, status: 'pending' });
		this.notify(inv.invitedById, 'Invitation accepted', `${user.name ?? user.username} accepted your invitation to ${channel.name}.`, channel.id);
		return { status: 'member' };
	}

	/** Admins: the club's pending invitations, newest first. */
	@bindThis
	public async invitations(channel: MiChannel, viewer: MiUser) {
		await this.assertAdmin(channel, viewer.id);
		const rows = await this.db.query(`SELECT "id", "userId", "invitedById", "createdAt" FROM "club_invitation" WHERE "channelId" = $1 AND "status" = 'pending' ORDER BY "createdAt" DESC LIMIT 200`, [channel.id]) as { id: string; userId: string; invitedById: string; createdAt: Date }[];
		const out = [];
		for (const r of rows) out.push({ id: r.id, userId: r.userId, invitedById: r.invitedById, createdAt: new Date(r.createdAt).toISOString(), user: await this.userEntityService.pack(r.userId, viewer, { schema: 'UserLite' }).catch(() => null) });
		return out;
	}

	/** Admins: withdraw a pending invitation. */
	@bindThis
	public async cancelInvitation(channel: MiChannel, by: MiUser, userId: string): Promise<{ status: 'cancelled' }> {
		await this.assertAdmin(channel, by.id);
		if (!(await this.myInvitation(channel.id, userId))) throw this.err('no_such_invitation', 'No pending invitation for this player.');
		await this.db.query(`UPDATE "club_invitation" SET "status" = 'cancelled', "decidedAt" = now() WHERE "channelId" = $1 AND "userId" = $2 AND "status" = 'pending'`, [channel.id, userId]);
		return { status: 'cancelled' };
	}

	/** A player's page "Invite to a club": the clubs the viewer owns or admins (not archived, max 50), each with that
	 *  player's status there — member > invited > requested > declined (latest invitation) > none. */
	@bindThis
	public async invitationStatusFor(viewer: MiUser, userId: string): Promise<{ channelId: string; name: string; status: 'member' | 'invited' | 'requested' | 'declined' | 'none' }[]> {
		const clubs = await this.db.query(`SELECT c."id", c."name", c."userId" FROM "channel" c LEFT JOIN "club_setting" s ON s."channelId" = c."id"
			WHERE c."isArchived" = false AND (c."userId" = $1 OR $1 = ANY(s."adminIds")) ORDER BY c."id" DESC LIMIT 50`, [viewer.id]) as { id: string; name: string; userId: string | null }[];
		if (!clubs.length) return [];
		const ids = clubs.map(c => c.id);
		// CLUB-TIERS-V1: 'member' is club_member (a follower is not a member — the admin can invite them)
		const follows = new Set((await this.db.query(`SELECT "channelId" AS "followeeId" FROM "club_member" WHERE "userId" = $1 AND "channelId" = ANY($2)`, [userId, ids]) as { followeeId: string }[]).map(r => r.followeeId));
		const invs = await this.db.query(`SELECT DISTINCT ON ("channelId") "channelId", "status" FROM "club_invitation" WHERE "userId" = $1 AND "channelId" = ANY($2) ORDER BY "channelId", "createdAt" DESC`, [userId, ids]) as { channelId: string; status: string }[];
		const latestInv = new Map(invs.map(r => [r.channelId, r.status]));
		const requested = new Set((await this.clubJoinRequestsRepository.find({ where: { userId, channelId: In(ids), status: 'pending' }, select: { channelId: true } })).map(r => r.channelId));
		return clubs.map(c => ({
			channelId: c.id,
			name: c.name,
			status: c.userId === userId || follows.has(c.id) ? 'member' as const
				: latestInv.get(c.id) === 'pending' ? 'invited' as const
				: requested.has(c.id) ? 'requested' as const
				: latestInv.get(c.id) === 'declined' ? 'declined' as const
				: 'none' as const,
		}));
	}

	/** My pending invitation to a club (the club page shows Accept / Decline). */
	@bindThis
	public async myInvitation(channelId: string, userId: string): Promise<'pending' | null> {
		const r = await this.db.query(`SELECT 1 FROM "club_invitation" WHERE "channelId" = $1 AND "userId" = $2 AND "status" = 'pending' LIMIT 1`, [channelId, userId]) as unknown[];
		return r.length ? 'pending' : null;
	}

	// ------------------------------------------------------------------------------------- ownership
	/** Reclub claim-club-ownership: a mirrored / orphaned club (no owner) is claimed by a member and verified by staff.
	 *  CLUB-CLAIM-VERIFY-V1 (2026-09-19): the claim is a REQUEST (club_claim, status 'pending'); only GripBat staff's
	 *  claimsDecide sets the owner. Before this, any member became owner instantly (17 ownerless clubs on live).
	 *  V1.1 (W1 review-w0): staff are told a claim arrived (in-app notification to every holder of the GripBat staff role
	 *  that adapter/sso gives the tenant's admins — a plain role, not a Misskey moderator); a person whose claim was declined waits CLAIM_COOLDOWN_DAYS. */
	@bindThis
	public async claim(channel: MiChannel, user: MiUser): Promise<{ status: 'pending' }> {
		if (channel.userId) throw this.err('has_owner', 'This club already has an owner.');
		if (!(await this.isMember(channel.id, user.id))) throw this.err('not_member', 'Join the club first.');
		const recent = await this.db.query(`SELECT "decidedAt" FROM "club_claim" WHERE "channelId" = $1 AND "userId" = $2 AND "status" = 'rejected' AND "decidedAt" > now() - make_interval(days => $3) ORDER BY "decidedAt" DESC LIMIT 1`, [channel.id, user.id, CLAIM_COOLDOWN_DAYS]) as { decidedAt: Date }[];
		if (recent.length) throw this.err('claim_cooldown', `Your last claim on this club was declined. You can claim it again after ${new Date(new Date(recent[0].decidedAt).getTime() + CLAIM_COOLDOWN_DAYS * 86_400_000).toISOString().slice(0, 10)}.`);
		const inserted = await this.db.query(`INSERT INTO "club_claim" ("id", "channelId", "userId") VALUES ($1, $2, $3)
			ON CONFLICT ("channelId", "userId") WHERE "status" = 'pending' DO NOTHING RETURNING "id"`, [this.idService.gen(), channel.id, user.id]) as { id: string }[];
		if (inserted.length) {
			// staff hear about a NEW claim once (a repeated tap on a pending claim inserts nothing and notifies nobody)
			for (const staffId of await gripbatStaffIds(this.db)) { // STAFF-ROLE-V1: holders of the GripBat staff role only
				if (staffId !== user.id) this.notify(staffId, 'Club ownership claim', `${user.name ?? user.username} asked to become the owner of ${channel.name}.`, channel.id);
			}
		}
		return { status: 'pending' };
	}

	/** CLUB-CLAIM-VERIFY-V1: my latest claim on a club (the club page shows "request sent" instead of the button). */
	@bindThis
	public async myClaim(channelId: string, userId: string): Promise<{ status: string; createdAt: Date } | null> {
		const r = await this.db.query(`SELECT "status", "createdAt" FROM "club_claim" WHERE "channelId" = $1 AND "userId" = $2 ORDER BY "createdAt" DESC LIMIT 1`, [channelId, userId]) as { status: string; createdAt: Date }[];
		return r[0] ?? null;
	}

	/** CLUB-CLAIM-VERIFY-V1: staff queue — pending claims, oldest first, with the club and the claimant. */
	@bindThis
	public async claimsList(viewer: MiUser, limit = 50) {
		if (!(await isGripbatStaff(this.db, viewer.id))) throw this.err('not_staff', 'Only GripBat staff can do this.'); // STAFF-ROLE-V1
		const rows = await this.db.query(`SELECT k."id", k."channelId", k."userId", k."createdAt", c."name" AS "clubName", c."userId" AS "ownerId"
			FROM "club_claim" k JOIN "channel" c ON c."id" = k."channelId" WHERE k."status" = 'pending' ORDER BY k."createdAt" ASC LIMIT $1`, [limit]) as { id: string; channelId: string; userId: string; createdAt: Date; clubName: string; ownerId: string | null }[];
		const out = [];
		for (const r of rows) out.push({ id: r.id, channelId: r.channelId, clubName: r.clubName, hasOwner: !!r.ownerId, createdAt: r.createdAt, user: await this.userEntityService.pack(r.userId, viewer, { schema: 'UserLite' }).catch(() => null) });
		return out;
	}

	/** CLUB-CLAIM-VERIFY-V1: staff decision. Approve sets the owner (only while the club is still ownerless) and closes
	 *  the club's other pending claims; reject closes just this one.
	 *  V1.1 (W1 review-w0): locks in ONE order — the channel row first, then its claims by id — so two staff deciding two
	 *  claims on one club cannot deadlock; approval re-checks the claimant is still a member with a live account; the
	 *  claimant (and anyone whose claim was closed by the approval) is told the outcome after commit. */
	@bindThis
	public async claimsDecide(claimId: string, approve: boolean, staff: MiUser): Promise<{ status: string }> {
		if (!(await isGripbatStaff(this.db, staff.id))) throw this.err('not_staff', 'Only GripBat staff can do this.'); // STAFF-ROLE-V1
		const head = (await this.db.query(`SELECT "channelId" FROM "club_claim" WHERE "id" = $1`, [claimId]))[0] as { channelId: string } | undefined;
		if (!head) throw this.err('no_such_claim', 'No such claim.');
		const out = await this.db.transaction(async (m) => {
			const c = (await m.query(`SELECT "userId", "name" FROM "channel" WHERE "id" = $1 FOR UPDATE`, [head.channelId]))[0] as { userId: string | null; name: string } | undefined;
			if (!c) throw this.err('no_such_club', 'No such club.');
			const claims = await m.query(`SELECT "id", "userId", "status" FROM "club_claim" WHERE "channelId" = $1 AND ("status" = 'pending' OR "id" = $2) ORDER BY "id" FOR UPDATE`, [head.channelId, claimId]) as { id: string; userId: string; status: string }[];
			const k = claims.find(x => x.id === claimId);
			if (!k) throw this.err('no_such_claim', 'No such claim.');
			if (k.status !== 'pending') throw this.err('claim_decided', 'This claim was already decided.');
			if (!approve) {
				await m.query(`UPDATE "club_claim" SET "status" = 'rejected', "decidedAt" = now(), "decidedById" = $2 WHERE "id" = $1`, [k.id, staff.id]);
				return { status: 'rejected', club: c.name, told: [{ userId: k.userId, approved: false }] };
			}
			if (c.userId) throw this.err('has_owner', 'This club already has an owner.');
			const account = (await m.query(`SELECT 1 FROM "user" u WHERE u."id" = $1 AND u."isSuspended" = false AND u."isDeleted" = false`, [k.userId]) as unknown[]).length > 0;
			const live = account && await this.isMember(head.channelId, k.userId); // isMember: the one member definition
			if (!live) throw this.err('not_member', 'The claimant is no longer a member of this club (or their account is suspended). Reject this claim.');
			await m.query(`UPDATE "channel" SET "userId" = $2 WHERE "id" = $1`, [head.channelId, k.userId]);
			await m.query(`UPDATE "club_claim" SET "status" = 'approved', "decidedAt" = now(), "decidedById" = $2 WHERE "id" = $1`, [k.id, staff.id]);
			const others = claims.filter(x => x.id !== k.id && x.status === 'pending');
			if (others.length) await m.query(`UPDATE "club_claim" SET "status" = 'rejected', "decidedAt" = now(), "decidedById" = $2 WHERE "id" = ANY($1)`, [others.map(x => x.id), staff.id]);
			return { status: 'approved', club: c.name, told: [{ userId: k.userId, approved: true }, ...others.map(x => ({ userId: x.userId, approved: false }))] };
		});
		this.privateClubsCache = null; // CLUB-PRIVATE-V1: the owner may have changed
		for (const t of out.told) {
			this.notify(t.userId, t.approved ? 'Club ownership approved' : 'Club ownership claim declined', t.approved ? `You are now the owner of ${out.club}.` : `Your claim to own ${out.club} was declined.`, head.channelId);
		}
		return { status: out.status };
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
			await this.chatService.createRoomInvitation(room.ownerId, room.id, user.id, { notify: false });
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
	/** NUKE-CLUB-PIN-V1: the clubs `userId` has pinned = the channels they have FAVOURITED (native channel_favorite,
	 *  written by channels/favorite / channels/unfavorite). We keep no pin column. */
	@bindThis
	public async pinnedChannelIds(userId: string, channelIds?: string[]): Promise<Set<string>> {
		if (channelIds != null && channelIds.length === 0) return new Set();
		const rows = await this.channelFavoritesRepository.find({
			where: channelIds != null ? { userId, channelId: In(channelIds) } : { userId },
			select: { channelId: true },
		});
		return new Set(rows.map(r => r.channelId));
	}

	@bindThis
	public async myState(channelId: string, userId: string): Promise<MiClubMemberState | null> {
		return await this.clubMemberStatesRepository.findOneBy({ channelId, userId });
	}

	/** Take a break (Reclub PUT /users/<id> {is_active}). Members only.
	 *  NUKE-CLUB-PIN-V1: "Pin to home screen" left here — it is the native channels/favorite. */
	@bindThis
	// INT-BATCH2 × NUKE-CLUB-PIN-V1: CLUB-TIERS-V1 loosened this guard so a FOLLOWER could pin the club to Home.
	// NUKE-CLUB-PIN-V1 then moved pinning off this row entirely onto the native channel favourite, which any signed-in
	// person may set — so the follower case is served natively and this door is a member's "Take a break" only.
	public async updateMyState(channel: MiChannel, user: MiUser, patch: { paused?: boolean | null }): Promise<MiClubMemberState> {
		if (!(await this.isMember(channel.id, user.id)) && !(await this.isAdmin(channel, user.id))) throw this.err('not_member', 'Join the club first.');
		let st = await this.myState(channel.id, user.id);
		if (!st) st = await this.clubMemberStatesRepository.insertOne({ id: this.idService.gen(), channelId: channel.id, userId: user.id, pausedAt: null, adminRoomId: null, updatedAt: new Date() });
		const upd: Partial<MiClubMemberState> = { updatedAt: new Date() };
		if (patch.paused != null) upd.pausedAt = patch.paused ? new Date() : null;
		await this.clubMemberStatesRepository.update(st.id, upd);
		return await this.clubMemberStatesRepository.findOneByOrFail({ id: st.id });
	}

	/** The clubs I am in, each with my state — the Home pinned row reads this. CLUB-TIERS-V1: memberships (club_member)
	 *  by default; tier 'all' adds the clubs I only follow, with role 'follower'. */
	@bindThis
	public async mine(user: MiUser, tier: 'member' | 'all' = 'member'): Promise<{ channel: MiChannel; pinned: boolean; paused: boolean; role: 'owner' | 'admin' | 'member' | 'follower' }[]> {
		const joined = await this.db.query(`SELECT "channelId" FROM "club_member" WHERE "userId" = $1 ORDER BY "id" DESC`, [user.id]) as { channelId: string }[];
		const follows = tier === 'all' ? await this.channelFollowingsRepository.find({ where: { followerId: user.id }, order: { id: 'DESC' } }) : [];
		const owned = await this.channelsRepository.find({ where: { userId: user.id, isArchived: false } });
		const memberIds = new Set([...owned.map(c => c.id), ...joined.map(r => r.channelId)]);
		const ids = Array.from(new Set([...owned.map(c => c.id), ...joined.map(r => r.channelId), ...follows.map(f => f.followeeId)]));
		if (!ids.length) return [];
		const channels = await this.channelsRepository.find({ where: { id: In(ids), isArchived: false } });
		const states = await this.clubMemberStatesRepository.find({ where: { userId: user.id, channelId: In(ids) } });
		const pinned = await this.pinnedChannelIds(user.id, ids); // NUKE-CLUB-PIN-V1: native channel_favorite
		const settings = await this.clubSettingsRepository.find({ where: { channelId: In(ids) } });
		const byId = new Map(channels.map(c => [c.id, c]));
		const out: { channel: MiChannel; pinned: boolean; paused: boolean; role: 'owner' | 'admin' | 'member' | 'follower' }[] = [];
		for (const id of ids) {
			const c = byId.get(id); if (!c) continue;
			const st = states.find(x => x.channelId === id); const s = settings.find(x => x.channelId === id);
			// INT-BATCH2: pinned from the native channel favourite (NUKE-CLUB-PIN-V1), role from the tiers (CLUB-TIERS-V1)
			out.push({ channel: c, pinned: pinned.has(id), paused: !!(st && st.pausedAt), role: c.userId === user.id ? 'owner' : s && s.adminIds.includes(user.id) ? 'admin' : memberIds.has(id) ? 'member' : 'follower' });
		}
		return out.sort((a, b) => Number(b.pinned) - Number(a.pinned));
	}

	/** Member ids to notify / auto-invite: members (club_member, CLUB-TIERS-V1 — not followers) ∪ owner, minus those
	 *  on a break, filtered to the tags when given. */
	@bindThis
	public async activeMemberIds(channel: MiChannel, tagIds: string[] = []): Promise<string[]> {
		const s = await this.settings(channel.id);
		const rows = await this.db.query(`SELECT "userId" FROM "club_member" WHERE "channelId" = $1`, [channel.id]) as { userId: string }[];
		const ids = new Set(rows.map(r => r.userId)); if (channel.userId) ids.add(channel.userId);
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
			// CLUB-TIERS-V1: the settings page's "Club notifications" switch (notification_mute scope 'club') is honoured
			const ids = (await this.activeMemberIds(channel)).filter(uid => uid !== by.id);
			const off = ids.length ? new Set((await this.db.query(`SELECT "userId" FROM "notification_mute" WHERE "userId" = ANY($1) AND "scope" = 'club' AND "targetId" = ''`, [ids]) as { userId: string }[]).map(r => r.userId)) : new Set<string>();
			for (const uid of ids) if (!off.has(uid)) this.notify(uid, `Announcement · ${channel.name}`, text || 'A new announcement was posted.', channel.id);
		}
		return { pinnedNoteIds: ids.slice(0, 10) };
	}

	/** Reclub "Message Admins": one chat room per member with the club's admins (owner + adminIds), minted on first open. */
	@bindThis
	public async adminsRoom(channel: MiChannel, user: MiUser): Promise<{ roomId: string }> {
		// SEC-CLUB-ADMINS-ROOM-V1: only someone attached to the club may open a thread with its admins — a stranger
		// could otherwise create a room owned by the club owner and land in their inbox (control-trace, 2026-09-20).
		if (!(await this.isMember(channel.id, user.id)) && !(await this.isAdmin(channel, user.id))) throw this.err('not_member', 'Only club members can message the admins.');
		const s = await this.settings(channel.id);
		const adminIds = Array.from(new Set([channel.userId, ...s.adminIds].filter((x): x is string => !!x && x !== user.id)));
		if (!adminIds.length) throw this.err('no_admins', 'This club has no admins to message.');
		let st = await this.myState(channel.id, user.id);
		let room = st && st.adminRoomId ? await this.chatService.findRoomById(st.adminRoomId) : null;
		if (!room) {
			const owner = await this.usersRepository.findOneByOrFail({ id: channel.userId ?? adminIds[0] });
			room = await this.chatService.createRoom(owner, { name: `${channel.name} · admins`, description: `${user.name ?? user.username} ↔ the admins of ${channel.name}` });
			if (!st) st = await this.clubMemberStatesRepository.insertOne({ id: this.idService.gen(), channelId: channel.id, userId: user.id, pausedAt: null, adminRoomId: room.id, updatedAt: new Date() });
			else await this.clubMemberStatesRepository.update(st.id, { adminRoomId: room.id, updatedAt: new Date() });
		}
		for (const uid of [user.id, ...adminIds]) {
			if (uid === room.ownerId || await this.chatService.isRoomMember(room, uid)) continue;
			await this.chatService.createRoomInvitation(room.ownerId, room.id, uid, { notify: false });
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

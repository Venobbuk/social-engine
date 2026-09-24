/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import * as Redis from 'ioredis';
import { Brackets, In } from 'typeorm';
import { DI } from '@/di-symbols.js';
import type { Config } from '@/config.js';
import { QueueService } from '@/core/QueueService.js';
import { IdService } from '@/core/IdService.js';
import { GlobalEventService } from '@/core/GlobalEventService.js';
import { UserEntityService } from '@/core/entities/UserEntityService.js';
import { ChatEntityService } from '@/core/entities/ChatEntityService.js';
import { ApRendererService } from '@/core/activitypub/ApRendererService.js';
import { PushNotificationService } from '@/core/PushNotificationService.js';
import { bindThis } from '@/decorators.js';
import type { ChatApprovalsRepository, ChatMessagesRepository, ChatRoomInvitationsRepository, ChatRoomMembershipsRepository, ChatRoomsRepository, MiChatMessage, MiChatRoom, MiChatRoomMembership, MiDriveFile, MiUser, MutingsRepository, NotificationMutesRepository, UsersRepository } from '@/models/_.js';
import type { NotificationMuteScope } from '@/models/NotificationMute.js';
import { UserBlockingService } from '@/core/UserBlockingService.js';
import { QueryService } from '@/core/QueryService.js';
import { RoleService } from '@/core/RoleService.js';
import { UserFollowingService } from '@/core/UserFollowingService.js';
import { MiChatRoomInvitation } from '@/models/ChatRoomInvitation.js';
import { Packed } from '@/misc/json-schema.js';
import { sqlLikeEscape } from '@/misc/sql-like-escape.js';
import { CustomEmojiService } from '@/core/CustomEmojiService.js';
import { emojiRegex } from '@/misc/emoji-regex.js';
import { NotificationService } from '@/core/NotificationService.js';
import { ModerationLogService } from '@/core/ModerationLogService.js';

const MAX_ROOM_MEMBERS = 50;
const MAX_REACTIONS_PER_MESSAGE = 100;
const isCustomEmojiRegexp = /^:([\w+-]+)(?:@\.)?:$/;

// TODO: ReactionServiceのやつと共通化
function normalizeEmojiString(x: string) {
	const match = emojiRegex.exec(x);
	if (match) {
		// 合字を含む1つの絵文字
		const unicode = match[0];

		// 異体字セレクタ除去
		return unicode.match('\u200d') ? unicode : unicode.replace(/\ufe0f/g, '');
	} else {
		throw new Error('invalid emoji');
	}
}

@Injectable()
export class ChatService {
	constructor(
		@Inject(DI.config)
		private config: Config,

		@Inject(DI.redis)
		private redisClient: Redis.Redis,

		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,

		@Inject(DI.chatMessagesRepository)
		private chatMessagesRepository: ChatMessagesRepository,

		@Inject(DI.chatApprovalsRepository)
		private chatApprovalsRepository: ChatApprovalsRepository,

		@Inject(DI.chatRoomsRepository)
		private chatRoomsRepository: ChatRoomsRepository,

		@Inject(DI.chatRoomInvitationsRepository)
		private chatRoomInvitationsRepository: ChatRoomInvitationsRepository,

		@Inject(DI.chatRoomMembershipsRepository)
		private chatRoomMembershipsRepository: ChatRoomMembershipsRepository,

		@Inject(DI.mutingsRepository)
		private mutingsRepository: MutingsRepository,

		@Inject(DI.notificationMutesRepository)
		private notificationMutesRepository: NotificationMutesRepository,

		private userEntityService: UserEntityService,
		private chatEntityService: ChatEntityService,
		private idService: IdService,
		private globalEventService: GlobalEventService,
		private apRendererService: ApRendererService,
		private queueService: QueueService,
		private pushNotificationService: PushNotificationService,
		private notificationService: NotificationService,
		private userBlockingService: UserBlockingService,
		private queryService: QueryService,
		private roleService: RoleService,
		private userFollowingService: UserFollowingService,
		private customEmojiService: CustomEmojiService,
		private moderationLogService: ModerationLogService,
	) {
	}

	@bindThis
	public async getChatAvailability(userId: MiUser['id']): Promise<{ read: boolean; write: boolean; }> {
		const policies = await this.roleService.getUserPolicies(userId);

		switch (policies.chatAvailability) {
			case 'available':
				return {
					read: true,
					write: true,
				};
			case 'readonly':
				return {
					read: true,
					write: false,
				};
			case 'unavailable':
				return {
					read: false,
					write: false,
				};
			default:
				throw new Error('invalid chat availability (unreachable)');
		}
	}

	/** getChatAvailabilityの糖衣。主にAPI呼び出し時に走らせて、権限的に問題ない場合はそのまま続行する */
	@bindThis
	public async checkChatAvailability(userId: MiUser['id'], permission: 'read' | 'write') {
		const policy = await this.getChatAvailability(userId);
		if (policy[permission] === false) {
			throw new Error('ROLE_PERMISSION_DENIED');
		}
	}

	@bindThis
	public async createMessageToUser(fromUser: { id: MiUser['id']; host: MiUser['host']; }, toUser: MiUser, params: {
		text?: string | null;
		file?: MiDriveFile | null;
		uri?: string | null;
		attachment?: Record<string, any> | null;
	}): Promise<Packed<'ChatMessageLiteFor1on1'>> {
		if (fromUser.id === toUser.id) {
			throw new Error('yourself');
		}

		const approvals = await this.chatApprovalsRepository.createQueryBuilder('approval')
			.where(new Brackets(qb => { // 自分が相手を許可しているか
				qb.where('approval.userId = :fromUserId', { fromUserId: fromUser.id })
					.andWhere('approval.otherId = :toUserId', { toUserId: toUser.id });
			}))
			.orWhere(new Brackets(qb => { // 相手が自分を許可しているか
				qb.where('approval.userId = :toUserId', { toUserId: toUser.id })
					.andWhere('approval.otherId = :fromUserId', { fromUserId: fromUser.id });
			}))
			.take(2)
			.getMany();

		const otherApprovedMe = approvals.some(approval => approval.userId === toUser.id);
		const iApprovedOther = approvals.some(approval => approval.userId === fromUser.id);

		if (!otherApprovedMe) {
			if (toUser.chatScope === 'none') {
				throw new Error('recipient is cannot chat (none)');
			} else if (toUser.chatScope === 'followers') {
				const isFollower = await this.userFollowingService.isFollowing(fromUser.id, toUser.id);
				if (!isFollower) {
					throw new Error('recipient is cannot chat (followers)');
				}
			} else if (toUser.chatScope === 'following') {
				const isFollowing = await this.userFollowingService.isFollowing(toUser.id, fromUser.id);
				if (!isFollowing) {
					throw new Error('recipient is cannot chat (following)');
				}
			} else if (toUser.chatScope === 'mutual') {
				const isMutual = await this.userFollowingService.isMutual(fromUser.id, toUser.id);
				if (!isMutual) {
					throw new Error('recipient is cannot chat (mutual)');
				}
			}
		}

		if (!(await this.getChatAvailability(toUser.id)).write) {
			throw new Error('recipient is cannot chat (policy)');
		}

		const blocked = await this.userBlockingService.checkBlocked(toUser.id, fromUser.id);
		if (blocked) {
			throw new Error('blocked');
		}

		const message = {
			id: this.idService.gen(),
			fromUserId: fromUser.id,
			toUserId: toUser.id,
			text: params.text ? params.text.trim() : null,
			fileId: params.file ? params.file.id : null,
			reads: [],
			uri: params.uri ?? null,
			attachment: params.attachment ?? null,
			system: null,
		} satisfies Partial<MiChatMessage>;

		const inserted = await this.chatMessagesRepository.insertOne(message);

		// 相手を許可しておく
		if (!iApprovedOther) {
			this.chatApprovalsRepository.insertOne({
				id: this.idService.gen(),
				userId: fromUser.id,
				otherId: toUser.id,
			});
		}

		const packedMessage = await this.chatEntityService.packMessageLiteFor1on1(inserted);

		if (this.userEntityService.isLocalUser(toUser)) {
			const redisPipeline = this.redisClient.pipeline();
			redisPipeline.set(`newUserChatMessageExists:${toUser.id}:${fromUser.id}`, message.id);
			redisPipeline.sadd(`newChatMessagesExists:${toUser.id}`, `user:${fromUser.id}`);
			redisPipeline.exec();
		}

		if (this.userEntityService.isLocalUser(fromUser)) {
			// 自分のストリーム
			this.globalEventService.publishChatUserStream(fromUser.id, toUser.id, 'message', packedMessage);
		}

		if (this.userEntityService.isLocalUser(toUser)) {
			// 相手のストリーム
			this.globalEventService.publishChatUserStream(toUser.id, fromUser.id, 'message', packedMessage);
		}

		// 3秒経っても既読にならなかったらイベント発行
		if (this.userEntityService.isLocalUser(toUser)) {
			setTimeout(async () => {
				const marker = await this.redisClient.get(`newUserChatMessageExists:${toUser.id}:${fromUser.id}`);

				if (marker == null) return; // 既読

				// CHAT-V2: the recipient muted this thread (or every chat) — the unread marker stays, the notification does not go out
				if (await this.isNotificationMuted(toUser.id, 'user', fromUser.id)) return;

				const packedMessageForTo = await this.chatEntityService.packMessageDetailed(inserted, toUser);
				this.globalEventService.publishMainStream(toUser.id, 'newChatMessage', packedMessageForTo);
				this.pushNotificationService.pushNotification(toUser.id, 'newChatMessage', packedMessageForTo);
			}, 3000);
		}

		return packedMessage;
	}

	@bindThis
	public async createMessageToRoom(fromUser: { id: MiUser['id']; host: MiUser['host']; }, toRoom: MiChatRoom, params: {
		text?: string | null;
		file?: MiDriveFile | null;
		uri?: string | null;
		attachment?: Record<string, any> | null;
		/** CHAT-V2 a system line: stored on the message, no push, the room's read-only gate skipped (the engine speaks even in an archived room) */
		system?: Record<string, any> | null;
	}): Promise<Packed<'ChatMessageLiteForRoom'>> {
		const ownerMuted = (await this.redisClient.get(`chatRoomOwnerMuted:${toRoom.id}`)) === '1'; // HOST-TOOLS-V1: the owner's mute (muteRoom below)
		const memberships = (await this.chatRoomMembershipsRepository.findBy({ roomId: toRoom.id })).map(m => ({
			userId: m.userId,
			isMuted: m.isMuted,
		})).concat({ // ownerはmembershipレコードを作らないため
			userId: toRoom.ownerId,
			isMuted: ownerMuted,
		});

		if (!memberships.some(member => member.userId === fromUser.id)) {
			throw new Error('you are not a member of the room');
		}

		// CHAT-V2 archive rule: a room past its readOnlyAt takes no user message (system lines still land)
		if (params.system == null && toRoom.readOnlyAt != null && toRoom.readOnlyAt.getTime() <= Date.now()) {
			throw new Error('ROOM_READ_ONLY');
		}

		const membershipsOtherThanMe = memberships.filter(member => member.userId !== fromUser.id);

		const message = {
			id: this.idService.gen(),
			fromUserId: fromUser.id,
			toRoomId: toRoom.id,
			text: params.text ? params.text.trim() : null,
			fileId: params.file ? params.file.id : null,
			reads: [],
			uri: params.uri ?? null,
			attachment: params.attachment ?? null,
			system: params.system ?? null,
		} satisfies Partial<MiChatMessage>;

		const inserted = await this.chatMessagesRepository.insertOne(message);

		// MOP-UP-CHAT CHAT-MENTION-V1 (E-chat-room.08): an @mention of a room member notifies that member (notifyRoomMentions).
		if (params.system == null && message.text) {
			this.notifyRoomMentions(fromUser.id, toRoom, memberships.map(m => m.userId), message.text).catch(() => undefined);
		}

		// NUKE-REVIEW-FIXES-V1 (review finding 6): an album is ONE notification, not one per photo. A meet photo is now a
		// file message (NUKE-MEET-PHOTOS-V1), and a host posting a 20-photo post-match album used to push 20 times to every
		// player. A FILE-ONLY message (no text — i.e. an upload, never a typed line) from the same sender into the same
		// room claims a 60 s window: the first one notifies, the rest of the burst do not. The unread marker and the
		// room stream are untouched, so the badge and an open room are exactly as before — only the per-photo PUSH and its
		// main-stream ping are coalesced. NX means the first message of the burst wins the window even under concurrency.
		let burstFirst = true;
		if (params.system == null && message.fileId != null && message.text == null) {
			burstFirst = (await this.redisClient.set(`chatRoomFileBurst:${toRoom.id}:${fromUser.id}`, '1', 'EX', 60, 'NX')) === 'OK';
		}

		const packedMessage = await this.chatEntityService.packMessageLiteForRoom(inserted);

		this.globalEventService.publishChatRoomStream(toRoom.id, 'message', packedMessage);

		const redisPipeline = this.redisClient.pipeline();
		for (const membership of membershipsOtherThanMe) {
			// NUKE-CHAT-MUTE-V1: a muted member still gets the UNREAD MARKER — only the notification is silenced (below).
			// That is what our notification_mute scope 'room' used to buy; native mute now does it, so the side table is gone.
			redisPipeline.set(`newRoomChatMessageExists:${membership.userId}:${toRoom.id}`, message.id);
			redisPipeline.sadd(`newChatMessagesExists:${membership.userId}`, `room:${toRoom.id}`);
		}
		redisPipeline.exec();

		// 3秒経っても既読にならなかったらイベント発行
		setTimeout(async () => {
			const redisPipeline = this.redisClient.pipeline();
			for (const membership of membershipsOtherThanMe) {
				redisPipeline.get(`newRoomChatMessageExists:${membership.userId}:${toRoom.id}`);
			}
			const markers = await redisPipeline.exec();
			if (markers == null) throw new Error('redis error');

			if (markers.every(marker => marker[1] == null)) return;

			const packedMessageForTo = await this.chatEntityService.packMessageDetailed(inserted);

			// CHAT-V2: a system line never pushes; a member who muted this room (or every chat) keeps the unread marker and gets no notification
			if (params.system != null) return;
			// NUKE-REVIEW-FIXES-V1: the 2nd..nth file of one upload burst keeps its unread marker and its room-stream
			// message (an open room draws every photo); it gets no main-stream ping and no push.
			if (!burstFirst) return;
			const mutedIds = await this.mutedUserIdsForRoom(toRoom.id, membershipsOtherThanMe.map(m => m.userId));

			for (let i = 0; i < membershipsOtherThanMe.length; i++) {
				const marker = markers[i][1];
				if (marker == null) continue;
				if (mutedIds.has(membershipsOtherThanMe[i].userId)) continue;
				if (membershipsOtherThanMe[i].isMuted) continue; // NUKE-CHAT-MUTE-V1: native chat/rooms/mute silences the push

				this.globalEventService.publishMainStream(membershipsOtherThanMe[i].userId, 'newChatMessage', packedMessageForTo);
				this.pushNotificationService.pushNotification(membershipsOtherThanMe[i].userId, 'newChatMessage', packedMessageForTo);
			}
		}, 3000);

		return packedMessage;
	}

	/** MOP-UP-CHAT CHAT-MENTION-V1 (Reclub E-chat-room.08: @mentions notify). A room message that names a MEMBER of the room
	 *  with "@" notifies that member once — in every GripBat room (meet chat, club chat, group chat: all of them are native
	 *  chat rooms sent through createMessageToRoom). A DM needs nothing: its one recipient is already notified of every
	 *  message (createMessageToUser's newChatMessage).
	 *  G11: EXTENDS native chat. Misskey's own 'mention' notification is note-only (it carries a noteId and the packer drops
	 *  it without the note — core/NoteCreateService.ts:156, core/entities/NotificationEntityService.ts), and mfm-js's
	 *  extractMentions (misc/extract-mentions.ts:9) only knows ASCII usernames, while the app's @ picker writes the member's
	 *  display name with the spaces taken out (app ChatThread.tsx mention()). So an "@token" is matched against the room's
	 *  members only — username OR squashed display name — and the notification is the native 'app' notification every
	 *  GripBat door already uses, with the sender as the notifier (native NotificationService: self, muting and the
	 *  per-type receive config are applied there), the room as its link, and the reader's language applied by the app
	 *  (lib/social NOTIF_HEAD). Nobody outside the room is ever looked up, so a mention cannot leak a message to a
	 *  non-member. The account-wide "chat notifications off" is respected; a per-room mute is not — a muted busy meet
	 *  chat still tells you when someone addresses you by name (Slack / Discord default), which is the point of a mention.
	 *  Returns the ids notified. */
	@bindThis
	public async notifyRoomMentions(fromUserId: MiUser['id'], room: MiChatRoom, memberIds: MiUser['id'][], text: string): Promise<MiUser['id'][]> {
		const tokens = new Set<string>();
		for (const m of text.matchAll(/(?:^|[^A-Za-z0-9_@.])@([^\s@]{1,64})/gu)) {
			const t = m[1].replace(/[.,!?;:\u3001\u3002\uff01\uff0c\uff1a\uff1b\uff1f)\]\uff09\u300d\u300f"'\u2026]+$/u, '').toLowerCase();
			if (t) tokens.add(t);
		}
		if (tokens.size === 0) return [];
		const others = [...new Set(memberIds)].filter(id => id !== fromUserId);   // a self-mention never notifies
		if (others.length === 0) return [];
		const squash = (x: string | null | undefined) => (x ?? '').replace(/\s+/g, '').toLowerCase();
		const users = await this.usersRepository.findBy({ id: In(others) });
		const hit = users.filter(u => u.host == null && (tokens.has(u.username.toLowerCase()) /* usernameLower is select:false on MiUser — findBy never loads it */ || (u.name != null && tokens.has(squash(u.name)))));
		if (hit.length === 0) return [];
		const chatOff = await this.mutedUserIdsForRoom(room.id, hit.map(u => u.id));
		const sender = await this.usersRepository.findOneBy({ id: fromUserId });
		const who = ((sender?.name ?? '').trim() || sender?.username) ?? '';
		const roomName = (room.name ?? '').trim();
		const meetId = await this.chatRoomsRepository.manager.query('SELECT id FROM meet WHERE "chatRoomId" = $1 LIMIT 1', [room.id])
			.then((r: { id: string }[]) => (r[0] ? r[0].id : null)).catch(() => null);
		const link = meetId ? 'meetchat:' + meetId : 'chat:' + room.id;   // a meet's room opens on the meet's Chat tab
		const header = roomName ? `${who} mentioned you in ${roomName}` : `${who} mentioned you`;
		const body = text.length > 140 ? text.slice(0, 139) + '\u2026' : text;
		const notified: MiUser['id'][] = [];
		for (const u of hit) {
			if (chatOff.has(u.id)) continue;
			if (await this.userBlockingService.checkBlocked(u.id, fromUserId)) continue;
			this.notificationService.createNotification(u.id, 'app', { customHeader: header, customBody: body, customIcon: null, appAccessTokenId: null, customLink: link }, fromUserId);
			notified.push(u.id);
		}
		return notified;
	}

	@bindThis
	public async readUserChatMessage(
		readerId: MiUser['id'],
		senderId: MiUser['id'],
	): Promise<void> {
		const redisPipeline = this.redisClient.pipeline();
		redisPipeline.del(`newUserChatMessageExists:${readerId}:${senderId}`);
		redisPipeline.srem(`newChatMessagesExists:${readerId}`, `user:${senderId}`);
		await redisPipeline.exec();
	}

	@bindThis
	public async readRoomChatMessage(
		readerId: MiUser['id'],
		roomId: MiChatRoom['id'],
	): Promise<void> {
		const redisPipeline = this.redisClient.pipeline();
		redisPipeline.del(`newRoomChatMessageExists:${readerId}:${roomId}`);
		redisPipeline.srem(`newChatMessagesExists:${readerId}`, `room:${roomId}`);
		await redisPipeline.exec();
	}

	@bindThis
	public async readAllChatMessages(
		readerId: MiUser['id'],
	): Promise<void> {
		// CHAT-V2: the set lists every thread with a marker (user:<id> / room:<id>), so the per-thread markers that
		// chat/history reads as isRead are cleared too — 'Mark all as read' in the inbox stays read after a reload
		const threads = await this.redisClient.smembers(`newChatMessagesExists:${readerId}`);
		const redisPipeline = this.redisClient.pipeline();
		for (const t of threads) {
			const [kind, id] = t.split(':');
			if (kind === 'user') redisPipeline.del(`newUserChatMessageExists:${readerId}:${id}`);
			else if (kind === 'room') redisPipeline.del(`newRoomChatMessageExists:${readerId}:${id}`);
		}
		redisPipeline.del(`newChatMessagesExists:${readerId}`);
		await redisPipeline.exec();
	}

	@bindThis
	public findMessageById(messageId: MiChatMessage['id']) {
		return this.chatMessagesRepository.findOneBy({ id: messageId });
	}

	@bindThis
	public findMyMessageById(userId: MiUser['id'], messageId: MiChatMessage['id']) {
		return this.chatMessagesRepository.findOneBy({ id: messageId, fromUserId: userId });
	}

	@bindThis
	public async hasPermissionToViewRoomTimeline(meId: MiUser['id'], room: MiChatRoom) {
		if (await this.isRoomMember(room, meId)) {
			return true;
		} else {
			const iAmModerator = await this.roleService.isModerator({ id: meId });
			if (iAmModerator) {
				return true;
			}

			return false;
		}
	}

	/* CHAT-SOFTDELETE-V1 (KUDOS-CHAT-V1, EXTENDED from native delete): Reclub keeps a deleted message's place in the
	 * thread ("Message unsent" / "{name} unsent a message." / "Message removed by an admin") and lets the person who
	 * deleted it Undelete. So the row stays with deletedAt / deletedById; the packers (ChatEntityService) blank its text,
	 * file, attachment and reactions for every reader; search skips it. A room's deletion still removes rows for real
	 * (FK cascade), as does the probe sweep. */
	@bindThis
	public async deleteMessage(message: MiChatMessage, deleterId?: MiUser['id'] | null) {
		await this.chatMessagesRepository.update(message.id, { deletedAt: new Date(), deletedById: deleterId ?? message.fromUserId });
		// CHAT-REPLY-V1: replies keep a snapshot of the text they quote — blank it, so removed words do not live on in a quote
		// (batch-1 review fix: scoped to the message's own thread, so the scan uses the room / user-pair indexes)
		if (message.toRoomId) {
			await this.chatMessagesRepository.query(`UPDATE "chat_message" SET "attachment" = "attachment" || '{"text": null, "deleted": true}'::jsonb WHERE "toRoomId" = $2 AND "attachment"->>'kind' = 'reply' AND "attachment"->>'replyId' = $1`, [message.id, message.toRoomId]);
		} else if (message.toUserId) {
			await this.chatMessagesRepository.query(`UPDATE "chat_message" SET "attachment" = "attachment" || '{"text": null, "deleted": true}'::jsonb WHERE (("fromUserId" = $2 AND "toUserId" = $3) OR ("fromUserId" = $3 AND "toUserId" = $2)) AND "attachment"->>'kind' = 'reply' AND "attachment"->>'replyId' = $1`, [message.id, message.fromUserId, message.toUserId]);
		}

		if (message.toUserId) {
			const [fromUser, toUser] = await Promise.all([
				this.usersRepository.findOneByOrFail({ id: message.fromUserId }),
				this.usersRepository.findOneByOrFail({ id: message.toUserId }),
			]);

			if (this.userEntityService.isLocalUser(fromUser)) this.globalEventService.publishChatUserStream(message.fromUserId, message.toUserId, 'deleted', message.id);
			if (this.userEntityService.isLocalUser(toUser)) this.globalEventService.publishChatUserStream(message.toUserId, message.fromUserId, 'deleted', message.id);

			if (this.userEntityService.isLocalUser(fromUser) && this.userEntityService.isRemoteUser(toUser)) {
				//const activity = this.apRendererService.addContext(this.apRendererService.renderDelete(this.apRendererService.renderTombstone(`${this.config.url}/notes/${message.id}`), fromUser));
				//this.queueService.deliver(fromUser, activity, toUser.inbox);
			}
		} else if (message.toRoomId) {
			this.globalEventService.publishChatRoomStream(message.toRoomId, 'deleted', message.id);
		}
	}

	/** CHAT-SOFTDELETE-V1: Reclub "Undelete" — only whoever deleted it; the quotes of it get their text back. */
	@bindThis
	public async undeleteMessage(message: MiChatMessage): Promise<void> {
		await this.chatMessagesRepository.update(message.id, { deletedAt: null, deletedById: null });
		const text = message.text ? message.text.slice(0, 200) : null;
		if (message.toRoomId) {
			await this.chatMessagesRepository.query(`UPDATE "chat_message" SET "attachment" = ("attachment" - 'deleted') || jsonb_build_object('text', $3::text) WHERE "toRoomId" = $2 AND "attachment"->>'kind' = 'reply' AND "attachment"->>'replyId' = $1`, [message.id, message.toRoomId, text]);
			this.globalEventService.publishChatRoomStream(message.toRoomId, 'deleted', message.id);   // clients re-read the thread on this event
		} else if (message.toUserId) {
			await this.chatMessagesRepository.query(`UPDATE "chat_message" SET "attachment" = ("attachment" - 'deleted') || jsonb_build_object('text', $4::text) WHERE (("fromUserId" = $2 AND "toUserId" = $3) OR ("fromUserId" = $3 AND "toUserId" = $2)) AND "attachment"->>'kind' = 'reply' AND "attachment"->>'replyId' = $1`, [message.id, message.fromUserId, message.toUserId, text]);
			this.globalEventService.publishChatUserStream(message.fromUserId, message.toUserId, 'deleted', message.id);
			this.globalEventService.publishChatUserStream(message.toUserId, message.fromUserId, 'deleted', message.id);
		}
	}

	@bindThis
	public async userTimeline(meId: MiUser['id'], otherId: MiUser['id'], limit: number, sinceId?: MiChatMessage['id'] | null, untilId?: MiChatMessage['id'] | null) {
		const query = this.queryService.makePaginationQuery(this.chatMessagesRepository.createQueryBuilder('message'), sinceId, untilId)
			.andWhere(new Brackets(qb => {
				qb
					.where(new Brackets(qb => {
						qb
							.where('message.fromUserId = :meId')
							.andWhere('message.toUserId = :otherId');
					}))
					.orWhere(new Brackets(qb => {
						qb
							.where('message.fromUserId = :otherId')
							.andWhere('message.toUserId = :meId');
					}));
			}))
			.setParameter('meId', meId)
			.setParameter('otherId', otherId);

		const messages = await query.take(limit).getMany();

		return messages;
	}

	@bindThis
	public async roomTimeline(roomId: MiChatRoom['id'], limit: number, sinceId?: MiChatMessage['id'] | null, untilId?: MiChatMessage['id'] | null) {
		const query = this.queryService.makePaginationQuery(this.chatMessagesRepository.createQueryBuilder('message'), sinceId, untilId)
			.andWhere('message.toRoomId = :roomId', { roomId })
			.leftJoinAndSelect('message.file', 'file')
			.leftJoinAndSelect('message.fromUser', 'fromUser');

		const messages = await query.take(limit).getMany();

		return messages;
	}

	@bindThis
	public async userHistory(meId: MiUser['id'], limit: number): Promise<MiChatMessage[]> {
		const history: MiChatMessage[] = [];

		const mutingQuery = this.mutingsRepository.createQueryBuilder('muting')
			.select('muting.muteeId')
			.where('muting.muterId = :muterId', { muterId: meId });

		for (let i = 0; i < limit; i++) {
			const found = history.map(m => (m.fromUserId === meId) ? m.toUserId! : m.fromUserId!);

			const query = this.chatMessagesRepository.createQueryBuilder('message')
				.orderBy('message.id', 'DESC')
				.where(new Brackets(qb => {
					qb
						.where('message.fromUserId = :meId', { meId: meId })
						.orWhere('message.toUserId = :meId', { meId: meId });
				}))
				.andWhere('message.toRoomId IS NULL')
				.andWhere(`message.fromUserId NOT IN (${ mutingQuery.getQuery() })`)
				.andWhere(`message.toUserId NOT IN (${ mutingQuery.getQuery() })`);

			if (found.length > 0) {
				query.andWhere('message.fromUserId NOT IN (:...found)', { found: found });
				query.andWhere('message.toUserId NOT IN (:...found)', { found: found });
			}

			query.setParameters(mutingQuery.getParameters());

			const message = await query.getOne();

			if (message) {
				history.push(message);
			} else {
				break;
			}
		}

		return history;
	}

	@bindThis
	public async roomHistory(meId: MiUser['id'], limit: number): Promise<MiChatMessage[]> {
		// TODO: 一回のクエリにまとめられるかも
		const [memberRoomIds, ownedRoomIds] = await Promise.all([
			this.chatRoomMembershipsRepository.findBy({
				userId: meId,
			}).then(xs => xs.map(x => x.roomId)),
			this.chatRoomsRepository.findBy({
				ownerId: meId,
			}).then(xs => xs.map(x => x.id)),
		]);

		const roomIds = memberRoomIds.concat(ownedRoomIds);

		if (memberRoomIds.length === 0 && ownedRoomIds.length === 0) {
			return [];
		}

		const history: MiChatMessage[] = [];

		for (let i = 0; i < limit; i++) {
			const found = history.map(m => m.toRoomId!);

			const query = this.chatMessagesRepository.createQueryBuilder('message')
				.orderBy('message.id', 'DESC')
				.where('message.toRoomId IN (:...roomIds)', { roomIds });

			if (found.length > 0) {
				query.andWhere('message.toRoomId NOT IN (:...found)', { found: found });
			}

			const message = await query.getOne();

			if (message) {
				history.push(message);
			} else {
				break;
			}
		}

		return history;
	}

	@bindThis
	public async getUserReadStateMap(userId: MiUser['id'], otherIds: MiUser['id'][]) {
		const readStateMap: Record<MiUser['id'], boolean> = {};

		const redisPipeline = this.redisClient.pipeline();

		for (const otherId of otherIds) {
			redisPipeline.get(`newUserChatMessageExists:${userId}:${otherId}`);
		}

		const markers = await redisPipeline.exec();
		if (markers == null) throw new Error('redis error');

		for (let i = 0; i < otherIds.length; i++) {
			const marker = markers[i][1];
			readStateMap[otherIds[i]] = marker == null;
		}

		return readStateMap;
	}

	@bindThis
	public async getRoomReadStateMap(userId: MiUser['id'], roomIds: MiChatRoom['id'][]) {
		const readStateMap: Record<MiChatRoom['id'], boolean> = {};

		const redisPipeline = this.redisClient.pipeline();

		for (const roomId of roomIds) {
			redisPipeline.get(`newRoomChatMessageExists:${userId}:${roomId}`);
		}

		const markers = await redisPipeline.exec();
		if (markers == null) throw new Error('redis error');

		for (let i = 0; i < roomIds.length; i++) {
			const marker = markers[i][1];
			readStateMap[roomIds[i]] = marker == null;
		}

		return readStateMap;
	}

	@bindThis
	public async hasUnreadMessages(userId: MiUser['id']) {
		const card = await this.redisClient.scard(`newChatMessagesExists:${userId}`);
		return card > 0;
	}

	@bindThis
	public async createRoom(owner: MiUser, params: Partial<{
		name: string;
		description: string;
	}>) {
		const room = {
			id: this.idService.gen(),
			name: params.name,
			description: params.description,
			ownerId: owner.id,
		} satisfies Partial<MiChatRoom>;

		const created = await this.chatRoomsRepository.insertOne(room);

		return created;
	}

	@bindThis
	public async hasPermissionToViewRoomInfo(meId: MiUser['id'], room: MiChatRoom) {
		if (room.ownerId === meId) {
			return true;
		}

		if (await this.isRoomMember(room, meId)) {
			return true;
		}

		if (await this.chatRoomInvitationsRepository.findOneBy({ roomId: room.id, userId: meId })) {
			return true;
		}

		if (await this.roleService.isModerator({ id: meId })) {
			return true;
		}

		return false;
	}

	@bindThis
	public async hasPermissionToDeleteRoom(meId: MiUser['id'], room: MiChatRoom) {
		if (room.ownerId === meId) {
			return true;
		}

		const iAmModerator = await this.roleService.isModerator({ id: meId });
		if (iAmModerator) {
			return true;
		}

		return false;
	}

	@bindThis
	public async deleteRoom(room: MiChatRoom, deleter?: MiUser) {
		const memberships = (await this.chatRoomMembershipsRepository.findBy({ roomId: room.id })).map(m => ({
			userId: m.userId,
		})).concat({ // ownerはmembershipレコードを作らないため
			userId: room.ownerId,
		});

		// 未読フラグ削除
		const redisPipeline = this.redisClient.pipeline();
		for (const membership of memberships) {
			redisPipeline.del(`newRoomChatMessageExists:${membership.userId}:${room.id}`);
			redisPipeline.srem(`newChatMessagesExists:${membership.userId}`, `room:${room.id}`);
		}
		await redisPipeline.exec();

		await this.chatRoomsRepository.delete(room.id);

		if (deleter) {
			const deleterIsModerator = await this.roleService.isModerator(deleter);

			if (deleterIsModerator) {
				this.moderationLogService.log(deleter, 'deleteChatRoom', {
					roomId: room.id,
					room: room,
				});
			}
		}
	}

	@bindThis
	public async findMyRoomById(ownerId: MiUser['id'], roomId: MiChatRoom['id']) {
		return this.chatRoomsRepository.findOneBy({ id: roomId, ownerId: ownerId });
	}

	@bindThis
	public async findRoomById(roomId: MiChatRoom['id']) {
		return this.chatRoomsRepository.findOne({
			where: { id: roomId },
			relations: { owner: true },
		});
	}

	@bindThis
	public async isRoomMember(room: MiChatRoom, userId: MiUser['id']) {
		if (room.ownerId === userId) return true;
		const membership = await this.chatRoomMembershipsRepository.findOneBy({ roomId: room.id, userId });
		return membership != null;
	}

	@bindThis
	public async createRoomInvitation(inviterId: MiUser['id'], roomId: MiChatRoom['id'], inviteeId: MiUser['id'], opts: { notify?: boolean } = {}) {
		if (inviterId === inviteeId) {
			throw new Error('yourself');
		}

		const room = await this.chatRoomsRepository.findOneByOrFail({ id: roomId, ownerId: inviterId });

		if (await this.isRoomMember(room, inviteeId)) {
			throw new Error('already member');
		}

		const existingInvitation = await this.chatRoomInvitationsRepository.findOneBy({ roomId, userId: inviteeId });
		if (existingInvitation) {
			throw new Error('already invited');
		}

		const membershipsCount = await this.chatRoomMembershipsRepository.countBy({ roomId });
		if (membershipsCount >= MAX_ROOM_MEMBERS) {
			throw new Error('room is full');
		}

		// TODO: cehck block

		const invitation = {
			id: this.idService.gen(),
			roomId: room.id,
			userId: inviteeId,
		} satisfies Partial<MiChatRoomInvitation>;

		const created = await this.chatRoomInvitationsRepository.insertOne(invitation);

		// BACKEND-DELIVERY-V1: a module that invites and joins in one step (meet / club / competition rooms) passes
		// notify:false. Its invitation is consumed at once, so the notification could never be listed (the packer drops a
		// used invitation) yet it stayed in the unread count: a phantom badge the reader could never clear by reading.
		if (opts.notify !== false) {
			this.notificationService.createNotification(inviteeId, 'chatRoomInvitationReceived', {
				invitationId: invitation.id,
			}, inviterId);
		}

		return created;
	}

	@bindThis
	public async getSentRoomInvitationsWithPagination(roomId: MiChatRoom['id'], limit: number, sinceId?: MiChatRoomInvitation['id'] | null, untilId?: MiChatRoomInvitation['id'] | null) {
		const query = this.queryService.makePaginationQuery(this.chatRoomInvitationsRepository.createQueryBuilder('invitation'), sinceId, untilId)
			.andWhere('invitation.roomId = :roomId', { roomId });

		const invitations = await query.take(limit).getMany();

		return invitations;
	}

	@bindThis
	public async getOwnedRoomsWithPagination(ownerId: MiUser['id'], limit: number, sinceId?: MiChatRoom['id'] | null, untilId?: MiChatRoom['id'] | null) {
		const query = this.queryService.makePaginationQuery(this.chatRoomsRepository.createQueryBuilder('room'), sinceId, untilId)
			.andWhere('room.ownerId = :ownerId', { ownerId });

		const rooms = await query.take(limit).getMany();

		return rooms;
	}

	@bindThis
	public async getReceivedRoomInvitationsWithPagination(userId: MiUser['id'], limit: number, sinceId?: MiChatRoomInvitation['id'] | null, untilId?: MiChatRoomInvitation['id'] | null) {
		const query = this.queryService.makePaginationQuery(this.chatRoomInvitationsRepository.createQueryBuilder('invitation'), sinceId, untilId)
			.andWhere('invitation.userId = :userId', { userId })
			.andWhere('invitation.ignored = FALSE');

		const invitations = await query.take(limit).getMany();

		return invitations;
	}

	@bindThis
	public async joinToRoom(userId: MiUser['id'], roomId: MiChatRoom['id']) {
		const invitation = await this.chatRoomInvitationsRepository.findOneByOrFail({ roomId, userId });

		const membershipsCount = await this.chatRoomMembershipsRepository.countBy({ roomId });
		if (membershipsCount >= MAX_ROOM_MEMBERS) {
			throw new Error('room is full');
		}

		const membership = {
			id: this.idService.gen(),
			roomId: roomId,
			userId: userId,
		} satisfies Partial<MiChatRoomMembership>;

		// TODO: transaction
		await this.chatRoomMembershipsRepository.insertOne(membership);
		await this.chatRoomInvitationsRepository.delete(invitation.id);
	}

	@bindThis
	public async ignoreRoomInvitation(userId: MiUser['id'], roomId: MiChatRoom['id']) {
		const invitation = await this.chatRoomInvitationsRepository.findOneByOrFail({ roomId, userId });
		await this.chatRoomInvitationsRepository.update(invitation.id, { ignored: true });
	}

	@bindThis
	public async leaveRoom(userId: MiUser['id'], roomId: MiChatRoom['id']) {
		const membership = await this.chatRoomMembershipsRepository.findOneByOrFail({ roomId, userId });
		await this.chatRoomMembershipsRepository.delete(membership.id);
		// KUDOS-CHAT-V1 (E-chat-room.13): Reclub channels:gating.left "{name} has left the conversation." — every room kind
		// (group, meet, club, competition) leaves through here; best-effort, a chat hiccup never fails the leave
		const leaver = await this.usersRepository.findOneBy({ id: userId }).catch(() => null);
		await this.createSystemMessageToRoom(roomId, { key: 'left', userId, name: leaver ? (leaver.name ?? leaver.username) : null }).catch(() => null);

		// 未読フラグを消す (「既読にする」というわけでもないのでreadメソッドは使わないでおく)
		const redisPipeline = this.redisClient.pipeline();
		redisPipeline.del(`newRoomChatMessageExists:${userId}:${roomId}`);
		redisPipeline.srem(`newChatMessagesExists:${userId}`, `room:${roomId}`);
		await redisPipeline.exec();
	}

	@bindThis
	public async muteRoom(userId: MiUser['id'], roomId: MiChatRoom['id'], mute: boolean) {
		// HOST-TOOLS-V1: the owner has no membership row (Misskey convention) — their mute lives in redis, read by createMessageToRoom
		const membership = await this.chatRoomMembershipsRepository.findOneBy({ roomId, userId });
		if (membership == null) {
			const room = await this.chatRoomsRepository.findOneBy({ id: roomId, ownerId: userId });
			if (room == null) throw new Error('not a member of the room');
			if (mute) await this.redisClient.set(`chatRoomOwnerMuted:${roomId}`, '1'); else await this.redisClient.del(`chatRoomOwnerMuted:${roomId}`);
			return;
		}
		await this.chatRoomMembershipsRepository.update(membership.id, { isMuted: mute });
	}

	/** NUKE-CHAT-MUTE-V1: is this room muted for `userId`? Native state only — the membership flag, or (for the owner,
	 *  who has no membership row) the redis flag muteRoom writes. One reader for rooms/show, the meet pack and the app.
	 *
	 *  NUKE-REVIEW-FIXES-V1 (review finding 1): the redis flag is the ROOM OWNER's, so it is only ever this caller's
	 *  answer when this caller owns the room — exactly the gate ChatEntityService.packRoom applies. Without it every
	 *  signed-in non-member read the host's mute as their own (MeetEntityService.pack calls this for every viewer of a
	 *  meet, so one host muting a meet chat showed "chat notifications off" to everybody) and a toggle they never set
	 *  failed when tapped. Anyone who is neither a member nor the owner has no mute here: false. */
	@bindThis
	public async isRoomMuted(userId: MiUser['id'], roomId: MiChatRoom['id']): Promise<boolean> {
		const membership = await this.chatRoomMembershipsRepository.findOneBy({ roomId, userId });
		if (membership != null) return membership.isMuted;
		const room = await this.chatRoomsRepository.findOneBy({ id: roomId, ownerId: userId });
		if (room == null) return false;
		return (await this.redisClient.get(`chatRoomOwnerMuted:${roomId}`)) === '1';
	}

	@bindThis
	public async updateRoom(room: MiChatRoom, params: {
		name?: string;
		description?: string;
	}): Promise<MiChatRoom> {
		return this.chatRoomsRepository.createQueryBuilder().update()
			.set(params)
			.where('id = :id', { id: room.id })
			.returning('*')
			.execute()
			.then((response) => {
				return response.raw[0];
			});
	}

	@bindThis
	public async getRoomMembershipsWithPagination(roomId: MiChatRoom['id'], limit: number, sinceId?: MiChatRoomMembership['id'] | null, untilId?: MiChatRoomMembership['id'] | null) {
		const query = this.queryService.makePaginationQuery(this.chatRoomMembershipsRepository.createQueryBuilder('membership'), sinceId, untilId)
			.andWhere('membership.roomId = :roomId', { roomId });

		const memberships = await query.take(limit).getMany();

		return memberships;
	}

	@bindThis
	public async searchMessages(meId: MiUser['id'], query: string, limit: number, params: {
		userId?: MiUser['id'] | null;
		roomId?: MiChatRoom['id'] | null;
	}) {
		const q = this.chatMessagesRepository.createQueryBuilder('message');

		if (params.userId) {
			q.andWhere(new Brackets(qb => {
				qb
					.where(new Brackets(qb => {
						qb
							.where('message.fromUserId = :meId')
							.andWhere('message.toUserId = :otherId');
					}))
					.orWhere(new Brackets(qb => {
						qb
							.where('message.fromUserId = :otherId')
							.andWhere('message.toUserId = :meId');
					}));
			}))
				.setParameter('meId', meId)
				.setParameter('otherId', params.userId);
		} else if (params.roomId) {
			q.where('message.toRoomId = :roomId', { roomId: params.roomId });
		} else {
			const membershipsQuery = this.chatRoomMembershipsRepository.createQueryBuilder('membership')
				.select('membership.roomId')
				.where('membership.userId = :meId', { meId: meId });

			const ownedRoomsQuery = this.chatRoomsRepository.createQueryBuilder('room')
				.select('room.id')
				.where('room.ownerId = :meId', { meId });

			q.andWhere(new Brackets(qb => {
				qb
					.where('message.fromUserId = :meId')
					.orWhere('message.toUserId = :meId')
					.orWhere(`message.toRoomId IN (${membershipsQuery.getQuery()})`)
					.orWhere(`message.toRoomId IN (${ownedRoomsQuery.getQuery()})`);
			}));

			q.setParameters(membershipsQuery.getParameters());
			q.setParameters(ownedRoomsQuery.getParameters());
		}

		q.andWhere('message.deletedAt IS NULL');   // CHAT-SOFTDELETE-V1: a deleted message is never found
		q.andWhere('LOWER(message.text) LIKE :q', { q: `%${ sqlLikeEscape(query.toLowerCase()) }%` });

		q.leftJoinAndSelect('message.file', 'file');
		q.leftJoinAndSelect('message.fromUser', 'fromUser');
		q.leftJoinAndSelect('message.toUser', 'toUser');
		q.leftJoinAndSelect('message.toRoom', 'toRoom');
		q.leftJoinAndSelect('toRoom.owner', 'toRoomOwner');

		const messages = await q.orderBy('message.id', 'DESC').take(limit).getMany();

		return messages;
	}

	@bindThis
	public async react(messageId: MiChatMessage['id'], userId: MiUser['id'], reaction_: string) {
		let reaction;

		const custom = reaction_.match(isCustomEmojiRegexp);

		if (custom == null) {
			reaction = normalizeEmojiString(reaction_);
		} else {
			const name = custom[1];
			const emoji = (await this.customEmojiService.localEmojisCache.fetch()).get(name);

			if (emoji == null) {
				throw new Error('no such emoji');
			} else {
				reaction = `:${name}:`;
			}
		}

		const message = await this.chatMessagesRepository.findOneByOrFail({ id: messageId });

		// CHAT-V2: reacting to your own message is allowed (Reclub / every messenger); the same reaction twice is a no-op
		if (message.reactions.includes(`${userId}/${reaction}`)) return;
		if (message.deletedAt != null) throw new Error('cannot react to a deleted message');   // CHAT-SOFTDELETE-V1

		if (message.toRoomId === null && message.toUserId !== userId && message.fromUserId !== userId) {
			throw new Error('cannot react to others message');
		}

		if (message.reactions.length >= MAX_REACTIONS_PER_MESSAGE) {
			throw new Error('too many reactions');
		}

		const room = message.toRoomId ? await this.chatRoomsRepository.findOneByOrFail({ id: message.toRoomId }) : null;

		if (room) {
			if (!(await this.isRoomMember(room, userId))) {
				throw new Error('cannot react to others message');
			}
		}

		await this.chatMessagesRepository.createQueryBuilder().update()
			.set({
				reactions: () => `array_append("reactions", '${userId}/${reaction}')`,
			})
			.where('id = :id', { id: message.id })
			.execute();

		if (room) {
			this.globalEventService.publishChatRoomStream(room.id, 'react', {
				messageId: message.id,
				user: await this.userEntityService.pack(userId),
				reaction,
			});
		} else {
			this.globalEventService.publishChatUserStream(message.fromUserId, message.toUserId!, 'react', {
				messageId: message.id,
				reaction,
			});
			this.globalEventService.publishChatUserStream(message.toUserId!, message.fromUserId, 'react', {
				messageId: message.id,
				reaction,
			});
		}
	}

	@bindThis
	public async unreact(messageId: MiChatMessage['id'], userId: MiUser['id'], reaction_: string) {
		let reaction;

		const custom = reaction_.match(isCustomEmojiRegexp);

		if (custom == null) {
			reaction = normalizeEmojiString(reaction_);
		} else { // 削除されたカスタム絵文字のリアクションを削除したいかもしれないので絵文字の存在チェックはする必要なし
			const name = custom[1];
			reaction = `:${name}:`;
		}

		// NOTE: 自分のリアクションを(あれば)削除するだけなので諸々の権限チェックは必要なし

		const message = await this.chatMessagesRepository.findOneByOrFail({ id: messageId });

		const room = message.toRoomId ? await this.chatRoomsRepository.findOneByOrFail({ id: message.toRoomId }) : null;

		await this.chatMessagesRepository.createQueryBuilder().update()
			.set({
				reactions: () => `array_remove("reactions", '${userId}/${reaction}')`,
			})
			.where('id = :id', { id: message.id })
			.execute();

		// TODO: 実際に削除が行われたときのみイベントを発行する

		if (room) {
			this.globalEventService.publishChatRoomStream(room.id, 'unreact', {
				messageId: message.id,
				user: await this.userEntityService.pack(userId),
				reaction,
			});
		} else {
			this.globalEventService.publishChatUserStream(message.fromUserId, message.toUserId!, 'unreact', {
				messageId: message.id,
				reaction,
			});
			this.globalEventService.publishChatUserStream(message.toUserId!, message.fromUserId, 'unreact', {
				messageId: message.id,
				reaction,
			});
		}
	}

	@bindThis
	public async getMyMemberships(userId: MiUser['id'], limit: number, sinceId?: MiChatRoomMembership['id'] | null, untilId?: MiChatRoomMembership['id'] | null) {
		const query = this.queryService.makePaginationQuery(this.chatRoomMembershipsRepository.createQueryBuilder('membership'), sinceId, untilId)
			.andWhere('membership.userId = :userId', { userId });

		const memberships = await query.take(limit).getMany();

		return memberships;
	}

	// ------------------------------------------------------------------------------------------ CHAT-V2
	/** A system line in a room (Reclub ChannelMessageType.System): "X joined", "meet cancelled"… The room owner is the
	 *  nominal sender (the packer needs one); the client draws it centred from `system`, never as the owner's bubble. */
	@bindThis
	public async createSystemMessageToRoom(roomId: MiChatRoom['id'], system: Record<string, any>): Promise<Packed<'ChatMessageLiteForRoom'> | null> {
		const room = await this.chatRoomsRepository.findOneBy({ id: roomId });
		if (room == null) return null;
		const owner = await this.usersRepository.findOneBy({ id: room.ownerId });
		if (owner == null) return null;
		return await this.createMessageToRoom(owner, room, { text: null, system });
	}

	/** The archive rule's clock: after `at` nobody sends in the room (null re-opens it). */
	@bindThis
	public async setRoomReadOnlyAt(roomId: MiChatRoom['id'], at: Date | null): Promise<void> {
		await this.chatRoomsRepository.update(roomId, { readOnlyAt: at });
	}

	@bindThis
	public async setNotificationMute(userId: MiUser['id'], scope: NotificationMuteScope, targetId: string, muted: boolean): Promise<void> {
		const existing = await this.notificationMutesRepository.findOneBy({ userId, scope, targetId });
		if (muted && existing == null) {
			await this.notificationMutesRepository.insertOne({ id: this.idService.gen(), userId, scope, targetId, createdAt: new Date() });
		} else if (!muted && existing != null) {
			await this.notificationMutesRepository.delete(existing.id);
		}
	}

	/** Muted for this thread, or for every chat (the settings toggle). */
	@bindThis
	public async isNotificationMuted(userId: MiUser['id'], scope: 'room' | 'user', targetId: string): Promise<boolean> {
		const rows = await this.notificationMutesRepository.createQueryBuilder('m')
			.where('m.userId = :userId', { userId })
			.andWhere(new Brackets(qb => {
				qb.where('m.scope = :scope AND m.targetId = :targetId', { scope, targetId })
					.orWhere("m.scope = 'chat'");
			}))
			.take(1).getMany();
		return rows.length > 0;
	}

	/** Of `userIds`, the ones who turned every chat notification off (the settings toggle).
	 *  NUKE-CHAT-MUTE-V1: the per-ROOM mute is native (chat_room_membership.isMuted / the owner's redis flag) and is read
	 *  straight off the membership by the caller — this only answers the account-wide toggle Misskey has no place for. */
	@bindThis
	public async mutedUserIdsForRoom(roomId: MiChatRoom['id'], userIds: MiUser['id'][]): Promise<Set<string>> {
		if (userIds.length === 0) return new Set();
		const rows = await this.notificationMutesRepository.createQueryBuilder('m')
			.select('m.userId', 'userId')
			.where('m.userId IN (:...userIds)', { userIds })
			.andWhere("m.scope = 'chat'")
			.getRawMany<{ userId: string }>();
		return new Set(rows.map(r => r.userId));
	}

	@bindThis
	public async notificationMutesOf(userId: MiUser['id']): Promise<{ scope: NotificationMuteScope; targetId: string }[]> {
		const rows = await this.notificationMutesRepository.findBy({ userId });
		return rows.map(r => ({ scope: r.scope, targetId: r.targetId }));
	}
}

/*
 * GB-PUSH-V1 (2026-09-19, GripBat wave 1 lane C) — the engine's notifications reach the member's PHONE.
 *
 * The GripBat app registers its devices with hkpl (the IdP), and hkpl owns the only dispatcher that reaches them
 * (APNS / FCM / Web Push). Until now no engine event got there: a player whose request was accepted, whose meet moved, or
 * who got a seat off the waitlist heard nothing unless the app was open. NotificationService calls sendHkplDevicePush() at
 * the moment Misskey itself would web-push ("still unread 2 s after it was created"), for the types members care about;
 * this posts it to hkpl's S2S door POST /api/v1/social/push/send (x-social-secret), which resolves the SSO username to the
 * person and pushes to every device of theirs.
 *
 * GATED: nothing is sent unless GRIPBAT_DEVICE_PUSH=on (instance setting, off by default) and ADAPTER_HKPL_URL +
 * ADAPTER_HKPL_S2S_SECRET are set. The member's own per-type setting already applies (NotificationService returns before
 * this when notificationRecieveConfig[type] is 'never'). GRIPBAT_DEVICE_PUSH_TYPES overrides the type list (comma list).
 * FAILS SOFT: never throws, never awaits in the caller's path; one warning line per failure; a 4 s timeout.
 * Only SSO members (local username hkpl_<12 hex>) — system, probe and remote accounts are skipped.
 */

type PackedLike = {
	id: string;
	type: string;
	header?: string | null;
	body?: string | null;
	link?: string | null;
	user?: { id?: string; name?: string | null; username?: string } | null;
};

const DEFAULT_TYPES = ['app', 'follow', 'receiveFollowRequest', 'followRequestAccepted', 'mention', 'reply', 'quote', 'chatRoomInvitationReceived'];
const SSO_USERNAME = /^hkpl_[0-9a-f]{12}$/;

type Lang = 'en' | 'zh_Hant' | 'zh_Hans';
const T: Record<string, Record<Lang, string>> = {
	follow: { en: '{name} followed you', zh_Hant: '{name} 關注了你', zh_Hans: '{name} 关注了你' },
	receiveFollowRequest: { en: '{name} asked to follow you', zh_Hant: '{name} 想關注你', zh_Hans: '{name} 想关注你' },
	followRequestAccepted: { en: '{name} accepted your follow request', zh_Hant: '{name} 接受了你的關注請求', zh_Hans: '{name} 接受了你的关注请求' },
	mention: { en: '{name} mentioned you', zh_Hant: '{name} 提及了你', zh_Hans: '{name} 提及了你' },
	reply: { en: '{name} replied to you', zh_Hant: '{name} 回覆了你', zh_Hans: '{name} 回复了你' },
	quote: { en: '{name} quoted your post', zh_Hant: '{name} 引用了你的帖子', zh_Hans: '{name} 引用了你的帖子' },
	chatRoomInvitationReceived: { en: '{name} invited you to a chat', zh_Hant: '{name} 邀請你加入聊天', zh_Hans: '{name} 邀请你加入聊天' },
};

function langOf(l: string | null | undefined): Lang {
	const s = String(l ?? '').toLowerCase();
	if (s.startsWith('zh')) return /hans|cn|sg/.test(s) ? 'zh_Hans' : 'zh_Hant';
	return 'en';
}

/** App route for a notification (the Taro app is served under /app in browser-router mode). */
export function deepLinkFor(n: PackedLike): string {
	const link = typeof n.link === 'string' ? n.link : '';
	if (link.startsWith('meet:')) return '/app/pages/meet/index?id=' + encodeURIComponent(link.slice(5));
	if (link.startsWith('club:')) return '/app/pages/community/index?id=' + encodeURIComponent(link.slice(5));
	if (link.startsWith('competition:')) return '/app/pages/tournament/index?id=' + encodeURIComponent(link.slice(12));
	if (n.type === 'follow' && n.user?.id) return '/app/pages/player/index?id=' + encodeURIComponent(n.user.id);
	return '/app/pages/notifications/index';
}

/** { title, body } for the phone, in the member's language; null = not a type we push. */
export function messageFor(n: PackedLike, lang: string | null | undefined): { title: string; body: string } | null {
	if (n.type === 'app') {
		const title = String(n.header ?? '').trim() || 'GripBat';
		return { title: title.slice(0, 120), body: String(n.body ?? '').slice(0, 400) };
	}
	const t = T[n.type];
	if (!t) return null;
	const name = String(n.user?.name || n.user?.username || 'GripBat').slice(0, 50);
	return { title: 'GripBat', body: t[langOf(lang)].replace('{name}', name) };
}

function enabledTypes(): Set<string> {
	const env = process.env.GRIPBAT_DEVICE_PUSH_TYPES;
	return new Set((env ? env.split(',') : DEFAULT_TYPES).map((s) => s.trim()).filter(Boolean));
}

/** Fire-and-forget. Returns the promise only so a test can await it; callers must not. */
export function sendHkplDevicePush(args: { host: string; username: string | null | undefined; lang: string | null | undefined; notification: PackedLike; warn?: (m: string) => void }): Promise<void> {
	const warn = args.warn ?? ((m: string) => console.warn(m));
	return (async () => {
		if (process.env.GRIPBAT_DEVICE_PUSH !== 'on') return;
		const base = (process.env.ADAPTER_HKPL_URL ?? '').replace(/\/+$/, '');
		const secret = process.env.ADAPTER_HKPL_S2S_SECRET ?? '';
		if (!base || !secret || !args.host) return;
		const username = String(args.username ?? '').toLowerCase();
		if (!SSO_USERNAME.test(username)) return;
		const n = args.notification;
		if (!enabledTypes().has(n.type)) return;
		const msg = messageFor(n, args.lang);
		if (!msg) return;
		const ctl = new AbortController();
		const timer = setTimeout(() => ctl.abort(), 4000);
		try {
			const r = await fetch(base + '/api/v1/social/push/send', {
				method: 'POST',
				headers: { 'content-type': 'application/json', 'x-social-secret': secret },
				body: JSON.stringify({ host: args.host, engineUsername: username, title: msg.title, body: msg.body, deepLink: deepLinkFor(n), lang: langOf(args.lang), kind: n.type === 'app' ? 'app' : 'social.' + n.type.toLowerCase(), id: 'se:' + n.id }),
				signal: ctl.signal,
			});
			if (r.status >= 400) warn(`[gb-push] hkpl answered ${r.status} for ${n.type} ${n.id}`);
		} catch (e) {
			warn(`[gb-push] ${n.type} ${n.id}: ${(e as Error).name === 'AbortError' ? 'timeout' : (e as Error).message}`);
		} finally {
			clearTimeout(timer);
		}
	})().catch(() => { /* never reaches the caller */ });
}

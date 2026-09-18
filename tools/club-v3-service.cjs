// CLUB-V3: adds the club-v3 methods to modules/clubs/ClubService.ts (owned by the CLUB-V3 stream). Anchored, idempotent.
'use strict';
const fs = require('fs'), path = require('path');
const p = path.join(__dirname, '..', 'packages', 'backend', 'src', 'modules', 'clubs', 'ClubService.ts');
let s = fs.readFileSync(p, 'utf8');
if (s.includes('CLUB-V3: codes, tokens, tags')) { console.log('already applied'); process.exit(0); }
function rep(a, b) { if (!s.includes(a)) throw new Error('anchor: ' + a.slice(0, 70)); s = s.replace(a, b); }

// ---- members(): paused members hidden from non-admins; tags from the CLUB-V3 tag list (expiry, visibility); lastActiveAt
rep(`		const users = ids.length ? await this.usersRepository.find({ where: { id: In(ids) } }) : [];
		const byId = new Map(users.map(u => [u.id, u]));
		let out = [] as { user: unknown; userId: string; role: 'owner' | 'admin' | 'member'; tags: string[]; joinedAt: string | null }[];
		for (const id of ids) {
			const u = byId.get(id); if (!u) continue;
			if (opts.query && !\`\${u.name ?? ''} \${u.username}\`.toLowerCase().includes(opts.query.toLowerCase())) continue;
			const row = rows.find(r => r.followerId === id);
			out.push({ user: await this.userEntityService.pack(u, viewer, { schema: 'UserLite' }), userId: id, role: channel.userId === id ? 'owner' : s.adminIds.includes(id) ? 'admin' : 'member', tags: admin ? (s.memberTags[id] ?? []) : [], joinedAt: row ? this.idService.parse(row.id).date.toISOString() : null });
		}
		const total = out.length;
		out = out.slice(opts.offset ?? 0, (opts.offset ?? 0) + (opts.limit ?? 100));
		return { total, members: out, tags: Array.from(new Set(Object.values(s.memberTags).flat())).sort() };`,
`		const users = ids.length ? await this.usersRepository.find({ where: { id: In(ids) } }) : [];
		const byId = new Map(users.map(u => [u.id, u]));
		// CLUB-V3: a member on a break (Take a break) is off the roster for members; admins see them flagged
		const paused = new Set((await this.clubMemberStatesRepository.find({ where: { channelId: channel.id }, select: { userId: true, pausedAt: true } })).filter(x => x.pausedAt).map(x => x.userId));
		const tagsOf = this.memberTagsOf(s, admin);
		let out = [] as { user: unknown; userId: string; role: 'owner' | 'admin' | 'member'; tags: string[]; tagDetails: { id: string; name: string; expiresAt: string | null }[]; joinedAt: string | null; lastActiveAt: string | null; paused: boolean }[];
		for (const id of ids) {
			const u = byId.get(id); if (!u) continue;
			if (opts.query && !\`\${u.name ?? ''} \${u.username}\`.toLowerCase().includes(opts.query.toLowerCase())) continue;
			if (paused.has(id) && !admin && id !== viewer.id) continue;
			const row = rows.find(r => r.followerId === id);
			const td = tagsOf(id);
			out.push({ user: await this.userEntityService.pack(u, viewer, { schema: 'UserLite' }), userId: id, role: channel.userId === id ? 'owner' : s.adminIds.includes(id) ? 'admin' : 'member', tags: td.map(t => t.name), tagDetails: td, joinedAt: row ? this.idService.parse(row.id).date.toISOString() : null, lastActiveAt: u.lastActiveDate ? new Date(u.lastActiveDate).toISOString() : null, paused: paused.has(id) });
		}
		const total = out.length;
		out = out.slice(opts.offset ?? 0, (opts.offset ?? 0) + (opts.limit ?? 100));
		const visibleTags = s.tags.filter(t => admin || t.visibility === 'all').sort((a, b) => a.order - b.order);
		return { total, members: out, tags: visibleTags.map(t => t.name), tagDefs: visibleTags.map(t => ({ id: t.id, name: t.name, visibility: t.visibility, order: t.order, count: Object.keys(t.members).length })) };`);

// ---- updateMember(): tags by name → the tag list (created when new, expiry kept)
rep(`		if (patch.tags) upd.memberTags = { ...s.memberTags, [userId]: patch.tags.map(t => t.trim()).filter(Boolean).slice(0, 12) };
		if (patch.remove) {
			upd.adminIds = (upd.adminIds ?? s.adminIds).filter(x => x !== userId);
			const mt = { ...(upd.memberTags ?? s.memberTags) }; delete mt[userId]; upd.memberTags = mt;`,
`		if (patch.tags) {
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
			await this.clubMemberStatesRepository.delete({ channelId: channel.id, userId });`);

// ---- join(): the ?at= token opens a private / invite-only club (Reclub quick-join by link)
rep(`	public async join(channel: MiChannel, user: MiLocalUser, message: string | null): Promise<{ status: 'member' | 'requested' }> {
		const s = await this.settings(channel.id);
		if (await this.isMember(channel.id, user.id)) return { status: 'member' };
		if (s.gateType === 'open') { await this.channelFollowingService.follow(user, channel); return { status: 'member' }; }
		if (s.gateType === 'invite') throw this.err('invite_only', 'This club is invite-only.');`,
`	public async join(channel: MiChannel, user: MiLocalUser, message: string | null, accessToken: string | null = null): Promise<{ status: 'member' | 'requested' }> {
		const s = await this.settings(channel.id);
		if (await this.isMember(channel.id, user.id)) return { status: 'member' };
		// CLUB-V3: the invite link's ?at= token is the admins' invitation — it seats the person in any gate
		if (accessToken && s.accessToken && accessToken === s.accessToken) { await this.channelFollowingService.follow(user, channel); await this.clubJoinRequestsRepository.delete({ channelId: channel.id, userId: user.id }); return { status: 'member' }; }
		if (s.gateType === 'open') { await this.channelFollowingService.follow(user, channel); return { status: 'member' }; }
		if (s.gateType === 'invite') throw this.err('invite_only', 'This club is invite-only.');`);

// ---- the CLUB-V3 block before notify()
const block = fs.readFileSync(path.join(__dirname, 'club-v3-service-block.ts.txt'), 'utf8');
rep(`	private notify(userId: string, header: string, body: string, channelId?: string): void {`, block + `\n	private notify(userId: string, header: string, body: string, channelId?: string): void {`);
fs.writeFileSync(p, s);
console.log('ok');

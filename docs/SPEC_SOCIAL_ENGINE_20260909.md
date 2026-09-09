# SPEC — Social Engine (independent) + Adapters for pyke / hkpl / any host

Contract loaded — proof-levels on, optimism off.
**Status: DRAFT for operator sign-off (L1 when signed). No code exists. Nothing is built until SIGN-OFF: yes.**
Evidence base: `HKPL_VS_RECLUB_BEDROCK_20260909.md` (bedrock + ~70-engine sweep), `HKPL_SOCIAL_PLATFORM_HANDOVER_20260909.md`, `RECLUB_TEARDOWN_20260909.md`, hkpl `docs/SPEC_HKPL_PYKE_PLATFORM_2026-09-05.md`.

---

## 0. Decisions recorded from the operator (2026-09-09)

1. Build the social layer as an **independent system** ("build independently"). Own repo, own service, own database. Not inside pyke, not inside hkpl.
2. Integration is by **adapters only**, "left or right": any host can mount the engine (host → engine) and the engine can call back into any host (engine → host). No host-specific code inside the engine core.
3. **pyke** stays the commerce engine behind the social layer; the pyke social experience must be TikTok/Xiaohongshu-shaped. pyke is not reshaped.
4. **hkpl** integrates through the same engine (engine as middleware) and keeps its league engine untouched. hkpl does not call pyke for social.
5. **SaaS is out.** Self-hosted only. No Stream, Amity, Firebase-only push, or vendor relays as dependencies.
6. Bedrock facts driving scope: hkpl already has a dormant open-play/clubs/feed/chat layer (modules off in prod), an Android Capacitor shell on Google Play, a complete but never-fired push pipeline (0 devices), and screenshot-receipt money. Reclub is ahead on product surface (native adoption, discovery, host automation, waitlist), not on engine.

---

## 1. Principles (binding on the build)

- **Host-agnostic core.** The engine knows `tenant_id` + `external_user_id` and nothing else about a host. Every host-specific behaviour lives in an adapter.
- **Adapter contract is the product.** A new host integrates by implementing a small, versioned contract (§6). If a feature needs host knowledge in the core, the design is wrong.
- **API-first, UI-second.** Every capability exists as an HTTP/WebSocket endpoint before any screen uses it. The uni-app package (§7) is one client of that API, not a privileged one.
- **Tenant-scoped everything.** Every row carries `tenant_id`; every query is tenant-filtered by middleware; cross-tenant reads are impossible by construction (probe §9).
- **No money in the engine.** Prices are display data. Payment is delegated to a host's pay provider (pyke) through the contract; the engine only records `payment_state` from webhooks.
- **Licence hygiene.** Superseded by §2b: the base is a Misskey fork under AGPL-3.0, published. Adapter code inside the fork is AGPL; host-side adapter code in pyke/hkpl keeps the host's licence. No proprietary host logic is copied into the fork.
- **Do not fill the shared box.** Media never lands on kaka's disk; object storage from day one (§8). Engine runs on its own box or after a reclaim with the build gate.
- **Contract-kit v6 governs the repo** (BLUEPRINT, START, probes, ledger, hook). Every phase ends with a proved probe, not a claim.

---

## 2. Architecture — DECIDED SHAPE (2026-09-09, operator direction: independent domain, shared across sites)

**Model C: one Misskey instance = the network and the identity home; each site is a community inside it; each site shows the network through its own front-end on its own domain.** Per-site instances (model B) only for a property that needs hard isolation later; external ids make that split possible.

| Layer | Decision | Evidence / level |
|---|---|---|
| Engine domain | `social.silkvo.com` → nginx → Misskey web + `/api` + `/streaming` | — |
| Media domain | `media.social.silkvo.com` → Aliyun CDN (or nginx proxy) in front of the OSS bucket; set as Misskey `objectStorageBaseUrl` | — |
| Object storage | **Aliyun OSS, region cn-hongkong** (same region as the box: box reports `cn-hongkong`, L4). Uploads via the internal endpoint `oss-cn-hongkong-internal.aliyuncs.com` (free intra-region bandwidth, pattern already used by studio and pyke containers, L4); public reads via the media domain. Misskey's client is `@aws-sdk/client-s3` + `lib-storage` with `objectStorageEndpoint/Region/S3ForcePathStyle/UseSSL/UseProxy` (L2, `S3Service.ts`). OSS is S3-compatible with V4 signatures but requires unsigned payload and rejects chunked transfer (L1, Alibaba docs). **Phase-0 probe `probes/oss-upload.cjs` must prove one video upload and read-back before anything else** (known risk: AWS SDK checksum defaults vs non-AWS S3). | L2/L4/L1 |
| Box | **DECIDED 2026-09-09: kaka (shared box), no CPU/RAM upgrade, disk to be added by operator.** Measured: 8 vCPU load ~4; 15.4 GB RAM, 5.3 GB available, **4 GB swap 100 % used** (box already pages); 12 GB disk free; 7 dangling images ≈ 7.3 GB safely reclaimable. Conditions: (1) cgroup caps — misskey 1536 MB, postgres 512 MB, redis 256 MB, transcode 1024 MB / `cpus: 2` / nice; total ceiling 3.3 GB; (2) **no image builds on kaka** — the public AGPL fork builds on GitHub Actions → ghcr; kaka pulls only; (3) prune the 7 dangling images (operator go) then add 40–50 GB disk; media on OSS, never on disk; (4) Meilisearch off, federation off, one transcode job at a time; accept slowdowns during other jobs' spikes. Same HK region, so the internal OSS endpoint applies. | L4 measurements 2026-09-09 |
| Compose | `misskey` (Node 26, web+api+queues), `postgres:16`, `redis:7`, `nginx`, `transcode-worker` (ffmpeg, CPU-capped; our addition), optional `meilisearch` later. Nightly `pg_dump` → OSS backup bucket (pyke's existing pattern). | — |
| Engine settings | `federation: none`; `disableRegistration: true`; hide content from logged-out visitors (2025.5.1 setting); per-role upload limits; `emailRequiredForSignup: false` (adapter creates users). | L2 `Meta.ts`, changelog |
| Sites inside | one **Channel** + one **Role** per site (hkpl, each pyke shop, kaka, mimi…); clubs/brands as sub-channels; site moderators = Role holders; explore scoped per site by the front-end, global explore off until content exists. | Misskey channels/roles (L2) |
| Identity | one account per person across the estate; username = `<site>_<external_id>` on first adapter sign-in; later sign-ins from another site link to the same person when the host passes a shared silkvo id (else separate accounts, mergeable). | — |
| Host faces | hkpl: Misskey PWA embedded in the existing Capacitor shell (day 1), `social-ui` screens later; pyke: `social-ui` uni-app screens in the storefront (H5 / WeChat MP / App). Tokens from adapter SSO in `Authorization`, CORS allow-list per host, no shared cookies. | — |
| Public face of social.silkvo.com | closed at launch (logged-out sees nothing); open the general feed only when community content makes explore alive. | operator direction |

```
 hkpl.com.hk (Capacitor)      pyke storefront (uni-app)      kaka / mimi …
        │ SSO JWT + API/WS            │ SSO JWT + API/WS             │
        ▼                             ▼                              ▼
 ┌────────────────────────── social.silkvo.com ───────────────────────────┐
 │ nginx → Misskey (web · /api · /streaming · queues) · transcode-worker │
 │ adapters/{hkpl,pyke,generic} · events module · refs resolver · push   │
 │ Postgres 16 · Redis 7 · (Meilisearch later)                           │
 └───────────────┬────────────────────────────────────┬──────────────────┘
                 │ S3 API, internal endpoint          │ signed webhooks / pay provider
                 ▼                                    ▼
   Aliyun OSS cn-hongkong  ──►  media.social.silkvo.com (CDN)     pyke (bookings, money) · hkpl (mirror)
```

### 2a. Original component notes (kept for reference)

```
                 ┌──────────────────────── hosts (left/right) ────────────────────────┐
                 │  pyke storefront (uni-app)   hkpl (Express + Capacitor shell)  …   │
                 └───────┬───────────────────────────┬─────────────────────────────────┘
        SSO JWT in │ REST/WS out                     │ webhooks out (HMAC)   host callbacks in
                 ┌─▼───────────────────────────────▼──────────────────────────────────┐
                 │                         SOCIAL ENGINE                              │
                 │  api (Fastify/TS)  ·  ws gateway  ·  worker (BullMQ)  ·  media     │
                 │  adapters/ (pyke, hkpl, generic) — loaded by config, not by code    │
                 └──┬───────────────┬───────────────┬─────────────────┬───────────────┘
                    │ Postgres 16   │ Redis 7        │ S3-compatible   │ ffmpeg/sharp
                    │ (own DB)      │ (queues, WS    │ object storage  │ (transcode,
                    │               │  pub/sub)      │ (media, HLS)    │  thumbnails)
                    └───────────────┴───────────────┴─────────────────┴───────────────
                    optional: Gorse (ranking, phase 4) · web-push / APNs / FCM (push)
```

- **Runtime:** Node 22, TypeScript, Fastify, Prisma, BullMQ, `ws`. Chosen to match the estate (hkpl is Node/Prisma; pyke is Node) so one team maintains all three.
- **Processes:** `api` (HTTP + WS), `worker` (fan-out, transcode, push, webhooks, reminders), `scheduler` (cron: event reminders, waitlist promotion sweeps, digest).
- **Storage:** Postgres 16 (own instance, own volume), Redis 7, S3-compatible bucket (MinIO on the engine box, or Aliyun OSS — operator decision §10).
- **Deployment:** Docker compose, bind-mounted dev loop (`dev.sh up` → hot reload, no image build per edit — rule N), one image build per feature. Ports proposed: api 3960, ws 3961, minio 3962/3963 (final numbers set at install, checked against `pm2 ls`/`docker ps`).
- **Box:** kaka is at 93 % disk / 3.5 GB RAM free with 12.75 GB of reclaimable Docker images. Engine footprint estimate (L0): 1–1.5 GB RAM idle, media off-box. Decision required (§10): dedicated box vs kaka-after-reclaim.

---

## 2b. Base codebase — FORK, do not build from scratch (operator instruction 2026-09-09)

**Pick: fork `misskey-dev/misskey`** (TypeScript/Node, PostgreSQL, Redis; 11.3k★; 2026.9.0 released 2026-09-06; monthly cadence). Verified in source and changelog on 2026-09-09 (L2):

| Need in this spec | Misskey already has it | Where |
|---|---|---|
| Closed, non-federated instance | `Meta.federation: 'all' \| 'specified' \| 'none'`, **default `'none'`**; `federationHosts[]` allowlist | `packages/backend/src/models/Meta.ts`; changelog 2023.10.0, 2025.5.0 |
| Media in object storage | `useObjectStorage`, `objectStorageBucket/Endpoint/Region/AccessKey/SecretKey/BaseUrl` | `Meta.ts` |
| Posts with images/video, reactions, collect-like (clips), follow, timelines, hashtags | notes + Drive files; `reactions`, `renote`, `reply`, `poll`, `visibility`, `localOnly`, `channel` | `NoteEntityService.ts` |
| Video upload | **client-side** compression on upload (2025.10.0); native browser players (2024.7.0); server only generates thumbnails (`VideoProcessingService`, fluent-ffmpeg). **No server transcoding, no HLS upstream** — see modification 10 | changelog; `VideoProcessingService.ts` |
| Closed to visitors | option to hide all content from logged-out visitors (2025.5.1); registration off by default; invite codes | changelog, `SignupApiService.ts` |
| Spaces | Channels (`channelId`, name, colour, owner) + Roles | `NoteEntityService.ts`, changelog 2023.9.0 |
| Chat | DM + rooms, reactions, mute, receipt policy (2025.4.0); push on new message (2025.4.1) | changelog |
| Push | web-push VAPID (`swPublicKey/swPrivateKey`) | `Meta.ts` |
| Auth surface | OAuth 2.0 provider (2023.9.0), MiAuth; passkeys | changelog |
| Explore | per-user Highlights (2023.10.0), Explore roles | changelog |
| API + realtime | full JSON API + Streaming (WebSocket) API | Misskey docs |
| i18n | `zh-TW`, `zh-CN` locales | repo `locales/` |
| Registration control | `disableRegistration` default true; `emailRequiredForSignup` | `Meta.ts` |

**Modifications to reach this spec (the fork's delta, in build order):**
1. **Adapter SSO in** — new endpoint `/api/adapter/sso` accepting the host-signed JWT (A1) → creates/links the Misskey user (`external_id` stored in a new column on `user`) → returns a Misskey access token. Misskey has OAuth *out* but no external login *in*; this is the one auth addition.
2. **Tenancy = one shared instance (model C, §2)**: one Channel + one Role per site, sub-channels for clubs/brands, front-ends scope queries per site. Zero core changes. A per-site instance (model B) is the exception for hard isolation, made possible by external ids.
3. **Events + RSVP module** — the only genuinely new feature: `event`, `rsvp` tables + endpoints (§4 Events) as a new backend module and a note kind "event" so events appear in timelines; waitlist auto-promotion, reminders, ICS, check-in; pay hook (P1) to the host.
4. **Product / host references on notes** — a `refs` JSON column on `note` + resolver call to the host (A3) at pack time; rendered as cards by the front-end.
5. **Outbound adapter webhooks (A2)** — Misskey has user/system webhooks (L1, verify at phase 0); extend the event list to the §4 set with HMAC + event id.
6. **Native push (P5)** — add APNs/FCM delivery beside web-push using hkpl's dispatcher pattern; `push_device` table.
7. **Explore-for-video** — a timeline endpoint filtered to notes with video files, ordered by the Highlights score; Gorse later.
8. **Front-end** — pyke: uni-app `social-ui` screens against the Misskey API (its API is POST-JSON with a generated `api.json`, easy to type). hkpl v1: **use Misskey's own PWA client as-is inside the hkpl Capacitor shell**, themed; replace screens with `social-ui` only where the experience demands (video feed). This is the "just use it" path for hkpl.
9. Disable/hide what we do not want: federation (`none`), public registration (`disableRegistration`), antenna/gallery/pages modules via Roles policies.
10. **Server-side video pipeline** — a worker that transcodes uploads to HLS (360p/720p) + mp4 + poster and writes variants to object storage; the stock server only makes thumbnails. Required for a TikTok-grade feed on mobile data. Yojo-Art's encode-format picker is a reference.

**Fork sweep (2026-09-09, L2 from repos and release pages):** no Misskey fork beats upstream as our base. Sharkey (Mastodon API, sign-up approval) sits on Misskey 2025.5 and its last own release is 2025.4.7 (May 2026 security fix); CherryPick (Korean) is silent since January 2026 on 2025.12; Yojo-Art (Japanese, CherryPick-derived) is active on 2026.6 but 20★ and removes channels; Iceshrimp.NET is a C# rewrite (no zh locales); Iceshrimp JS is maintenance-only; Firefish is dead (maintenance mode 2024-09, domain lapsed); **Catodon was abandoned in Nov 2025 and relaunched in 2026 as a Sharkey fork** (26.9.0 on 2026-09-08, 569 commits in 90 days, native Mastodon API, DMs, forums, blogs; but it removes Channels, Chat, Gallery and Clips, sits on a 2-star self-hosted forge after two relocations, and has no OIDC) — high churn, not a base; FoundKey is a v12-era hard fork in "limited maintenance"; live Japanese forks Kinel (niri-la, tracks 2026.9.0 within days), kakurega and Yojo-Art add niche features only; MisskeyIO's production fork tracks 2025.4; nyaone (Chinese-speaking) tracks upstream same-day with a thin patch set, a model for our own delta. **No fork of any lineage has inbound OIDC/SSO** (upstream issue #9132 open since 2022), so modification 1 is ours to write. CherryPick's own changelog (L2) lists DM/group messaging with remote invites, "event federation", scheduled notes and note editing with history, and its locales include zh-TW and zh-CN; the repo has had no push since 2026-02-03 (170★, based on Misskey 2025.12.2). Its groups and events code is the reference for modification 3, read before writing ours. Sharkey precise state: `stable` = Misskey 2025.4.1, `develop` = 2025.5.0, 31 commits in 90 days, canonical GitLab behind a bot wall today, no GitHub mirror; build from the shork.ch mirror if ever needed.

**Licence consequence (decision, not detail):** Misskey is **AGPL-3.0**. Running a modified Misskey as a network service obliges us to offer the modified source to the service's users (AGPL §13). Practical form: publish the fork publicly (e.g. `Venobbuk/social-engine`, AGPL). Adapters that live inside the fork are covered too; host-side adapter code in pyke/hkpl is not. **If the operator will not publish the fork, Misskey is out and the fallback below applies.**

**Upkeep cost (stated):** Misskey has no server-side plugin system, so the delta is a patch set on a monthly-moving upstream. Keep the delta small (the nine items above), keep it in clearly separated modules/files, and rebase monthly; budget half a day per upstream release.

**Fallback pick if AGPL is refused or hkpl-first is chosen:** `OpenMeet-Team/openmeet-api` + `openmeet-platform` (Apache-2.0, NestJS + Vue/Quasar with a `src-capacitor` target; groups, events with RSVP, schema-per-tenant multi-tenancy, OAuth incl. AT Protocol, Matrix chat; live at platform.openmeet.net; 26★/63★, small team). Exact shape for hkpl meets and clubs, permissive licence, but no video feed and a tiny codebase to lean on — more building, less using.

**Front-end observed live (2026-09-09, phone width 414 px, screenshots in `D:\Downloads\shots_social\`; L5 observation, L0 judgement):** Misskey's client is a real social-app UI: media cards in the feed, emoji-reaction rows with counts, reply/renote/react actions, profile with banner, avatar, badge chips, tabs and fields, explore with Highlights/Users/Roles tabs. Dense and capable, Twitter-shaped, default look is Japanese-community flavoured and needs theming and pruning; no full-screen video swiper. OpenMeet's client is a clean Material (Quasar) directory app: events list with cards, filters and online/in-person tags, event detail with a clear RSVP Going/Can't-go block, share and QR, groups list with photo, category, location and member count. Readable and purpose-fit for meets, but thin (v0.3.0, pagination renders 161 page buttons, AT Protocol links on every card) and it has no media feed at all. Verdict: Misskey is the better social front-end; OpenMeet is the better meets/groups screen set; neither is TikTok-shaped, which is why `social-ui` still builds the video feed.

**Rejected as the fork base:** HumHub (PHP, intranet UX), Mastodon (Ruby, no chat/video), Loops/Pixelfed (PHP, one maintainer, beta/stalled), NodeBB (forum shape), XiaoShiLiu/HongShu (learning projects, "禁止转卖"), Bluesky stack (engine partly closed).

## 3. Domain model (engine core; every table has `tenant_id`, `created_at`, `updated_at`)

> With the Misskey fork, this section maps onto Misskey's existing tables (`user`, `note`, `drive_file`, `note_reaction`, `following`, `channel`, `chat_message`, `notification`, `sw_subscription`, `webhook`) plus the **new** tables `event`, `rsvp`, `push_device`, `webhook_delivery` and the new columns `user.external_id`, `note.refs`. `tenant_id` becomes the instance boundary (§2b item 2).

| Table | Key fields | Notes |
|---|---|---|
| `tenant` | id, name, host_kind (pyke/hkpl/generic), brand (json, mirrors pyke `WHITE_LABEL_KEYS`), features (json), webhook_url, webhook_secret, sso_public_key | one row per mounted host instance |
| `identity` | id, tenant_id, external_id, handle, display_name, avatar_url, badges (json), locale, status | external_id = host's user id; unique (tenant_id, external_id) |
| `space` | id, tenant_id, external_ref?, slug, name, kind (club/brand/topic), visibility (public/members/private), banner, theme (json), settings (json) | club (hkpl) or brand/shop (pyke) |
| `space_member` | space_id, identity_id, role (owner/admin/mod/member), joined_at | |
| `post` | id, tenant_id, author_id, space_id?, kind (video/carousel/text), body, media (json[]), tags (text[]), refs (json[] of {host, kind, id}), visibility, status (pending/visible/hidden/deleted), stats (likes, collects, comments, shares, views), event_id? | `refs` = product refs for pyke, match/venue refs for hkpl |
| `media` | id, tenant_id, owner_id, kind, original_key, variants (json: hls, mp4, poster, sizes), duration, width, height, status (uploaded/processing/ready/failed) | object-storage keys only |
| `comment` | id, post_id, author_id, parent_id?, body, status, likes | threaded |
| `reaction` | (subject_kind, subject_id, identity_id, kind) | like / collect / emoji (v2) |
| `follow` | follower_id, target_kind (identity/space), target_id | |
| `block`, `report` | | report has reason, status, resolver_id |
| `feed_item` | identity_id, post_id, source (follow/space/explore), score, created_at | fan-out-on-write for following feed; explore is query-time |
| `event` | id, tenant_id, space_id?, host_id, title, starts_at, ends_at, venue (json: name, address, lat, lng, external_ref), capacity, format, level_min/max, price (json: amount, currency, mode fixed/split), access (public/members), status (open/full/cancelled/done), recurrence (json?), reminder_minutes, external_ref | the meet / the launch |
| `rsvp` | event_id, identity_id, status (going/waitlist/cancelled/no_show/attended), position, payment_state (none/pending/paid/refunded), payment_ref, checked_in_at | waitlist auto-promotes on cancel |
| `channel` | id, tenant_id, kind (dm/group/event/space), ref_id, members (via table) | ported from hkpl chat model |
| `message` | id, channel_id, sender_id, body, attachment (json), reply_to_id, reactions, edited_at, deleted_at | + `message_read` |
| `notification` | id, identity_id, kind, payload, read_at, pushed_at | |
| `push_device` | identity_id, platform (ios/android/web), token, app_version, last_seen | same shape as hkpl's |
| `webhook_delivery` | tenant_id, event, payload, attempts, status, last_error | idempotent, signed |
| `audit` | actor, action, subject, before/after | moderation + admin |

---

## 4. Engine API (v1) — REST + WebSocket

Base `/v1`. Auth: `Authorization: Bearer <engine session>` obtained from `/v1/auth/sso`. Every response tenant-scoped.

**Auth**
- `POST /v1/auth/sso` — body `{ jwt }` signed by the host (RS256, host public key on tenant). Claims: `sub` (external_id), `tenant`, `name`, `avatar`, `locale`, `roles[]`, `exp`. Creates/updates identity, returns engine session + refresh.
- `POST /v1/auth/refresh`, `POST /v1/auth/logout`.

**Identities** — `GET /v1/me`, `PATCH /v1/me`, `GET /v1/users/:id`, `GET /v1/users/:id/posts`, `POST/DELETE /v1/users/:id/follow`, `POST /v1/users/:id/block`, `POST /v1/report`.

**Spaces** — `GET /v1/spaces` (discover, filters), `POST /v1/spaces` (per tenant policy), `GET /v1/spaces/:id`, `PATCH`, `POST/DELETE /v1/spaces/:id/join`, `GET /v1/spaces/:id/members`, `GET /v1/spaces/:id/feed`, `GET /v1/spaces/:id/events`.

**Media** — `POST /v1/media/upload-url` (presigned PUT to object storage), `POST /v1/media/:id/complete` (enqueue transcode), `GET /v1/media/:id` (status + variants).

**Posts** — `POST /v1/posts` (kind, body, media_ids[], tags[], refs[], space_id?, visibility), `GET /v1/posts/:id`, `DELETE`, `POST/DELETE /v1/posts/:id/like`, `POST/DELETE /v1/posts/:id/collect`, `GET/POST /v1/posts/:id/comments`, `DELETE /v1/comments/:id`, `POST /v1/posts/:id/view` (batched).

**Feeds** — `GET /v1/feed/following` (cursor), `GET /v1/feed/explore` (cursor; v1 = recency × engagement score, v4 = Gorse), `GET /v1/feed/video` (explore filtered to kind=video, prefetch-friendly), `GET /v1/tags/:tag`.

**Events** — `POST /v1/events`, `GET /v1/events` (near lat/lng, date range, level, space, price), `GET /v1/events/:id`, `PATCH`, `POST /v1/events/:id/cancel`, `POST /v1/events/:id/rsvp` (→ going or waitlist by capacity; if price set → `payment_state=pending` + returns `pay_url` from the host pay provider), `DELETE /v1/events/:id/rsvp` (→ promote first waitlisted, notify), `POST /v1/events/:id/checkin/:identity`, `GET /v1/events/:id/roster`, `POST /v1/events/:id/duplicate` (recurrence helper), `GET /v1/events/:id.ics`.

**Chat** — `GET /v1/channels`, `POST /v1/channels` (dm/group), `GET /v1/channels/:id/messages` (cursor), `POST /v1/channels/:id/messages`, `POST /v1/messages/:id/react`, `POST /v1/channels/:id/read`, `GET /v1/chat/search`. Event and space channels are created automatically.

**Notifications** — `GET /v1/notifications`, `POST /v1/notifications/read`, `POST /v1/push/register`, `DELETE /v1/push/:id`.

**Admin (tenant-scoped, role admin)** — moderation queue, hide/restore, space management, feature toggles, exports (roster CSV), stats.

**WebSocket** `wss://…/v1/ws?token=` — subscriptions: `feed:new`, `post:{id}:stats`, `channel:{id}`, `event:{id}` (roster/waitlist changes), `notification`. Redis pub/sub behind; same wire shape as hkpl's (`{type, channel, payload, ts}`) so the chat port is mechanical.

**Webhooks out (engine → host)** — signed `X-Engine-Signature: sha256=HMAC(body)`, `X-Engine-Event-Id` for idempotency, retries with backoff, delivery log. Events: `identity.created`, `space.created`, `post.created|hidden`, `event.created|cancelled`, `rsvp.created|promoted|cancelled|checked_in`, `rsvp.payment_required` (carries event, identity, amount), `report.created`.

---

## 5. What the engine does NOT do (non-goals)

- No payments, ledgers, payouts, or price computation beyond display. (pyke.)
- No league, match, standings, rating computation. (hkpl.)
- No federation (ActivityPub/AT), no ads, no subscriptions in v1–v4.
- No host UI inside the engine repo beyond the admin console.
- No reshaping of pyke or hkpl. Adapters touch hosts only at documented edges.

---

## 6. Adapter contract (versioned `adapter/v1`) — what a host implements

A host is "mounted" when it provides the four items below. Everything else is optional.

| # | Host provides | Direction | pyke | hkpl |
|---|---|---|---|---|
| A1 | **Identity provider**: an endpoint that mints the SSO JWT for the logged-in user (`sub`, `tenant`, `name`, `avatar`, `roles`) | host → engine | new route in the pyke storefront BFF, signed with pyke's key | new route `GET /api/v1/sso/social` in hkpl (after sign-in-code login); 2,461/2,642 users have email, `sub` = hkpl user id so email is not needed |
| A2 | **Webhook receiver**: accepts signed engine events, idempotent on `X-Engine-Event-Id` | engine → host | marks orders/launch interest; optional | marks meet attendance in hkpl if hkpl keeps a mirror; optional |
| A3 | **Reference resolver**: `GET {host}/social/refs?kind=&ids=` returns display cards for `refs` in posts (name, image, price, deep link) | engine → host | product / variant / seller cards from Medusa store API | match, venue, team cards |
| A4 | **Brand record**: name, logo, colours, template (mirrors pyke `WHITE_LABEL_KEYS`) | host → engine | already exists in pyke shop settings | already in `Tenant.feature_flags` per 09-05 spec |

Optional capabilities a host may add:

| # | Capability | pyke | hkpl |
|---|---|---|---|
| P1 | **Pay provider** for priced events: `POST {host}/social/pay/create` → `{ pay_url, ref }`; host later calls `POST /v1/events/:id/rsvp/:identity/payment` `{ state, ref }` (signed) | pyke creates a booking/order for the event seat; pay page = deep link (v1) → embedded sheet (later). Both Reclub pricing modes (fixed per head, cost-split) computed here, not in the engine | hkpl has none; hkpl priced meets use pyke's provider **through the engine** (this is the middleware path the operator chose) |
| P2 | **Space sync**: host pushes its organisations as spaces (`external_ref`) | sellers → brand spaces | 196 clubs → spaces, managers → space admins |
| P3 | **Auto-posts**: host posts system content via a service token | "new drop", "order shipped" (opt-in) | rating change, match won, season milestones (replaces hkpl's `auto` FeedPost) |
| P4 | **Event source**: host mirrors its own events into engine events | launches, pop-ups, classes | migrate `OpenPlaySession` rows (4) into events; keep hkpl `module_open_play=false` and point hkpl's nav at the engine pages |
| P5 | **Push transport**: host lends APNs/FCM credentials for its app bundle | pyke app bundle when it exists | `com.hkpl.app` APNs/FCM keys already configured in hkpl prod env — reuse; PushDevice registration moves to the engine |

Adapter code lives in the engine repo under `adapters/<host>/` and is selected per tenant by config. A generic adapter (JWT + webhooks only) is enough to mount any future host.

---

## 7. Front-end — DECIDED 2026-09-09: stock Misskey client everywhere it can be shown; build only what it lacks

- **hkpl:** Misskey web client inside the existing Capacitor shell (`com.hkpl.app`), themed to hkpl. All stock screens. Zero front-end work at launch.
- **pyke H5 / App:** stock client in a web view inside the uni-app storefront, themed to the shop.
- **pyke WeChat mini-program:** stock client via the mini-program `web-view` component, with `social.silkvo.com` registered as a business domain.
- **Built by us, v1:** ONE uni-app page — the full-screen vertical video feed (autoplay, swipe, like, comment sheet, product card from `refs`) against the video explore timeline (modification 7). Mounted in pyke first.
- **Built by us, later, only if usage demands:** the Xiaohongshu-style notes waterfall; any stock screen that proves unfit in the phase-1 real-cursor walk.
- Theming: tenant brand record → Misskey theme + CSS variables; per-site skin applied by the embedding host.

The earlier full `social-ui` screen list below is retained for reference only; it is NOT v1 scope.

### 7a. Original screen list (reference, not scope)

One Vue 3 / uni-app package compiled three ways: WeChat mini-program, H5, App (via the host's shell). Consumes only the engine API. Themed entirely from the tenant brand record (tokens → CSS vars), so pyke's storefront and hkpl look like themselves.

Screens (v1 unless marked): Explore video feed (full-screen vertical swiper, autoplay, prefetch 2) · Notes waterfall (2-column, image carousel on tap) · Post detail + comment sheet · Composer (video/carousel/text, tag, add ref via host resolver, choose space) · Profile (posts, collects, follows) · Space page (feed, members, events) · Search (tags, spaces, people) · Notifications · Events list + map + detail + RSVP/waitlist/pay (v2) · Chat inbox + channel (v3) · Settings.

Mounting: pyke storefront imports the package as pages; hkpl embeds the H5 build under its Capacitor shell (`shell-webview`) with SSO handled by A1. Reference UIs (looked at, not copied): zyronon/douyin for the swiper feel, Bluesky `social-app` for feed/profile information architecture.

---

## 8. Non-functional requirements

- **Media:** video ≤ 3 min / 200 MB upload, transcoded to HLS (360p/720p) + mp4 fallback + poster; images resized to 1080/480 widths. All in object storage; CDN in front when traffic warrants. Transcode worker CPU-capped (`systemd-run`/compose limits) — never OOM the box.
- **Feeds:** following feed fan-out-on-write capped at 5k followers (beyond that, fan-out-on-read); explore = time-decayed engagement score in v1, Gorse in v4.
- **Realtime:** WS with heartbeat, resume cursor; `/poll` fallback.
- **Push:** APNs (token auth), FCM v1, web-push; per-device, per-kind preferences; digest for noisy kinds.
- **i18n:** en, zh-Hant, zh-Hans in UI and notification templates; content is user-language.
- **Moderation:** report queue, keyword/LLM pre-screen hook (host-pluggable), rate limits per identity, block/mute.
- **Privacy:** PDPO-conscious: export and delete per identity; media purge on delete; no third-party analytics SDKs in v1.
- **Observability:** structured logs, request ids, Prometheus metrics, error tracking self-hosted (no Sentry SaaS).
- **Security:** RS256 host keys, HMAC webhooks, presigned uploads, tenant guard middleware with a negative test in CI.

---

## 9. Phases with acceptance probes (each phase = probes proved L5/L6 on the running dev instance before DELIVER)

| Phase | Scope | "Done" probe (observable) |
|---|---|---|
| **0 Bootstrap (fork)** | fork Misskey → `social-engine`, contract-kit v6, compose on the chosen box, `federation: none`, `disableRegistration`, object storage wired, dev loop (bind-mounted backend, `pnpm dev`), adapter SSO endpoint, `user.external_id` | `probes/sso.cjs`: host-signed JWT → `/api/adapter/sso` → Misskey token → `/api/i` returns the linked user; a second instance cannot read the first (negative probe); `probes/no-fed.cjs`: `/.well-known/nodeinfo` and inbox respond closed |
| **1 Core social (mostly stock)** | verify stock notes/video/reactions/follow/timelines/chat/web-push on the real path; add `note.refs` + resolver cards; video explore timeline; first adapter mounted; `social-ui` video feed + notes waterfall for pyke, stock PWA in hkpl shell | `probes/post-to-feed.cjs`: upload video → object storage → note → appears in a follower's home timeline over the Streaming API within 2 s → reaction count updates; `probes/ref-card.cjs`: a note with a pyke product ref renders name/price from the resolver |
| **2 Events + pay seam** | events, RSVP, capacity, waitlist auto-promotion, reminders, check-in, ICS, event channel, pay provider contract with pyke (deep-link) | `probes/waitlist.cjs`: capacity 2, three RSVPs → third is waitlist → first cancels → third promoted + notified; `probes/pay-seam.cjs`: priced event → `pay_url` from pyke → pyke webhook → `payment_state=paid`, RSVP confirmed (needs pyke booking on the real path — gated on pyke readiness) |
| **3 Chat** | use Misskey chat (stock) for DM/rooms; add event/space auto-rooms; bring voice notes + transcript search from hkpl's package only if stock chat lacks them after the phase-1 walk | `probes/chat.cjs`: two identities exchange text + voice in an event room over the Streaming API; unread counts; search hits transcript |
| **4 Ranking + hkpl surfacing** | Gorse explore, hkpl competition/rating posts, club spaces sync, hkpl nav switch | `probes/explore-rank.cjs`: two users with different follow graphs get different explore orders; `probes/hkpl-sync.cjs`: 196 clubs mirrored, manager roles correct |

Real-cursor browser walk (rule G) once per phase, last before DELIVER. Working-set freeze after each proved phase (rules Q/R).

---

## 10. Decisions the operator must make (blocking items marked ⛔)

0. ✅ **AGPL: YES** (operator, 2026-09-09) — fork is public; base = Misskey.
0a. ✅ **Dangling-image prune DONE 2026-09-09** (`docker image prune -f`, operator go): **342 MB** freed, not the estimated 7.3 GB — the large dangling images are pinned by running/stopped containers and Docker protects them. Further reclaim needs per-image decisions (rollback images) and is not required once the operator adds disk. Two stopped containers noted, not touched: `magical_brown` (anonymous, OOM-killed 6 days ago) and `gemini-gateway-prod` (superseded by `shared-infra-gemini-gateway-1`).
1. ✅ **First adapter: hkpl** (operator, 2026-09-09). Phase 1 ships with hkpl mounted: SSO endpoint in hkpl, 196 clubs → channels, Misskey client in the `com.hkpl.app` shell; pyke adapter follows.
2. ✅ **Box: kaka, no CPU/RAM upgrade, disk added by operator** (operator, 2026-09-09; conditions in §2). Media storage: **Aliyun OSS cn-hongkong** — needs the bucket name and a key pair scoped to it (operator creates; I never handle credentials).
2a. **Model C (one shared instance, communities per site, host-branded faces, public face closed at launch)** — confirm.
3. ⛔ **PROJECT root + repo name** for contract-kit v6: proposed `root@<box>:/root/social-engine`, GitHub `Venobbuk/social-engine` (private).
4. **Pay seam owner:** confirm pyke is the ledger for priced events on both hosts, superseding hkpl's Stripe-direct blueprint of 2026-08-03.
5. **hkpl migration mode:** replace hkpl's dormant open-play/feed with engine pages (recommended: nothing to lose, 4 sessions and 1 human post), or run both.
6. **Ranking:** Gorse in phase 4 (extra process) or stay on the simple score.
7. **Video ceiling:** 3 min / 200 MB proposed; change if pyke wants longer.

---

## 11. Risks (stated, not solved)

- **Engagement, not code, is the risk.** hkpl's 386 monthly actives and pyke's early customer base will not fill feeds alone. Launch plan must include anchor-hosted events and seeded creator/brand posts, or the module launches to an empty room like hkpl's own feed did (61 auto posts, 1 human).
- **pyke booking is not deployed yet** (proven on a branch, multi-tenancy off, hkpl tenant not provisioned). Phase 2's pay probe cannot go L6 until that lands; the contract is fixed now so both sides build to it.
- **Video costs real CPU and storage.** Off-box storage and capped transcoding are non-negotiable; a CDN becomes necessary before any real traffic.
- **Bus factor.** One more system in the estate. Mitigated by same-language stack, contract-kit discipline, and the adapter boundary keeping hosts ignorant of engine internals.

---

## 12. Sign-off

SIGN-OFF: no — operator signs.
Signing this means: build phase 0 and phase 1 as specified, with the first adapter named in §10.1, on the box named in §10.2, under contract-kit v6 at the root named in §10.3. Anything not in this document is out of scope until the document changes.

# hkpl (+HumHub +pyke) vs Reclub — BEDROCK COMPARISON (2026-09-09)

Contract loaded — proof-levels on, optimism off.
Companion to `HKPL_SOCIAL_PLATFORM_HANDOVER_20260909.md` and `RECLUB_TEARDOWN_20260909.md`. Nothing built. This is the review-before-spec the operator asked for.

Proof levels used: **L2** = read in source / official docs / changelog · **L4/L5** = read from the RUNNING prod DB or box tonight (read-only SQL, `docker exec hkpl-docker-hkpl-db-1 psql`) · **L1** = recalled from a memory note or a summary · **L0** = my judgement.

---

## 0. The one finding that changes the question

**hkpl already contains most of Reclub's MVP in code — and none of it is switched on.** The handover said "no product code written for this yet". That is true for the *pivot*, but false for hkpl itself: an open-play / clubs / feed / follow / chat layer was built in July–August 2026 and then left dark.

| Reclub MVP surface | hkpl today (L2 = `prisma/schema.prisma` + `routes/*.js`) | Prod usage (L5, tonight) |
|---|---|---|
| Meet = session + capacity + RSVP | `OpenPlaySession` (capacity, dupr_min/max, fee, guest_fee, access, status open/full/cancelled) + `OpenPlaySignup` (status `signed_up\|waitlist\|cancelled`) + `OpenPlayGuest` · routes `open-play.js` (12 endpoints: create, signup, guest-signup, schedule, games, score, submit-dupr) · pages `open-play.html`, `open-play-live.html`, `open-play-manage.html`, `open-play-guide.html` | 4 sessions, 5 signups, 8 guests, 10 games. **Feature flag `module_open_play = false` on hkpl** |
| Round robin / live board | `OpenPlayGame` (round, court, p1–p4, score) + `POST /:id/schedule` + live board + QR spectator (per `docs/CASUAL_PLAY_MODEL_2026-07-30.md`) | 10 rows |
| Clubs as pages | `Club` (banner, theme colours, section_config, sponsors, descriptions in 3 languages) + `ClubMembership` (join/leave) + `ClubManager` · pages `clubs.html` (985 lines), `club.html`, `club-directory.html` | 196 active clubs, 46 managers, **0 memberships** (nobody has ever "joined" a club feed) |
| Feed / kudos / comments | `FeedPost` (moderation, media, auto-events), `FeedComment`, `FeedKudos` · `routes/feed.js` 13 endpoints · `feed.html` 842 lines | 61 posts, all `auto` (rating changes); 1 human text post (deleted); 1 comment; 1 kudos |
| Follow / block / DM / QR | `UserFollow`, `UserBlock`, `routes/social.js` (follow, followers, block, dm/start, qrcode) | 10 follows, 0 blocks |
| Chat | `ChatMessage` (channels `team: office: dispute: match: user:`), attachments image/voice/video/file, reply_to, reactions, search incl. voice transcripts, WS server + Redis pub/sub · `messages.html` 1,375 lines | 177 messages total, 10 DM threads; last message today |
| Competition engine | `Tournament` + `TournamentEntry` + `Bracket` + `BracketMatch` (`brackets-manager` dep) + the whole league engine (Season/Division/Team/Match/Game, rules engine, standings, disputes, referee, live-score) | 4 tournaments / 25 entries; **league: 1,816 matches, 800 teams, 901 registrations, 14 seasons** — used daily |
| DUPR | `DuprPlayerSnapshot`, `DuprWriteQueue`, `DuprWebhookEvent`, partner-API client, `SocialGame` submit | 5,274 snapshots; 2,190 hkpl users with a DUPR id |
| Venues / map | `Venue` (lat/long, district, google/amap place ids, court_count) + `map.html` + `/venues/map` | 60 venues, all geocoded, all approved |
| Push | `PushDevice` (ios/android/web/wechat) + `lib/push-dispatcher.js` (APNs via node-apn, FCM via firebase-admin, web-push) | **0 device rows** |
| Money | `Payment` model (stripe/alipay/wechat_pay/fps/bank_transfer) · `Registration.receipt_url` + `receipt_approved` | **Payment: 0 rows. Registrations: 344/356 paid by uploaded receipt screenshot** |

**Reading:** hkpl = a heavily-used league engine (Reclub's "crown jewel", already live) + a complete-on-paper but *dormant* open-play/social layer + screenshot-receipt money (same as Reclub). What hkpl lacks is not code, it is **activation, product polish, discovery and a shipped native shell**.

So "just add HumHub" does not fill an empty slot. It puts a **second** social layer (PHP, MySQL, second identity, second chat, second feed, second club object) next to a dormant Node one that already joins to users, DUPR, venues, teams and matches.

---

## 1. Bedrock facts (what each system actually is)

### hkpl (L4/L5 unless noted)
- **Users, hkpl tenant:** 2,642 (2,466 active). 2,461 have email, 838 have a password, 1,001 have a phone (0 verified), 2,190 have a DUPR id. Apple / WeChat sign-in columns exist but **0 users** use them. Login is magic-link / sign-in code (2,559 `SignInCode` rows). Sessions alive now: 2,190.
- **Engagement (honest):** `last_seen_at` in last 30 days = **386** (14.6 %); last 90 days = 388. The "2,000 members" are a registration base, not a daily-active base. This is the real number to build against.
- **Roles:** 2,322 PLAYER, 316 CAPTAIN, 3 TENANT_ADMIN, 1 REGISTRAR.
- **Money today:** 0 real payments. 344 registrations paid by receipt screenshot, 332 approved by hand. Identical mechanic to Reclub.
- **Modules:** `module_open_play`, `module_social_games`, `module_tournament` = **false** on prod. Nav (`site-header.js`) does link `open-play.html`, `clubs.html`, `social-games.html` but the module gate hides them.
- **Native app (CORRECTED 2026-09-09 after operator challenge):** an Android app **exists and is published**: Google Play lists "HKPL - Hong Kong Pickleball" by sio chi hang, package `com.hkpl.app` (L2, Play search page; the listing shows "0+ Downloads"). The built bundle is on the box: `/root/app-release.aab` (6.6 MB, 2026-07-07) with `capacitor.config.json` inside pointing `server.url` at `https://hkpl.silkvo.com` (L2, read from the bundle). The web side is wired for it: `native-bridge.js` calls `PushNotifications.requestPermissions/register` and posts to `/api/v1/push/register`, mounted in `server.js:448`; `app-mode.js` and `shell-webview.js` give the native shell its own app-bar and 5-tab bar. nginx shows Android WebView (non-WeChat) traffic on the prod hosts: 1,365 hits on hkpl.silkvo.com and 628 on www.hkpl.com.hk in the previous log file, from about five IPs (L5). **iOS:** no HKPL app found in the HK App Store (bundle lookup for `com.hkpl.app` returns 0; a 198-app "pickleball" search has no HKPL entry) (L2). My earlier statement "no shipped native shell" was wrong for Android; I had searched only `/root/*` at depth 3 and missed the bundle at `/root`.
- **Push (precise):** the pipeline is complete in code and configured in prod: APNs key, FCM service account and VAPID keys are all set in the container env; dispatcher sends via node-apn, firebase-admin and web-push. But **`PushDevice` has 0 rows in prod** (L5), so no device has ever completed registration and no native push has ever been delivered on the real path. Push is L3 (shipped), not L6 (observed working).
- **Realtime:** own WS server (`lib/ws-server.js`) on Redis pub/sub, plus a `/chat/poll` fallback.
- **Stack:** Node/Express/Prisma/Postgres 16/Redis, Docker on :3939, dev loop `/root/hkpl-docker/dev.sh up` → :3949 hot reload, contract-kit already installed in `/root/hkpl-dev`.
- **Its own commerce decision (L2, `docs/BLUEPRINT_commerce_payments_monetization.md`, 2026-08-03):** "thin Stripe Checkout inside the current app; Stripe Connect for splits; skip the framework, take the processor." ⚠️ This **conflicts** with the 2026-09-09 decision "pyke is the payment backend". Must be reconciled in the spec (see §5).

### HumHub (L2, docs/marketplace/changelog/source)
- PHP 8.x / Yii2, **MySQL 8+ or MariaDB 10.11+** (InnoDB, utf8mb4). AGPLv3 Community Edition; Professional Edition is paid. Minimum PHP memory 64 MB; realistically a php-fpm + nginx + MariaDB set ≈ 1 GB of images and 400–800 MB RAM.
- **Calendar module 1.9.4 (2026-09-08):** `CalendarEntry` has `max_participants`, `participation_mode`, `allow_decline`, `allow_maybe`, `participant_info`; recurring events; reminders; ICS; participant export CSV/XLSX; REST support since 1.1.7. **No waitlist**: 0 issues match "waiting list/waitlist" in the repo, nothing in the changelog, nothing in `CalendarEntry.php`. Full = closed.
- **JWT SSO module 1.2.0 (2026-07-22):** `…/user/auth/login?jwt=<token>`, HS256 default, matches on `id | email | guid | username`, auto-creates users, can mark profile fields "managed by broker", `autoLogin` can redirect guests to the broker. → hkpl can mint the token; 2,461/2,642 users have an email to match on; the 181 without need a `username` claim.
- **REST API module 0.12.2 (2026-07-16):** beta, covers users/spaces/content/calendar/mail/… Webhooks: HumHub has an internal PHP event system, not outbound webhooks; the pyke→HumHub "mark paid" step would be a REST call *into* HumHub (or a tiny custom module).
- **Live updates:** polling by default; optional Node `humhub-pushservice` (WebSocket/long-poll, needs Redis). Push notifications need the Firebase module plus HumHub's push relay.
- **Chat:** the official "Messenger" (mail) module = threaded messages, not a WhatsApp-grade chat. **FreiChat is deprecated** (v1.0.3, 2020, third-party SaaS). No maintained real-time group chat.
- **Mobile:** official Flutter app, **HumHub-branded** on both stores (App Store: 4.0★ from 2 ratings, v1.2.80), user connects to a network. Open source, so a fork under our own listing is possible but is a Flutter project to own. White-label module only removes "Powered by HumHub".
- **Shape:** corporate intranet / community. Spaces, streams, wiki, tasks, polls. Nothing sport-shaped: no rating band, no per-head price, no guest signup, no round robin, no host/roster tools.

### Reclub (L2 binary/help centre; HK liquidity L5 from an earlier measurement)
- Expo React Native app-only, MQTT real-time, DUPR partner, ads + RevenueCat subs, **no payments** (screenshot receipts — a March 2026 HK meet literally titles itself 「先付款確認留位」and takes HK$160/head off-platform).
- Organiser tools (their own page): round-robin generator, RSVP with **automatic waitlist**, sort by skill, court assignments, mark paid/checked-in, **automated weekly activities with auto-invite**, tournaments/leagues, kudos + Street Cred.
- HK live liquidity when measured: ~41 upcoming sessions / ~250 open spots across ~10+ clubs; follower counts large (PicklePop 9.9k) but soft.
- Weaknesses from reviews: crashes, blank chats after updates, weak map discovery, no no-show enforcement, janky screenshot payments.

### pyke (L1, from memory notes — not re-read tonight)
- Money law, commission, settlement, payout, per-tenant ledger: **live** (New Yaohan). Booking engine Phase 0 (no-double-booking) **proven L6 on a branch, not deployed**. Multi-tenancy **built but OFF**; hkpl tenant **not provisioned**; owner self-serve court setup has P0 gaps. Booking sweep/fulfilment defaults OFF.
- So "pyke is more excellent" is true for the *money* half and *not yet true* for the booking half on the real path.

---

## 2. Head-to-head: strengths and weaknesses

### Reclub — strengths / weaknesses
**Strong:** polished consumer native app; global network + multi-sport; competition engine + DUPR bulk submit; organiser automation (weekly auto-meets, auto-invite, waitlist, check-in); Street Cred as a no-money trust layer; free + ad-funded so hosts feel no cost.
**Weak:** app-only (no web, no SEO, no share-to-WhatsApp landing that converts without install — their meet page only offers "Open app"); no money held → no deposits, no refunds, no real no-show enforcement; clubs are follower pages, not real member rolls; HK liquidity thin; stability complaints; monetisation depends on ads, which HK organisers and players tolerate but do not love.

### hkpl today — strengths / weaknesses
**Strong:** the league engine Reclub calls its crown jewel is already live and used daily (1,816 matches); real identity (2,642 verified people, 2,190 DUPR-linked, 316 captains = a ready host pool); 196 real clubs with managers; 60 geocoded venues; a WhatsApp-grade chat (voice, reply, search-transcripts) Reclub does not have; trilingual; web + PWA (installs from a WhatsApp link, no store gate); an open-play + round-robin + guest + DUPR-submit layer already coded.
**Weak:** the social layer is **off and unproven** (0 club joins, 0 human feed posts, 4 sessions); engagement 386/30 d; **no shipped native shell / 0 push devices**; no meet discovery surface ("meets near me", map of sessions); no host automation (recurring meets, auto-invite, check-in, mark paid); waitlist exists as a status but **no auto-promotion on cancel** (`DELETE /:id/signup` just sets `cancelled`); money is screenshot receipts, same as Reclub; single-sport, single-city.

### hkpl + HumHub — what it adds / costs
**Adds:** a finished feed/stream/spaces UX; calendar events with `max_participants`; comments/likes/mentions; a HumHub-branded mobile app for free; marketplace modules (polls, wiki, files); JWT SSO in a day.
**Costs:** a second stack (PHP + MySQL) on a box at 93 % disk / 3.5 GB RAM free; a **second identity store** (hkpl User ↔ HumHub user via JWT); **second club object** (Space) with no link to hkpl's `Club`/teams/venues; **second chat** (Messenger, non-realtime) beside hkpl's; **second feed** beside hkpl's; polling live-updates unless we also run `humhub-pushservice`; **no waitlist**; a Calendar event has no DUPR band, no guest signup, no round robin, no host tools → all the sport-shaped features Reclub has would have to be built as HumHub PHP modules or bolted on outside; the mobile app says "HumHub" unless we fork the Flutter app; every pyke seam (price, pay, mark-paid) is a custom HumHub module on top of a beta REST API. Net: HumHub matches Reclub on *feed + spaces* and is **behind hkpl's own dormant code on meets, chat, DUPR and venues**.

### hkpl + HumHub + pyke (the decided path) vs Reclub
Beats Reclub on: money held (deposits, refunds, no-show fees, payouts), real member rolls, league engine, DUPR depth, web + PWA reach, HK-native payments (FPS/PayMe/Alipay HK via pyke's rails when wired).
Loses to Reclub on: native polish and stability, organiser automation, waitlist, discovery/map, real-time chat inside the meet, multi-sport/global network. And carries three systems (hkpl, HumHub, pyke) with three data models for the same person, club and event.

### hkpl (own social layer switched on) + pyke vs Reclub
Same wins as above, **plus**: one identity, one chat (the better one), one club object joined to teams and venues, one DB to query for "who is free Thursday at 3.5 DUPR near Kowloon", no PHP, no second box footprint, contract-kit + dev loop already in place. Loses to Reclub on the same product gaps (native app, automation, discovery), which have to be built in *either* option — the difference is whether they are built once in Node or as PHP modules on HumHub.

---

## 3. The gap list to beat Reclub (option-independent)

These have to exist whichever container the social layer lives in. Ordered by what Reclub users would notice first.

1. **Discovery:** "meets near me / this week" list + map + filters (level, format, district, price) with a **public web landing per meet** that converts from a WhatsApp share without an install (Reclub cannot do this).
2. **Host automation:** recurring/weekly meet templates, auto-invite last week's players, check-in, mark paid, roster export. (Reclub has all four.)
3. **Waitlist with auto-promotion + notify** on cancel (hkpl: status exists, promotion missing; HumHub: nothing).
4. **Push + native shell:** ship the Capacitor wrap (playbook is written; Mimi/Kaka pattern) and register devices; WhatsApp deep-link share cards.
5. **Money at the gate (v2):** price per head or cost-split, pay-to-confirm, deposit, refund on cancel window, no-show fee, host payout — this is the pyke seam and the only thing Reclub structurally cannot copy.
6. **Trust without money:** a Street-Cred-like reliability score (attendance / no-show) so free meets also self-police.
7. **Anchor-host operations:** hkpl's own weekly sessions seeded from the 316 captains + 60 venues, because 386 monthly-actives will not fill meets on their own.
8. Phase 3: competition engine surfaced to social hosts (already exists for the league).

---

## 4. The three open items, resolved with evidence

**Waitlist.** HumHub: no native waitlist (L2, repo + changelog + source). Accept "full = closed" if HumHub. hkpl: waitlist status exists in `OpenPlaySignup`, promotion missing — a ~20-line change in `routes/open-play.js` (on cancel: promote oldest `waitlist` → `signed_up`, notify via existing `lib/notify.js`).

**SSO / import.** If HumHub: JWT SSO module, hkpl mints an HS256 token with `{email, username: user.id, fullname, guid}` at a new `GET /api/v1/sso/humhub` after the normal sign-in-code login; HumHub auto-creates on first hit; the 181 email-less users match on `username`. No CSV import needed and no second password. If hkpl's own layer: **no SSO problem exists**, the 2,642 users are already in.

**Chat.** HumHub Messenger is a threaded mail system with polling; the only real-time module is deprecated. hkpl's chat is WS-based with voice, reply, reactions and transcript search — it is the better product and it is already the operator's. If HumHub is adopted, run hkpl chat as the meet chat and hide HumHub Messenger, or accept two inboxes. If hkpl's own layer, add a `meet:<id>` channel (the channel convention already supports it).

---

## 5. Conflicts and constraints to settle before the spec

1. **Stripe-in-hkpl vs pyke-as-backend.** hkpl's 2026-08-03 blueprint chose Stripe Checkout inside hkpl. The 2026-09-09 decision routes money through pyke. Both cannot be the ledger of record. Recommendation: pyke is the ledger (operator's estate law), hkpl calls pyke's API; Stripe (or whatever pyke uses) sits under pyke. Needs an explicit yes.
2. **pyke readiness (L1):** booking engine not deployed, multi-tenancy OFF, hkpl tenant not provisioned. The v2 seam cannot be spiked end-to-end until those land. The spec should treat pyke as an interface contract now and a live dependency later.
3. **Box:** 12 GB free / 93 %, 3.5 GB RAM available, 12.75 GB of reclaimable Docker images (`docker system df`). A HumHub stack fits only after a reclaim, and only with the build gate. hkpl's own layer needs **zero** new footprint.
4. **Native app truth:** confirm whether an hkpl store app exists. The DB says no device has registered.
5. **Engagement truth:** 386 monthly-actives, not 2,000. The plan must include activation (anchor-hosted sessions + WhatsApp share) or the platform launches to a quiet room regardless of container.

---

## 6. Options (operator decides — surfaced, not lunged at)

| | A. HumHub v1 (as decided) | B. Switch on hkpl's own layer, polish to Reclub parity | C. Hybrid: HumHub for feed/spaces only, hkpl for meets/chat |
|---|---|---|---|
| New stack | PHP + MySQL + optional Node pushservice | none | PHP + MySQL |
| Identity | 2 stores via JWT SSO | 1 | 2 |
| Meets | Calendar event, no waitlist, not sport-shaped | existing OpenPlay* (capacity, DUPR band, guests, round robin, DUPR submit), add promotion + discovery | hkpl |
| Chat | HumHub Messenger (polling) or hkpl's beside it | hkpl's | hkpl's |
| Clubs | Spaces (unlinked to teams/venues) | existing Club + ClubMembership | both (duplicate) |
| Mobile | HumHub-branded Flutter app free; fork to brand | Capacitor wrap per playbook | both |
| pyke seam | custom HumHub module + REST | one route + one webhook in hkpl | hkpl side |
| Time to a demoable free v1 | stand up HumHub + SSO + Calendar config ≈ days; sport features weeks in PHP | flip flags on uat, fix promotion, build discovery page + host template ≈ comparable days, in the stack with a dev loop and contract-kit | worst of both |
| Box risk | needs reclaim | none | needs reclaim |
| Beats Reclub on | money (v2), members, league | money (v2), members, league, chat, one data model | as A |

**My read (L0):** the HumHub decision was made before the inventory in §0 existed. Given the inventory, **B** is the bedrock-honest path: hkpl is not "lacking the social layer", it is lacking the *switch-on and polish* of a social layer it already has, and HumHub would give you a second, less sport-shaped copy of it plus a PHP stack on a full box. HumHub's real remaining advantage is a finished feed/stream UX and a free (HumHub-branded) app; neither is the thing that beats Reclub. The things that beat Reclub — money at the gate, members, league engine, HK-native chat and payments — all already live in hkpl + pyke.

This is not a re-litigation; the operator's reasoning ("different workflows, different systems; adopt whole, don't reshape") stands for **pyke**. The new fact is only that hkpl already *is* the social system.

---

## 6b. Two questions raised mid-review

**"Can uni-app be the frontend for HumHub, since HumHub is PHP?"** Technically yes: a uni-app client only needs HTTP, and HumHub exposes a REST module (0.12.2, **beta, "API may change"**; covers users, spaces, content/posts, comments, likes, notifications, activity, calendar, mail, files, polls, tasks, wiki — L1 from the module's docs index, not exercised). But doing so throws away HumHub's only strong asset, its finished UI, and keeps a PHP backend with a beta API in front of which you rebuild every screen. At that point hkpl's own Node API is the better headless backend: the models and JSON routes in §0 already exist, and hkpl already serves a WeChat-webview shell (`lib/shells.js`: mobile / webview / desktop-pro; `shell-wechat-mini.js`). Note also that the operator's own 2026-09-05 spec (`docs/SPEC_HKPL_PYKE_PLATFORM_2026-09-05.md`, L1 "yes, just do it") already fixes **pyke's storefront = uni-app/Vue → H5 + WeChat mini-program** and rules that HKPL's chat/receipts/live scoring "cannot cross to uni-app without loss". So uni-app is already the shop frontend in the estate; the social layer does not need a second one.

**"Social layer on top, shop behind — a more advanced, stickier model?"** As a business model, yes; as engineering, it is two products to run. Discussed in the chat reply; the short version: the community solves customer acquisition (the expensive half of e-commerce), commerce funds the community, and the layer only sticks when it is *utility-social* (find a game, RSVP, rating, chat) rather than a posting feed. hkpl's own data proves that: 61 auto posts, 1 human post, 0 club joins, versus 1,816 league matches.

## 6c. Reusable social module — the adopt-whole candidates (Node / API-first), reviewed 2026-09-09

Operator reframe: hkpl's code is proprietary and not portable; the goal is a **reusable social layer** that plugs on pyke (Xiaohongshu-style) and any other property. Candidates (L2 = official docs/pricing pages; L0 = my fit judgement):

| Engine | Stack | Shape | Plug-in surface | Fit for "module on pyke" |
|---|---|---|---|---|
| **NodeBB** | Node, Postgres/Mongo + Redis | forum + groups with activity feeds + real-time chat + web push; PWA | read/write REST API; `nodebb-plugin-session-sharing` (JWT cookie on a shared domain = SSO from any app) | Most embeddable Node engine that exists. Forum-shaped UX, not a feed of notes. Good "community + chat behind the shop"; not Xiaohongshu. |
| **Misskey** 2026.5 | TypeScript, Postgres, Redis, Meilisearch | notes with media, follow, timelines, reactions, channels, drive; every function on HTTP API + webhooks + WebSocket | full API, webhooks | Closest *shape* to Xiaohongshu (notes/media/follow/reactions/tags). But a federated public microblog, heavy, not designed to be embedded or tenant-scoped; stripping ActivityPub is real work. |
| **Discourse** | Ruby/Rails, single Docker, idles 1.4–1.8 GB RAM | best-in-class forum + chat + events plugin + DiscourseConnect SSO + API | DiscourseConnect, REST | Best community engine overall; **not Node, not on this box** (RAM). |
| **HumHub** | PHP/MySQL | intranet social (spaces, stream, calendar) | REST beta, JWT SSO | Covered in §1; not a reusable module for pyke. |
| **Stream (getstream.io)** | SaaS, US-hosted | headless Activity Feeds + Chat APIs, SDKs for Node/RN/Flutter | pure API | The exact "plug social onto anything" product. Free: 10k MAU feeds / 500 MAU chat; paid feeds from $49/mo (100k MAU), chat from ~$399–499/mo (2.5k MAU). Data offshore; chat cost bites at scale. |
| **Amity Social Cloud (social.plus)** | SaaS | feeds, groups, profiles, chat, live; UI kits | SDK/API | Same category as Stream, commit-based pricing; data offshore. |
| **Gancio / Mobilizon / Cactoide** | Node / Elixir / Node | events + RSVP only | ActivityPub, small APIs | Events-only; no clubs/feed/chat. |
| **pump.io** | Node | ActivityStreams server | API | discontinued 2020 — no. |

**Conclusion (L0):** still no adopt-whole Node "social network in a box" with clubs + meets + feed + chat. The only products that are literally "a reusable social module you mount on any app" are the SaaS ones (Stream, Amity). The self-hosted equivalent is a **headless social service of our own**: one Node service, Postgres + Redis, JWT SSO in, REST + WebSocket + webhooks out, tenant-scoped, entities = identity (external ids), space (club/brand), post (note + media + tags + product refs), comment, reaction, collect, follow, feed, event + RSVP + waitlist, chat channel, notification/push. Seed it by **porting** hkpl's already-packaged chat (its plan explicitly targets "a portable chat module a new app drops in", 8 shared JS modules + a documented backend contract) and the OpenPlay/Feed schema — port out, never reuse hkpl in place. Hosts (pyke uni-app storefront, hkpl, kaka, mimi) mount it by API. If an adopt-whole is wanted *today*: NodeBB behind pyke via session-sharing for community + chat, or Stream feeds on the free tier for the feed only.

## 8. Deep sweep: is there ready-made code "almost on par" with Facebook / TikTok / Xiaohongshu? (2026-09-09)

Four research lanes ran in parallel (Western fediverse and protocols; Chinese-world engines and clones; open-source mobile app codebases; community engines and headless feed backends). About 70 candidates examined. Proof level: **L1** throughout (fetched pages summarised by a tool; nothing installed or run). Lane reports are in this session's task outputs; every claim below has a URL there.

### 8.1 The bar, applied honestly
Nothing open-source is simultaneously (a) experience-parity with FB/TikTok/XHS, (b) self-hostable, (c) extensible as a module behind other products, and (d) multi-tenant. Every engine assumes it owns the user table. Every parity-grade *experience* is a fediverse or protocol app whose backend is either heavy, single-tenant, or partly closed. The choice is therefore which compromise, not which winner.

### 8.2 Shortlist by shape (UX score is L0 judgement on cited evidence)

| Shape | Best ready-made | UX | Stack / licence | What you get | Killer weakness |
|---|---|---|---|---|---|
| Facebook / Twitter feed app, native | **Bluesky `social-app`** | 4/5 (iOS 3.9★ on 14k; zh-HK/TW/CN locales; ranked custom feeds; video; DMs) | React Native + Expo, **MIT** (logo and icon set excluded) | The best open-source social front-end that exists; fork explicitly blessed | The engine is not yours: DM service and video transcoding are closed; AppView self-host is community-only (28★ and 123★ repos); the app speaks AT Protocol, so a Node backend must implement its lexicons. Months. |
| TikTok short-video | **Loops** (server + `loops-expo`) | 3.5/5 (For You + Following, live streaming landed 2026-09-05, iOS 4.5★ on 30) | PHP/Laravel + Expo, **AGPL-3.0** | Only living FOSS TikTok-shaped product with store apps and a small documented OAuth2 REST API a Node backend could reimplement | v1.0-beta.14, 448★, one maintainer (dansup), English-only store listing, video-only |
| Instagram / Xiaohongshu notes | **Pixelfed** (server + `pixelfed-rn`) | 3/5 (stories, carousels, DMs; iOS 4.2★, Android 2.4★) | PHP/Laravel + Expo, **AGPL-3.0** | Mastodon-compatible API plus stories/carousel extensions | App repo has **0 commits since 2026-02-04**; same single maintainer as Loops |
| Modern social engine in **Node** | **Misskey** (or fork Sharkey) | 3/5 web/PWA (reactions, Drive, roles, built-in Chat rooms since 2025.4) | TypeScript/Node + Postgres + Redis, **AGPL-3.0**; 11.3k★; 2026.9.0 on 2026-09-06 | The strongest ready-made engine in our language: full HTTP API + WebSocket, zh-CN and zh-TW locales, monthly releases | No native app (PWA only); chronological feed; chat "local users only"; docs recommend 4 GB RAM; single-tenant; Sharkey's 2026 releases UNVERIFIED |
| Mature, safe, text-first | **Mastodon** | 3/5 (iOS 4.6★ on 13k; zh-HK server locale; OIDC/SAML SSO) | Ruby, **AGPL-3.0**, 50k★ | Safest engine, best-rated official app, open push relays | Chronological, no chat, no stories, no video feed; Android push via Mastodon's relay; furthest from TikTok/XHS |
| Function-complete community engine | **Discourse** | 2.5/5 (forum-shaped; good PWA; Discourse Hub app 3.9★) | Ruby, **GPL-2.0**, 48k★, min 1 GB RAM | The only engine with **everything**: groups, events with RSVP, chat, reactions, follow, DiscourseConnect `external_id`, HMAC webhooks, zh_TW | Looks like a forum, not a feed. Ruby. Idles 1.4 to 1.8 GB. |
| Xiaohongshu look-alikes (Chinese GitHub) | HongShu (Ma-YongJian), XiaoShiLiu, 宠友 | 3 to 4/5 fidelity | SpringBoot/uni-app or Express/Vue; MIT / AGPL / MulanPSL | Highest visual fidelity to XHS | 80 to 285★, single authors, paid "Pro" editions, no tenant or external-id model, zh-Hans only. UI references, not engines. |
| Chinese social engines | Fresns; ThinkSNS+; 林风; Discuz! Q; WildfireChat | 2 to 3/5 | PHP / Java | Fresns is the only clean one (Apache-2.0, API-first, real i18n) | ThinkSNS+ forbids commercial use; 林风 open edition is a crippled demo; WildfireChat is CC BY-ND and sells only to mainland entities; Discuz! Q abandoned 2022 |
| Chat piece | **OpenIM**; Mattermost mobile as UX reference | 4/5 chat | Go; Apache-2.0 server and SDKs | External user ids, token from your server, uni-app/RN/Flutter SDKs | Polished UI kits are AGPL "not for commercial use"; production UI is paid; Mongo+Redis+Kafka+MinIO+etcd |
| Feed-as-a-service, self-hosted | none | | | | Stream-Framework last released 2016; GetStream's own OSS feed says "not for prod"; Takahē dead 2024. Composable: Supabase/PocketBase tables + Novu (inbox) + Gorse (ranking). |
| Clones on GitHub (TikTok/IG/Threads) | zyronon/douyin (11.5k★) and ~10 others | 1 to 3.5/5 | mostly Firebase/Supabase | zyronon is the best-looking Douyin UI on GitHub | Web-only, mock data, notice forbids commercial use; the rest are tutorials welded to Firebase |

Late additions from the last two sub-lanes (events engines; headless backends and starters):
- **OpenMeet** (NestJS API + Vue/Quasar, Apache-2.0): the only project whose *shape* is exactly the target: groups + events with RSVP + feed + schema-per-tenant multi-tenancy + OIDC + Matrix chat. 63★ and 26★, small team, last commit 2026-08-21. A reference design to copy, not a dependency to adopt.
- **Mobilizon** (Elixir, AGPL): events with RSVP inside groups, GraphQL with OAuth2 apps, Keycloak/OIDC/LDAP in, zh_Hant file present but every string untranslated; 16 commits in the last 90 days, all in June. Events piece only.
- **Nakama** (Go, Apache-2.0, 13k★, v3.40 2026-07): headless friends, groups, chat, notifications on Postgres with external custom ids. No feed or follow primitive; you build the timeline in its runtime.
- **pretix / Hi.Events**: ticketing engines, not social RSVP. pretix has zh-hant, customer OIDC both ways, external ids and a widget, but its licence's third-party-sales clause needs counsel before it sits behind a storefront. Hi.Events has zh-hk and Apple/Google Pay checkout but no SSO.
- Every Supabase, Firebase or Next.js "social starter" examined is a tutorial clone. None survived.
- **Matrix** (chat lane, last to report): Synapse and the Element X apps are AGPL plus commercial; the Rust homeservers Tuwunel (v1.9.0, 2026-08-19, 952 commits in 90 days) and Continuwuity and the JS/Rust SDKs are Apache-2.0. SSO in via the Matrix Authentication Service (OIDC only, no SAML) or Synapse's JWT login; external ids map to the MXID localpart. Element X iOS 3.4★, FluffyChat 4.0★, zh-Hant (Taiwan) strings in both. No multi-tenancy (one server name per homeserver), no native webhooks (build an Application Service), presence is the known resource hog, and Element X is not published as a library. Verdict unchanged: a credible self-hosted DM layer if we ever need federation or E2EE, heavier than the job here; hkpl's chat port stays the plan, OpenIM the external fallback.

- **Final sub-lane (community OS and fediverse engines)**, corrections and additions: Pixelfed gained **OIDC login in v0.12.6 (2025-09-03)** and ships a Groups feature disabled by config, so it is closer to embeddable than the table above says. **Lineweb Social** (Laravel 13 + React 19, GPL-3.0) is the one project whose shape is exactly feed + spaces + DMs + events with RSVP + stories, but it is 31★, 72 commits, one author, self-declared not production-ready. **Coral** (Apache-2.0, Node, GraphQL) is the best embeddable comments piece: external ids via JWT SSO, HMAC webhooks, per-site scoping, zh-CN only. **Friendica** is the only fediverse engine with groups, events and PMs in core, with the weakest UX. **Minds** sells hosted "Networks" and has no supported self-host path. **Twenty** is a CRM, not a community platform. **Orbit** was sunset by Postman in 2024. "Threadify" as a community OS does not exist.

### 8.3 What this means for the operator's goal (L0)
1. **The "experience" lives in the app, and the only parity-grade open app is Bluesky's.** Everything else with a store app is 3/5. If experience parity is non-negotiable, the path is: fork `social-app` (MIT, RN/Expo, zh-HK) as the shell, strip federation, rebrand, and give it a backend of our own that implements the lexicon subset it uses (feed, profile, notifications, media) plus hkpl's chat port for DMs. That is the best-looking route and the longest one.
2. **The best ready-made engine in our language is Misskey.** Feed, reactions, media Drive, chat rooms, roles, full API and WebSocket, zh-TW, released monthly. Wrap its PWA with the Capacitor playbook to get store apps. Gaps to fill: ranked feed (Gorse), events with RSVP (build), product references for pyke (note metadata), tenant scoping (one instance per property, or roles and channels). Cost: 4 GB RAM class, so not on the current box without a reclaim or a second box, and AGPL obligations on modifications.
3. **Discourse is the function-complete fallback** if functions matter more than feel on day one: events with RSVP, chat, reactions, follow, external-id SSO, webhooks are all bundled. It will never read as Xiaohongshu.
4. **Do not adopt**: HumHub (intranet UX, PHP), Forem (self-host path officially dead since 2026-03), Mastodon for this purpose (no chat, no video, Ruby), the Chinese open-core engines, and every clone.
5. Whichever engine is chosen, the **reusable module boundary** stays what §6c said: one social service, JWT SSO in, REST + WebSocket + webhooks out, mounted by hkpl and by the pyke uni-app storefront. Misskey can *be* that service today at 70 percent; Bluesky's app can be its *face*; Discourse can be it at 100 percent of function and 40 percent of feel.

## 9. Reclub XAPK vs hkpl code — capability by capability

Reclub side = route table read from the v2.45.12 binary (L2). hkpl side = `prisma/schema.prisma` + `routes/*.js` (L2) with prod counts (L5). "Live" = used in production today.

| Capability | Reclub (binary) | hkpl (code) | hkpl (live) | Who is ahead |
|---|---|---|---|---|
| Sign-in | email, Apple, Facebook, Google | magic link, sign-in code, Apple and WeChat columns (unused), password | 2,559 sign-in codes issued | Reclub on social login; hkpl on verified identity and roles |
| Identity depth | DUPR connect, Street Cred | DUPR id on 2,190 users, 5,274 snapshots, Glicko-2 ratings, indemnity signatures, blacklist, shadow users | live | **hkpl** |
| Discover meets | filters by community/location/sport, map points | none for meets; venues map only (60 geocoded) | venues map live | **Reclub** |
| Clubs | follower pages, claim ownership, gate type, visibility, insights, payment info, tags | real organisations: managers, teams, themed page, sponsors, feed, 3 languages, join/leave | 196 clubs live; 0 joins | hkpl as organisations; Reclub as discoverable pages |
| Meet object | upsert participants, by-ref share, stats summary, leaderboards | session with capacity, DUPR band, fee, guest fee, access, status; signup with waitlist status; guests | 4 sessions; module off | on par in code; **Reclub** in use |
| Host automation | automated weekly activities, auto-invite, auto waitlist, sort by skill, court assignment, mark paid, check-in | schedule generator (rounds, courts), no recurrence, no auto-invite, no promotion, no check-in | off | **Reclub** |
| Round robin / live board | round-robin generator, real-time standings | OpenPlayGame rounds and courts, live board, QR spectator (per casual-play doc) | 10 games | on par in code |
| Competition engine | create/publish/start/cancel, lock registration, teams, score sets, match assign, stat ranking, awards, kudos | seasons, divisions, rules engine, eligibility, standings, playoffs, disputes, referee, live scoring, brackets (brackets-manager), tournaments | 1,816 matches, 800 teams, 14 seasons live | **hkpl**, clearly |
| DUPR | activity manager, connect, submit, eligibility | write queue, webhook events, partner API client, breaker, sync runs, name sync | live (sync); submit gated | **hkpl** |
| Chat | MQTT channels per competition and meet, GIFs, unread | WebSocket + Redis, channels per team/match/dispute/DM, voice, video, file, reply, reactions, search over voice transcripts | 177 messages live | **hkpl** in capability; Reclub in usage |
| Feed | feed, content by channel | posts with media, moderation verdicts, kudos, comments, auto events | 61 auto posts, 1 human | on par in code; Reclub in use |
| Social graph | follow clubs, block, report | follow users, block, report, QR add | 10 follows | on par |
| Payments | display bank/wallet, screenshot receipt | screenshot receipt on registrations, Payment model stub (0 rows) | 344 paid by screenshot | tie; **pyke** is the only differentiator |
| Push | native push (Firebase) | APNs, FCM, web-push dispatcher, PushDevice, native bridge registers on launch; keys configured in prod | 0 devices registered, so never delivered | on par in code; **Reclub** on the real path |
| Mobile | Expo RN app in both stores, 4.8★ on 14k ratings | Capacitor shell `com.hkpl.app` on Google Play ("0+ downloads"), AAB built 2026-07-07; iOS not in store; PWA (service worker v520) | Android app live, low adoption | **Reclub** on adoption and iOS; hkpl has the shell |
| Trust and safety | Street Cred, block, report | block, report, disclaimers, blacklist, suspension | live | on par; Reclub's reliability score is a gap |
| Venues | venues tab, map | 60 approved venues with lat/long, proximity groups, AMap and Google ids | live | **hkpl** |
| i18n | English-first | en, zh-Hant, zh-Hans throughout; WeChat webview shell | live | **hkpl** |
| Ads / subs | full ad mediation stack, RevenueCat | none | | Reclub monetises; hkpl does not |

**Verdict:** hkpl is the more advanced *engine* (competition, DUPR, chat, identity, venues, i18n). Reclub is the more advanced *product surface* (native app, push, discovery, host automation, and the fact that its social features are used). Everything Reclub is ahead on is product work in hkpl's own stack; nothing Reclub has is an engine hkpl lacks.

## 7. What I need from the operator to write the L1 spec

1. Pick **A / B / C** (or say "spike first").
2. Confirm the native app status (store listing yes/no).
3. Confirm **pyke is the ledger** and hkpl's Stripe-direct blueprint is superseded.
4. Give the **PROJECT root for the v6 contract-kit** — for B it is `root@kaka.silkvo.com:/root/hkpl-dev` (already carries a `contract-kit/`; version to be checked against the v6 pin). For A it is a new `/root/humhub-docker` (does not exist yet).

Then the spec: free v1 scope, pyke seam (API + webhook contract with idempotency), phase map, probes.

---

## Appendix — commands used tonight (all read-only)
```
ssh root@kaka.silkvo.com 'df -h /; free -m; pm2 ls; docker ps'
ssh root@kaka.silkvo.com 'cd /root/hkpl-server && grep -E "^model " prisma/schema.prisma'
ssh root@kaka.silkvo.com 'docker exec hkpl-docker-hkpl-db-1 psql -U hkpl -d hkpl -At -c "<counts>"'
ssh root@kaka.silkvo.com 'cd /root/hkpl-server && grep -nE "router\.(get|post|patch|delete)\(" routes/open-play.js routes/feed.js routes/social.js routes/chat.js'
```
Sources (HumHub): marketplace calendar 1.9.4 page + changelog; `models/CalendarEntry.php`; jwt-sso manual 1.2.0; rest module 0.12.2; docs requirements + push-updates; FreiChat marketplace page (deprecated); App Store listing id6446092274. Reclub: pickleball.reclub.co/for-organizers; reclub.co/m/PULPOE.

# Events/Meets engine for the Misskey fork — open-source candidates, evaluated

Date: 2026-09-10. Method: WebFetch of GitHub/GitLab REST API JSON (stars, `pushed_at`/`last_activity_at`, SPDX licence), raw source files (entities/models/package.json), project docs, and npm registry `/latest` JSON. No server touched.

**Proof-level legend used below** (per operating contract): **L2** = I read the source/registry/API JSON at the URL shown. **L1** = a doc page, README summary or search snippet said it (secondary). **L0** = my inference. Every table cell that is not L2 is flagged. Where a page was blocked (403/404/Anubis) I say so instead of guessing.

Target spec (from the brief): event date/time/duration · venue lat/lng · capacity · RSVP state machine (requested, invited, confirmed, waitlisted, hold, declined, maybe, checked-in, no-show) · auto-approve or host approval · waitlist auto-promotion with pay-by deadline · guests (+1) · host/cohost roles · level/gender/age gates · cancellation freeze · weekly recurrence + RRULE schedules · reminders · ICS export · share pages · per-event chat hook · payment status tags.

---

## 0. TL;DR — ranked shortlist and recommendation

| Rank | Candidate | Verdict |
|---|---|---|
| 1 | **Build inside Misskey** (TypeScript module in `packages/backend`, own tables, BullMQ timers) | **Recommended.** No candidate covers > ~50 % of the spec; the missing half (hold/pay-by promotion, +1 guests, level/gender/age gates, cancellation freeze, no-show, payment tags) is the sports-specific core, and it is ~the same code whether written as a NestJS sidecar or a Misskey module. Misskey already ships NestJS 11, TypeORM, `pg`, BullMQ 6, `date-fns` 4, ioredis (L2, package.json). Effort estimate below. |
| 2 | **OpenMeet API** (NestJS/TypeORM/Postgres, Apache-2.0) as *reference implementation / code donor* | Closest data model in our exact stack (event entity with `maxAttendees`, `requireApproval`, `allowWaitlist`, PostGIS `locationPoint`, `timeZone`, `seriesSlug`; attendee statuses incl. `waitlist`, `maybe`, `invited`, `pending`; roles `host/moderator`; `rrule` + `ical-generator` deps; event-series with JSONB `recurrenceRule`) — all L2. BUT: **no waitlist promotion, no capacity enforcement in the attendee service** (L2 — grep of two service files), Matrix removed to an external AppService, English-only i18n, 26 stars, multi-tenant via PG schemas (bolts awkwardly onto Misskey's single DB). Apache-2.0 → freely copyable into an AGPL codebase. Use as a lift-and-adapt source for entities/DTOs, not as a sidecar. |
| 3 | **Hi.Events** (Laravel 13/React 19, AGPL-3.0 + attribution clause) as a *paid-ticketing sidecar only* | Strongest off-the-shelf ticketing: waitlists, recurring/multi-date events, capacity, QR check-in, Stripe Connect, REST API + OpenAPI, webhooks, **繁體中文 locale** (L2 README). Wrong shape for RSVP/meets (ticket-order centric, no host approval, no maybe/+1/level gates), PHP, and its "Powered by Hi.Events" attribution clause is an AGPL-additional-term you'd have to honour or buy out. Only worth it if paid meets with real checkout become a hard requirement. |
| 4 | **Mobilizon** (Elixir/Phoenix, GraphQL, AGPL-3.0) | Best fediverse events product; participation approval, capacity, ICS, zh_Hant (L2). But **no recurrence** (issue #20 open since 2018-05-24, 21 upvotes, L2), no waitlist, Elixir stack alien to our team, and maintainership moved Framasoft → Kaihuri (L2). Not a fit. |
| 5 | Gancio (Node/Nuxt2/Sequelize, AGPL-3.0) | Public agenda, **no RSVP/attendee model at all** (L2 — `server/api/models/` has no attendee model; `event.js` has no capacity/RSVP fields). Has `recurrent` JSON + ICS. Not usable as an RSVP engine. |
| 6 | Gathio (Node/Express/TS/MongoDB, GPL-3.0) | Nice tiny RSVP with `maxAttendees`, attendee `status/approved`, `eventGroup`, timezone, ical-generator (L2 `Event.ts`). MongoDB, no accounts, no recurrence, no waitlist, GPL-3.0 (one-way into AGPL is fine, but the design is "no registration"). Reference only. |
| 7 | Discourse events (core, `discourse-calendar` MIT) | Max attendees (Sep 2025), recurring-event RSVPs (May 2026), explicitly **no waitlist** ("We might implement a waiting list in the future") — L1 meta posts. Ruby/Ember; not bolt-on-able to Misskey. |
| 8 | pretix (Python/Django, AGPL + additional terms) | Waiting list = voucher-on-quota model with API (L2), zh_Hans/zh_Hant (L2). Ticket-shop, not RSVP; Python. Only as a paid-ticketing sidecar, and Hi.Events is the closer fit for that. |
| — | cal.com → **now cal.diy (MIT)**; Rallly (AGPL); Nextcloud calendar (AGPL); Eventyay/open-event-server (**archived 2026-05-21**); Attendize (last push 2024-08-20, AAL licence); EventSchedule (Laravel, AAL); Cactoide (SvelteKit, AGPL); Thinkmill meetup-alternative (27 commits, WIP); GetTogether (Python, last push 2023-12-19) | Not fits — reasons in §2. |

**Build-vs-bolt-on:** build the meets engine as a Misskey backend module + Vue pages, borrowing OpenMeet's entity/enum design and the exact npm set in §4. Keep a *payments* boundary open for a later Hi.Events/pretix sidecar or a direct Stripe integration. Estimated effort for a single senior TS dev to reach the full spec at L5 (running, exercised): **~7–10 working weeks**; the critical-path items are the RSVP state machine with timers (2 wk), recurrence/schedules (1.5 wk), gates/roles/guests (1 wk), notifications/ICS/share (1 wk), UI (2–3 wk), tests/migration (1 wk). Level: L0 (estimate).

---

## 1. Coverage matrix vs our spec

✓ = present in source/docs I read (L2 unless marked). ~ = partial. ✗ = absent in what I read. ? = could not verify (page blocked). "(L1)" = from doc/README summary, not source.

| Feature | OpenMeet API | Hi.Events | Mobilizon | Gancio | Gathio | Discourse events | pretix | cal.diy | Rallly |
|---|---|---|---|---|---|---|---|---|---|
| Date/time + end/duration | ✓ `startDate/endDate` | ✓ (L1) | ✓ (L1) | ✓ `start_datetime/end_datetime` (int) | ✓ `start/end` | ✓ (L1) | ✓ subevents (L1) | ✓ | ~ polls only |
| Time zone per event | ✓ `timeZone` default UTC | ? | ✓ (L1) | ✗ (server tz) | ✓ `timezone` | ✓ (L1) | ✓ (L1) | ✓ | ✓ |
| Venue lat/lng | ✓ `lat`,`lon`, PostGIS `locationPoint` geography Point | ~ address (L1) | ✓ OSM address (L1) | ✓ `place` model | ~ text `location` | ✗ | ~ (L1) | ✗ | ✗ |
| Capacity | ✓ `maxAttendees` (column) but **not enforced in attendee service** (L2) — enforced only in `attendEvent()` of event-management.service (L2) | ✓ capacity (L1) | ✓ "Number of places" (L1) | ✗ | ✓ `maxAttendees` | ✓ max attendees (L1, 2025-09-01) | ✓ quotas (L1) | ✓ seats? (unverified) | ✗ |
| RSVP states: requested/invited/confirmed/waitlisted/declined/maybe | ✓ `Invited, Confirmed, Attended, Cancelled, Rejected, Maybe, Pending, Waitlist` | ~ order/attendee status (L1) | ~ participant / not_approved / rejected (L1 docs; enum file 404 on raw API) | ✗ none | ~ `status`,`approved` | ✓ going/interested/not going (L1) | ~ order states | ~ booking accepted/pending/cancelled | ✗ |
| checked-in / no-show | ~ `Attended` only | ✓ QR check-in lists (L1) | ✗ | ✗ | ✗ | ✗ | ✓ check-in (L1) | ✗ | ✗ |
| hold (pay-by) state | ✗ | ~ waitlist notify (L1; deadline text blocked 403) | ✗ | ✗ | ✗ | ✗ | ✓ voucher w/ expiry (L1) | ✗ | ✗ |
| Auto-approve vs host approval | ✓ `requireApproval` → `Pending` | ✗ | ✓ (L1) | ✗ | ✓ approvals (L1 docs) | ✗ | ✗ | ~ opt-in confirm | ✗ |
| Waitlist auto-promotion | ✗ (status exists, **no promotion code found** L2) | ✓ notify in order (L1) | ✗ | ✗ | ✗ | ✗ explicitly none (L1) | ✓ voucher auto-send (L1) | ✗ | ✗ |
| Guests (+1) | ✗ (`Guest` is a *role*, not +1) | ~ multiple tickets per order (L1) | ✗ | ✗ | ✗ | ✗ | ~ multi-position order | ✗ | ✗ |
| Host/cohost roles | ✓ `Host, Moderator, Speaker, Participant, Guest` + permissions | ✓ multi-user roles (L1) | ✓ creator/admin/moderator (L1) | ✗ | ✗ | ✗ | ✓ team perms (L1) | ✗ (Teams removed) | ✗ |
| Level/gender/age gates | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ~ questions (L1) | ✗ | ✗ |
| Cancellation freeze | ✗ | ~ refund policy (L1) | ✗ | ✗ | ✗ | ✗ | ✓ cancel deadlines (L1) | ✓ min-notice | ✗ |
| Recurrence / RRULE | ✓ event-series `recurrenceRule` JSONB + `rrule` dep + occurrence service | ✓ "recurring and multi-date events" (L1) | ✗ (#20 open since 2018) | ~ `recurrent` JSON (own format) | ✗ | ~ fixed presets (L1) | ~ subevents | ✓ recurring bookings | ✗ |
| Reminders | ~ mail module (L1) | ✓ scheduled msgs (L1) | ✓ | ✓ `eventnotification` model | ~ `node-schedule` dep | ✓ (L1) | ✓ | ✗ (Workflows removed) | ✓ |
| ICS export | ✓ `calendar-feed` (user & group feeds) + `ical-generator` dep | ✓ (L1) | ✓ (L1, 5.2.4 adds search ICS) | ✓ global/individual ics (L1) | ✓ `ical-generator` dep | ✗ not in docs read | ✓ | ✓ | ✓ |
| Share pages | ✓ `embed`, `sitemap` modules | ✓ | ✓ | ✓ iframe/webcomponent (L1) | ✓ | ✓ | ✓ | ✓ | ✓ |
| Per-event chat hook | ~ `matrixRoomId` column; room lifecycle moved to external Matrix AppService (L2 comment) | ✗ | ✓ comments | ✓ `message` model | ✓ `comments` | ✓ topic | ✗ | ✗ | ✓ comments |
| Payment status tags | ✗ (no stripe dep) | ✓ Stripe Connect, offline payments, invoices (L1) | ✗ | ✗ | ✗ | ✗ | ✓ | ~ apps | ✗ |
| REST/GraphQL | REST + Swagger (L1) | REST + OpenAPI (L1) | GraphQL | REST (L1 gancio.org/dev/api) | none documented | JSON + BBCode POST (L1) | REST | API v2 (L1) | tRPC |
| Multi-tenant | ✓ PG schemas | ✓ organizers/accounts (L1) | ✗ | ✗ | ✗ | ✗ | ✓ organizers | ✗ (Orgs removed) | ✗ |
| zh-Hant | ✗ only `en-US` in platform `src/i18n` | ✓ 繁體中文 (README) | ✓ `zh_Hant` dir | ~ `zh.json` only (variant unknown) | ✗ (de/en/ja/nn) | ✓ Discourse core | ✓ `zh_Hant` | ✓ (Crowdin, unverified) | ~ 10+ langs (L1) |
| Licence vs AGPL fork | Apache-2.0 → compatible (one-way into AGPL) | AGPL-3.0 + attribution term | AGPL-3.0 | AGPL-3.0 | GPL-3.0-or-later → compatible one-way | MIT (calendar) | AGPL + additional terms | MIT | AGPL-3.0 |
| Stack | NestJS 11 / TypeORM 0.3.27 / PG / Redis / Node ≥24 | Laravel 13 / React 19 / PG / Redis | Elixir / Phoenix / PG | Node 14–22 / nuxt-edge 2.17 / Vuetify 2 / Sequelize 6 | Node ≥22 / Express 4 / Mongoose 5 | Ruby / Ember | Python / Django | Next.js / Prisma / tRPC | Next.js / Prisma / tRPC |

Spec coverage score (my count of ✓ over the 20 feature rows, L0): OpenMeet 9–10/20, Hi.Events ~9/20 (but ticket-shaped), Mobilizon 7/20, Gathio 6/20, Gancio 4/20, pretix ~8/20 (ticket-shaped), Discourse 6/20, cal.diy 5/20, Rallly 3/20. **Nobody has: guests +1, level/gender/age gates, no-show, cancellation freeze as a first-class rule, hold/pay-by promotion for RSVP.**

---

## 2. Per-project evidence

### 2.1 OpenMeet API (NestJS) — closest model, weakest maturity
- Repo: https://github.com/OpenMeet-Team/openmeet-api · frontend https://github.com/OpenMeet-Team/openmeet-platform
- API JSON (L2): `license.spdx_id: Apache-2.0`, `language: TypeScript`, **26 stars**, 7 forks, `pushed_at 2026-09-05T17:43:59Z`, created 2024-09-18 — https://api.github.com/repos/OpenMeet-Team/openmeet-api. Platform: 63 stars, `pushed_at 2026-08-21`, LICENSE file = Apache-2.0 (L2 https://raw.githubusercontent.com/OpenMeet-Team/openmeet-platform/main/LICENSE).
- package.json (L2 https://raw.githubusercontent.com/OpenMeet-Team/openmeet-api/main/package.json): version 1.5.0; `rrule ^2.8.1`, `ical-generator ^8.1.1`, `date-fns ^4.1.0`, `date-fns-tz ^3.2.0`, `typeorm ^0.3.27`, `@nestjs/core ^11.1.16`, `@nestjs/schedule ^5.0.1`, `matrix-js-sdk ^39.2.0`, `nodemailer`, `ioredis`, `pg 8.12.0`, `@atproto/oauth-client-node`; Node `>=24`. **No** stripe, bullmq, amqplib, geolib.
- Event entity (L2 https://raw.githubusercontent.com/OpenMeet-Team/openmeet-api/main/src/event/infrastructure/persistence/relational/entities/event.entity.ts): `startDate`, `endDate`, `maxAttendees int`, `requireApproval bool`, `approvalQuestion`, `requireGroupMembership`, `locationPoint geography Point`, `lat/lon double`, `status`, `visibility`, `allowWaitlist bool`, `matrixRoomId`, `seriesSlug`, `originalDate`, `isAllDay`, `timeZone varchar(100) default 'UTC'`, `conferenceData jsonb`, ATProto sync columns.
- Enums (L2 https://raw.githubusercontent.com/OpenMeet-Team/openmeet-api/main/src/core/constants/constant.ts): `EventAttendeeStatus { Invited, Confirmed, Attended, Cancelled, Rejected, Maybe, Pending, Waitlist }`; `EventAttendeeRole { Participant, Host, Speaker, Moderator, Guest }`; `EventStatus { Draft, Pending, Published, Cancelled }`; `EventVisibility { Public, Unlisted, Private }`; `EventType { InPerson, Online, Hybrid }`; permissions incl. `ApproveAttendees, ManageAttendees, CancelEvent`.
- Event series (L2 …/src/event-series/…/event-series.entity.ts): `recurrenceRule jsonb NOT NULL`, `timeZone`, `templateEvent` one-to-one by slug; directory has `services/`, `controllers/`, occurrence-service specs (L2 tree listing).
- Join logic (L2 https://raw.githubusercontent.com/OpenMeet-Team/openmeet-api/main/src/event/services/event-management.service.ts): `attendeeStatus = Confirmed`; `if (count >= event.maxAttendees) attendeeStatus = Waitlist`; `if (event.requireApproval) attendeeStatus = Pending`; cancel → `Cancelled`. Comment: "Chat room cleanup removed - Matrix Application Service handles room lifecycle automatically".
- Attendee service (L2 https://raw.githubusercontent.com/OpenMeet-Team/openmeet-api/main/src/event-attendee/event-attendee.service.ts): **no `promoteFromWaitlist`/capacity logic**; approval = generic `updateEventAttendee(status, role)`.
- Calendar feed (L2 …/src/calendar-feed/calendar-feed.service.ts): `getUserCalendarFeed()`, `getGroupCalendarFeed()` via `ICalendarService`; access check `validateFeedAccess()`.
- i18n: platform `src/i18n` shows only `en-US` (L2 tree listing, page partially errored).
- Multi-tenant: "PostgreSQL (multi-tenant via schemas)", tenants in `config/tenants.json` (L1 README).
- Integration path: (a) **sidecar** — run OpenMeet with one tenant, SSO via Misskey OAuth 2.0 (PKCE S256, IndieAuth-style `client_id` = app page URL — L1 https://misskey-hub.net/en/docs/for-developers/api/token/oauth/); OpenMeet auth module supports OIDC/Google/GitHub/Bluesky, so a **Misskey OAuth provider strategy must be written**; then implement promotion, +1, gates, freeze, pay-by, no-show inside OpenMeet — you'd be maintaining a 26-star fork of a moving target (ATProto pivot visible in entity columns). Effort to spec ≈ 6–8 wk *plus* ongoing fork drag. (b) **code donor** — copy entities/enums/series-occurrence logic into Misskey (Apache-2.0 permits, keep NOTICE). Effort saved vs greenfield ≈ 1–1.5 wk. I recommend (b).

### 2.2 Hi.Events (Laravel) — best ticketing, wrong shape
- Repo: https://github.com/HiEventsDev/hi.events · API JSON (L2): **4,014 stars**, 719 forks, `pushed_at 2026-09-09T20:31:07Z`, `license NOASSERTION` (custom), language PHP.
- README (L2 https://raw.githubusercontent.com/HiEventsDev/hi.events/develop/README.md): "free, paid, donation and tiered tickets · recurring and multi-date events · sold-out waitlists · promo codes … QR check-in with scan logs and access-controlled check-in lists … multi-user roles · Stripe Connect payments · offline payment methods · automatic invoicing … multi-language support · full REST API"; stack "Laravel 13 (PHP >=8.3) · React 19 with SSR · TypeScript · PostgreSQL · Redis · Docker"; licence "AGPL-3.0 with additional terms" requiring "Powered by Hi.Events" attribution on generated pages and emails; languages list includes 中文 and 繁體中文.
- Waitlist mechanics (L1 — search snippet; doc page https://hi.events/docs/help-center/marketing-and-promotions/waitlists returned 403 to me): "waitlisted attendees are notified automatically in the order they signed up"; "to support waitlists and scheduled messages, the Laravel scheduler must be running". Pay-by deadline after notification: **unverified**.
- Integration path: sidecar behind Misskey SSO (Hi.Events has its own accounts; no OIDC provider found in what I read — would need a bridge), events created via REST from Misskey, webhooks back for order/check-in status → payment tags on our meet. Covers payments/check-in only; all RSVP-state/gates/+1 logic still ours. Effort ≈ 2–3 wk for the bridge, and you inherit a PHP runtime + attribution clause.

### 2.3 Mobilizon (Elixir) — mature, no recurrence
- Repo now https://framagit.org/kaihuri/mobilizon (GitHub mirror `framasoft/mobilizon` 404s — L2). GitLab API (L2 https://framagit.org/api/v4/projects/framasoft%2Fmobilizon → redirected namespace `kaihuri/mobilizon`): 157 stars, 143 forks, `last_activity_at 2026-09-09T14:00:06Z`, default branch `main`.
- Releases (L2 https://framagit.org/api/v4/projects/kaihuri%2Fmobilizon/releases): **5.2.4 (2026-06-30)** "introduces ICS feed creation for searches… Federation now works with Gancio instances"; 5.2.3 (2026-03-23); 5.2.2 (2026-01-11). CHANGELOG.md top entry is stale at 4.1.0 (2024-02-29) with "This release is the last provided by Framasoft. The project is now supported by the Kaihuri association." (L2).
- Recurrence: issue #20 "Add recurence options for events", opened 2018-05-24, still `opened`, 21 upvotes (L2 https://framagit.org/api/v4/projects/kaihuri%2Fmobilizon/issues?search=recurring&state=opened).
- Locales (L2 https://framagit.org/api/v4/projects/kaihuri%2Fmobilizon/repository/tree?path=priv/gettext): `zh_Hant` present; no zh_Hans.
- Participation (L1 docs https://docs.mobilizon.org/1.%20Use/Events%20and%20Activities/1.create-events/ and …/4.participate-event/): participation approval, "Number of places", anonymous participation, tentative/confirmed/cancelled status; no waitlist documented. Role enum source file blocked (Anubis/404 on raw API) — the `not_approved/not_confirmed/rejected/participant/moderator/administrator/creator` set is my recollection, **L0**.
- Verdict: only as a *federation peer* (our Misskey fork could federate `Event` objects to Mobilizon/Gancio later), not as engine.

### 2.4 Gancio (Node) — agenda, not RSVP
- Repo mirror https://github.com/lesion/gancio (L2 API: AGPL-3.0, 51 stars, `pushed_at 2026-02-17`); canonical https://framagit.org/les/gancio (L2 API: 64 stars, `last_activity_at 2026-09-09T17:53:44Z`, default `main`).
- package.json (L2 https://raw.githubusercontent.com/lesion/gancio/master/package.json): 1.21.0, `node >=14 <=22`, `nuxt-edge 2.17.2-…`, `vuetify 2.6.14`, `sequelize ^6.37.3`, `express ^4.19.2`, `ics ^3.7.6`, `ical.js ^2.0.1`, `dayjs`, `luxon`, sqlite3/pg/mariadb. No rrule/bullmq/node-cron.
- Models (L2 https://github.com/lesion/gancio/tree/master/server/api/models): announcement, ap_user, collection, event, eventnotification, filter, instance, message, notification, oauth_*, place, resource, setting, tag, user — **no attendee/RSVP model**. Event fields (L2 …/server/api/models/event.js): `title, slug, description, multidate, start_datetime INT, end_datetime INT, image_path, media, is_visible, recurrent JSON, likes, boost, online_locations, ap_object, ap_id` — no capacity/RSVP.
- Locales: 27 files incl. `zh.json` (variant unknown), no zh-TW (L2 tree).
- API (L1 https://gancio.org/dev/api): `GET/POST /api/events`, `/api/events/{id}`, `/api/events/tag/{tag}`, `/api/events/place/{place}`, `/api/geocode`, OAuth token login.
- Verdict: unusable as RSVP engine; Nuxt 2 / Node ≤22 also ageing.

### 2.5 Gathio (Node/TS) — small, clean, MongoDB
- Repo https://github.com/lowercasename/gathio (L2 API: GPL-3.0, TypeScript, **461 stars**, `pushed_at 2026-09-07T23:52:50Z`). package.json (L2): 1.6.7, `GPL-3.0-or-later`, Node ≥22, express 4, mongoose 5, i18next 24, `ical-generator ^1.15.4`, `node-schedule`, nodemailer, activitypub-types.
- Event model (L2 https://raw.githubusercontent.com/lowercasename/gathio/main/src/models/Event.ts): `attendees[] {status, approved, visibility}`, `maxAttendees Number`, `eventGroup ref`, `comments[]`, `start/end Date`, `timezone default Etc/UTC`, `location String required`, `usersCanAttend`, `usersCanComment`, `showOnPublicList`, ActivityPub actor/keys/followers.
- Approvals (L1 https://docs.gath.io/using-gathio/attendee-approvals/): pending/approved, reject buttons, "Hide event location from attendees until they are approved by the host".
- Locales: de, en, ja, nn (L2 tree, possibly truncated). No zh.
- Verdict: reference for the "hide venue until approved" pattern and the minimal attendee sub-document; not a bolt-on (Mongo, no accounts, no recurrence/waitlist).

### 2.6 Discourse events (core plugin, formerly discourse-calendar)
- https://github.com/discourse/discourse-calendar (L1 page: MIT, 69 stars, "bundled into Discourse core"). Angus' plugin redirected to https://github.com/angusmcleod/angus-events-plugin (L2 API: GPL-2.0, Ruby, 57 stars, `pushed_at 2026-07-30`).
- Max attendees (L1 https://meta.discourse.org/t/max-attendees-support-for-discourse-calendar/381205, 2025-09-01): "When an event is full you won't be able to join it, only mark yourself as interested or not going… We might implement a waiting list in the future".
- Recurring RSVPs (L1 https://meta.discourse.org/t/improved-events-more-flexible-rsvps-for-recurring-events/402827, 2026-05-18): "This event" vs "This event and all following events"; presets Every Day/Week/Two Weeks/Four Weeks/Month/Weekday.
- Verdict: Ruby, forum-bound; not bolt-on-able. Useful as UX reference for "this vs all following" RSVP.

### 2.7 pretix (Python)
- https://github.com/pretix/pretix (L2 API: 2,514 stars, 654 forks, `pushed_at 2026-09-09`, licence NOASSERTION = "AGPL v3 with additional terms" L1 README).
- Waiting list API (L2 https://docs.pretix.eu/en/latest/api/resources/waitinglist.html): fields `id, created, email, voucher, item, variation, locale, subevent`; "If [voucher] is set, the user has been sent a voucher and is no longer waiting"; endpoints list/get/create/PATCH/`send_voucher`/DELETE. Voucher expiry ("valid until") is on the voucher resource (L1 https://docs.pretix.eu/guides/vouchers/). This **voucher-with-deadline** is the exact "hold + pay-by" primitive our spec needs — worth copying the *concept*.
- Locales (L2 https://github.com/pretix/pretix/tree/master/src/pretix/locale): `zh_Hans`, `zh_Hant`.
- Verdict: paid-ticketing sidecar only; Python.

### 2.8 The rest (one line each, L2 unless marked)
- **cal.com → cal.diy**: repo is now `calcom/cal.diy`, MIT, 48,337 stars, `pushed_at 2026-09-09` (https://api.github.com/repos/calcom/cal.com). Cal.com went closed-source April 2026; cal.diy removed "Teams, Organizations, Insights, Workflows, SSO/SAML" and API v1 (L1 https://cal.com/blog/cal-diy-open-source-to-closed-source, README). 1:1/booking scheduler; no capacity RSVP model; Workflows (reminders) gone. Not a fit.
- **Rallly**: AGPL-3.0, 5,251 stars, `pushed_at 2026-09-10` (https://api.github.com/repos/lukevella/rallly). Date-polls, not RSVP/capacity. Not a fit.
- **Eventyay / open-event-server**: GPL-3.0, "archived by the owner on May 21, 2026" (L1 page https://github.com/fossasia/open-event-server). Dead.
- **Attendize**: `pushed_at 2024-08-20`, licence NOASSERTION = "Attribution Assurance License" (https://api.github.com/repos/Attendize/Attendize). Stale + non-standard licence.
- **EventSchedule** (https://github.com/eventschedule/eventschedule): Laravel 11, AAL licence, 64 stars, recurring + waitlist + QR + REST + 11 languages (no Chinese) (L1 page). AAL is not GPL-compatible in the FSF list → avoid.
- **Cactoide** (https://github.com/polaroi8d/cactoide): SvelteKit/TS, AGPL-3.0, 393 stars, RSVP with capacity, ICS, federation, JSON i18n; no waitlist/recurrence (L1 page). Too thin.
- **Thinkmill/meetup-alternative**: Keystone 5, 27 commits, "work in progress" (L1). Dead.
- **GetTogether**: Python, BSD-2, `pushed_at 2023-12-19` (https://api.github.com/repos/GetTogetherComm/GetTogether). Dead.
- **Nextcloud calendar**: AGPL-3.0, 1,184 stars, `pushed_at 2026-09-10` (https://api.github.com/repos/nextcloud/calendar); CalDAV/appointments, PHP+Vue. A CalDAV server is not an RSVP engine. Not a fit.
- **jhracho/Pickup** (student pickup-sports app with waitlist email) — L1 search hit only; not evaluated further.
- No maintained "RSVP engine" npm library with hold/pay-by/auto-promotion was found (searches: `waitlist auto-promote typescript`, `NestJS Prisma RSVP waitlist recurring`) — L1 negative result.

---

## 3. Build vs bolt-on — reasoning

1. **Coverage gap is in the sports-specific core.** The nine RSVP states, hold-with-pay-by, +1 guests, level/gender/age gates, cancellation freeze, no-show — none of the nine candidates has them (matrix §1). Whoever we pick, that logic is greenfield.
2. **What candidates *do* give (dates, capacity, approval, waitlist status, RRULE, ICS, roles) is ~1.5–2 weeks of TypeScript when you have Misskey's NestJS/TypeORM/BullMQ already wired**, and OpenMeet's Apache-2.0 entities are a copyable head-start (§2.1).
3. **A sidecar costs an SSO bridge + duplicate user/profile store + webhook plumbing + a second runtime**, and every gate (level/gender/age) needs the *Misskey* profile, so the sidecar would call back into Misskey for every join. Misskey's built-in user webhooks only fire on `mention, unfollow, follow, followed, note, reply, renote, reaction` (L2 https://raw.githubusercontent.com/misskey-dev/misskey/develop/packages/backend/src/models/Webhook.ts) — no user-profile-changed hook, so a sidecar would have to poll or we'd add hooks anyway.
4. **Misskey already runs the timers we need**: `QueueService` has `systemQueue` with repeatable cron patterns (`'55 * * * *'`, `'0 0 * * *'`), a `delay:` pattern (`createDelayedUnfollowJob`), plus `postScheduledNoteQueue` and `endedPollNotificationQueue` (L2 https://raw.githubusercontent.com/misskey-dev/misskey/develop/packages/backend/src/core/QueueService.ts) — the scheduled-note and ended-poll queues are the exact template for "pay-by expiry" and "reminder T-24h" jobs.
5. **i18n**: Misskey has `zh-TW.yml`, `zh-CN.yml`, `ja-JP.yml` (L2 https://github.com/misskey-dev/misskey/tree/develop/locales); building inside inherits the existing translation pipeline; OpenMeet is en-US only.
6. Keep **payments** as the one legitimately-external piece (Stripe direct, or Hi.Events/pretix later) — model it as `paymentStatus` tag + webhook consumer from day one.

---

## 4. If we build inside Misskey — exact libraries

Versions are npm `/latest` as of 2026-09-10 (L2 registry JSON) unless noted; Misskey's current pins from `packages/backend/package.json` (L2 https://raw.githubusercontent.com/misskey-dev/misskey/develop/packages/backend/package.json) in brackets.

| Concern | Use | Version / licence | Why / caveat |
|---|---|---|---|
| Recurrence (RRULE) | **`rrule-temporal`** | 2.2.4, MIT, dep `temporal-spec ^1.0.0`; repo https://github.com/ggaabe/rrule-temporal (113 stars; README: uses native `Temporal` on Node 26+ else bundled `temporal-polyfill`; BYSETPOS/EXDATE/RDATE; RFC 7529 RSCALE; "restores DTSTART's time after DST gaps"; "42-107x faster than rrule" in tz-aware benchmarks — L1 README claims) | Timezone-correct weekly schedules in `Asia/Hong_Kong` etc. Alternative **`rrule`** 2.8.1 (BSD-3, tslib) is what OpenMeet/ical-generator use, but its README warns "Returned 'UTC' dates are always meant to be interpreted as dates in your local timezone" (L2 README) — the classic DST foot-gun. Store the RRULE string + `timeZone` + `dtstart`; materialise occurrences N weeks ahead into an `meet_occurrence` table via a BullMQ repeatable job. Keep `rrule` only if ical-generator's optional peer needs it for RRULE serialisation (you can also emit the RRULE string yourself). |
| ICS export / feeds | **`ical-generator`** | 11.1.1, MIT, Node 22 or ≥24; optional peers `rrule >=2.6.8`, `@touch4it/ical-timezones >=1.6.0` (VTIMEZONE) — L2 registry | Per-meet `.ics`, per-user/group webcal feed (OpenMeet's `calendar-feed` shows the shape). Alternative `ics` 3.12.0 (ISC; deps yup/nanoid/runes2; supports `attendees{rsvp,partstat,role}`, `alarms`, `recurrenceRule`, `status`, `sequence` — L2 README) — fine but ical-generator's VTIMEZONE support matters for HK/overseas guests. |
| Dates/timezones | **`date-fns` 4.4.0 [already in Misskey]** + **`date-fns-tz`** 3.2.0 (MIT, peer `date-fns ^3||^4`; `toZonedTime/fromZonedTime/formatInTimeZone` — L2) | Reminders "T-24h local", freeze windows "until 18:00 venue time". Or go all-in on `Temporal` via the same polyfill rrule-temporal bundles. |
| Distance / nearby | **PostGIS via TypeORM** `@Column('geography', { spatialFeatureType: 'Point', srid: 4326 })` (TypeORM docs: GeoJSON interchange; `ST_GeomFromGeoJSON`/`ST_AsGeoJSON` — L1 https://typeorm.io/docs/drivers/postgres) — exactly what OpenMeet does (`locationPoint geography Point`, L2) | `ST_DWithin` index-backed nearby search beats app-side geohash. Requires `CREATE EXTENSION postgis` on the box (ops decision). If PostGIS is refused: **`h3-js`** 4.5.0 (Apache-2.0, WASM; `latLngToCell/gridDisk/cellToLatLng`) storing an H3 cell column at res 8–9 and querying `gridDisk`; or **`ngeohash`** 0.6.4 (MIT, tiny, old). For plain point-to-point distance **`geolib`** 3.3.14 (MIT, `getDistance`, `isPointWithinRadius`, `orderByDistance`) — or `@turf/distance` 7.4.0 (MIT) if you already want GeoJSON. Pick geolib (no GeoJSON ceremony). Misskey has none of these today (L2). |
| RSVP state machine | **`xstate`** 5.32.6 (MIT; `setup/createMachine/createActor`, persisted snapshots — L2) — **optional** | The machine is small (9 states, ~20 transitions, guards on capacity/gates/freeze). A hand-written transition table `{from, event, guard, to}` in one TS file is testable and avoids a 5.x dependency; use xstate only if you want the statechart diagram/typegen. My call: transition table + exhaustive unit tests. |
| Timers: pay-by expiry, promotion, reminders, no-show sweep | **`bullmq` 6.3.4 [Misskey pins 6.3.2]** with `ioredis` [5.11.1] | Delayed job per hold (`delay = payBy - now`, jobId = `hold:{rsvpId}` so re-holds are idempotent), repeatable job schedulers (cron-parser bundled) for occurrence materialisation and reminder fan-out. Do **not** add `node-cron` (4.6.0, ISC) — Misskey already schedules via BullMQ repeat patterns (L2 QueueService); two schedulers = split brain. |
| Notifications | Misskey `NotificationService` + push + `nodemailer` [9.0.6] | Reuse Misskey's notification types; add `meet:*` kinds. |
| Per-event chat | Misskey channels or a note-thread bound by `meetId` | Same DB; no Matrix. |
| Payments | Stripe SDK direct (later) or Hi.Events/pretix webhooks → `paymentStatus` enum on `meet_rsvp` | Keep as boundary. |
| Validation | Misskey's existing JSON-schema endpoint definitions | Consistent with `packages/backend/src/server/api/endpoints`. |

Schema sketch (L0): `meet` (dates, tz, venue, `location geography`, capacity, guestsAllowed, approvalMode, gates jsonb {levelMin,levelMax,gender,ageMin,ageMax}, freezeBeforeMinutes, payByMinutes, seriesId, occurrenceOf, hostId, chatRef, visibility, status) · `meet_series` (rrule text, tz, dtstart, until, templateMeetId) · `meet_rsvp` (meetId, userId, state, role host/cohost/player, guestCount, waitlistRank, holdExpiresAt, paymentStatus, checkedInAt, stateHistory jsonb) · `meet_cohost` · indices: `(meetId, state, waitlistRank)`, GIST on `location`.

State machine (L0, matches the brief): `requested → confirmed|waitlisted|declined` (auto vs host approval, capacity, gates) · `invited → confirmed|declined|maybe` · `waitlisted → hold` (auto-promotion on a confirmed cancel, ordered by `waitlistRank`, respects `freeze`) · `hold → confirmed` (paid/acknowledged before `holdExpiresAt`) | `→ waitlisted-tail` or `declined` on expiry (BullMQ delayed job) · `confirmed → checked-in|no-show` (host or sweep job after end) · `confirmed → declined` blocked inside freeze window unless host override.

---

## 5. What I could not verify (honest gaps)
- Hi.Events waitlist *deadline* semantics — doc page 403; only the ordering rule is L1.
- Mobilizon participant-role enum — source blocked; docs only show approve/pending.
- Exact last-publish dates for `rrule`/`rrule-temporal` — npmjs.com 403; registry `time` block was truncated. Versions are L2.
- Whether cal.diy retains seated events — README only says EE features removed.
- Star counts are GitHub API snapshots at fetch time; GitLab stars for Mobilizon/Gancio are on framagit, not GitHub.

## 6. Source index (all fetched 2026-09-10)
GitHub API: openmeet-api, openmeet-platform, HiEventsDev/hi.events, pretix/pretix, calcom/cal.com→cal.diy, lukevella/rallly, Attendize/Attendize, lowercasename/gathio, paviliondev/discourse-events→angusmcleod/angus-events-plugin, nextcloud/calendar, lesion/gancio, GetTogetherComm/GetTogether. GitLab API: framagit.org/api/v4/projects/kaihuri%2Fmobilizon (+releases, +issues?search=recurring, +tree priv/gettext), les%2Fgancio. Raw source: OpenMeet event.entity.ts / event-series.entity.ts / constant.ts / event-management.service.ts / event-attendee.service.ts / calendar-feed.service.ts / package.json; gancio package.json / server/api/models/event.js; gathio package.json / src/models/Event.ts; misskey packages/backend/package.json / src/core/QueueService.ts / src/models/Webhook.ts / locales tree. Docs: gancio.org/dev/api, docs.gath.io attendee-approvals, docs.mobilizon.org create/participate, docs.pretix.eu api/resources/waitinglist, typeorm.io/docs/drivers/postgres, misskey-hub OAuth, cal.com blog cal-diy-open-source-to-closed-source, meta.discourse.org 381205 & 402827, github.com/ggaabe/rrule-temporal, github.com/jkbrzt/rrule, adamgibbons/ics README. npm registry `/latest`: rrule-temporal, rrule, ical-generator, ics, date-fns-tz, geolib, @turf/distance, xstate, bullmq, node-cron, h3-js, ngeohash.

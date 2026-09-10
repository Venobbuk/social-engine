# Open-source sport-club / social-sport / pickup-game platforms — survey vs Reclub parity

Date: 2026-09-10. Scope: self-hostable, forkable projects implementing any of: open play / pickup RSVP + waitlist, club membership with roles + dues, court/venue booking, player ratings/levels, ladders, DUPR/UTR, kudos, team/league management, chat, venues/map, match generator, competitions.
Target we are extending: Misskey fork (TypeScript / Node / Postgres+TypeORM / Vue 3) + hkpl (league engine) + pyke (commerce).

## Evidence labels (proof levels — nothing here is above L2, most is L1)

| Tag | Meaning | Contract level |
|---|---|---|
| **[J]** | Number/field read from the GitHub (or Framagit) REST API JSON — hardest fact in this doc | L2 (machine field, not interpreted) |
| **[F]** | Page/README/source file fetched by WebFetch, which returns a *model-written summary* of the page, not the raw text. Quotes inside are what the summariser reported as quotes. | L1 (summarised for me) |
| **[S]** | Seen only in a search-result snippet; page not opened | L0/L1 |
| **[I]** | My inference | L0 |

No server was touched. No repository was cloned or run. "Maintained?" = pushed within ~90 days per `pushed_at` [J]; it is not a judgement on quality.

---

## 1. Ranked shortlist (what is actually worth borrowing)

| # | Project | Why it ranks here | Integration path |
|---|---|---|---|
| 1 | **OpenMeet** (`openmeet-api` + `openmeet-platform`) | Only candidate whose *event/attendee/group-role model* maps almost 1:1 onto Reclub "meets" + "clubs": `maxAttendees`, `requireApproval`, `allowWaitlist`, `requireGroupMembership`, attendee statuses incl. `waitlist`/`pending`/`confirmed`, group roles `owner/admin/moderator/member/guest`, 19 group permissions, PostGIS point, event series, Matrix chat. Apache-2.0, TypeScript, Postgres, same relational-entity style as ours [I: TypeORM]. | **Port the model** (entities + state machine + permission matrix) into the Misskey fork. Do not run it side-by-side: no payments, no ratings, and a second Postgres/NestJS/Matrix/RabbitMQ stack is dead weight. |
| 2 | **CourtHive `competition-factory`** (+ `TMX`) | MIT npm library (`tods-competition-factory`), 22k commits, "9,800+ tests", draw generation (round robin, elimination, DrawMatic probabilistic pairing, Lucky Draw), scheduling engines, scoring engine, ranking-points ("Scale") engine. Pushed 2026-09-10. | **Bolt on as a dependency** for competitions + match generator. Pure TS, no server. TMX shows the UI patterns. |
| 3 | **`mbeacom/openleague`** | Apache-2.0, Next.js 16 + Prisma + Postgres. Prisma schema is the richest *payments + registration + venue-reservation* model found: `SignupEvent{capacity, registrationMode}`, `EventRegistration`, `Payment{stripeAccountId, applicationFeeAmount, PaymentStatus enum}`, `VenueReservation` + `VenueReservationTransition`, `SkillLevelReference`, `AssociationRoleGrant`. README claims signup events with "role-limited slots, waitlists, and Stripe payments". Hockey-centric (`IceSurface`). 13 stars, pushed 2026-09-05. | **Port schema ideas** for meet payments (pyke link), venue reservations, role grants. Not a fork candidate (Next.js, single-dev, hockey domain). |
| 4 | **DUPR official API + `offsetkeyz/dupr-api-client` / `Lighthouse-Pickleball/dupr_prod`** | Official swagger exists (`prod.mydupr.com/api/swagger-ui`, `api.dupr.gg/api-explorer?group=public`); Python clients enumerate endpoints: auth token, player search, rating history, match create/update/bulk, club members' ratings, club match submission. Club integration requires every player to have a DUPR ID and a Club ID. | **Re-implement in TS** from the endpoint map (MIT client is a usable spec). Confirm partner-access terms with DUPR before building (docs at `events.mydupr.com/docs` are gated to @dupr.com logins). |
| 5 | **`philihp/openskill.js`** | Weng-Lin (TrueSkill-class) rating with asymmetric teams, patent-free, npm/TypeScript. | **Bolt on** as internal level engine (doubles-aware) for non-DUPR sports / provisional levels. |
| 6 | **Mobilizon** | AGPL-3.0, Elixir, ActivityPub events + groups with roles, "Number of places" limit, participation approval, anonymous participation. No waitlist. Framagit last activity 2026-09-09. | **Protocol reference only**: our meets are AP objects already (Misskey); publishing them as Mobilizon-compatible `Event` objects gives federation for free. Don't port code (Elixir, AGPL). |
| 7 | **`tkrebs/ep3-bs`** and **LibreBooking** | Two mature PHP court/resource booking systems. ep3-bs: MIT, 215 stars, "1.9.1 (August 2026)", court calendar, billing, en/de. LibreBooking: GPL-3.0, 804 stars, pushed 2026-09-09, waitlist, quotas/credits, API. | **UX/model reference** for venue booking; both wrong stack and (LibreBooking) copyleft. Embedding LibreBooking via its API is possible but adds a PHP box. |
| 8 | **hitobito** / **Admidio** / **vereinfacht** | Membership/roles/dues systems for federations & Vereine (AGPL / GPL-2 / MIT). hitobito: JSON:API for group/person/event/mailing_list/invoice, events with max participants + waiting-list role. vereinfacht: Laravel+Next.js, JSON:API + OpenAPI, multilingual membership applications, "early-adoption phase". | **Reference** for club dues/membership-application flows. Not forkable into our stack. |
| 9 | **Match-generator toys**: `alimfeld/tournicano`, `chinmaymahajan/PickleAdmin` (= courtcontrol.pro), `imathis/court-shuffle`, `akulanikhil/pickleball` | Browser-only Americano/Mexicano/round-robin/king-of-court rotation generators with court assignment, sit-out fairness, TV mode. Small (1–3 stars) but current (2026). Licence: court-shuffle MIT [J]; PickleAdmin README says MIT but GitHub API reports no licence file [J] — conflict, treat as unlicensed until checked; tournicano no licence [J]. | **Read the algorithms**, re-implement. Only court-shuffle is safely MIT. |
| 10 | **`tysoncung/gameon`** | Next.js/Mongo/Twilio WhatsApp RSVP bot: reply `in`, `out`, `in +2`, `status`; daily cron nags non-responders. No licence file [J]. | **Steal the idea** (WhatsApp is the HK organiser channel), not the code. |

**No project covers more than ~40 % of the Reclub list, and none is on our stack. Nothing is worth forking wholesale.** Borrow models (1, 3, 8), bolt on libraries (2, 5), re-implement API clients (4), copy UX ideas (9, 10).

---

## 2. Feature coverage matrix

Legend: ✔ implemented (per [F]/[J] evidence) · ◐ partial / adjacent · ✘ absent or not documented · ? not checked. Columns: **Open play RSVP+waitlist** · **Club roles/dues** · **Court/venue booking** · **Ratings/levels** · **Ladders** · **DUPR/UTR** · **Kudos** · **Team/league** · **Chat** · **Venues/map** · **Match generator** · **Competitions/draws**

| Project | RSVP+WL | Club roles/dues | Booking | Ratings | Ladder | DUPR | Kudos | Team/league | Chat | Map | MatchGen | Draws |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| OpenMeet | ✔ (`allowWaitlist`, status `waitlist`) | ◐ roles/permissions, no dues | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ | ✔ Matrix | ✔ PostGIS point, map | ✘ | ✘ |
| competition-factory / TMX | ✘ | ✘ | ◐ court scheduling engine | ◐ ranking points ("Scale Engine") | ✘ | ✘ | ✘ | ◐ team events | ✘ | ✘ | ✔ DrawMatic / RR | ✔ |
| openleague | ✔ RSVP GOING/NOT_GOING/MAYBE; signup capacity + waitlist (README) | ◐ Team ADMIN/MEMBER, AssociationRoleGrant; Stripe payments | ✔ VenueReservation + transitions | ◐ SkillLevelReference | ✘ | ✘ | ✘ | ✔ League/Division/Season | ◐ LeagueMessage | ◐ Venue entity | ◐ GameProposal | ◐ SeasonGame |
| DUPR clients | ✘ | ◐ club members | ✘ | ✔ | ✘ | ✔ | ✘ | ✘ | ✘ | ✘ | ✘ | ◐ events/brackets endpoints |
| openskill.js | ✘ | ✘ | ✘ | ✔ (teams) | ◐ (ordinal) | ✘ | ✘ | ✘ | ✘ | ✘ | ◐ predictWin | ✘ |
| Mobilizon | ◐ limit + approval, no WL | ◐ group roles | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ | ◐ group discussions | ✔ | ✘ | ✘ |
| ep3-bs | ✘ | ◐ user roles, billing | ✔ | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ |
| LibreBooking | ◐ reservation waitlist | ◐ roles, quotas/credits | ✔ | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ |
| hitobito | ◐ event max participants + waiting-list role | ✔ hierarchy, roles, invoices | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ | ◐ mailing lists | ✘ | ✘ | ✘ |
| Admidio | ◐ event participation | ✔ roles, memberships | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ | ◐ email | ✘ | ✘ | ✘ |
| vereinfacht | ✘ | ✔ applications, fees (Laravel/Filament) | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ |
| Volleyball-League (axuno) | ✘ | ◐ tenants, roles | ◐ venues | ✘ | ✘ | ✘ | ✘ | ✔ fixtures/standings/referees | ✘ | ◐ venues | ✘ | ◐ fixtures |
| SportsPress (WP) | ✘ | ✘ | ✘ | ◐ player stats | ✘ | ✘ | ✘ | ✔ leagues/tables | ✘ | ◐ venues | ✘ | ◐ |
| elovation | ✘ | ✘ | ✘ | ✔ Elo + TrueSkill | ◐ | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ |
| tournicano / PickleAdmin / court-shuffle | ◐ session player list | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ | ✔ | ◐ Americano/Mexicano |
| gameon (tysoncung) | ✔ WhatsApp `in/out/in +2`; no WL | ◐ groups via invite code | ✘ | ✘ | ✘ | ✘ | ◐ attendance stats | ✘ | ◐ WhatsApp | ✘ | ✘ | ✘ |
| HumHub calendar (already in our inventory) | ◐ participation, recurring; max/WL not documented | ◐ spaces | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ | ✔ | ◐ Events Map module | ✘ | ✘ |

**Kudos / endorsements / reputation: no open-source sports project found implements it.** The closest is `gameon`'s attendance stats and the commercial "Pickup" app's "reputation system" [S]. Reclub's kudos will be an in-house build (Misskey reactions are the obvious substrate [I]).

**Ladders: nothing maintained.** All ladder repos found (`django-tennis-ladder`, `TennisClubLadder`, `mhas97/TennisLadder-Backend`, `robhoes/elo-ladder`) are hobby/stale [S]. Build ladder on top of openskill/competition-factory.

---

## 3. Candidate dossiers

### 3.1 OpenMeet — `OpenMeet-Team/openmeet-api`, `OpenMeet-Team/openmeet-platform`
- URLs: https://github.com/OpenMeet-Team/openmeet-api · https://github.com/OpenMeet-Team/openmeet-platform · https://platform.openmeet.net/ · API docs https://api.openmeet.net/docs
- Licence: API Apache-2.0 [J]; platform LICENSE file = Apache-2.0 [F] (GitHub API reports `NOASSERTION` [J] because the file is non-standard text).
- Stack [F]: API "NestJS + TypeScript", "PostgreSQL (multi-tenant via schemas)", Redis, RabbitMQ, "JWT + OAuth (ATprotocol/Bluesky, Google, GitHub)", "Matrix (Synapse)" chat. Platform "Vue 3" + "Quasar", Pinia, Vitest, Cypress. Directory layout `infrastructure/persistence/relational/entities/` [F] → TypeORM (brocoders nestjs-boilerplate lineage) [I].
- Stars/activity [J]: api 26★/7 forks, pushed 2026-09-05, created 2024-09-18, 12 open issues; platform 63★/11 forks, pushed 2026-08-21. Maintained: yes.
- Data model (fetched from `src/core/constants/constant.ts` and `event.entity.ts` [F]):
  - `EventAttendeeStatus`: `invited, confirmed, attended, cancelled, rejected, maybe, pending, waitlist`
  - `EventAttendeeRole`: `participant, host, speaker, moderator, guest`
  - `GroupRole`: `owner, admin, moderator, member, guest`; `GroupPermission` 19 values incl. `MANAGE_GROUP, DELETE_GROUP, MANAGE_MEMBERS, MANAGE_EVENTS`; `UserPermission` 35+.
  - `EventType` `in-person|online|hybrid`; `EventStatus` `draft|pending|published|cancelled`; `EventVisibility`/`GroupVisibility` `public|unlisted|private`.
  - Event entity fields: `maxAttendees`, `requireApproval`, `approvalQuestion`, `requireGroupMembership`, `allowWaitlist`, `attendeesCount`, `locationPoint` (geography Point), `lat/lon`, `timeZone`, `series` (recurrence), `matrixRoomId`, `sourceType/sourceId/sourceUrl/sourceData` (import from bluesky/eventbrite/facebook/luma/meetup), ATProto publish fields.
- API [F]: REST + OpenAPI; tags include Groups, GroupRole, Events, EventRole, "RSVP Integration", Matrix, ATProto, Calendar Feeds. Paths `/api/events/{slug}/attendees`, `/api/groups/{slug}/members`. No payment endpoints. No i18n endpoints.
- i18n: not documented [F]. Payments: none [F]. Ratings/sport: none.
- Verdict: **best model donor** for meets (RSVP/waitlist/approval/level-gate-by-membership) and club RBAC. Mismatch: Meetup-shaped (no sport, no money, no levels). Waitlist *promotion* logic lives in `event-attendee.service.ts` [F: file list only — not read].

### 3.2 CourtHive `competition-factory` + `TMX`
- URLs: https://github.com/CourtHive/competition-factory · https://github.com/CourtHive/TMX · npm `tods-competition-factory`
- Licence: MIT both [J]. Stars [J]: 31 / 26. Pushed 2026-09-10 both [J]. competition-factory created 2020-09 [J]; "22,153 commits" [F]; TMX "5,516 commits" [F].
- What [F]: "functions to manipulate TODS-JSON documents which represent tournaments and leagues; generating draws & etc." Engines: draw generation (DrawMatic probabilistic pairing, Lucky Draw, Draft Draws, "linked structure architecture enables tournament topologies of arbitrary complexity"), scheduling ("Garman and Pro"), Scoring Engine, "Scale Engine for ranking points", publishing with embargo. "9,800+ tests … thresholds: 95/95/85/95%".
- TMX [F]: PWA, vanilla TypeScript, Vite, draws, real-time score entry, singles/doubles entries, PDF, Google Sheets import, offline. Backend not specified. i18n not documented.
- Verdict: **bolt-on** for competitions and the doubles match generator. Tennis-origin (TODS) but sport-agnostic data; pickleball/padel topics tagged on GitHub [F topic page].

### 3.3 `mbeacom/openleague`
- URL: https://github.com/mbeacom/openleague · Licence Apache-2.0 [J] (docs CC-BY-4.0, trademark reserved [F]).
- Stack [F]: "Next.js 16 with App Router and React 19", "PostgreSQL (Neon) via Prisma ORM", "Auth.js v5", MUI v7, Bun, Vercel; self-host "via Docker or traditional hosting with PostgreSQL and SMTP".
- Stars/activity [J]: 13★/11 forks, created 2025-10-05, pushed 2026-09-05, 0 open issues. Status "MVP Complete" [F].
- Data model (Prisma schema fetched [F]): ~90 models. Relevant: `Team{sport enum HOCKEY…OTHER}`, `TeamMember{role ADMIN|MEMBER}`, `Event{type GAME|PRACTICE}`, `RSVP{status GOING|NOT_GOING|MAYBE|NO_RESPONSE}`, `Invitation`, `League/Division/Season/SeasonPhase/SeasonGame/GameProposal/PlacementDecision`, `Venue/VenueStaff/VenueOperatingHour/VenueScheduleBlock/VenueReservation/VenueReservationTransition/VenueReservationOverride`, `SignupEvent{capacity, registrationMode, status}`, `EventRegistration{status, quantity, unitAmount, amountTotal, confirmedAt, canceledAt, checkInActorId, manualPaymentMarkerId}`, `Payment{status FREE|REQUIRES_PAYMENT|PROCESSING|PAID|FAILED|REFUNDED|PARTIALLY_REFUNDED|CANCELED, applicationFeeAmount, stripeAccountId, stripeCheckoutSessionId, stripePaymentIntentId}`, `SkillLevelReference`, `AssociationRole/AssociationRoleGrant{scopeType, grantedAt, revokedAt}`, `NotificationOutbox/NotificationBatch`, gear inventory (large, irrelevant).
- Verdict: **schema reference** for paid meets (Stripe Connect-style application fee → maps to pyke), venue reservation state machine, scoped role grants. Not forkable (Next.js/Prisma, hockey, one author).

### 3.4 DUPR integration
- Official: https://www.dupr.com/club-resources [S], API explorer https://api.dupr.gg/api-explorer?group=public [S], staff docs https://events.mydupr.com/docs (login gated to @dupr.com/@mydupr.com) [S], swagger `prod.mydupr.com/api/swagger-ui` [F via dupr_prod README].
- Club rules [S]: "all participants in a match must have a DUPR ID"; clubs insert Club ID into partner software so results flow to the club; CSV upload alternative.
- `offsetkeyz/dupr-api-client` https://github.com/offsetkeyz/dupr-api-client — MIT [J], Python, 3★, pushed 2025-11-12 [J]. Covers [F]: bearer auth, player search/details/rating history/matches, rating-impact simulation, match create/update/search (singles/doubles), club search/membership/club match submission, events/brackets/admin. Partner status not stated [F].
- `Lighthouse-Pickleball/dupr_prod` https://github.com/Lighthouse-Pickleball/dupr_prod — no licence, 0★, 5 commits [F]; generated by OpenAPI Generator 7.11.0 from `api-doc.json` [F]. Endpoints: `POST /api/auth/{version}/token`, ratings/history/subscription, users search/provisional ratings/invitations/club membership, matches CRUD/bulk/history, `club_members_rating_using_post` [F].
- `ironprogrammer/pickleball-ratings` (WP plugin, "uses the official DUPR API") [S]; `lsternlicht/duprly` scraper [F topic page] — scrapers are out of scope.
- Verdict: endpoint surface is known and small; write a TS client against the official swagger; obtain partner/club API credentials first. Reclub's own DUPR screens are documented in `domain_competition_dupr.md` in this directory.

### 3.5 `philihp/openskill.js`
- URL: https://github.com/philihp/openskill.js · npm `openskill` [S]. Licence: not fetched — MIT per my memory [I]; verify.
- [S]: "JavaScript implementation of Weng-Lin Rating, up to 20x faster than TrueSkill", "not encumbered by patents", asymmetric teams ("3 vs 2"), `rate()`, `ordinal()`, `predictWin()`, `predictDraw()`.
- Verdict: drop-in for internal doubles level; elovation's TrueSkill has the Microsoft-patent caveat [F], openskill avoids it.

### 3.6 Mobilizon
- URLs: https://framagit.org/framasoft/mobilizon · https://docs.mobilizon.org/ (GitHub mirror `framasoft/mobilizon` returns 404 [J]).
- Licence AGPL-3.0 (LICENSE file fetched [F]). Framagit [J]: 157★, 143 forks, last activity 2026-09-09, created 2017-12-08. Maintained by Kaihuri (ex-Framasoft) [S].
- Events [F docs]: "Number of places … if you want to limit this number", approval "if you want to approve every participation request", anonymous participation with email confirm, organiser = profile or group with contacts. **No waiting list** in docs [F]. v4 imports from Facebook/Meetup [S].
- Verdict: protocol reference (ActivityPub `Event`, `Join`/`Accept` participation). Elixir code not portable.

### 3.7 `tkrebs/ep3-bs`
- URL: https://github.com/tkrebs/ep3-bs · MIT [J] · PHP 8.1–8.4, Zend Framework 2.5, MySQL [F] · 215★/131 forks/248 open issues, created 2014, pushed 2026-08-15 [J] · "1.9.1 (August 2026)" [F].
- Features [F]: interactive booking calendar, en/de, responsive, roles, "billing administration", GDPR options, email notifications. Origin: tennis club court booking, once sold as SaaS [S].
- Verdict: UX reference for court grid + billing; stack mismatch.

### 3.8 LibreBooking
- URL: https://github.com/LibreBooking/librebooking (API redirect from `LibreBooking/app`) · GPL-3.0 [J] · PHP 8.2+, MySQL/MariaDB, Bootstrap 5 [F] · 804★/378 forks, pushed 2026-09-09 [J] · fork of Booked Scheduler 2020 [F].
- Features [F]: "multi-resource booking with waitlist functionality", "quotas and credits", RBAC, reporting, plugin architecture, ICS.
- Verdict: only if a separate venue-booking box is acceptable (GPL, PHP). Otherwise reference for quotas/credits (Reclub "credits"-style booking).

### 3.9 hitobito
- URL: https://github.com/hitobito/hitobito · AGPL-3.0 [J] · Ruby on Rails, "Wagons" plugin framework [F] · 477★/136 forks/402 open issues, created 2013, pushed 2026-09-10 [J] · "11,961 commits", OpenSSF badge [F] · users: Swiss youth/scout federations [F].
- Features [F]: group hierarchies with typed roles, members, events with registration, courses, mailing lists, invoices/fees. API: JSON:API endpoints "group, person, event, mailing_list, invoice" [S]. Events: per-event waiting-list toggle, max participants, "Waiting list" role instead of Participant [S, from issues in wagons — partially feature requests].
- Verdict: reference for federation-grade membership/dues/role hierarchy (Reclub club "roles + tags" analogue). Not portable.

### 3.10 Admidio
- URL: https://github.com/Admidio/admidio · GPL-2.0 [J] · PHP 8.2+, MariaDB/MySQL/PostgreSQL [F] · 474★, pushed 2026-09-07 [J] · 20+ languages [F] · roles/groups, member profiles, relationships, events with participation, photo, documents, email [F]. API not documented [F].
- Verdict: reference only.

### 3.11 `vereinfacht/vereinfacht`
- URL: https://github.com/vereinfacht/vereinfacht · MIT [J] · "Laravel (API backend)", MariaDB, Next.js, Filament admin, "JSON:API & Open API spec" [F] · 61★, created 2025-05, pushed 2026-08-13, 43 open issues [J] · "early-adoption phase" [F] · multilingual membership applications, Super Admin / club-admin roles [F].
- Verdict: reference for membership-application + fee flow. Young.

### 3.12 `axuno/Volleyball-League`
- URL: https://github.com/axuno/Volleyball-League · MIT [J] · ASP.NET 10 / C#, SQL Server 2022 [F] · 22★, pushed 2026-09-09 [J] · fixtures + calendar export, results, standings, venues, referees, tenants, runtime config, en/de, live at volleyball-liga.de [F].
- Verdict: hkpl already covers this; reference for referee/venue/tenant modelling only.

### 3.13 SportsPress (WordPress)
- URL: https://github.com/ThemeBoy/SportsPress · GPLv3 per wordpress.org [S], API `NOASSERTION` [J] · PHP · 164★/106 forks/160 issues, pushed 2026-08-30 [J] · leagues, teams, players, events, venues, standings, stats, calendars, equation builder, CSV import, Transifex i18n, Pro upsell [F/S].
- Verdict: league-stats presentation reference only; WP-bound.

### 3.14 `elovation/elovation`
- URL: https://github.com/elovation/elovation · MIT [J] · Rails, Postgres, Docker [F] · 172★/162 forks, pushed 2024-11-05 [J] (stale) · Elo (1v1) + TrueSkill (teams) with "Caution" that commercial use requires removing the Microsoft-patented TrueSkill [F].
- Verdict: reference; prefer openskill.

### 3.15 Match-generator toys (all browser-only, no backend)
- `alimfeld/tournicano` https://github.com/alimfeld/tournicano — no licence [J], TS/Mithril/Pico/Vite, PWA offline, "Americano, Mexicano, and other formats", "automatic player pairing and fair rotation" [F]; 3★, 428 commits, pushed 2026-09-02 [J/F].
- `chinmaymahajan/PickleAdmin` https://github.com/chinmaymahajan/PickleAdmin (deployed as courtcontrol.pro) — README says MIT [F], GitHub API `license: null` [J] → **licence conflict, unresolved**; React 18/TS/Vite, round robin, open play, king/queen of court, drag-and-drop court assignment with conflict detection, TV mode up to 30 courts, timers/horn, xlsx/csv import, "Nothing is transmitted to any server" [F]; 1★, pushed 2026-03-24 [J].
- `imathis/court-shuffle` https://github.com/imathis/court-shuffle — MIT [J], TS, "organizing court mixers like tennis and pickle ball" [J], 2★, pushed 2026-08-22 [J].
- `akulanikhil/pickleball` "Fair and automated pickleball rotations generator", JS, 3★, updated 2026-07-14 [F topic page].
- `rbongard/tournament-scheduler` "Round-robin tournament scheduler for racket-sports clubs", TS, 1★, 2026-06-09 [F topic page].
- Verdict: read for the fairness heuristics (repeat-partner minimisation, sit-out balancing); implement in hkpl/social engine.

### 3.16 `tysoncung/gameon`
- URL: https://github.com/tysoncung/gameon · no licence file [J] (README says MIT [F]) · Next.js 16, Tailwind 4, MongoDB Atlas via Mongoose, Twilio WhatsApp Business API, Vercel [F] · 7★, 17 commits, created 2026-02-27, pushed 2026-05-17 [J/F].
- Features [F]: WhatsApp bot "RSVP by texting `in`, `out`, `in +2` (bring friends), `status`", web invite links, groups via invite codes, admin panel, daily cron reminders to non-responders, attendance stats. No waitlist/capacity/payments/skill [F].
- Verdict: idea only (WhatsApp RSVP + guest count) — matches Reclub's "bring guests" meets; Twilio WhatsApp Business is the delivery path [I].

### 3.17 Already in our inventory: HumHub `calendar`
- https://github.com/humhub/calendar — licence not detected [J], PHP, 31★/48 forks/96 issues, pushed 2026-09-10 [J]; marketplace v1.9.4 (2026-09-08), free, HumHub 0.8–1.19 [F]; recurring events, reminders, "manage event participation, keep track of attendees" [F]; max participants / waitlist **not documented** on README or marketplace page [F]. Events Map module exists [S].
- Verdict: consistent with the earlier finding that the dormant HumHub layer is a weaker meets model than OpenMeet's.

---

## 4. Seen, rejected

| Project | Why rejected | Evidence |
|---|---|---|
| `pushpickup/pushpickup` (Meteor pickup games) | pushed 2016-03-06; Meteor | [J] |
| `freeCodeCamp/league-for-good` | archived, pushed 2019-05 | [J] |
| `awoo100-zh/simple-sports` | 0★, pushed 2017 | [J] |
| `GameOn/gameon` (GitHub) | 2010 C++ repo, unrelated to the GameOn pickup app (commercial, game-on.app) | [J]/[S] |
| `adroste/tennis-court-reservation-system-v2` | AGPL, pushed 2021-10, German-only, "still in development" | [J]/[F] |
| `zorkpt/padel_league` | no licence, pushed 2023-08 | [J] |
| `Ehtisham33/Ace-community-project` | GitHub 404 on fetch; search snippets describe a proposal-style student project | [J]/[S] |
| `RocketDelivery2/TeamBuilder` | GitHub description says open-source, LICENSE says "proprietary software. All rights reserved" | [F]; its Recruiting→Full→Recruiting refill state idea is noted |
| `Lehrstuhl-BWL-EvIS/sportyweb` (Elixir, FernUni Hagen) | AGPL, "not yet ready for production", pushed 2025-03 | [J]/[F] |
| `tnthreat33/project-4-pickleball`, `riyad899/SCMS`, `charukaJayasinghe/laravel_club_management`, `Moswag/sportsclubsytem`, gym systems (LaraGym, Gymie, GimnasioQR, wger, OpenStudio, Costasiella, AuraFlow) | student/bootcamp or gym-domain; no sport-social features | [S] |
| `Athvexa` (Spring Boot + React "sports social platform") | not read; snippet-only; ranking/OCR domain unrelated | [S] |
| Awesome-Sports-Club-Management list | generic SaaS/CRM/ERP catalogue; no sport-specific OSS beyond those already covered | [F] |
| OpenSports (opensports.net) | commercial; GitHub org holds only forked RN libraries | [F] |
| Rankade | commercial; `rankade.com/api` fetch failed twice (socket hang up) — API terms not read | [S] |
| OpenPlay (openplay.net) | commercial leisure-centre software; GitHub org = Ruby buildpacks | [S] |
| Vollea, Chalk, Hometown, Sportlink, TennisConnect, Heja, Spond, TeamSnap, Playtomic, CourtReserve, Pickleheads, PicklePlay, KrazyPickles, Ratibly, PlayMore | commercial or not found as OSS | [S] |
| Playtomic tooling (`ypk46/playtomic-scheduler`, `joshp123/padel-cli`, `rafa-garcia/go-playtomic-api`) | clients that scrape/automate Playtomic; useful only as API notes, not platforms | [S]/[F] |
| Discourse Events / Calendar plugins | RSVP yes, waitlist not found; only relevant if Discourse were the base | [S] |
| Elo toys (`diesys/pomelo`, `lambtron/ladder`, `robhoes/elo-ladder`, `jacquesh/getrankd`, `Browser-Elo-Ranking`) | small, mostly stale; superseded by openskill/competition-factory | [S] |
| CV/analytics repos on pickleball/padel topics (TrackNet, Padex, PadelVic, ovscout2) | not platforms | [F] |

---

## 5. Recommendation

1. **Do not fork any of these.** Base remains the Misskey fork. Highest-coverage candidate (OpenMeet) is ~35 % of the Reclub list and is money-blind and sport-blind; the rest are single-feature.
2. **Port OpenMeet's model into the social engine** (Apache-2.0 permits it): the `EventAttendeeStatus` state machine (`pending → confirmed | waitlist → confirmed on promotion`, `invited`, `maybe`, `attended`, `cancelled`, `rejected`), `maxAttendees/requireApproval/approvalQuestion/requireGroupMembership/allowWaitlist`, event series, `GroupRole` × `GroupPermission` matrix, PostGIS `locationPoint`. Read `event-attendee.service.ts` before porting — waitlist promotion semantics are there and were **not read** in this pass.
3. **Bolt on `tods-competition-factory`** (MIT, TS) for competitions, draws, scheduling and the doubles match generator; **`openskill`** for internal levels. Both are libraries, no new servers.
4. **DUPR**: write a TS client from the official swagger; use `offsetkeyz/dupr-api-client` as the endpoint checklist (auth token, player search, rating history, club members' ratings, club match submission, bulk match). Gate: partner/club API access from DUPR — confirm before spending effort.
5. **Payments / venue booking**: copy `openleague`'s `Payment` + `EventRegistration` + `VenueReservation(+Transition)` shapes as the contract between social engine and pyke; UX from ep3-bs/LibreBooking only.
6. **Kudos, ladders, insights**: in-house. No OSS donor exists; ladders can be an `openskill.ordinal()` sort plus challenge rules.
7. **Federation**: emit meets as Mobilizon-compatible ActivityPub `Event` objects (cheap because Misskey already speaks AP) — optional, later.
8. **Small idea to keep**: WhatsApp `in / out / in +2` RSVP bot (gameon) — fits HK organiser habits.

### What I did not verify (honest gaps)
- All READMEs/schemas were read through WebFetch's summariser, not raw (L1). Numbers from the GitHub API are the only L2 items.
- openskill.js licence, OpenMeet waitlist-promotion logic, hitobito waiting-list behaviour (issue threads, some are requests not features), Rankade API, DUPR partner-access terms.
- No project was cloned, built or run — "maintained" = `pushed_at` only.

### Sources (primary URLs used)
https://github.com/OpenMeet-Team/openmeet-api · https://github.com/OpenMeet-Team/openmeet-platform · https://api.openmeet.net/docs-json · https://raw.githubusercontent.com/OpenMeet-Team/openmeet-api/main/src/core/constants/constant.ts · https://raw.githubusercontent.com/OpenMeet-Team/openmeet-api/main/src/event/infrastructure/persistence/relational/entities/event.entity.ts · https://github.com/CourtHive/competition-factory · https://github.com/CourtHive/TMX · https://github.com/mbeacom/openleague · https://raw.githubusercontent.com/mbeacom/openleague/main/prisma/schema.prisma · https://github.com/offsetkeyz/dupr-api-client · https://github.com/Lighthouse-Pickleball/dupr_prod · https://www.dupr.com/club-resources · https://api.dupr.gg/api-explorer?group=public · https://github.com/philihp/openskill.js · https://framagit.org/framasoft/mobilizon · https://docs.mobilizon.org/1.%20Use/Events%20and%20Activities/1.create-events/ · https://github.com/tkrebs/ep3-bs · https://github.com/LibreBooking/librebooking · https://github.com/hitobito/hitobito · https://github.com/Admidio/admidio · https://github.com/vereinfacht/vereinfacht · https://github.com/axuno/Volleyball-League · https://github.com/ThemeBoy/SportsPress · https://github.com/elovation/elovation · https://github.com/alimfeld/tournicano · https://github.com/chinmaymahajan/PickleAdmin · https://courtcontrol.pro/ · https://github.com/imathis/court-shuffle · https://github.com/tysoncung/gameon · https://github.com/RocketDelivery2/TeamBuilder · https://github.com/humhub/calendar · https://marketplace.humhub.com/module/calendar/description · https://github.com/topics/pickleball · https://github.com/topics/padel · https://github.com/topics/club-management · https://github.com/topics/pickup-games · https://github.com/ishandutta2007/Awesome-Sports-Club-Management · https://github.com/pushpickup/pushpickup · https://github.com/freeCodeCamp/league-for-good · https://github.com/OpenSports

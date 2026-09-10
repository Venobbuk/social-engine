# Research: events/RSVP module options for a Misskey 2026.9.0 fork (2026-09-10)

STATUS: COMPLETE for this 40-call budget. Nothing on any server was touched.

Proof labels (per operating contract):
- [READ] = I fetched the URL and a summariser model read it for me -> honest level **L1** (told by a tool), not L2. Quoted code strings are verbatim from that summary.
- [SEARCH] = only a search-result snippet -> L1, weaker.
- [INFERRED] = my inference -> L0.
- [NOT VERIFIED] = from prior knowledge, fetch failed -> L0.

Our required model, for the comparison table: event w/ capacity; RSVP states incl. waitlist + hold; gates (who may RSVP); recurrence; venue lat/lng; per-event chat.

---

## Q1 — Does Misskey or a fork ship / plan an events/RSVP/calendar module?

| Project | Ships events? | Evidence |
|---|---|---|
| **Misskey (upstream)** | **No.** No module, no roadmap item. | #3217 "Events / calendar" OPEN since 2018-11-13, label Feature, no maintainer reply, no PR [READ] https://github.com/misskey-dev/misskey/issues/3217 ; #3110 same request [SEARCH] https://github.com/misskey-dev/misskey/issues/3110 ; #8353 "An event planner" (2022-02-25) CLOSED; snippet says reply pointed to Mobilizon because in-Misskey would be "quite complicated" [READ state / SEARCH reply] https://github.com/misskey-dev/misskey/issues/8353 |
| **CherryPick** (kokonect-link, AGPL-3.0, 170 stars / 64 forks) | **Partial: "event on a note"** — a note may carry title/start/end; federated since 4.17.0 (2025-11-12) via changelog line `Feat: 이벤트 연합 (yojo-art/cherrypick#658)`; 4.13.0 note-edit covers events; Unreleased: edit-history covers events. **No RSVP, no capacity, no recurrence, no venue geo, no chat.** [READ] https://raw.githubusercontent.com/kokonect-link/cherrypick/develop/CHANGELOG_CHERRYPICK.md ; repo [READ] https://github.com/kokonect-link/cherrypick |
| CherryPick internals | `packages/backend/src/core/activitypub/models/ApEventService.ts` imports `IEvent from @/models/Event.js`; `isEvent(note)` type guard; reads AP `name` + `startTime` (required), `endTime`, `href`, `summary`, `id`; returns `{ title, start, end, metadata: { '@type': 'Event', startDate, endDate, name, url, identifier } }` (schema.org-flavoured JSON-LD in a jsonb column). `ApNoteService` calls `apEventService.extractEventFromNote(note, resolver)` on create+update and passes `event` into `noteCreateService.create()`. [READ] https://raw.githubusercontent.com/kokonect-link/cherrypick/develop/packages/backend/src/core/activitypub/models/ApEventService.ts , https://raw.githubusercontent.com/kokonect-link/cherrypick/develop/packages/backend/src/core/activitypub/models/ApNoteService.ts . (NB: `models/NoteEvent.ts` 404 — the entity is `models/Event.ts`; not fetched.) |
| **Sharkey** (TransFem-org, activitypub.software) | **No hits.** Official CHANGELOG fetch returned HTTP 402 (rate-limited). A git.moe.team mirror (stale: latest header 2025.5.0) has zero lines matching event/calendar/RSVP/Mobilizon. [READ, stale mirror] https://git.moe.team/OpenSource/Sharkey/raw/branch/develop/CHANGELOG.md ; canonical https://activitypub.software/TransFem-org/Sharkey/-/blob/develop/CHANGELOG.md (NOT READ) |
| **Iceshrimp.NET** (C#, not a Misskey codebase) | No hits in search; issue tracker not searched directly. [SEARCH] https://iceshrimp.dev/iceshrimp/Iceshrimp.NET — treat as "unknown, probably none" [INFERRED] |
| **Firefish / Calckey (legacy, discontinued)** | Calckey/Firefish is where the "event on a note" concept + `Event` AP ingestion lineage came from (Calckey #9595 "Add support to properly process all Mobilizon Events" exists; Codeberg fetch 504'd). Project discontinued March 2024. [SEARCH] https://codeberg.org/calckey/calckey/issues/9595 , https://joinfediverse.wiki/What_is_Firefish%3F |
| **Foundkey / Catodon** | Not searched in this budget; both archived/inactive per general knowledge [NOT VERIFIED]. Not a source of a maintained events module. |

**Q1 verdict:** nobody in the Misskey family ships an RSVP/capacity/calendar module. The only shipped artefact is CherryPick's note-attached `Event` (title/start/end + jsonb metadata, federated) — useful as a *pattern* for how to bolt an `Event` onto a Note and render it out over AP, not as a module to import. [INFERRED from the rows above]

---

## Q2 — ActivityPub `Event` object support in upstream Misskey

- `packages/backend/src/core/activitypub/type.ts`: `validPost = ['Note', 'Question', 'Article', 'Audio', 'Document', 'Image', 'Page', 'Video', 'Event']` — `Event` IS accepted as a post type, but there is **no `isEvent` guard**. [READ] https://raw.githubusercontent.com/misskey-dev/misskey/develop/packages/backend/src/core/activitypub/type.ts
- `ApNoteService.ts`: no type-specific handling; every valid post type goes through the same pipeline (`cw = summary`, `name: note.name`, content -> MFM). A Mobilizon/Gancio `Event` therefore lands as a plain note with `name` set and **startTime/endTime/location dropped**. [READ] https://raw.githubusercontent.com/misskey-dev/misskey/develop/packages/backend/src/core/activitypub/models/ApNoteService.ts
- Following Mobilizon actors was broken until PR #8635 "fix(federation): accept HTTP signatures with hs2019" (merged 2022-05-26) closed #8629. [READ] https://github.com/misskey-dev/misskey/pull/8635 , https://github.com/misskey-dev/misskey/issues/8629
- Outbound: Misskey never *emits* `Event` objects (no renderer) — [INFERRED; no renderer seen in type.ts summary, ApRendererService not grepped].
- Interop standard to target: **FEP-8a8e** "A common approach to using the Event object type" (WIP). Defines Join -> Accept (or Ignore when `joinMode: "none"`), `Invite`, `joinMode: "external"` + `externalParticipationUrl`, `maximumAttendeeCapacity`, `attendees` collection (`totalItems` gives remaining capacity indirectly), `requiredJoinVisibility`. [READ] https://codeberg.org/fediverse/fep/raw/branch/main/fep/8a8e/fep-8a8e.md ; validator https://validate.event-federation.eu/ ; RSVP precedence used in the ecosystem: Leave > Reject > TentativeAccept > Accept > Join, newer timestamp wins [SEARCH] https://event-federation.eu/2025/04/23/progress-on-the-fep-for-event-objects/
- Who renders Event today: Mastodon + forks minimal; Friendica -> calendar; GoToSocial rejects. [READ] https://gancio.org/federation

---

## Q3 — Sidecar / donor candidates

### 1. Mobilizon — Framasoft (Elixir/Phoenix, AGPL-3.0-or-later)
- Repo https://framagit.org/framasoft/mobilizon — 6,926 commits, 91 releases; stars not shown on framagit; last-commit date not captured. [READ]
- **Event model** (`lib/mobilizon/events/event.ex`): `begins_on`, `ends_on` (validated >= begins), `physical_address` (belongs_to Address -> has geom), `online_address`, `draft`, `category`, `external_participation_url`, `join_options` enum, `status` enum, `visibility` enum, embedded `options` + `participant_stats`. No recurrence field. [READ] https://framagit.org/framasoft/mobilizon/-/raw/main/lib/mobilizon/events/event.ex
- **EventOptions**: `maximum_attendee_capacity`, `remaining_attendee_capacity`, `show_remaining_attendee_capacity`, `anonymous_participation`, `attendees[]`, `program`, `comment_moderation`, `offers[]`, `participation_condition[]`, `hide_number_of_participants`, `show_start_time`, `show_end_time`, `timezone`, `hide_organizer_when_group_event`, `is_online`. [READ] https://framagit.org/framasoft/mobilizon/-/raw/main/lib/mobilizon/events/event_options.ex
- **Enums** (`lib/mobilizon/events/events.ex`): `ParticipantRole = [:not_approved, :not_confirmed, :rejected, :participant, :moderator, :administrator, :creator]`; `JoinOptions = [:free, :restricted, :invite, :external]`; `EventStatus = [:tentative, :confirmed, :cancelled]`; `EventVisibility = [:public, :unlisted, :restricted, :private]`. **No waitlist state, no hold state, no capacity-enforcement function found in that module.** [READ] https://framagit.org/framasoft/mobilizon/-/raw/main/lib/mobilizon/events/events.ex
- **Participant** (`participant.ex`): uuid id, `role`, `url`, 6-char `code`, embedded `metadata`, unique (event_id, actor_id). [READ] https://framagit.org/framasoft/mobilizon/-/raw/main/lib/mobilizon/events/participant.ex
- Docs: organiser can require approval and set "number of places"; Join carries `participationMessage`. [SEARCH] https://docs.mobilizon.org/1.%20Use/Events%20and%20Activities/4.participate-event/ , https://docs.mobilizon.org/5.%20Interoperability/1.activity_pub/
- Recurrence: open issue since early days. [SEARCH] https://framagit.org/framasoft/mobilizon/-/issues/20
- **Verdict: (b) sidecar only, and a weak one.** Elixir -> (a) impossible. Closest existing RSVP model (roles ~ pending/approved/rejected + capacity) but no waitlist/hold, no recurrence, its own accounts (OIDC login exists — [NOT VERIFIED]), own comments, not per-event chat in our sense. Runs a second BEAM + Postgres. [INFERRED]

### 2. Gancio — les (Node, AGPL-3.0)
- Repo https://framagit.org/les/gancio — 4,628 commits, 221 tags, created 2019-08-07; stars not shown. [READ]
- Stack (`package.json` master = 1.28.2): Node `>=14 <=23`, nuxt-edge 2.17 / Vue 2.7 / Vuetify 2, express 4, **sequelize 6** with pg | sqlite3 | mariadb, @nuxtjs/auth + passport. 2.0.0-beta.5 (2026-07-06) is a rewrite re-introducing recurrence and geolocation ("WIP"). [READ] https://framagit.org/les/gancio/-/raw/master/package.json , https://gancio.org/changelog
- Event model supports: title/start/end, place (geo in 2.0), tags, recurrence (legacy + 2.0), anonymous posting, federation as `Event` via app actor `events@instance`; receives/updates/deletes remote events (1.10+). **No RSVP / attendee / capacity model at all** — absent from federation doc and changelog; HN 2023 confirms missing. [READ] https://gancio.org/federation ; [SEARCH] https://news.ycombinator.com/item?id=36870961
- **Verdict: (c) not viable** for our needs. It is a public agenda, not an RSVP system; Vue 2 + Sequelize vs our Vue 3 + TypeORM means (a) merge is a rewrite anyway. [INFERRED]

### 3. Smithereen — grishka (Java 21 + MySQL, Unlicense, 546 stars)
- Events are a **subtype of Group** with an `Event` object in `attachments` (`startTime` required, `endTime` optional); RSVP = `Join`/`Follow` (going), `sm:TentativeJoin` (maybe), `Leave`/`Undo{Follow}`; separate `sm:tentativeMembers` collection; capability flag `sm:tentativeMembership` in `litepub:capabilities`. Invitations + reminders work; no location field yet (planned 0.11); no capacity. [READ] https://smithereen.software/docs/federation/groups , https://github.com/grishka/Smithereen ; [SEARCH] https://mastodon.social/@grishka/114784244096408696
- **Verdict: (c)** as code (Java), but its **"event = group + Event attachment" AP shape and tentative-membership vocabulary are worth copying** for federation design. [INFERRED]

### 4. EveryCal — burnoutberni (TypeScript, Node >=22, Hono + React + SQLite, AGPL-3.0-only, 5 stars)
- Federation complete for event CRUD and RSVP: inbound `Accept`/`Join` -> going, `TentativeAccept` -> maybe, `Reject`/`Leave` -> not attending; visibility public/unlisted/followers/private; iCal/JSON feeds; venue scrapers; WordPress plugin. Recurrence not listed. Last commit date not captured. [READ] https://github.com/burnoutberni/everycal
- **Verdict: (a)-lite donor.** Tiny, unproven (5 stars), SQLite, but it is the only TS codebase found with an FEP-8a8e-style RSVP state machine; worth reading its inbox handlers before writing ours. Not a sidecar (no capacity, no gates, no chat). [INFERRED]

### 5. Gathio — lowtechfoss (Node/Express/MongoDB, GPL-3.0) [NOT VERIFIED — fetch 404'd twice]
- Known from prior knowledge only: anonymous RSVP with max-attendees, event groups, comments, AP federation, no accounts. MongoDB -> (c). Not re-checked in this budget.

### 6. Friendica (PHP) / Hubzilla (PHP)
- Both have built-in events with RSVP and a personal calendar; Friendica uses the `Accept/Event` RSVP construct; they are the reference implementations FEP-8a8e is tested against. [SEARCH] https://event-federation.eu/2025/04/23/progress-on-the-fep-for-event-objects/ , https://event-federation.eu/2025/02/11/event-bridge-for-activitypub-1-0-0/
- **Verdict: (c)** — PHP monoliths, own identity; only useful as interop test targets. [INFERRED]

### 7. "Events for Misskey" community plugins
- None found. Misskey's plugin system is client-side AiScript only (no backend hooks) — [NOT VERIFIED here, from prior knowledge]. Nothing in search matched "misskey events plugin".

---

## Feature matrix vs our spec

| Need | Misskey | CherryPick | Mobilizon | Gancio | Smithereen | EveryCal |
|---|---|---|---|---|---|---|
| Event entity w/ start/end | – | Y (on note) | Y | Y | Y (group+attach) | Y |
| Capacity | – | – | Y (`maximum_attendee_capacity`) | – | – | – |
| RSVP states | – | – | not_approved/not_confirmed/rejected/participant | – | going/tentative | going/maybe/no |
| Waitlist / hold | – | – | **–** | – | – | – |
| Gates (who may RSVP) | – | – | `join_options` free/restricted/invite/external | – | open/private | visibility only |
| Recurrence | – | – | – (open issue) | Y (2.0 WIP) | – | – |
| Venue lat/lng | – | – | Y (Address.geom) | Y (2.0 WIP) | – (0.11 todo) | venue text |
| Per-event chat | – | note replies | comments | notes/replies | group wall | – |
| Stack fit (TS/NestJS/TypeORM/Vue3) | native | native | no | partial (Vue2/Sequelize) | no | TS, different frameworks |

Sources per column: see Q1/Q3 rows above, [READ]/[SEARCH] as marked; the "–" cells are absence-of-evidence in the fetched material, not proof of absence [INFERRED].

---

## Ranked shortlist

1. **Build in-fork, native (recommended).** Nothing found covers waitlist/hold, gates and per-event chat; every candidate would need those written anyway. Reuse: CherryPick's `Event` model + `ApEventService` pattern (jsonb schema.org metadata, `isEvent` guard) as the template for a first-class `event` table hung off a Note; EveryCal's inbox RSVP mapping and Smithereen's tentative-membership vocabulary as the AP design; FEP-8a8e as the wire contract (`Join`/`Accept`/`TentativeAccept`/`Reject`/`Leave`, `maximumAttendeeCapacity`, `attendees` collection, `joinMode`).
2. **Mobilizon sidecar (b)** — only if the operator wants a fediverse-native events product *now* and accepts: Elixir ops burden, a second identity (OIDC), no waitlist/hold/recurrence, chat = Mobilizon comments. Would still need a bridge job to mirror RSVP state into our Postgres.
3. **Gancio (c)** — no RSVP at all; skip.
4. Smithereen / Friendica / Hubzilla / Gathio (c) — wrong stack; interop targets only.

## One-paragraph recommendation

Build the events/meets module natively inside the fork. Evidence: upstream Misskey has an 8-year-old open feature request and no code beyond accepting `Event` in `validPost` and flattening it to a note (L1: type.ts + ApNoteService.ts fetched); the only shipped Misskey-family artefact is CherryPick 4.17's note-attached Event with title/start/end and no RSVP (L1: changelog + ApEventService.ts fetched); Mobilizon, the most complete external model, has capacity and approval roles but no waitlist/hold, no recurrence, and is Elixir (L1: event_options.ex + events.ex fetched); Gancio has no attendee model (L1: federation doc + changelog). Since capacity+waitlist+hold+gates+recurrence+geo+chat all have to be written regardless, the cheapest path with one identity, one Postgres and one deploy is a NestJS module (`event`, `event_rsvp`, `event_occurrence`, venue lat/lng on `event`, chat = a per-event channel or note thread) that renders/ingests FEP-8a8e `Event` objects so Mobilizon/Friendica/Gancio users can see and RSVP to our meets. Verify before building (things this research could NOT confirm): the current Sharkey CHANGELOG (402), CherryPick `models/Event.ts` column list, and whether Mobilizon's OIDC login is acceptable if the sidecar route is chosen anyway.

# MEET MODULE — build plan on social.silkvo.com (the one module that closes the Reclub gap) — 2026-09-10

Contract loaded — hook armed: yes · integrity: v6@379dba191765 OK

**Status:** L1 plan derived from four research passes (`reclub_forensic/research_event_engines.md`, `research_match_generation.md`, `research_sport_apps.md`, `research_misskey_events.md`) and the four Reclub build specs (`spec_meets.md` first). Nothing here is built. Estimates are L0.

## 1. Decisions taken today (recorded in BLUEPRINT.md DECISIONS)
1. **Build the meet module inside the Misskey fork** (backend module in `packages/backend` + Vue pages), not a sidecar. No open-source project covers more than about half of the meet spec; the missing half (hold and pay-by promotion, +1 guests, level/gender/age gates, cancellation freeze, no-show, payment tags) is greenfield either way, and a sidecar would need an SSO bridge, a duplicate profile store and polling for profile changes (Misskey webhooks do not fire on profile updates). Misskey already ships NestJS, TypeORM, Postgres, BullMQ, date-fns, notifications, push, chat rooms and zh-TW/zh-CN locales.
2. **Naming:** every community is a **Club / 球會**, same page and same tools as Reclub gives hosts. hkpl-mirrored clubs carry the badge **League club ✓ / 聯賽球會 ✓**, which unlocks teams, standings, fixtures, official venues and the DUPR submission pipeline. No lower-status word anywhere in the UI. Internally one entity with `verified` and `leagueRef`.

## 2. What we borrow (licences checked, L2 on repo metadata)
| Piece | Source | Licence | Use |
|---|---|---|---|
| Event / attendee / group data model | OpenMeet API (NestJS, TypeORM) | Apache-2.0 | copy entities, enums, DTOs; do not run it (no waitlist promotion, no capacity enforcement, en-only) |
| Recurrence | `rrule-temporal` | MIT | weekly schedules, DST-safe in Asia/Hong_Kong; store RRULE + tz + dtstart, materialise occurrences ahead via BullMQ |
| Calendar export | `ical-generator` (+ `@touch4it/ical-timezones`) | MIT | per-meet .ics, per-user feed |
| Time zones | `date-fns-tz` beside Misskey's `date-fns` | MIT | freeze windows, reminders |
| Nearby search | PostGIS `geography(Point,4326)` via TypeORM; `geolib` for distances; fallback `h3-js` if PostGIS refused | PostGIS/MIT/Apache-2.0 | Discover map and "near me" |
| Timers | BullMQ (already in Misskey; templates: `postScheduledNoteQueue`, `endedPollNotificationQueue`) | — | pay-by expiry, waitlist promotion, reminders, no-show sweep; no node-cron |
| Brackets, pools, consolation | `brackets-manager` | MIT (confirm LICENSE file; npm says ISC) | competitions phase |
| Social schedulers | hand-written (~600–900 lines): Rotating Partners, Ladder, Americano, Mexicano, courts, sit-outs, standings + tiebreakers | ours | verified whist tables exist for 5/8/12/13/16/17/20/21 players (`forensic/whist_check.js`) |
| Reference for draw edge cases | CourtHive `tods-competition-factory` | MIT | read, not depend |
| Internal rating | `openskill.js` | verify licence | doubles-aware level alongside DUPR |
| Federated event shape (optional, later) | FEP-8a8e + CherryPick `ApEventService` pattern | — | only if federation is ever switched on |
| Out | `tournament-pairings`, `tournament-organizer` (GPL-3), `@graph-algorithm/maximum-matching` (AGPL), Hi.Events/pretix (PHP/Python ticketing, only if paid checkout outside pyke is ever needed), Mobilizon/Gancio/Gathio (no waitlist or no RSVP) | | |

## 3. Data model (from `spec_meets.md` §Y + OpenMeet)
`meet` (clubId?, hostId, sportId, format, type listing|managed, startAt, tz, duration, venueId | location geography, capacity, guestsAllowed, approvalMode auto|host, gates jsonb {levelMin, levelMax, levelBasis self|duprS|duprD, gateType guidance|autoApprove|strict, gender, ageGroup}, feeType none|free|perPax|autoSplit, feeAmount, currency, cancellationFreezeMin, payByMin, hostStatus plays|hostOnly, allowPlusOne, visibility public|private + accessToken, seriesId, status, chatRef, referenceCode) · `meet_series` (rrule, tz, dtstart, publishLeadTime, template) · `meet_participant` (meetId, userId | reserved {name, level, gender, age}, type user|reserved|plusOne, status hold|declined|spectator|approved|waitlist|invited|requested|maybe, waitlistRank, holdExpiresAt, roles {host, coach, referee, paymentCollector}, tags[] paid|unpaid|cash|digital|membership|punch|feeWaived|refunded|checkedIn|noShow|late|excused|guest, teamId, courtIdx, paymentStatus) · `meet_match` (scheme, round, court, team1, team2, scores[], status) · `club` gains `verified`, `leagueRef`, `gateType`, `level`, `visibility`, `gating adminGated|memberGated`, `allowMemberMeets`, `paymentInfo`, `tags[]`.

## 4. State machine (timers in BullMQ)
requested → approved | waitlist | declined (auto vs host; capacity; gate) · invited → approved | declined | maybe (auto-confirm after 3 days) · waitlist → hold (promotion on a freed spot, by rank; respects freeze) · hold → approved (paid or acknowledged before pay-by) | back to waitlist tail on expiry · approved → checkedIn | noShow (host or sweep) · approved → declined blocked inside the freeze window unless host · maybe purged 2 h before start · chat archived 14 days after end.

## 5. Screens (Vue, in the hkpl shell and web) — all copy already exists in `i18n_en.json` + zh
Create/edit/duplicate form (exact field order proven on the phone), meet page (Details / Participants / Matches / Chat + Payments and Kudos panes), roster tools (reserve, teams, bulk, promote, sort, visibility), Discover sheet (panes, day strip, filters, map), Home activity list, club page with Meets/Schedules tabs, schedule form, notifications.

## 6. Order and size (L0)
1. Entities + state machine + timers + API (2 weeks) 2. Create form + meet page + roster (2–3 weeks) 3. Discover + Home + club Meets tab + schedules (2 weeks) 4. Notifications, ICS, share pages, PayMe step + receipt (1 week) 5. Social scheduler + standings (1–2 weeks). Total 7–10 senior-developer weeks to L5; each step ships behind a probe and a walked screenshot.

## 7. Open before build
- Operator: `FLOW_MEET_SPEC_20260910.md` §4 decisions (default price mode, hard/soft gate default, guests per member) and `SIGN-OFF (meet flow): yes`.
- Ops: `CREATE EXTENSION postgis` on kaka's social-engine database (or accept the h3 fallback).
- Dev loop decision (rule N): dev image on GitHub Actions vs off-box.

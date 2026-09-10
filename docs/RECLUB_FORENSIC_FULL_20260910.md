# RECLUB — FULL FORENSIC (345 screens, bytecode-bound) vs social.silkvo.com — 2026-09-10

Contract loaded — hook armed: yes · integrity: v6@379dba191765 OK

**Purpose.** Everything Reclub 2.45.12 does, screen by screen, read from its shipped binary and its vendor's own screenshots, so that the social engine on social.silkvo.com can be ground to an app as close to Reclub as possible in all details. This master document is the map; the per-domain build specs (§9) carry every label, key, enum, field and endpoint.

**Proof levels used.** L2 = present verbatim in the shipped bundle (string table, decoded object literal, or bytecode operand) or visible in a vendor screenshot I viewed. L6 (script) = a deterministic decode whose sanity numbers are reported. L1 = a third-party snippet. INFERRED = my reading of relationships the bytecode does not state. Not achieved: L6 behaviour (the app was not run; this PC has no Android emulator and Reclub has no web app).

---

## 0. Corrections to my earlier documents

| Earlier claim | Correct fact | Evidence |
|---|---|---|
| "Languages en/tl/id/es/pt, no Chinese" (`RECLUB_FORENSIC_PAGES_20260910.md` §17) | Reclub ships 9 languages: en, vi, ja, zh_TW, zh_CN, tl, ko, id, th; 49 namespaces × 6,358 keys each, e.g. `meets:cancellation_freeze` = "Cancellation freeze" / 取消凍結 / 取消冻结 | `forensic/bind_stats.json` (i18n.langs), `forensic/i18n_other.json` |
| "Skill is free text, host eyeballs" (`FLOW_MEET_SPEC_20260910.md`) | Structured gate: `MeetSportLevelGateType` Guidance=1 / AutoApprove=2 / Strict=3; basis `MeetSportLevelBasis` SelfRating=1 / DUPRSingles=2 / DUPRDoubles=3 | `forensic/spec_meets.md` §Y.1 (module 2824 literals) |
| "Recurrence weekly only" | Two mechanisms: meet-level repeat (weekly × 1–4) AND a club Schedule entity (weekly on a weekday, publish lead time, auto-created meets, pause/activate) | `spec_meets.md` §11, §Y.5 |
| "Adjacency in strings.txt reveals modules" (my brief to agents) | False: the Hermes string table is hash/alpha-ordered. Screen membership comes only from the bytecode binding (module registry + closure tree) | `forensic/README_bind.md` |
| "Sign in with email/Apple/Facebook/Google" | Apple, Facebook, Email only; no Google login copy in any language | `forensic/domain_profile_social_system.md` key findings |
| "Tab bar Home/Discover/Community/Statistics/Inbox" | That is the classic layout. Since Feb 2026 the default is a tile-grid Home with swipe-left Profile and swipe-right Inbox and a floating search button; both layouts are switchable in settings | `forensic/help/img/main-navigation_1.png` vs `_2.png`; App Store 2.45.5 notes in `forensic/store/apple_version_history.tsv` |

---

## 1. Evidence base (what was read, with receipts)

| Artefact | Content | Numbers (L6 script output unless noted) |
|---|---|---|
| `apk/base/assets/index.android.bundle` | Hermes bytecode v96, React Native + Expo Router | 28,793,784 bytes |
| `hermes_strings.cjs` → `out/strings.txt` | string table | 128,251 strings |
| `hermes_core.cjs` + `hermes_model.cjs` + `hermes_bind.cjs` | function table, opcode walk, literal buffers, Metro module registry, closure tree, Expo Router map | 90,140 functions, walk 100.000 %; 105,261 object literals; 7,964 modules; 345/345 routes bound (`forensic/bind_stats.json`) |
| `forensic/i18n_en.json`, `i18n_other.json` | complete UI copy reconstructed from literal buffers | 9 languages × 49 namespaces × 6,358 keys |
| `forensic/screens.md` | per-screen: module cluster, handlers, components, i18n keys with text, literals, navigation targets | 345 sections; 296 with copy; 159 with navigation targets |
| `forensic/api_calls.md` | HTTP idioms bound to service functions | 215 HTTP paths, 242 in-app navigation paths, 1,023 call sites |
| `forensic/web_evidence.md` + `help/` + `shots/` + `store/` + `web/` | store listings, 82 help articles, 45 in-app screenshots, 43 store images, share pages, version history | 82/82 articles HTTP 200; no web app exists (`app.`/`web.reclub.co` no DNS) |
| `forensic/OBSERVED_UI.md` | my own descriptions of 10 screenshots I viewed | L2 |
| Domain inventories (round 1) | `domain_meets.md`, `domain_clubs_discover.md` (3,425 citations, 0 problems), `domain_competition_dupr.md` (3,161 citations), `domain_profile_social_system.md` (3,387 citations) | line-cited to strings.txt |
| Build specs (round 2) | `spec_meets.md` (1,214 key/text pairs, 0 mismatches), `spec_clubs_discover_home.md` (1,107 / 0; 143/143 routes), `spec_competition_dupr.md` (1,748 / 0; 83 routes), `spec_profile_social_system.md` (1,266 / 0; 116 routes) | self-check output appended verbatim as §Z of each file (`work/spec/selfcheck.cjs`) |

Not recoverable from the binary: server-side rules (who gets auto-advanced when a spot opens, exact push triggers), numeric option values passed as integer operands (cancellation-freeze hour options, blind-team minutes), and screen layout order where no screenshot exists.

---

## 2. Reclub as built (architecture, L2)

- **Client:** React Native (Expo SDK, Expo Router file routes; 345 route files in three layout groups: `(tabs)` 13, `(screens)` 52, `(modals)` 235, `(transparent)` 42, plus root/native-intent). Hermes bytecode. Third-party: RevenueCat (subscription), AdMob + mediation adapters, Sentry, Apple Maps/Google Maps, MQTT client for live channels, Giphy, Expo push.
- **Backend:** REST at `https://api.reclub.co` (215 paths, `send`/`sendWithToken` idioms with method + body keys recovered), MQTT for chat and live meet/schedule updates, image assets on `assets.reclub.co`, share pages on `reclub.co/m/<ref>`, `/clubs/@slug`, `/players/@handle`.
- **Identity:** email + Apple + Facebook; `POST /auth/token` body keys `locale, referral_source, referral_id, context, provider, token, name, email, password, external_id, image_url, device_id, app_ver`.
- **Money:** none for meets (host bank details + screenshot receipts, Supporter-gated); RevenueCat IAP for Supporter US$2.99 monthly / US$29.99 yearly (`forensic/store/apple_text.txt`).
- **Company:** Reclub PBC, Florida; product team in Ho Chi Minh City; 500K+ Play installs; 4.7★ / 20.7K reviews (`forensic/store/play.html`).

---

## 3. The real UI (from vendor screenshots I viewed, L2) — see `forensic/OBSERVED_UI.md`

1. **Home (2026 layout)**: avatar + name, bell, chat bubble; 2×3 tiles My clubs / My network / My activities / Feed / Statistics / See more; chips Active / By friends / By clubs; club avatar row; competition cards; day-grouped activity list (time, title, pill Hosting/Joining/Draft, venue + distance, capacity chip n/N); floating search button. Classic layout: tab bar Home / Discover / Community / Statistics / Inbox with Home tabs RSVP / Active / Hidden / Past and a kudos card.
2. **Discover sheet**: region + Sports dropdowns; tabs CLUBS / MEETS / COMPS / VENUES / PEOPLE; filter icon + day strip; time-grouped meet cards (club name, title, chip Social/Training, venue, sport icon, capacity, distance); search bar with map toggle.
3. **Venue page**: map header, name, share, address, sport icons, distance from saved place; tabs Activities / Clubs; disclaimer; date-grouped activities with Cancelled pill.
4. **Meet detail**: green header, date, TITLE, share, kebab; tabs Details / Participants / Matches / Chat; host quick bar Payments + Auto-approve; ORGANIZERS / CONFIRMED n/N; Sort and Show menus; avatar grid with dashed empty slots.
5. **Match generator**: Standings / Matches / Your matches; Generate next round sheet with Prioritize least matches and player selection.
6. **Profile**: gear, help; avatar, name, @handle; "Add gender and age group"; bio prompt; Supporter card; SPORTS list (sport · level); COMMUNITY CENTERS.
7. **Inbox**: filter tiles Direct / Activity / Clubs / Support; auto chats per meet and per competition (General / Captain's / Staff); Reclub Feedback thread.

---

## 4. Screen inventory (345 route files, L3 = in the shipped artifact) — full list in `forensic/screen_tree.md`

| Area | Route groups (count) | What lives there |
|---|---|---|
| Shell / tabs | `(tabs)/*` 13, `(screens)/tabbar/*`, `settings/navigation` | tab shells: home, clubs, feed, friends, inbox, notifications, my-history, statistics, promotions, resources, help, settings, profile; user-configurable navigation |
| Auth & onboarding | `(screens)/auth/*` 4, `(screens)/onboard/*` 12, `groups/[groupId]/onboard/*` 3, `networks/*` 4 | welcome, login, signup, forgot; terms, basic info, gender, age group, location (3), club code (+success), join club, completed; club onboarding; reward-network consent |
| Home & community | `home`, `home-menu`, `community-center/select`, `switch-active-community`, `select-community`, `communities/*` 2 | tile home, create menu, community centres |
| Discover & venues | `discover/*` 4, `(transparent)/discover/*` 2, `filter-dates`, `filter-distance`, `filters/sports`, `venues/*` 4, `(transparent)/venues/*` 3, `select-venue`, `select-location`, `location-map-picker` | five-pane discover, map points, filters, venue pages, venue create, beta/listings/sports info |
| Clubs | `clubs/*` 13, `groups/*` 29, `(transparent)/clubs/*` 2, `quick-join-club`, `select-club-members`, `select-group`, `invite-to-group/*` 3, `add-from-community` | club home, about, menu, detail panes, settings (profile, privacy, permissions, communications, dupr, integrations ×3), tags, claim ownership, schedules, insight rankings ×3, member page, manage-* ×13, payment info |
| Content & forum | `content/*`, `content-detail/*` 2, `content-editor`, `create-poll`, `poll-voter`, `select-content-channel`, `channels/[id]`, `upsert-note` | posts, media, polls, notes |
| Meets | `create-meet/*` 4, `create-meet-with-privacy`, `(transparent)/create-meet/by-privacy`, `(transparent)/create`, `update-meet`, `duplicate-meet`, `meet-detail/*` 3, `meets/*` 7, `m/[id]`, `promote-meet/*` 2, `upsert-club-activity/*` 2, `invite-to-activity/*` 3, `invite-friends/*` 3, `share/*`, `share-activity`, `join/*`, `qrcode` | the meet form, detail tabs, roster, roles, teams, matches, promote, share, join |
| Schedules | `schedules/*` 8, `(transparent)/schedules/*` | recurring club meets |
| Payments | `payment/methods/*` 3, `payments/manager/*` | methods list/add, receipts, host manager |
| Matches & competitions | `competitions/*` 28, `(transparent)/competitions/*` 2, `matches/*` 10, `(transparent)/matches/*` 2, `(transparent)/meets/[meetId]/*` 4 | wizard, detail tabs, seeds, sublocations, score sets, awards, teams, availability, share images |
| DUPR & coaches | `dupr/*` 6, `coaches/*` 4, `sports/manage-sport-levels`, `manage-sports*` 3, `active-sport/switch` | connect, activity manager, submit, support; coach profiles |
| Stats & Street Cred | `stats/*` 10, `stats-team-*` 2, `street-creds/*` 6, `(transparent)/street-creds/*`, `award-showcase` | leaderboards, kudos give/detail, team stats, awards |
| Profile & players | `account/*` 6, `players/[userId]/*` 5, `view-player-review/*` 2, `review-player`, `select-country` ×2 | profile edit, location, delete; player page, manage, no-show history, sport panes; reviews |
| Chat & inbox | `chat/create`, `chats/*` 3, `(transparent)/chats/*` 2, `share-chat`, `giphy-previewer` | DMs, group chats, settings, message menu, reactions |
| Settings | `settings/*` 11 | preferences, notifications, navigation, locations, theme, locale, blocked players, calendars, reward networks, developer |
| Supporter & ads | `premium-supporter/*` 7, `ads/*` 2, `promotions`, `reclub-partner-www`, `reclub-www` | upsell, feature-locked, thank-you, supporters, stickers, impact; ad consent/transition |
| Help & system | `help/*` 6, `(screens)/help/tutorials/manage-club/*` 8, `help/popups/*` 8, `cms-content`, `maintenance`, `upgrade-app`, `upgrade-app-alert-box`, `rate-app`, `popup-modal`, `splash-loading`, `[...path]`, `[domain]/*` 3 | tutorials, popups, CMS pages, system states, deep-link resolvers |

---

## 5. Domain summaries (models the build must reproduce)

### 5.1 Meets (build spec: `spec_meets.md`, 158 KB)
- **Enums (decoded literals):** `MeetType` Listing=1/Managed=2 · `MeetPrivacy` Private=0/Public=1 · `MeetStatus` Cancelled=-1/Pending=0/Active=1 · `MeetFeeType` None=0/Free=1/PerPax=2/TotalAutoSplit=3 · `MeetGender` C/F/M · `MeetAgeGroup` A/J/S · `MeetSportLevelBasis` 1/2/3 · `MeetSportLevelGateType` 1/2/3 · `MeetParticipantStatus` Hold=-2/Declined=-1/Spectator=0/Approved=1/Waitlist=2/Invited=3/Requested=4/Maybe=5 · `MeetParticipantType` User=1/Reserved=2/PlusOne=3 · participant tags `no_show, unpaid, paid, membership, checked_in, late, excused, fee_waived, refunded, dropper, cash, digital, guest, punch` · 26 team colours with hex · `PaymentMethod` BANK_TRANSFER/ZELLE/VENMO/PAYPAL/MOMO/OTHER · `PaymentTransactionStatus` Cancelled/Pending/Authorized/Completed · `MeetMatchGeneratorScheme` SINGLES/ROTATING_PARTNERS/LADDER_RUN/PRESET_TEAMS.
- **Meet fields:** id, referenceCode, type, startDatetime, endDateTime, duration, timezone, communityId, sportId, sportFormatId, min/maxSportLevelValue, sportLevelGateType, sportLevelBasis, numPlayers, privacy, accessToken, name, notes, status, feeType, feeAmount, feeCurrency, autoApproval, hostStatus, cancellationThreshold, gender, ageGroup, blindTeams, allowPlusOne, allowPlayerScoring, repeatInterval, repeatCount, participants[], matches[], matchConfig, media[], groups[], venueId, venue, scheduleId, slots[], flags[], paymentTransactions[], calendarEventId, visibility[], chatChannel.
- **Form (create/edit/duplicate, one overlay):** club section, sport + format chips, date/time, duration, location, number of players, privacy, fee (None/Free/Per person/Auto split), min/max level, level basis, level gating, DUPR section (pickleball), name (default "{{sport_name}} {{sport_format}} with {{host}}"), notes, advanced (gender, age range, repeat weekly ×1–4, host's role, cancellation freeze, auto-approve, allow +1, send notification), invite friends, hosts and coaches. Save → `POST /meets` / `PUT /meets/{id}`; error `start_datetime_in_past`.
- **Detail:** header + kebab; tabs Details / Participants / Matches / Chat (+ Payment, Photos, Kudos panes); footer CTA table across 18 viewer states; join pipeline with safety warning; +1 requests; roster sort (12 modes) and visibility flags (8); bulk actions; reserves (name, skill, gender, age); roles host/coach/referee/payment collector; block list; matches generator; kudos after end.
- **Timers:** invitation auto-confirm 3 days; Maybe purged 2 h before start; cancellation freeze N h; promote once, ≤36 h, 20 km; meet chat archived 14 days after end; no-show window 30 days.
- **Schedules:** `Schedule{frequencyType Weekly, frequencyUnit Mon..Sun, startTime, publishLeadTime, duration, …same gates/fees as meet, participants, updateExistingMeets, status Active/Suspended}`; "next meet" link `/s/<id>/next`.

### 5.2 Clubs, discover, venues, home (round-1 `domain_clubs_discover.md`; build spec `spec_clubs_discover_home.md`)
- **Club:** name, handle/slug, sport(s), level, visibility public/private, gate `adminGate`/`memberGated`, auto-approve, inactive flag, description, cover/avatar, media library, venues (with confirmation migration), tags (name, expiry, visibility, order), payment info (free text), who may create meets (admin / admin+member), outside-link restriction, communications (chat, forum, notifications), DUPR club id, integrations (reward network join, up-sell), club code, claim-ownership flow, insights (most active / most rewarded / most stats × timeframe).
- **Member lifecycle:** request / invite / approve / decline / cancel / leave / remove; roles Admin / Member / Follower; sorting modal; member action sheets; tags applied per member.
- **Panes:** Members / Activities / Library / Discussion (forum threads) / Chat / Content (posts with visibility levels, announcements, polls) / Insights / Reports.
- **Discover:** panes clubs / meets / comps / venues / people (older: players / coaches); filters location mode (nearby / saved / recent / current / global), distance, dates + mornings/afternoons/evenings, sports, gender, hide full / hide empty, friends only, community, verified only; map with cluster/spiderfy constants; `GET /discover/meets`, `/discover/meets/map-points`, `/discover/meets/count-by-date`, `/discover/venues`, `/discover/groups`.
- **Venue:** name, address, lat/lng, sports, status verified / reviewing / closed, owner claim, media, activity + club counts, beta/listings/sports info sheets, feedback form with subcategories; `venues/autocomplete|resolve|reverse-geocode` (Google Places session tokens).
- **Home:** both layouts; tiles (2.45.12 `HOME_FEATURES` buffer carries `my_history`, the help screenshot shows "My activities" from a neighbouring build; chip leaf `home:by_friends` = "With friends"); 13-item tab-bar catalogue with routes/icons/badge keys; chips; `GET /user/navigation`, `/user/pinned`, `/user/sync/meets`, `/user/sync/competitions`, `/user/badges` (per-tab unread counters).

### 5.3 Competitions, matches, DUPR, coaches, stats (round-1 `domain_competition_dupr.md`; build spec `spec_competition_dupr.md`)
- **Formats:** round robin single/double/triple; pool play single/double/triple with pools, winners per pool, playoffs, optional consolation and third-place match; single and double elimination; Swiss (label only). Meet schemes: Round Robin, Ladder Run (min 4), Rotating Partners, Scramble, Americano, Mexicano, Team Americano, Rally, Round & Court, Custom; caps 12 rotating / 32 simple.
- **Lifecycle:** draft → publish → register / lock → seed / draw (reveal, blind teams) → start → end → review / reopen; reset, cancel, delete branches; free agents; early-bird fee and deadline; spectators; referees; captains; awards 1st–4th + custom; request support.
- **Scoring:** score sets per match, SET vs GAME type, point values standard / tiebreaker / draw / forfeit, six standings modes, seven tiebreakers (`WINPCT, SETSWON, SETWINPCT, TOTALSCORE, SCOREDIFF, H2HWINS, H2HDIFF`), availability per match participant, quick score input, match share image, head-to-head.
- **DUPR:** connect (DUPR login inside app), ratings sync, per-match eligibility with 8 ineligibility messages, gate types block / prompt / prompt+approval, submission by director/organizer, club id sync, virtual clubs, rankings by country.
- **Sports catalogue (embedded, 63 sports, `work_spec/sports_catalog.json`):** per sport `stats[]` with formula/unit/rank_value/category (e.g. tennis `first_serve_pct = first_serve/(first_serve+second_serve+double_fault)`), `kudo_dimensions` (technical / soft), `meet_match_formats`, `sets_term` (pickleball = GAME), levels; pickleball id 36, padel id 30; pickleball and padel have score-only stats panes.
- **Coaches:** coach profile, fees, coaching tab, cohost coaches on meets. **Stats:** per-sport stat vocabulary with formulas, Street Cred leaderboard (kudos count × unique givers), timeframes ALL_TIME / CURRENT_MONTH / LAST_MONTH / LAST_3_MONTHS / LAST_6_MONTHS / LAST_90 / LAST_YEAR / YTD.

### 5.4 Profile, onboarding, chat, notifications, Supporter, ads (round-1 `domain_profile_social_system.md`; build spec `spec_profile_social_system.md`)
- **Onboarding order (proven from navigation targets):** welcome → community-centre select or club code → accept terms → basic info (name, email, photo) → location → manage sports → join club → completed; gender → age group branch (Junior <18, Adult 18–55, Senior >55; genders M/F/N/C).
- **Profile:** avatar, name, handle, bio, gender, age group, sports with levels (per-sport profile: ratings, DUPR, coaching), community centres, awards, badges (Supporter, Verified), placements, reviews/endorsements (pick up to 3 badges), stats, friends/follow, last seen, no-show history, blocked players.
- **Kudos & Street Cred:** one dimension per recipient per meet/competition, N-day window, "Updated 10am daily", giver names Supporter-only, leaderboards by dimension × timeframe.
- **Chat:** MQTT + REST; channel types DM / group / meet / competition (General, Captain's, Staff) / club / support; roles admin / regular / subscriber; 6 reaction enum members (victory, heart, laugh, sad, shocked, pray; the "Awesome" label has no enum twin); attachments incl. meet cards, Giphy, stickers; meet chats archive 14 days, competition chats 1 week; unread + mark-read.
- **Notifications:** settings toggles meet / activity / favourites / promoted meets (club, community) / social / club / chat; Expo push; in-app list; toggles via `POST/DELETE /notifications/{key}`; sticker drawer Supporter-gated.
- **Supporter (paywalled):** no banner/transition ads, kudos-giver visibility + all-access Street Cred, personal match history, stats analytics, sport stickers, badge, payment methods & receipts, tab-bar navigation, themes (beta).
- **Ads:** AdMob banner / mrect / interstitial with consent screen and transition screen.

---

## 6. Ours today (L5, social.silkvo.com) — the honest baseline
Misskey 2026.9.0 fork, federation off, registration off, OSS media, hkpl SSO proven (`probes/sso.verdict.json`, `probes/hkpl-sso-mint.verdict.json`, walk `shots_social/sso_walk_mobile.png`). Stock features that map onto Reclub surfaces: notes (posts) with media, polls, reactions (custom emoji), replies, renotes; channels (used as clubs) with banner, description, timeline, follow, featured; user profiles with bio, fields, avatar, banner, followers/following; chat (DMs + rooms, reactions); notifications + web push; drive; search; roles; announcements; pages; galleries; antennas; clips; mute/block/report; zh-Hant, zh-Hans, en, ja and more locales. Seeded demo: 10 HKPL clubs, 12 users, 30 meet posts.

---

## 7. Module-by-module mapping: Reclub → what Misskey gives → what we build → where the data comes from

| # | Reclub module | Misskey stock | Build item (ours) | Data / adapter source | Size |
|---|---|---|---|---|---|
| 1 | Auth + onboarding (email/Apple/Facebook, 8 steps) | accounts, first-login wizard | SSO from hkpl (done); suppress wizard + copy host avatar (spec 1b); one-screen sport+level pick for open users | hkpl JWT claims (name, avatar, DUPR, club) | S |
| 2 | Home (tile grid, chips, day-grouped activities, kudos card, club row) | home timeline | new Home page: tiles (My clubs / My network / My activities / Feed / Statistics / More), chips Active / By friends / By clubs, activity list from events module, kudos card | events module + channels + reactions | M |
| 3 | Discover sheet (5 panes, day strip, filters, map, venues) | channel directory, user search | `/discover` page: panes Clubs / Meets / Comps / Venues / People; day strip; filters (distance, dates, time of day, sports, gender, hide full, friends, verified); map with pins | events module + hkpl venues (60 geocoded) + hkpl clubs | L |
| 4 | Club page (7 panes, roles, tags, settings, insights, schedules, code, claim) | channel (timeline, followers, banner) | club object on top of channel: roles Admin/Member/Follower, join modes (public / member-gated / admin-gated / auto-approve), tags with expiry, venues, payment info, create-meet permission, panes Members / Activities / Library / Discussion / Chat / Insights; verified (hkpl) vs open groups | hkpl clubs → channels sync (P2); hkpl managers → admins | L |
| 5 | Meet object + form (15+ fields, gates, fees, repeat, roles) | note + poll | `event` entity + create/edit/duplicate form with every Reclub field (type listing/managed, privacy + access token, fee types, level min/max/basis/gate, gender, age, cancellation freeze, host role, +1, auto-approve, repeat ×1–4, hosts/coaches, invite) | own DB; DUPR from hkpl | L |
| 6 | Meet detail (tabs, 18 viewer states, roster, tags, reserves, bulk, block list, promote, share) | note thread, reactions | meet page with Details / Participants / Matches / Chat / Payment / Photos / Kudos; participant state machine (Hold, Declined, Spectator, Approved, Waitlist, Invited, Requested, Maybe) + tags; timers (3-day invite, 2-h Maybe, freeze, 14-day chat archive); promote (club / proximity, once, ≤36 h) | own DB; push via hkpl P5 | L |
| 7 | Schedules (recurring club meets) | none | schedule entity + auto-creation worker + "next meet" link | own | M |
| 8 | Payments (methods, receipts, manager, tags) | none | v1: club/host payment info + "I've paid" + receipt image + host tags paid/cash/digital/refunded/fee waived; v2: pyke booking + webhook → Paid | pyke P1 | M (v1) |
| 9 | Matches in meets (schemes, rounds, courts, scores, standings, share image) | none | generator schemes Round Robin / Ladder / Rotating Partners / Americano / Mexicano / Preset teams; score sheet; standings; share image | hkpl OpenPlayGame/SocialGame code | L |
| 10 | Competitions (wizard, formats, pools, playoffs, seeds, awards, chats) | none | phase 3: surface hkpl league engine (brackets, standings, rules, referee, live scoring) into competition pages with Reclub's tab set | hkpl engine via adapter | XL (mostly wiring) |
| 11 | DUPR (connect, eligibility, submit, club sync) | none | rating in SSO token; eligibility rules and submission through hkpl's pipeline; gate types Guidance / AutoApprove / Strict | hkpl (2,190 linked members) | S–M |
| 12 | Kudos + Street Cred + reviews + awards | reactions | post-meet kudos (per-sport dimensions), leaderboard by timeframe, private feedback, endorsements (3 badges), awards showcase, reliability (no-show history) | own | M |
| 13 | Chat & inbox (auto chats per meet/comp/club, filters, reactions, stickers, archive) | Misskey chat (DMs, rooms, reactions) | auto-create rooms per meet / competition / club; inbox filter tiles Direct / Activity / Clubs / Support; system messages (created, cancelled, time/location/fee updated, ended); archive rules | Misskey chat + events hooks | M |
| 14 | Profile (sports-first, per-sport panes, community centres, awards, stats, no-shows) | profile + fields | sports list with levels, DUPR block, community centres, awards, reviews, stats cards, no-show history; settings catalogue (notification toggles, navigation layout, locale, theme, blocked, calendars) | hkpl cards (A3) | M |
| 15 | Venues (crowd-sourced beta, owner claim, feedback) | none | venue entity from hkpl's 60 approved venues + map + activities/clubs tabs + owner claim later | hkpl venues | M |
| 16 | Notifications (7 toggle groups, push, in-app) | notifications + web push | event-driven notifications (request, confirm, waitlist promote, reminder, cancel, promote, kudos, chat) mapped to Misskey notification types + native push in the hkpl shell | hkpl APNs/FCM (P5) | M |
| 17 | Content: posts, polls, media library, forum threads, announcements | notes, polls, drive, galleries | forum thread view on channel notes; announcement tag; club media library = gallery per channel | stock + small UI | S |
| 18 | Supporter, ads, partner promotion | none | ⚪ not built by design (no ads, no paywall); anchor-host margin + pyke commerce instead | — | 0 |
| 19 | Languages (9 incl. zh_TW / zh_CN) | Misskey locales incl. zh-Hant / zh-Hans / ja / ko / vi / th / id | parity: our new pages ship zh-Hant / zh-Hans / en from day one | — | S (copy) |
| 20 | Native shell, deep links, share pages, QR | web client | Capacitor shell (hkpl's), `/m/<ref>`, `/c/<slug>`, `/players/@handle` share pages with OG images, QR | hkpl app shell | M |

Size legend: S ≤ 2 days, M ≤ 1 week, L 2–3 weeks, XL longer (L0 estimates; sized against one engineer with the specs in §9).

---

## 8. Build order to reach "as close as possible"

1. **Meet core** (rows 5, 6, 16): entity, form, detail tabs, state machine, timers, notifications. This is the single module that flips the biggest gap and is fully specified in `spec_meets.md`.
2. **Home + Discover** (rows 2, 3, 15): tile home, activity list, discover sheet with day strip and filters, venues from hkpl.
3. **Club object** (rows 4, 7, 17): roles, join modes, tags, panes, schedules, verified-vs-open.
4. **Chat wiring** (row 13): auto rooms, inbox filters, system messages.
5. **Matches + kudos + profile** (rows 9, 12, 14, 11): generators from hkpl code, kudos, sports-first profile, DUPR gates.
6. **Payments v1 → v2** (row 8): info + receipts, then pyke.
7. **Competitions** (row 10): surface hkpl's engine.
8. **Shell + share pages** (row 20).

Each step ships behind a probe (`probes/<id>.cjs` → verdict) and a walked screenshot, per the contract.

---

## 9. Where every detail lives (deliverables copied to `D:\Downloads\reclub_forensic\`)

| File | Use it for |
|---|---|
| `spec_meets.md` | every label/key/enum/field/endpoint of the meet domain; the first build |
| `spec_clubs_discover_home.md` | club, discover, venue, home, content, community, reward-network screens |
| `spec_competition_dupr.md` | competition wizard and tabs, match formats, scoring, DUPR, coaches, stats |
| `spec_profile_social_system.md` | auth, onboarding, profile, settings, chat, notifications, Supporter, ads, help, system |
| `domain_*.md` (4) | round-1 string inventories with strings.txt line numbers |
| `i18n_en.json`, `i18n_other.json` | the complete copy in 9 languages (zh_TW / zh_CN included) |
| `screens.md`, `api_calls.md`, `modules.json`, `screen_tree.md` | per-screen bindings, HTTP inventory, module registry, route tree |
| `web_evidence.md`, `help/`, `shots/`, `store/`, `web/` | vendor screenshots, 82 help articles, store data, share pages |
| `OBSERVED_UI.md` | what the real screens look like |
| `hermes_core.cjs`, `hermes_model.cjs`, `hermes_bind.cjs`, `hermes_strings.cjs`, `README_bind.md` | rerun the decode (`node --max-old-space-size=8192 hermes_bind.cjs`) |

---

## 10. What would get this to L6
Run the app. Options: an Android emulator on this PC (Android Studio, ~10 GB) with the XAPK installed and an account the operator creates; or a phone with the app signed in and screen-mirrored. Then every screen in §4 gets walked and screenshotted, and the server-side rules the binary cannot show (auto-advance, push timing) get observed.

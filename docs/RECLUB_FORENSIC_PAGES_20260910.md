# RECLUB FORENSIC — page by page from the app binary, against what we have now (2026-09-10)

Contract loaded — hook armed: yes · integrity: v6@379dba191765 OK
**Method (L2):** `Reclub 2.45.12` XAPK → `co.reclub.apk` → `assets/index.android.bundle` (Hermes bytecode v96, 28.8 MB). String table decoded from the file format (128,251 strings, 130,476 lines once written out: component names, route/overlay paths, API paths, UI labels in en/tl/id/es/pt, enum constants). Evidence tags: **[C]** component/class name, **[R]** route/overlay path, **[A]** API path, **[L]** UI label text, **[E]** enum constant. Not run, not decompiled to source: screen layout order is inferred from component names and labels.
**Ours (L5):** what runs on social.silkvo.com tonight (Misskey 2026.9.0 fork, seeded demo, hkpl SSO proven). **Planned:** `SPEC_SOCIAL_ENGINE_20260909.md` + `FLOW_MEET_SPEC_20260910.md`.

Verdict key: 🔴 Reclub ahead · 🟡 parity or different shape · 🟢 ours ahead · ⚪ not applicable by design.

---

## 0. Corrections the binary forces on my earlier flow document
1. **Level gate exists and has two modes** [C `MeetSportLevelGateType`, `MeetSportLevelBasis`] [L "Players that meet the level requirements are auto-approved, others will need approval from the hosts." / "Players who do not meet the level requirement will be blocked from joining or requesting." / "Set the gate type for your club" / "Choose a minimum sport level for your meet" / "Choose a maximum sport level for your meet"]. Earlier I wrote "skill is free text, host eyeballs" from their help centre. Wrong: the gate is structured, per club, soft or hard.
2. **Cancellation freeze is a field** [L "Cancellation freeze", "Pag-freeze ng pagkansela"], not just prose in meet details.
3. **Check-in is a participant state** [L "Checked In"] [C `checkinMargin`], and **gender / age-group gating exists** [C `MeetGender`, `MeetAgeGroup`] [L "Choose genders", "Choose age groups", "Add gender and age group"].
4. Recurrence is weekly only, confirmed [L "Repeat this meet weekly", "Repeat for one week" … "Repeat for four weeks", "Add your weekly schedule once and we will auto create future meets"]; `DAILY/MONTHLY` constants belong to the RevenueCat subscription SDK, not meets.

---

## 1. Onboarding (first run)
**Reclub** [R `/auth/welcome`, `/overlays/auth/login|signup|forgot-password`, `/onboard/club-code`, `/onboard/join-club`, `/onboard/create-activity`, `/onboard/invite-friends`, `/onboard/location-existing-user`, `/overlays/onboard/age-group`] [L "Add your sports to find clubs, activities, and friends." · "Add gender and age group" · "Enter club code" · "Don't have a club code? Please ask your club admin." · "Find a club near you" · "Find a game" · "Create your first meet" · "Invite your friends"] [C `LoginWithProvider`, `FBLoginManager`]. Flow: sign in (email/Apple/Facebook/Google) → pick sports → gender + age group → club code or find club → create first activity → invite friends → location.
**Ours now:** none of it, by design: an hkpl member arrives through SSO already known (name, DUPR, club) [probes `sso`, `hkpl-sso-mint`, walk]. Stock Misskey shows a "profile setup" wizard once (to be suppressed, spec 1b).
**Planned:** no onboarding for hkpl members; a one-screen "pick your clubs / level band" for open-group users.
**Verdict:** 🟢 for hkpl members (zero steps vs six), 🟡 for strangers (Reclub's is polished; ours is nothing yet).

## 2. Home
**Reclub** [C `Home`, `HomeTab`, `CommunityPromotedMeets`, `GroupPromotedMeets`, `KudosReceivedTileCarouselItem`] [A `/user/navigation`, `/user/pinned`, `/user/sync/meets`, `/user/sync/competitions`, `/players/recent-activity`, `/players/last-seen`]. Tiles: your upcoming meets/competitions, RSVP inbox, promoted meets (club + community), kudos received carousel, pinned venues, recent players (My Network).
**Ours now:** Misskey home = timeline of followed users/channels + a pinned admin note. Seeded content only.
**Planned:** club feed as home inside hkpl (stock), plus a "this week near you" meets strip once the events module exists (flow spec §2 Player 1).
**Verdict:** 🔴 today; 🟡 after events module.

## 3. Discover
**Reclub** [C `Discover`, `DiscoverFilters`, `DiscoverMapView`, `DiscoverMapPin`, `DiscoverMeetMarker`, `DiscoverVenuePin`, `MeetMapCard`, `MeetMapCarousel`, `FilterRecentLocations`] [A `/discover/meets`, `/discover/meets/count-by-date`, `/discover/meets/map-points`, `/discover/venues`, `/discover/groups`, `/discover/filter`, `/discover/filter-location`, `/discover/filter-sports`, `/venues/autocomplete`, `/venues/reverse-geocode`] [L "Filter activities" · "Filter sports" · "Filter dates" · "Filter distance" · "Filter by gender" · "Friends only" · "Discover by Venue" · "Discover nearby clubs and activities. Your location stays completely private."]. Map with meet pins + venue pins, date-count strip, carousel of meet cards under the map.
**Ours now:** Channels directory (trending/favourites/followed/search) [stock]; no meets to discover; hkpl has a venues map (60 geocoded) on its own site.
**Planned:** `/meets` list + map with hkpl venues, filters week/near me/level/club (flow spec §2 Player 1; spec §4 Events list).
**Verdict:** 🔴 today; 🟡 planned parity with better venue data (hkpl's 60 approved venues vs their crowd-sourced "venues-beta").

## 4. Club page (Reclub "group")
**Reclub** [C `ClubDetailHeader`, `ClubDetailHeaderQuickBar`, `ClubDetailPanes`, `ClubDetailActivitiesLoading`, `ClubDetailChat`, `ClubDetailDiscussion`, `ClubDetailContent`, `ClubDetailLibrary`, `ClubDetailLibraryMedia`, `ClubDetailMembers`, `ClubInsightsOverlay`, `ClubTag`, `ClubFollower`, `ClubVenueConfirmation`, `GroupCreateMeetPermission`, `GroupProfileMembersSortingModal`, `onOpenMemberRolesModal`] [A `/groups/by-ids`, `/groups/user-status`, `/groups/manage-group-sport`, `/teams/groups`, `/content/by-channel`, `/discussion/general_chat|team_chat|captain_chat|staff_chat`] [L "Only club members can see and request to join" · "Only admin can create meets" · "Admin and members can invite and approve members" · "Show club tags" · "Add club media" · "Add highlight reel to your club" · "Set the gate type for your club" · "Your club's sport level" · "Add to club venues?" · "Oops! The club admin has restricted links to outside activities." · "There is not enough data of active players. Host meets to gather your club members." (Insights)]. Panes: Activities · Chat · Discussion · Content (posts) · Library (media) · Members (roles, tags, sorting) · Insights (rankings). Club has: privacy, gate type + club level, venues, tags, media, who-may-create-meets, link restrictions, DUPR club id.
**Ours now:** Channel = banner (real HKPL logos), description, timeline (posts), featured, search, follow, "post to channel"; members = followers; no roles, no tags, no insights, no venues, no gate. [screens `demo_channel_mobile.png`]
**Planned:** verified clubs (hkpl mirror: managers → channel admins, teams/standings link, venues) vs open groups (spec §2 community model); club "Meets" tab, roles, gate type + level from hkpl DUPR (events module).
**Verdict:** 🔴 today (their club is a full workspace); 🟢 on trust once mirrored (real clubs with real managers, teams, standings, venues — theirs are self-declared).

## 5. Meet page
**Reclub** [C `MeetDetail`, `MeetDetailContent`, `MeetDetailModalTypes`, `MeetUserStatusPillView`, `MeetParticipant*`, `MeetParticipantTag`, `MeetParticipantTagGroup`, `MeetParticipantTagScopes`, `MeetParticipantTeam`, `MeetParticipantPaymentType`, `MeetParticipantRequirementStatus`, `MeetMatch*`, `MeetScoresPane`, `MeetPhotosPane`, `KudosPane`, `MeetMedia`, `MeetFlag`, `MeetPrivacy`, `MeetFeeType`, `MeetFeesPerPersonComponent`, `MeetRepeatInterval`, `MeetType`, `MeetListingsPopupOverlay`, `ReserveSpot`, `CohostCoachesPane`] [A `/meets/by-ids`, `/participants/assignments|bulk|resolve|teams_confirmed`, `/matches/generate|format|manual-seeding|quick-input-score|reset|reveal-draw`, `/meets/generator/stats`, `/kudos/by-reference`, `/channels/by-reference`] [E `REQUESTED`, `WAITLISTED`, `CONFIRMED`, `INVITED`, `NOT_REQUESTED`, `PAID`, `CANCELED`, `ENDED`, `HOST`, `HOSTING`, `HOST_BLOCK`] [L "Request to join" · "Request +1" · "You are on the waitlist." · "You are waitlisted. Please wait for the host to confirm you before coming." · "Important notifications such as when you’ve been moved from the waitlist to confirmed will be missed." · "Confirmed to play" · "Checked In" · "Fee amount per person" · "Auto split total" · "Fee Waived" · "Payment collector" · "Payment Note" · "See payment receipt" · "Upload payment receipt" · "Cancellation freeze" · "Contact host" · "Chat host" · "Reserve a spot" · "Swap Reserve" · "Generate matches" · "Add match notes" · "Give kudos" · "You cannot join this meet because you don't meet the level requirements."]. Tabs: Details · Participants (states, tags, teams, reserves) · Matches (generator, scores) · Payment · Photos · Kudos · chat. Statuses are a real state machine incl. checked-in and paid; "+1" requests; hosts/cohosts/coaches; meet media; meet flags (report).
**Ours now:** a meet is a **post** in a club channel with "in" replies and reactions (seeded). No states, no capacity, no waitlist, no fee, no check-in, no matches. [`demo_meets_mobile.png`]
**Planned:** the events module = exactly this tab set with structured states (`Requested · Confirmed · Waitlisted(n) · Paid · Checked-in · No-show · Cancelled`), spots left, pay-by deadline with auto-release, promotion always + notification, hard/soft level gate on the member's real DUPR, guests counted, recurrence beyond weekly; matches via hkpl's existing OpenPlayGame/SocialGame pipeline; kudos later (flow spec §2–3).
**Verdict:** 🔴 today, the biggest gap; 🟢 on the money and DUPR sides once built (they: screenshot receipts, Supporter-paywalled; we: pyke + hkpl's DUPR pipeline).

## 6. Create meet (host)
**Reclub** [R `/overlays/create-meet`, `/overlays/create-meet/select-club`, `/create-meet/by-privacy`, `/overlays/upsert-club-activity/meet`, `/overlays/manage-sports/create-meet`] [C `onOpenUpsertMeetModal`, `onOpenDateTimeModal`, `onOpenVenue`, `onOpenAddressActionSheet`, `MeetRepeatInterval`] [L "Add meet name" · "Choose starting time" · "Choose duration" · "Choose location" / "Add new location" / "Add court" · "Choose a privacy for your meet." · "Choose a minimum sport level for your meet." / "Choose a maximum sport level for your meet." · "Choose genders" · "Choose age groups" · "Fee amount per person" / "Auto split total" · "Payment collector" · "Payment Note" · "Auto approve" · "Cancellation freeze" · "Repeat this meet weekly" / "Repeat for one week" … "Repeat for four weeks" · "Create recurring schedule" · "Add notes" · "Create a meet for your invited friends only" · "Full featured meet" vs "Meet listing"]. So the form is: name, date/time, duration, venue/court, privacy, level min/max, genders, age groups, fee (per person / auto split / waived), collector, payment note, auto-approve, cancellation freeze, repeat, notes, listing-vs-meet.
**Ours now:** "Post to channel" (text + media).
**Planned:** same field set plus currency, pay-by deadline, guests-per-member, recurrence (weekly/bi-weekly/monthly/custom), approval mode, visibility public/club/invite, venue picker from hkpl's list (flow spec §2 Host 1).
**Verdict:** 🔴 today; 🟡 planned parity, 🟢 on payment fields.

## 7. Participants / roster management (host)
**Reclub** [C `ConfirmedParticipantsOptions`, `AssignPlayer`, `AssignPlayersButton`, `ParticipantSeeds`, `onOpenParticipantRolesModal`, `onShowMeetRolesActionSheet`, `onOpenInvitationsActionSheet`, `MeetParticipantTag`] [A `/participants/bulk`, `/participants/assignments`, `/participants/resolve`, `/select-player`] [L "Put in waitlist" · "Move to waitlist" · "Remove from waitlist" · "Invite or reserve spot for a player." · "Edit reserved info" (name, skill, gender, age) · "Demote host" · "Promote to host" · "Manage block list"]. Bulk actions, tags, roles (host/cohost/coach), reserves for non-users, block list.
**Ours now:** none.
**Planned:** roster with one-tap approve / mark paid / check in / promote / remove, export, message-all, sort by rating (flow spec §2 Host 2).
**Verdict:** 🔴 today; 🟡 planned.

## 8. Payment
**Reclub** [R `/overlays/payment/methods/add|list|see-receipt`] [A `/payments/methods`, `/payments/transactions`, `/v1/receipts`] [C `PaymentMethodCards`, `PaymentTransactionStatus`, `MeetParticipantPaymentType`, `CheckoutPaymentForm*` (RevenueCat subscription checkout)] [L "Payment collector must be a premium supporter to show payment methods and upload receipts." · "Become a Reclub Supporter so players can upload payment receipts." · "Upload payment receipts on behalf of your players." · "Are you sure you want to replace this proof of payment?"]. Confirmed from the binary: **no money movement for meets** — methods are display info, receipts are images, the paid flag is manual, and both sides are paywalled behind the US$2.99 Supporter subscription. Real checkout exists only for their own subscription.
**Ours now:** none (Payment model in hkpl is a stub; registrations are screenshot receipts too).
**Planned:** v1 structured PayMe/FPS details + "I've paid" + host confirm; v2 pyke booking + webhook → `Paid` (spec §6 P1). No paywall on either side.
**Verdict:** 🟡 today (both nothing); 🟢 planned, and this is the structural wedge.

## 9. Kudos and Street Cred
**Reclub** [C `Kudos`, `KudosPane`, `CredLeaderboard*`, `HAS_GIVEN_KUDOS`, `SKIP_KUDOS`, `PlayerReviewServices`, `PlayerReviewStats`] [A `/kudos/by-reference|by-user`, `/results/kudos`, `/leaderboards/street-cred`, `/stats/street-cred/leaderboard`, `/player/review/closed`] [L "After the meet, players can give kudos for various skills and earn rankings in our fun Street Cred leaderboard." · "Curious who gave you kudos?" (Supporter) · "Give private feedback" · "Community reviews" · "Curious who endorsed you?"]. Post-meet kudos (categories), private feedback to host, community reviews/endorsements, monthly leaderboard.
**Ours now:** emoji reactions on posts (stock).
**Planned:** reliability score (attended / no-show / late cancel) shown on profile, kudos after meets; endorsements optional (flow spec §2 Player 6).
**Verdict:** 🔴 today; 🟡 planned, different emphasis (reliability > popularity).

## 10. DUPR
**Reclub** [R `/overlays/dupr/connect`, `/overlays/dupr/activity-manager/confirm-submit-sheet`, `/overlays/dupr/submit-notice`, `/overlays/dupr/support`] [A `/dupr/login`, `/dupr/eligibility`, `/dupr/ratings`, `/dupr/submission`, `/settings/dupr`, `/statistics/dupr-rankings`] [C `DUPRManager`, `DUPRMatchEligibility(ErrorCode)`, `PlayerSportProfileDUPR`, `DUPR_CLUB_ID`] [L "Connect your Reclub account with DUPR to sync your ratings." · "Only Club director or organizer can submit matches." · "You cannot submit these matches because you are not a host or club admin."]. Per-user connect (DUPR login inside the app), eligibility check per match, bulk submit by club director.
**Ours now:** the engine has nothing; hkpl already holds 2,190 DUPR-linked members, snapshots, a write queue, webhooks and eligibility rules [hkpl schema, L2/L5].
**Planned:** DUPR rating arrives in the SSO token (proven: `dupr_rating: 2.971` in the walk claims); submit through hkpl's pipeline via the adapter (phase 1b).
**Verdict:** 🟢 — theirs asks every player to log into DUPR inside their app; ours already knows.

## 11. Matches / round robin / competitions
**Reclub** [C `MeetMatchGeneratorScheme`, `MeetMatchConfig`, `CustomMatch`, `MatchOnce`, `Competition*` (~120 classes), `tiebreaker`, `revealDraw`, `blindTeams`, `feeEarlyBirdAmount`, `registrationEarlyBirdDeadline`, `FREE_AGENT`, `SPECTATORS`, `REFEREE`] [A `/competitions/create-competition|matches|scores|stats|stats/summary`, `/matches/generate|reveal-draw|manual-seeding|reset`] [L "Add extra matches for the round robin stage. These matches will affect the standings." · "Add extra matches for the playoffs stage." · "Edit first place award" … "Edit fourth place award" · "Become free agent" · "Early bird fee" · "Competition points are awarded based on wins, losses, or draws of matches."]. This is their deepest surface.
**Ours now:** nothing in the engine; hkpl runs a full league engine daily (1,816 matches, rules engine, standings, disputes, referee, live scoring, brackets) and has OpenPlayGame round-robin code [hkpl, L5].
**Planned:** phase 3 in the spec; surface hkpl's engine into the social layer rather than rebuilding.
**Verdict:** 🟡 — parity in capability, different homes; 🔴 on the ad-hoc "any host runs a round robin in the app" convenience until phase 3.

## 12. Chat / inbox
**Reclub** [C `Chat`, `ChatPane`, `ChannelsMQTT`, `ChannelMessage*`, `ChatSettingsMembers`, `GroupChatNoAccess`, `ClubChatRestriction`] [R `/overlays/chat`, `/overlays/chat/create`, `/detail/chat`] [A `/channels/by-participants|by-reference|mark_read|sync|unread`] [L "Let's wait for host to approve your request and start chatting." · "Request to join to start chatting with other participants." · "Invite to chat"]. Per-meet chat gated on being confirmed, per-club chat/discussion, DMs, MQTT real-time, reactions, attachments.
**Ours now:** Misskey chat (DMs + rooms, reactions) [stock, 2025.4]; hkpl has its richer WhatsApp-grade chat separately.
**Planned:** auto-rooms per meet and per club; hkpl's voice/transcript search only if needed (spec phase 3).
**Verdict:** 🟡.

## 13. Profile / stats / awards
**Reclub** [C `Profile`, `PlayerSportProfile`, `PlayerSportProfileRatings`, `PlayerSportAward`, `PlayerAgeGroup`, `PlayerGender`, `PlayerRestrictions`, `PlayerReviewStats`, `Coach*`] [A `/user/badges`, `/user/placements`, `/user/entitlements`, `/user/activities`, `/statistics/activity-history|match-history|match-summaries|stats-team-rankings`, `/settings/blocked-players`] [L "Add an award" (e.g. MVP, Fair Play) · "Curious who endorsed you?" · "Clear scores and stats" · `beta_discover_venues_verified_badge_body` · `premium-supporter/feature-locked.tsx`]. Sports profiles with ratings, awards, badges (Supporter/Verified), placements, reviews, stats, coach profile.
**Ours now:** Misskey profile (name, bio, avatar, posts, followers) [stock]; hkpl profile has DUPR, Glicko-2, team history.
**Planned:** SSO carries name/avatar/DUPR/club; reliability score; hkpl stats via adapter cards (spec §6 A3).
**Verdict:** 🔴 on presentation today; 🟢 on data depth once cards land.

## 14. Venues
**Reclub** [C `VenueDetail`, `VenueMapSheet`, `VenueConfirmationOverlay`, `GroupVenue`, `DiscoverVenue`] [A `/venues/autocomplete|resolve|reverse-geocode|beta-info|listings-info|sports-info`] [L "Discover by Venue" · "The activities and schedule is updated weekly.  Please confirm directly with the club for the most accurate information and availability."]. Crowd-sourced venues with club and activity counts; "beta".
**Ours now:** hkpl's 60 approved, geocoded venues with court counts (not yet in the engine).
**Planned:** venue picker + `/meets` map from hkpl's list.
**Verdict:** 🟢 on data quality; 🔴 on being visible in the social app today.

## 15. Notifications
**Reclub** [C `NotificationsMQTT`, `NotificationsAPI`, `ExpoNotificationsHandlerModule`] [A `/notifications/opened|read`, `/settings/notifications`] [L six toggles: friend requests · new/invited public meets · promoted games by my clubs · promoted games by the community · reviews/kudos/awards/posts · club updates].
**Ours now:** Misskey in-app + web push (VAPID) [stock]; native push code on the hkpl side with zero devices registered.
**Planned:** push through hkpl's APNs/FCM keys inside the hkpl shell; waitlist-promotion and reminder notifications from the events module.
**Verdict:** 🟡.

## 16. Monetisation surfaces
**Reclub** [R `/overlays/ads/*`, `/overlays/reclub-partner-www`] [C `ADMOB_ANDROID_BANNER_ID`, `ADMOB_ANDROID_INTERSTITIAL_ID`, `ADMOB_ANDROID_NATIVE_ID`, `CheckoutPaymentForm*`, `REVENUECAT_ANDROID_PUBLIC_KEY`] (AdMob mediation; Pangle named in the bundle, other networks only in native libs) [L "Go ad free with Reclub Premium" · "Interested in promoting your brand to our sport community?" · "Community Partner"]. Ads for everyone, US$2.99 subscription removes them and unlocks receipts/kudos names/stats; brand promotion.
**Ours:** ⚪ no ads, no subscription by design; revenue = anchor-host margin and pyke commerce (handover §3).

## 17. Languages
**Reclub:** en + Tagalog + Indonesian + Spanish + Portuguese in the bundle [L]. No Chinese. **Ours:** zh-Hant, zh-Hans, en (Misskey locales; hkpl trilingual). **Verdict:** 🟢 for Hong Kong.

---

## Summary table

| Page | Reclub (binary) | Ours today | Ours planned | Verdict |
|---|---|---|---|---|
| Onboarding | 6-step wizard | SSO, zero steps | same | 🟢 members / 🟡 strangers |
| Home | tiles, promoted meets, RSVP inbox | timeline | + meets strip | 🔴 → 🟡 |
| Discover | map, filters, venue pins | channel list | `/meets` + map | 🔴 → 🟡 |
| Club | 7 panes, gate, venues, media, insights | channel + timeline | verified vs open, roles, meets tab | 🔴 → 🟢 (trust) |
| Meet | full state machine, tabs | a post | events module | 🔴 → 🟢 (money, DUPR) |
| Create meet | 15-field form, weekly repeat | post box | field parity + currency, deadline, recurrence | 🔴 → 🟡/🟢 |
| Roster | bulk, tags, roles, reserves | none | roster tools | 🔴 → 🟡 |
| Payment | display + screenshot, paywalled | none | pyke | 🟡 → 🟢 |
| Kudos / Cred | kudos, leaderboard, reviews | reactions | reliability + kudos | 🔴 → 🟡 |
| DUPR | per-user connect, director submit | via hkpl | in token + pipeline | 🟢 |
| Competitions | deep engine | via hkpl | surfaced phase 3 | 🟡 |
| Chat | MQTT, gated per meet | Misskey chat | auto-rooms | 🟡 |
| Profile / stats | awards, badges, reviews, stats | basic | cards from hkpl | 🔴 → 🟢 |
| Venues | crowd-sourced beta | hkpl 60 approved | picker + map | 🟢 data / 🔴 visibility |
| Notifications | 6 toggles, push | web push | hkpl push | 🟡 |
| Ads / subs | heavy | none | none | ⚪ |
| Languages | en/tl/id/es/pt | zh-Hant/zh-Hans/en | same | 🟢 HK |

**Honest reading:** today Reclub is ahead on every consumer-facing page except onboarding, DUPR and language. Everything that flips the table is one module, the meet object with its states, plus wiring what hkpl already owns (DUPR, venues, clubs, competitions, payments through pyke). The binary shows their meet is richer than their help centre lets on (structured level gate, cancellation freeze, check-in, gender and age gates), so the flow spec's build list now includes all four.

Artifacts: probe `probes/reclub-forensic.verdict.json` (every bracketed token and quoted label in this document is checked verbatim against the string table); decoded strings `scratchpad/reclub/out/strings.txt` (128,251 strings), grouped lists `api.txt` (144 routes), `modals.txt`, `pascal.txt` (708 domain components), `labels.txt` (11,858 UI strings), `domain.txt`.

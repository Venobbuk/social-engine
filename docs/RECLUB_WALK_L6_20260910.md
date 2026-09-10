# RECLUB — L6 WALK ON A REAL PHONE (2026-09-10, Reclub 2.46.0 build 402, Android 16, Zenfone 11 Ultra over Tailscale + adb)

Contract loaded — hook armed: yes · integrity: v6@379dba191765 OK

**Method (L6):** the operator's phone paired to this droplet by adb over Tailscale (`adb devices` → `100.94.34.3:45473 device product:ZWW_AI2401 model:ASUS_AI2401_H`). Every step = `adb shell input tap/swipe` + `screencap` + `uiautomator dump`. 87 captures in `D:\Downloads\reclub_walk\` as `NNN_name.png` + `.xml` (UI tree) + `.txt` (text nodes with tap coordinates). Driver: `D:\tools\walk.cjs`. Signed in as the operator ("Hi, Vincent", `@vincent-58`), home location near Tung Chung, radius 20 km. Nothing was joined, sent, created or changed on the account; the create-meet form was opened and abandoned.

**What this adds to the bytecode forensic:** real layouts (L6) for the screens below, the option values that were only integer operands in the bytecode, the 2.46.0 navigation (newer than the 2.45.12 bundle), and live market data for Hong Kong.

---

## 1. Strategic finding first: Reclub is already the Hong Kong pickleball social layer

Discover → CLUBS, "Near Home · 20 km", scrolled through 95 clubs (`reclub_walk/HK_CLUBS_SEEN.txt`, from captures 013–036). Memberships summed across the 95: 63,747 (overlapping people, but the scale is unambiguous). Largest:

| Members | Club |
|---|---|
| 6,127 | HK Pickleball 香港匹克球 |
| 4,567 | HK Pickle Rock 香港匹克樂 |
| 4,254 | HAPPY Pickleball |
| 2,970 | 活力匹克 Vitality Pickleball Club |
| 2,452 | iPickle |
| 2,285 | PB Day (level 3.0) |
| 2,182 | PTSD |
| 2,037 | Friendship_pickle |
| 1,971 | Nets Sport Association |
| 1,926 | Pickleball & Tennis @ Sha Tin |
| 1,819 | Pickleball Lam ² |
| 1,697 | Happy pickleball club |
| 1,612 | The Pickleball Lab |

Discover → MEETS on Thursday 10 Sep within 20 km of Tung Chung: 1 PM 1 meet, 2 PM 3 meets, 3 PM 1 meet, 4 PM 3 meets and more below (capture 008, 085): Tin Shui Wai indoor 6/6 full, Long Ping Sports Centre 4/6, Yuen Long 18/18 full, 朗屏體育館 6/6 full. Venues pane lists Tung Chung clubhouses with activity and club counts (capture 023).

A real HK meet (capture 009, "The Pickleball Pack", 18/18): `Social • Min 2.75 [Self Rating]`, `Per player • HK$50`, host notes carry the whole HK workflow in free text: request → host moves you to waitlist → pay by PayMe link → send receipt in group chat → unpaid after 48 h moves to on-hold, paddle rental HK$10, "15 direct scoring, no deuce, 6 players per court". Participants tab (capture 010) shows a DUPR Manager bar, ORGANIZERS, CONFIRMED 18/18 with per-player DUPR doubles/singles (2.286 / 2.891), a yellow "Reserved" slot, Sort and Show menus (Tags, Courts, Friends, DUPR), footer "Message host" / "Request to join". Matches tab for a non-member: "Generate Matches … Please ask your meet host about this feature." Chat tab: "Request to join to start chatting with other participants."

**Reading for hkpl:** hkpl has ~2,000 members; the HK pickleball public is already organised on Reclub at 20 to 30 times that scale, with PayMe as the payment rail and self-rated or DUPR level gates. Our engine must interoperate with that reality (PayMe-native payment step, DUPR shown per participant, Chinese-first copy), and differentiate on what Reclub does not have here: verified clubs, real leagues and standings, a DUPR submission pipeline that survived this week's DUPR outage, and commerce.

## 2. DUPR outage notice (capture 003–004, verbatim from the in-app page "An update on DUPR", 9 Sep 2026)
- "As of 10 September 11.30am, systems are said to be online, however Reclub is experiencing an extremely high match submission failure rate."
- "On Wednesday 9th Sept, DUPR notified users that they had proactively shut down their systems after detecting suspicious activity on their network."
- "Reclub was able to connect to DUPR's API throughout this period, and queued match submissions as they came in."
- "Reclub only shares your DUPR ID and Reclub Public User ID with DUPR."
Relevance: hkpl's DUPR pipeline (2,190 linked members, write queue) should be checked for failed submissions and rating drift from 8–10 Sep.

## 3. Navigation as shipped in 2.46.0 (captures 001, 007, 050)
- Bottom bar: Home · Feed (megaphone) · Inbox (chat bubble, unread dot) · Menu (avatar with up/down chevrons) · floating Search (opens Discover). No Statistics tab in the bar.
- Menu panel (not exposed to accessibility, read from the screenshot): Profile (with filter icon and a blue "+" create button), Home, Feed, Inbox, Notifications, My clubs, My network, My history, Statistics, Settings, Help.
- Home: "Hi, Vincent", dismissible announcement card (DUPR update), chips Active / With friends / By clubs, empty state "Find an activity near you" + Discover button.

## 4. Discover (captures 008, 013–024, 085, 086)
- Sheet header: close, "Near Home · 20 km ▾", "Sports ▾"; tabs CLUBS / MEETS / COMPS / VENUES / PEOPLE.
- MEETS: filter icon + 7-day strip; time-grouped headers "2:00 PM | 3 meets"; card = club avatar, CLUB NAME caps, title, chip Social, venue with pin, sport icon, capacity pill (yellow when open, purple when full), distance; bottom "Search…" with map toggle.
- Meet filters dialog (085): row 1 Mornings / Afternoons / Evenings (all on); row 2 Not full / Friends only / Clubs only / Hide empty; Confirm.
- Map (086): Google Maps dark style, tabs MEETS / VENUES, Sports dropdown, filter button, day chip with next arrow, locate-me button.
- CLUBS: rows with avatar, name, "N Members", level ("All Levels" / "3.0" / "Intermediate" / "Newbie / 2.0").
- COMPS: chips All / Registration / Happening now; empty state "Host your competition on Reclub. There's never been an easier way to register, seed, draw, and track matches." + Get started.
- VENUES: BETA strip, toggle "Upcoming activities", rows with address, "N Activities", "N Clubs", distance.
- PEOPLE: chips Players / Coaches; "No recent players yet".

## 5. Club page (capture 037–041, YL Fun Club, 366 members)
Cover image, avatar, name, "Public • Pickleball • All Levels", icon row Members / Activities / Library / Discussion, counters "366 Members · 25 Activities", description, Admins with shield badges + "Message Admins", Venues list, big "Request to join". Activities pane: "REGULAR SCHEDULE — This club does not have any automated weekly activities.", chips "Open • 0" / "Past • 25".

## 6. Create meet (captures 065–083) — the form as rendered, top to bottom
Chooser: Create meet / Create competition / Create club (065). Privacy chooser: Public meet / Private meet + Learn more (066).
Form "CREATE A MEET" (back arrow, swap icon top-right):
1. "Creating a meet for your club? Add club"
2. SPORT: sport tile (Pickleball), format chips Social / Round Robin / Singles / Doubles
3. MEET: Select date and time (native date-time dialog with Cancel/Confirm), duration "1 hour" (wheel "Select duration" + Confirm), Choose venue (screen "Enter venue location", "No venues found", options "To be determined" / "Add Venue")
4. Number of players − 12 +
5. Privacy › (sheet: "Choose a privacy for your meet." — Create a public meet "Everyone can see and request to join." / Create a private meet "Only invited people can see and request to join")
6. Meet fee › (sheet "Set type of fee for your meet": None / Free / Auto split total / Per person)
7. Switch "Matches will be submitted" (DUPR)
8. Minimum Level › / Maximum Level › (prompt "Enter min level" numeric with Cancel/OK)
9. MEET NAME (counter 100) prefilled "Pickleball Social with Vincent"
10. Add Notes (multiline)
11. Advanced options: Gender › (Coed / Female / Male / No restriction), Age group › (Adult (18 - 55) / Junior (Under 18) / Senior (Above 55) / No restriction), Repeat › ("Repeat this meet weekly": None / one / two / three / four weeks), Host's role › (Host only / Host and play), Cancellation freeze › ("Set the time when participants can no longer cancel": None / 2 / 4 / 6 / 8 / 12 / 24 hours before), Auto-approve switch (off by default), Allow +1 requests switch (on by default), Invite friends link
12. Footer button "Create Meet" (disabled grey until valid)
Everything matches `spec_meets.md` §2.10; the cancellation-freeze hour set and the two switch defaults were INFERRED there and are now PROVEN.

## 7. Profile, settings, other pages (captures 053–064)
- Profile: avatar, name, @handle, "Add gender and age group", "Tell us a little bit about yourself", yellow SUPPORT RECLUB card, SPORTS + Add Sport, sport card with DUPR "Connect" and SELF RATING "Newbie / 2.0".
- Settings: segments Account / Preferences / Help; rows Locations, Payment methods, Calendars, Blocked players, Community reviews, Logout; "Version 2.46.0 (402)".
- Preferences: Navigation (BETA) "Tabbar — Customize your Home screen's layout experience.", Language "English", Notifications.
- Notification toggles (all on by default): Activity notifications; Club notifications; Friend notifications; Social notifications; Chat notifications ("You can also turn off chat notifications on a per chat basis"); Promoted community meets; Promoted club meets; Latest updates.
- Notifications page: "No recent notifications". My clubs: "Find a club near you". My network: tabs Friends / Saved / Recent, copy "See where the crew's headed, stay in the loop, and never miss a meet.", "Add friends to see their activities", "See recent activities". My history: tabs Meets / Competitions / Matches, "You don't have any past meets."
- Statistics: "Updated daily"; tabs Rankings / Street Cred / Teammates / Opponents; Street Cred: "See which players the community voted as the best, based on certain skills." rows Leaderboard / By activity / By category.
- Help: mission line, Our Charter / Our impact, Safety Center, Community Partners, Send feedback, Community Standards, FAQs, Terms of Service, Privacy Policy, Debug.
- Inbox: compose icon; filter tiles Unread (badge) / Direct / Activity / Clubs; thread "Reclub Feedback" with the CEO's welcome message ("Tony Ho: Hi Vincent! I'm Tony, cofounder and CEO of Reclub…").
- Feed: posts by Reclub staff ("Reclub x PPA Asia Singapore Open", "Urgent Security Notice: Phishing Scams") with reactions count and comments.

## 8. What is still not observed
Host-side screens (roster management, payments manager, match generator on a meet I host), competition wizard, club settings, kudos flow, chat inside a meet, schedules. Those need the operator to be a host or member: create one test meet and one test club on the account, or join a club, and I walk them the same way.

## 9. Automated read-only crawl (added 15:40, L6)
`D:\tools\crawl.cjs` ran three passes (depth 2, 4, 7; the depth-7 pass found nothing untried within reach) on Reclub 2.46.0 over adb: **94 distinct screens, 174 transitions, 78 distinct tap labels**, zero exits into other apps, zero errors (`D:\Downloads\reclub_crawl_stdout.log`). Every screen: `D:\Downloads\reclub_crawl\<name>.png` + `.txt`; the graph and a readable sitemap: `reclub_crawl\graph.json`, `reclub_crawl\SITEMAP.md`. Deny-list kept it off join/send/create/pay/follow/logout/delete/language/layout actions; two side effects on the account: the "Reclub Feedback" thread was opened (marked read) and "Mark all as read" was tapped once in the inbox before that label was added to the deny-list. Reached beyond the manual walk: Account page (email + password fields, not typed), Preferences → Navigation options sheet ("Tile Navigation" / "Tabbar"), Language list (9+ languages), Locations (saved "Home" with Edit/Delete, Add location form), Payment methods & receipts ("Available to Reclub supporters only"), Calendars (permission prompt), Blocked players (empty), Community reviews (Your Reviews / Community tabs), Help → Our Charter / Our impact / Community Partners / Send Feedback form (categories incl. "Report a bug"), club tutorial (INTRO / MANAGE MEMBERS / ACTIVITIES panes), Feed post detail with comment threads, Inbox filters, Statistics → Street Cred leaderboard with country picker and gender filter, Discover panes with multiple club pages (JoyFromPickle, Happy picklevibes isquare, IGNITE FOOTBALL ACADEMY, The Pickleball Lab, HK Pickleball 香港匹克球, PTSD, Pickleball Lam ²). Not reachable read-only: host-side and member-side screens (need a test meet/club or a club membership on the account).

## 10. Host-side and admin-side walk (added 16:20, L6, authorised by the operator)
With the operator's authorisation a **private** test meet ("Pickleball Social with Vincent", Fri 11 Sep 3:50 PM, 1 h, venue To be determined, 4 players, no fee) and a **private** test club (name mangled by the phone keyboard to "ice蟿 es clu", code IX412) were created on the account, walked, then removed: the club was deleted (Settings → ⋯ → Delete club → "Are you sure to delete this club?" → Delete; My clubs is empty again, capture `cleanup_myclubs_check`); the meet was cancelled (kebab → Cancel meet → "Are you sure to cancel this meet?"). Per Reclub's own help article a meet cancelled with a participant on the roster cannot be deleted afterwards and stays in history as Cancelled — that is the state it is in now. Captures 088–179 in `D:\Downloads\reclub_walk\` (`host_*`, `host2_*`, `club_*`, `clubadmin_*`, `clubset_*`, `comp_*`, `cleanup_*`).

**Meet host view (captures 093–115):**
- Header bar under the tabs: "DUPR Manager" (Players / Matches tabs; player rows show "Not connected"; footer "Ratings may take some time to update…"), then "Payments" card and "Auto-approve" switch.
- **Payments Manager**: title + meet line; "Become a Reclub Supporter so players can upload payment receipts."; filters Receipt Only / Unpaid / By Status; section Confirmed with each participant + "Upload receipt"; tag chips Paid / Membership / Punch Card / Refunded / Digital.
- **CONFIRMED kebab**: Reserve a spot · Generate teams · Reset teams · Bulk actions · Get more players · Share participant list.
- **Reserve a spot** sheet: Name (optional), Skill level chips (Newbie / 2.0, 2.25, 2.5 …), Reserve.
- **Generate teams** sheet: "Number of teams · 2" (minimum 2), switches Balance skill levels / Balance genders / Blind teams ("Only reveal teams at a certain time before meet start") / Force teams and positions, player list with level, Generate.
- **Bulk actions**: Choose participants; Tags chips Paid / Unpaid / Membership / Punch Card; Teams.
- **Get more players**: Copy Message · Promote meet ("Send a notification to ask players to join your meet", preview of the push, CHOOSE YOUR AUDIENCE) · Invite within Reclub · Share in a chat · Other sharing options.
- **Sort** menu: Last Confirmed · Alphabetical · Skill Level · Courts · Attendance · DUPR Singles · DUPR Doubles. **Show/Visibility** sheet: Show self rating · Show DUPR rating · Show age group · Show gender · Show courts · Show friends · Show participant tags; tag legend Paid / Unpaid / Membership / Punch Card / Guest / Cash / Digital / Checked In / No show / Late / Excused; Finish.
- **Participant sheet (tap a player)**: name + level; Roles: Coach · Referee · Payment Collector; On Hold; Assign a team; Assign a court.
- **Matches tab (host)**: "Generate matches" and "Create custom match" → **Setup Matches** with tabs Format / Courts / Players / More: formats Ladder Run (beta) · Rotating Partners · Preset Teams · Singles (exactly the four schemes from the bytecode); Number of courts 1–7; Select players with Deselect All; Generate.
- **Chat tab (host)**: system line "Vincent has joined the conversation.", composer "Write a message…".
- **Details kebab**: Duplicate meet · Edit meet · Cancel meet · Turn off chat notifications.

**Club admin view (captures 127–169):**
- Creation wizard: tutorial (INTRO / MANAGE MEMBERS / ACTIVITIES / FORUM / CHAT, "100% FREE for the love of the game") → Select a sport → Select a level (All Levels, Newbie / 2.0, 2.25 … 5.0+) → Name your club + Public / Private + "Auto approve new members" (on) → "Do you want to enable chat?" (Disable / Enable) → "Invite your friends" with club code and link `reclub.co/clubs/@<slug>?at=<token>` (Copy / Share).
- Club page as admin: Upload a cover photo; name + "Private • Pickleball • All Levels"; panes Details / Members / Activities / Library; Details pane: No upcoming activities + Create, members count, Add description, Admins, Venues + Add. Members pane: Admins, "Members · 1", "Add tags to organize your members.", Search, Invite friends, Share. Activities pane: REGULAR SCHEDULE ("This club does not have any automated weekly activities."), Open • 0 / Past • 0. Library: "Share your club's moments." + Add club media.
- Club kebab: Invite · Create activity · Post announcement; Chat notifications · Pin to home screen · Take a break ("This will remove this club's activities from your home screen and cease activity notifications."); Get Reclub Support; Share · Settings.
- **Settings hub**: Profile · Privacy · Permissions · Communications · Integrations; ⋯ → Delete club.
  - Profile: Sport level chips (All Levels … 5.0+), Club name, handle `reclub.co/clubs/@…`, Description, Update.
  - Privacy: Visibility Public ("Anyone can see and request to join") / Private ("Only invited players can see and request to join"); Gating Admin Gated ("Only admins can invite and approve members") / Member Gated ("Admin and members can invite and approve members"); Update.
  - Permissions: "Allow members to create meets" (off) — "This is great for adhoc friend groups with no clear admins."
  - Communications: Enable Chat (on); "Allow outside activity links to be shared" (on) — "When turned off, only activity links from this club can be shared in the chat and club discussion."
  - Integrations: empty for a new club.
- **Create activity** sheet ("LET'S PLAY! ✌️"): Create recurring schedule ("Schedules are for clubs with fixed weekly recurring activities. Upon creating a schedule once, meets will then be auto published every week.") · Create one-off meet · Create competition ("a club level competition that can be accessed by all club members").
- **CREATE SCHEDULE** form: WEEKLY SCHEDULE day chips Mon–Sun; MEET DETAILS format chips; Select starting time; duration; Choose venue; **Choose time to create meet** (2 weeks / 1 week / 6 / 5 / 4 / 3 / 2 days / 24 hours before meet start); Number of players; Privacy; Meet fee; Meet feature (Full featured); Minimum / Maximum Level; "Matches will be submitted"; ADVANCED OPTIONS Gender / Age group / Cancellation freeze / Auto-approve / Allow +1 requests; MEET NAME; Add Notes; Participants + Manage; Club tags (All) "Members of your club will automatically be invited and notified."; CREATE. (Not created.)
- **CREATE COMPETITION**: intro (REGISTRATION / DRAWING) → form: Club (Change / Remove club), SPORT, DETAILS (Choose venue; Approximate starting time "You can start your competition anytime once there are enough confirmed teams and players."), TIMELINE R Registration open (edit) / E Early bird deadline (optional) / C Registration deadline / D Duration, Level restrictions, Player restrictions, Participant type (sheet: Team / Single player; Max number of teams 8; players per team Min 2 / Max 5), Competition fee, Privacy (Public), Competition name. (Not created.)

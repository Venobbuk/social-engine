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

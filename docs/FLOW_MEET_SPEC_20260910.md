# MEET FLOW — Reclub's flow, mapped, and ours (better) — 2026-09-10

Contract loaded — hook armed: yes · integrity: v6@379dba191765 OK
Status: **L1 draft for operator sign-off** ("make it like the Reclub flow but better"). Sources for Reclub: their help centre (~45 of 60 articles read today), pickleball.reclub.co FAQ / for-organizers, seven public meet pages, four public club pages, App Store reviews (US/SG/PH/MY/HK). Proof level for Reclub facts: public pages fetched today. Ours: what runs on social.silkvo.com today (L5) vs what this spec builds.

---

## 1. Reclub's flow, exactly (what a player and a host go through)

**Player:** install app (mobile only, web is read-only) → profile (name, sports, community) → connect DUPR → Discover (map ~10 km, filters: community, time, date, distance, sport, skill, friends-only) → Meet sheet (Details / Participants / Matches / Payment / Kudos / chat) → **Request to join** → state `Requested` → `Confirmed` or `Waitlisted` (auto-approve on/off; host may hold you waitlisted "for payment verification" or "skill check") → **pay off-platform** (host's bank / PayMe / GCash pasted as text; screenshot receipt, and only paying Supporters can attach it in-app, others paste into chat) → host tags you `Paid` and `Checked-in` → play → scores by host/ref (players only if toggled) → host marks Finished → **Kudos** (effort/improvement/skill) → Street Cred leaderboard → host submits to **DUPR** (only matches where every player is DUPR-linked; reserves make a match ineligible) → rating back in ≤24 h.

**Host:** create club (one sport, one location, 6-char code) → sync DUPR club → club → Activities → + → one-off / **recurring (weekly only)** / competition → fields: title, date, start, duration, location (search or add), cost "per player $X" (single number, no currency), capacity, skill as **free text**, details free text (this is where hosts write their payment, cancellation and no-show rules by hand), visibility (public / private / invite-only / club-only), auto-approve toggle, allow-players-to-score toggle → recurring engine auto-invites members weekly → Participants: approve, sort by skill, court assignment, mark paid / checked-in, add "reserves" (people without the app) → Matches: generate (singles / rotating partners / fixed pairs / Social Ladder / Mexicano; ≤32 players, ≤8 courts) → scores → Finished → DUPR Manager → submit.

**Public web meet page, field order:** title → date/time → duration → venue + map link → "Per Player $X" → details text → hosted by → club + recurrence → Confirmed · N / Waitlisted · N / Requested · N → status badge → **"Open app"**. No join from the web, no capacity counter, no currency, no skill field.

**Where it is weak (their own words and their users'):** no payments ("Reclub is not a payment processor"), receipt features paywalled on both sides; `Waitlisted` overloaded to mean "pay now", hosts invent "ON HOLD" in prose; promotion-on-cancel documented inconsistently; no no-show or reliability system beyond a warning; no DUPR-range enforcement (skill is text, host eyeballs); recurrence weekly only; cancelled meets unrecoverable; discovery lumps districts; app crashes, ads, dead notifications, blank chats in reviews; support unanswered (two HK reviews); web is read-only.

---

## 2. Our flow (same shape, structured, and the money is real)

Everything below is ONE screen set on social.silkvo.com, usable from a shared WhatsApp link **without installing anything**, and identical inside the hkpl Android shell.

### Player
1. **Discover** — `/meets`: list + map, "this week / near me / my level / my clubs", each card = club logo · title · date · venue · **spots left** · price · level band · friends going. (Reclub: app only, no spots on web.)
2. **Meet page** — `/meets/<id>`: structured header (club, host, date/time/duration, venue with map, level band, price + currency, capacity + spots left, cancel policy as a field), roster with states, **Join** button. (Reclub: free text + "Open app".)
3. **Join** → state machine, automatic:
   - spots open → `Confirmed` (or `Requested` if host set approval)
   - full → `Waitlisted` with a **position** shown
   - priced meet → `Confirmed (pay by <deadline>)`; unpaid past deadline → auto-released to the next in waitlist (Reclub: hosts do this by hand and by threat)
   - a Confirmed cancels → first waitlisted is **promoted and notified** (push + in-app), always, no "auto-approve" ambiguity
   - **level gate is enforced**: if the meet says DUPR 3.0–3.8 and the member's linked rating is outside, Join becomes "Request" and the host sees the rating next to the request. (Reclub: eyeballing.)
4. **Pay** — v1: host's payment details shown structured (PayMe / FPS / bank), member taps "I've paid", host confirms; v2: **pyke** creates the booking and the member pays in-app; webhook flips to `Paid`. Refund and no-show rules are fields, so they are enforced, not typed.
5. **Day of** — check-in by the member (QR on the host's phone or a tap when within the venue window) or by the host.
6. **After** — scores (host, or players if allowed), round robin as today's hkpl code does, **DUPR submit** through hkpl's existing pipeline (hkpl already syncs 2,190 DUPR ids; Reclub needs every player to connect manually), kudos, and a **reliability score** (attended / confirmed, no-shows, late cancels) shown on the profile and used by hosts.

### Host
1. **Create meet** from a club: title, date, start, duration, venue (from hkpl's 60 geocoded venues, or free), capacity, level band (min–max DUPR), price + currency + mode (fixed per head / cost-split), pay-by deadline, visibility (public / club / invite), approval (auto / manual), guests allowed (0–2 per member, counted against capacity), recurrence (**weekly, bi-weekly, monthly, custom days**), cancel window, notes.
2. **Roster** — states `Requested · Confirmed · Waitlisted(n) · Paid · Checked-in · No-show · Cancelled`; one tap to approve, mark paid, check in, promote, remove; export; message-all; sort by rating.
3. **Automation** — recurring meets auto-post and **auto-invite last time's attendees first**, then the club; reminders at T-24h and T-2h; auto-release unpaid; auto-promote waitlist.
4. **Games** — schedule generator (courts × rounds), score entry, DUPR submit (hkpl pipeline), session recap card to share.
5. **Insights** — fill rate, no-show rate, revenue per meet.

### What already runs today (L5) vs what this spec builds
| | today on social.silkvo.com | built by this spec |
|---|---|---|
| Clubs with logos, feed, follow, reactions, replies, chat, profiles | ✅ stock Misskey, seeded with 10 HKPL clubs | theming to HKPL |
| Meet as a structured object with capacity / states / waitlist / level gate / price | ✗ (meets are posts today) | **events module** in the fork: tables `event`, `rsvp`; API; pages `/meets`, `/meets/:id`, host roster; notifications |
| Discovery list + map | ✗ | `/meets` with hkpl venues |
| Pay | ✗ | v1 manual-confirm fields; v2 pyke seam (spec §6 P1) |
| Reliability score, check-in, auto-release, promotion | ✗ | in the module |
| Round robin, scores, DUPR submit | exists in hkpl (OpenPlayGame, SocialGame) | adapter call into hkpl in phase 1b |

---

## 3. Build plan (the events module, on the fork)

Backend (Misskey NestJS style, new module `packages/backend/src/server/api/endpoints/meets/*` + entities `MiMeet`, `MiMeetRsvp`, migration): endpoints `meets/create|update|cancel|show|list|join|leave|approve|mark-paid|check-in|promote|roster|ics`; a scheduler job for pay-by deadlines, reminders and recurrence; notifications via Misskey's existing notification + push; `note` auto-posted into the club channel on create (so the feed stays alive). Frontend (Misskey Vue client): pages `/meets` (list + map), `/meets/:id` (card + roster + Join), host `/meets/:id/manage`, club tab "Meets"; a public server-rendered `/m/<id>` for shared links. Probes: `meet-join-waitlist` (capacity 2, third joins → waitlisted pos 1 → first cancels → promoted + notification row exists), `meet-level-gate`, `meet-pay-deadline` (clock advance → auto-release), `meet-recurrence` (next instance created).

Order: (1) module + probes on the dev loop, (2) seed real-looking meets into the 10 demo clubs, (3) real-cursor walk on phone, (4) hkpl SSO adapter so real members log in, (5) pyke pay seam.

Estimate (L0): module + pages + probes ≈ 4–6 working days; hkpl SSO 1–2 days; pyke seam depends on pyke booking readiness.

---

## 4. Decisions — ANSWERED by the operator 2026-09-10
1. Go: **yes** ("1 yes, i ask u to find the best fit" — best fit = build inside the Misskey fork, see docs/MEET_MODULE_PLAN_20260910.md).
2. Price mode default: **free** ("free for now first"); fee types None/Free/Per head/Auto-split stay available per meet, default None.
3. Level gate: **hard minimum** ("yes"), **no maximum by default** ("we allow higher DUPR player to play"); host may set a maximum per meet; gate modes Guidance/AutoApprove/Strict exist, default Strict on the minimum only.
4. Guests per member: **1, counted** ("yes, is just a setting we can set later") — a club/meet setting.

SIGN-OFF (meet flow): yes — 2026-09-10, operator answers quoted above.

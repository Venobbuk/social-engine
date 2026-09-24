# GripBat — GLOBAL CONTRACT (GLOBAL-CONTRACT-V1, 2026-09-19)
*GLOBAL-CONTRACT-V2 (2026-09-23): G2 extended (brand beyond site pages), G11 extended (reuse hkpl too), G15 product
decisions, G16 verification traps. Parallel-lane mechanics and deploy/infra traps live in `/root/AGENT_RULES.md`;
the incidents behind these rules are in `contract-kit/LESSONS_2026-09-21_23.md`.*

Rules that hold on **every** GripBat screen: the site pack (`/`, `/how.html`, `/depth.html` and the tester pages), the
Taro app (`/app/…`, every route in `src/app.config.ts`), the engine UI (Misskey fork: `/about`, `/explore`, …) and the
back office (the hkpl management surfaces nginx proxies on the UAT host). Every agent that builds or changes a GripBat
screen reads this first. A change that breaks one rule is not finished, whatever else it fixes.

**The check:** `bash /root/gen/browser-slot.sh node /root/social-engine/probes/global-contract.probe.cjs` on kaka
(always through the box's browser budget — one Chrome, 4 tabs; hkpl-app was OOM-killed when checks ran unbudgeted). It **enumerates** the surfaces
itself (never a hand-typed page list), runs every app route × role × language at 412 px (UAT: anonymous, player, host,
tenant admin from `/root/uat-personas.json`; LIVE: anonymous only, read-only), every site / engine / back-office page ×
language at 412 px as anonymous and tenant admin (the same document for every role), adds 768 and 1280 px for
anonymous (site pages: all languages at both widths; other surfaces: one sampled width + language each), retries each
failing render once in a fresh browser, and writes `probes/global-contract.verdict.json` with a per-rule family count
(detail per render: `probes/global-contract.detail.json`, screenshots of failing renders: `/root/walk/gc/`).
Pass = zero violations in every family. Quick loop while fixing: `ONLY=site HOSTS=uat QUICK=1 node …`.

**Why this exists:** the operator kept finding site-wide problems page-by-page checks missed (report button missing
on 7 pages, 抓拍 over-emphasised, stale "4-minute" labels, captions overflowing). Root causes: checks built from our
own list; per-page copies of shared things; hand-picked samples; global rules never written down. So: rules are
written here, the probe enumerates, and every shared thing has ONE implementation.

## Surfaces (how the probe finds them)
| kind | enumeration source |
|---|---|
| site | every `*.html` in `/var/www/boyau-uat-app/uat/` + every `location = /x.html` (and `= /`) in the two nginx confs |
| app | every `'pages/…/index'` in `/root/hkpl-taro-branch/src/app.config.ts`, on UAT and LIVE |
| engine | links crawled from `/about` and `/explore` (one per URL shape, cap 30) + `/admin` on LIVE |
| back office | the alternatives of the nginx management regex `location ~ ^/(admin|activity-|…)` (prefixes expanded from `hkpl-server/public/*.html`) |
| roles | `/root/uat-personas.json` (QA door sign-in, no clicks) + anonymous |

## The rules

**G1 — exactly one report button.** Every screen shows exactly one visible report button: `.hkpl-bug-fab` on site,
engine and back-office pages (injected by nginx `# BUG-FAB-GLOBAL` `sub_filter '</body>'`; a page never links the
widget itself), `.fb-fab` (the app's own FeedbackWidget) inside `/app/`. Never zero, never two.

**G2 — brand.** GripBat is the brand.
- EN: "抓拍" never appears in visible text, `<title>`, `<meta>` content, or `alt` / `aria-label` / `title` / `placeholder`.
- 繁 / 简: "抓拍" appears only as a small secondary tag beside "GripBat": font-size ≤ 20 px, never the first word of a
  heading or of `<title>`, and never standing alone as the brand name in running copy (write "GripBat", e.g.
  "我的 GripBat", "GripBat 帳戶").
- No "silkvo" in visible text on site pages (addresses in the URL bar / `href` are fine). **Allowed, listed
  exception:** the tester pages that show the sandbox address and tester logins — `/qa.html`, `/test-plan.html`,
  `/fixed.html`, `/tutorial.html` (step 1: "Open uat.social.silkvo.com"), `/uat/parity.html`, `/sandbox-gate.html`
  (probe constant `SILKVO_ALLOWED_SITE`).
- The product name in the app is `appName()` = "GripBat" in every language (`src/lib/config.ts`); translations write
  "GripBat" for the brand, never 抓拍. The tenant record's display name must not lead with 抓拍 either.
- **G2 addendum (V2) — the brand reaches everything a user sees or sends, not only site pages.** Measured leaks,
  2026-09-20..22: every share link + share card + share text printed `social.silkvo.com` (11 sites); the app's
  `<title>` was "Hong Kong Pickleball League" (browser tab, bookmark, home-screen name, link previews); the engine's
  own `meta` was "silkvo social" / maintainer "silkvo" / `info@hkpl.com.hk`; help pages said `hello@silkvo.com`.
  So: (a) links and cards use `publicOrigin()` / `publicHost()` from `src/lib/config.ts` — the visitor's own origin,
  never a hardcoded host; (b) the GripBat build rebrands the shared app shell (`BRAND-SHELL-V1` in
  `tools/deploy-boyau.sh`, which fails the deploy if the title isn't GripBat); (c) the engine `meta` is GripBat /
  `info@gripbat.com`; (d) the contact address everywhere is `info@gripbat.com`; (e) "Hong Kong Pickleball League"
  and "silkvo" never appear on a GripBat surface. The tester pages listed above as silkvo exceptions (qa, test-plan,
  fixed, parity, depth) are **not served on the brand domains at all** (nginx 404s them) — they exist only on the
  raw UAT webroot for the operator and us.

**G3 — LIVE shows no tester chrome.** On `social.silkvo.com`: no UAT banner (`#uat-banner`), no QA role switcher
(`#qa-switch-bar`), no league chat bubble (`#hkpl-chat-fab`), no "UAT" / "sandbox" / 沙盒 / 測試環境 wording.
(nginx on LIVE answers `/js/uat-banner.js`, `/js/qa-switch-bar.js`, `/js/public-chat-widget.js` with an empty script.)

**G4 — no errors.** No page errors, no console errors, no failed same-origin request (status ≥ 400 or a network
failure other than an abort). **Expected, listed:** anonymous 401 on "who am I" / token-only calls (`/api/v1/auth/me`,
`/api/v1/social/me`, `/api/v1/me`, `/api/v1/push/`, `/api/v1/notifications`, `/api/i`, `/api/notes/…` …); 404 on an
optional `/fonts/` or `/cdn/` asset the page falls back from; 401/403 on `/api/v1/admin/…` for a non-admin (the page
shows its no-access state). Anything else is a violation (probe constant `EXPECTED_FAIL`).

**G5 — nothing overflows.** No horizontal scroll at 412, 768 and 1280 px (document, body and the app's
`.sh-app-body`). No visible text pushed off-screen or cut by an `overflow:hidden` box without an ellipsis
(horizontal scrollers such as chip rows and carousels are exempt — that is their job).

**G6 — all three languages.** Every visible string is translated in en / 繁 / 简: no raw i18n key on screen
(`nav.try`, `gbnav_how`, a `data-i` element showing its own key); no English sentence on a 繁/简 screen.
**Allow-list:** the brand and proper nouns (GripBat, DUPR, HKPL, Reclub, WhatsApp, WeChat, Google, Apple …), units and
codes (km, HK$, ID, API, URL, QA, UAT), names (Title Case lines: clubs, venues, meets, people), user content (feed,
chat, inbox, notifications, player, reports, admin lists, engine notes), and text marked `lang="en"`,
`translate="no"`, `.notranslate`, `<code>`, `<pre>`, `<kbd>`, form fields (probe constants `EN_ALLOW`,
`USER_CONTENT_ROUTES`). Technical evidence (file paths, endpoints) and quoted English data (testers' bug titles) are
marked `lang="en" translate="no"` at the source. One language decision per site page: `/uat/nav.js` publishes
`window.GB_LANG` (a shared link's `?lang=` wins, then the stored choice `gb_uat_lang`, then the browser); `i18n.js` and
the qa / test-plan / fixed scripts read it — no page decides the language again. 简 has its own rows (`*_cn`), never
the 繁 text.

**G7 — one shared site header.** Every site page shows exactly one header — logo → `/`, How it works → `/how.html`,
Try it → `/app/` — and every page except `/` exactly one breadcrumb. (G7-NO-DEPTH, 2026-09-24: the In depth link
is gone — operator: internal/status pages are not for testers, and `/depth.html` is 404 on the brand domains per the
G2 addendum.) Both are rendered by
`/uat/nav.js` from ONE registry (styles `/uat/nav.css`); a page only declares itself:
`<script src="/uat/nav.js" data-page="demo" data-langui="langbar"></script>`. No page carries its own header or
breadcrumb markup (the probe requires `data-gbnav` / `data-gbcrumb`, which only nav.js sets). A new site page = one
registry row in nav.js + that one script tag.

**G8 — reachable, no dead links.** Every site page is reachable from `/` within the three layers
(GripBat › How it works / In depth › page); no orphan pages (a retired page is a redirect stub, not a stray file).
Every page answers < 400 and every link found on any rendered screen answers < 400 (GET, anonymous; `/api/`, QA
sign-in, logout and DUPR links are not fetched). **Listed:** an external host answering 401 / 403 / 429 to a script
is bot protection, not a dead link; `/.well-known/host-meta|nodeinfo` answer 403 by design (no federation) although
the engine's stock About page lists them. A non-HTML document (PDF, image) is judged by its status only.

**G4 corollary — no call without its id.** A route opened without its `?id=` shows its empty state quietly: the one
engine door `sapi()` (`src/lib/social.ts`, `REQUIRED_ID`) refuses a show/list call whose id is missing (status 400
`missing_id`, no network), instead of every page sending an empty id to the engine.

**G9 — one owner per shared thing (source rule, enforced by the app deploy gates).** A shared UI part is implemented
once and reused: `tools/ui-guard.cjs` (no page re-declares a kit part), `tools/class-owner-guard.cjs` (one class, one
owner), `tools/inner-component-guard.cjs` (no component defined inside another), `tools/preset-drift.cjs` (presets ==
the server's), `tools/gen-theme-css.cjs` (every visual declaration in a theme role), `tools/i18n-coverage.cjs` (every
keyed string has a zh row), `tsc`. `tools/deploy-boyau.sh` refuses to publish when any fails. Site pack: header /
breadcrumb in `nav.js`, language switching in `i18n.js`, report button from nginx — never copied into a page.

**G10 — the pack stays in one place.** `/var/www/boyau-uat-app/uat/` and `/root/hkpl-taro-branch/src/assets/boyau/uat/`
are byte-identical (except `people.json`, written on the box by `/root/uat-people.cjs`). Edit the repo copy, then
copy (or deploy); `diff -rq` must print nothing else.

## Process rules (how the contract is kept)
1. Measure → fix every member of a family at its root (the one shared implementation) → re-measure. No per-instance patch.
2. A new rule goes here first, then into the probe; a new surface kind goes into the probe's enumeration, not into a list.
3. Reports carry proof levels (L2 source … L6 observed) and the probe's verdict file; no "done" without it.

## G11 — Adopt Misskey first (operator, 2026-09-20)
The engine is a Misskey fork. Before adding ANY engine endpoint, table or service, check Misskey's native capability (this fork's packages/backend/src/server/api/endpoints/**, core services, entities, and upstream behaviour). Order of preference: (1) wire the app to the native endpoint; (2) EXTEND native (a guard/param on the native path); (3) NEW only for GripBat concepts Misskey lacks (meets, club gates/tiers, competitions, GripBat rating, claims). Every engine change states which of the three it is, with file:line of the native code checked. A parallel endpoint duplicating a native capability is a contract violation.

**G11 addendum (V2, operator 2026-09-23): reuse hkpl too, and record the search.** "If you need new code, check
Misskey AND hkpl — reuse as much as we can rather than invent it." hkpl (`/root/hkpl-server`) already holds DUPR
partner integration, auth/SSO, teams, divisions, fixtures, scoring, standings, venues and i18n tables — check it
before building any tournament, scoring, standings or venue piece. Our own app has shared components and helpers
(`src/components/ui.tsx`, `lib/person`, `lib/social`, `lib/config`) — check those before writing a new one. Every
verdict tags each new piece **REUSED** (file:line of what was used) / **EXTENDED** / **NEW**; a NEW with no record of
what was searched first is a failed check. The model that worked: a coaching lesson is a meet with a
`coachScheduleId`, booked through Misskey's native RSVP/capacity/waitlist — not a parallel lesson system.

## G12 — Checks prove function, not clicks (operator, 2026-09-20)
Blind click-sweeps produce false failures and miss real ones (2026-09-20: 12 of 22 GripBat failures were probe bugs — case-sensitive matching vs uppercase CSS, selectors that never match Taro markup, stale ids, a crash that aborted the run). Required instead:
1. CONTROLS DECLARE THEMSELVES: every interactive element carries a role and an accessible name through the shared kit component; a build guard fails when one does not. Checks enumerate controls from that inventory — never by guessing selectors.
2. TRACE, DON'T CLICK: follow each control to the request it sends; call that endpoint directly per permission class and assert status, response shape, file type for downloads, and the DB row it writes. That is the proof of function.
3. LANGUAGES ARE TEXT: render once per language and compare text only (missing keys, foreign leftovers, raw keys, date/number format). Never re-click a flow per language.
4. CLICK ONLY STATE CHANGES: a handful of real end-to-end flows (join, score, approve, pay) with the DB checked after.
5. EVERY CHECK SELF-TESTS: plant the faults it must catch (a control with no role, an action whose endpoint 404s, a permission that should refuse) and fail if it misses them.
6. ROLES: one account per permission class, plus a direct call from a role that must be refused.

## G13 — Probe hygiene (operator saw our litter, 2026-09-20)
Checks create data; testers must never see it. Required:
1. Every fixture a check creates is prefixed `[probe] ` and carries the probe id, on every entity it touches (clubs, meets, competitions, chats, posts, users, reports).
2. Each check cleans up in a `finally` — including after a crash or a timeout — and a run that cannot clean up says so loudly in its verdict.
3. A sweeper runs at the end of every check run AND in the nightly reset: archive/cancel then unfollow/unlink anything matching the probe prefix, so no leftover is reachable from a tester's screens (My clubs, Home rails, Discover, Inbox, admin queues).
4. Probe-filed reports/messages carry the probe header/tag so they never land in a human inbox.
5. The proof that hygiene works is a query counting reachable probe artifacts = 0, run as part of the suite — not a promise in a report.


## G14 — Coverage is DERIVED, and an unowned surface is a failure (operator, 2026-09-20)
"Writing the lesson down does not remove the gap." Every gap so far came from the same root: coverage was a
HAND-WRITTEN LIST (lane A owns these pages), so a surface nobody typed was never checked and nobody missed it.
So coverage is now derived and enforced:

1. **The ledger derives the surface from the code** — `tools/coverage-ledger.cjs` ->
   `probes/coverage-ledger.json`: app routes (`src/app.config.ts`) x roles (`/root/uat-personas.json`) x states read
   from each page; every control (from `probes/control-inventory.json` once the control lane lands, an onClick scan
   until then); every engine endpoint (`server/api/endpoint-list.ts` + each endpoint's `meta`) with the app call
   sites that use it; every hkpl endpoint the app calls; jobs, crons, migrations; every outbound notification (the
   `notify()` call sites) plus push and email; every site page (pack dir + the nginx `location =` aliases).
   Each item carries `id · kind · scope · where (file:line) · the facets that must be checked · who claims them`.
   A new surface appears in the ledger the moment it appears in the code. No list to forget.
2. **A check CLAIMS an item.** A probe declares `// @claims <kind> <glob> :: <checkId> [:: <facet>]` in its own
   source; `probes/invariants.probe.cjs` re-writes the claims it actually exercised into its verdict.
3. **`probes/invariants.probe.cjs` applies six invariants to EVERY item, never to a curated list** — I1 page agrees
   with itself (delegated to page-agreement), I2 every control traces to a request that answers for a role allowed to
   use it and is refused server-side for one that is not (endpoints called directly, per permission class), I3 no page
   or console errors and no horizontal scroll at 412/768/1280 (delegated to this probe's `coverage.json`), I4 every
   endpoint the app calls exists and answers, and every endpoint the engine exposes is called or listed in
   `probes/unused-endpoints.json`, I5 every notification reaches the other person in their language with a working
   link (delegated to backend-delivery), I6 reachable `[probe]` artifacts = 0.
4. **THE RAIL: the suite FAILS when any GripBat-scope item has a facet no check claims.** An unowned surface is a
   failure, not a silence. "We checked 263/263" is not a coverage claim; `coverage.unclaimed` is.
5. **Every mechanism self-tests** (G12.5): `probes/invariants-selftest.sh` plants an unchecked route, a control whose
   endpoint 404s and an endpoint that answers 200 for a role that must be refused — in COPIES of the trees — and
   fails if the suite misses any of the three.


## G15 — Product decisions (operator-signed; do not re-litigate)
These are settled. A change that contradicts one is not finished, however well it works.

**G15.0 — How every NEW product decision is made (operator, 2026-09-23): don't ask; beat Reclub.** "You learned from
Reclub — just be better than it. Research, learn their code, find the best way to beat it; enhance it to be more
user-friendly, or closer to what the user needs." So when a product choice comes up:
1. **Reclub is the floor — its function AND its anatomy** (screens, flow, tab bar, row/chip layout; decoded app
   `D:\Downloads\reclub_forensic\`, 345 screens, `probes/reclub-triage.json`). Never ship less, and never make a flow
   *simpler to build* by dropping a Reclub function because it is hard or touches a lot (operator 2026-09-20:
   "follow the Reclub flow, only more advanced — do not make it simpler to avoid our own fix"). Only the skin is
   ours (colours, logo).
2. **Enhance above the floor only for a real user need, researched** — Reclub plus the category leaders for that
   job (e.g. Calendly/Mindbody/Playtomic for booking). "Better" means easier *for the user*, or closer to what the
   host who needs players / the player who needs a game actually needs — never easier for us. NOT allowed:
   speculative "wouldn't it be nice" inventions that replace Reclub behaviour with no measured need (the operator
   corrected this five times; dropped 2026-09-12: reactions instead of kudos, a meet poll, an Insights tab, a venue
   utilisation dashboard, a custom waitlist rank). Our real leads came from need: DUPR partner, GripBat rating,
   chemistry, verified venues, coaching booking.
3. **Reuse before inventing** (G11) and **stay inside the settled decisions below** — an "enhancement" never overrides
   them (privacy, DUPR partner-only, no gateway, honest marketing).
4. **Decide, build, and record the reason in the verdict** ("chose X over Reclub's Y because …"). Ask the operator only
   when a choice is irreversible, spends real money, or touches real users' data or relationships in a way they would
   notice — and even then, bring a recommendation, not an open question.

1. **DUPR only through hkpl's Partner API.** GripBat never triggers Richard's scrape; boyau tenants are pinned
   partner-only (`hkpl-server/lib/dupr/partner-only.js`, `route-richard.js canWrite()` = false). There is exactly one
   door: `POST /api/v1/social/dupr/submit`. Re-verify the pinning before and after any DUPR change.
2. **Production = UAT, feature for feature (PROD-PARITY-V1, operator 2026-09-23).** No feature is held dark on
   production; tournament→DUPR and coaching run on both. DUPR stays **reused from hkpl** (operator asked port-vs-reuse;
   reuse chosen: one writer, one set of partner credentials, one tested queue/retry/dedupe/sandbox guard — a second
   writer could double-submit). The environments differ only in WHICH tenant calls: a prod submit is real, a UAT
   submit is caged (engine sandbox mode on `web-uat` + hkpl resolving the caller's tenant so `boyau-uat` hits the
   existing `SANDBOX_TENANT_IDS` guard). Until both cages are proven, never press a real DUPR submit on UAT.
3. **Negative partner chemistry is private to the two players.** Positive chemistry may be shown. Every door that
   exposes or derives chemistry applies this (gb-edge, gb-pairs, gb-fair, friend suggestions) — dropped *before*
   ranking so it can't leak through sort order.
   **G15.3 addendum (2026-09-24, orchestrator decision under G15.0; found by lane sec-chemistry):** the private part must
   not be derivable either. (a) Per-match rating before/after and rating deltas are shown only to the player
   themselves — from public results plus per-match ratings anyone could compute a pair's chemistry (Reclub's match
   summary shows no per-match ratings). (b) To anyone other than the pair, positive chemistry is shown only when it is
   clear — at least 3 matches together AND at least +5 percentage points above expected; anything else reads neutral,
   so "not shown as positive" never implies "negative". (c) Private-meet matches never feed any figure a stranger sees
   (`MatchHistory.logVisible`), including Edge rating / form / clutch / upsets. One rule: `GbRating.chemFor`.
4. **A warning's author is anonymous to the person warned.** Endorsements and feedback stay attributed.
5. **Private means private.** A private club/meet — its existence, name, members, counts, schedule, location — is
   readable only by owner, admins, members, and invite-token holders (`ClubService.mayReadClub`). Every sibling door
   that reads a club goes through that one guard.
6. **No payment gateway in v1.** Payment = the host/coach's own payment info shown to members, the player marks paid
   and uploads proof, the host confirms. Collecting money on behalf (a gateway) is an optional convenience later,
   never compulsory.
7. **Coaching:** any club owner/admin may post lessons — GripBat never verifies or judges credentials; a coach
   advertises their own qualifications in a free-text field. Booking = single, weekly series (with skip-a-week), or a
   pack; price is locked at booking and never re-priced; a group-slot student is never surprised by the private rate
   (the coach re-confirms first); signed-out visitors may browse lessons. `COACHING_V1` is a whole-feature kill-switch
   for rollout, not a per-user gate.
8. **A friendship is a mutual follow, derived at read time.** A one-way follow is never labelled a friendship; it may
   appear as a pending request. Suggestions carry their evidence ("played together 4 times").
9. **Domains:** `gripbat.com` and `uat.gripbat.com` open on the app; the marketing demo lives at
   `uat.gripbat.com/demo.html`; both are proxies over `social.silkvo.com` / `uat.social.silkvo.com` with Host forced to
   the canonical name (hkpl resolves the tenant by Host), which stay reachable.
10. **Marketing claims only what is live today.** Never advertise a capability the tester can't use (the demo lane
    refused to headline coaching booking before it existed — that is the standard). No "tonight's build" changelogs on
    user-facing pages.
11. **Terms/privacy:** plain and generic, GripBat is the only name on them, contact `info@gripbat.com`, no invented
    company entity or address.
12. **Design:** Reclub's function, GripBat's own design. No dark theme. Apple/Facebook sign-in later. Club follow and
    club join are different things (`W1_TIERS_V1`). Meet photos follow the meet's audience. Club auto-invite off.
13. **Never let a client-settable value decide something security-relevant.** Any request header
    (`X-Original-Host`, `X-Forwarded-*`, `Host`), query param or body field that decides where a sign-in link, token,
    redirect or email points must be checked against a trusted server-side list first — for hosts, the tenant's
    proxy-host list `lib/platform-config.getProxyHosts` (the one the CSRF guard already uses). Measured 2026-09-23 on
    production: `curl -H 'X-Original-Host: evil.example' https://hkpl.com.hk/` was honoured; the staged magic-link fix
    would have emailed a working sign-in token on any host an attacker names — account takeover. Caught before ship.
14. **hkpl is the production league system.** Restarts happen only in the 03:30–06:00 HKT window through
    `/root/gen/hkpl-batch.sh` (it refuses outside the window without `FORCE=1`, and FORCE is the operator's call).
15. **GripBat owns its accounts (operator 2026-09-23; SUPERSEDES the 2026-09-17 shared-identity decision).** Sign-up,
    sign-in, password reset, email change, username and profile name live in the ENGINE (Misskey native auth — G11, reuse
    it). hkpl is no longer GripBat's identity provider; it is a server-to-server SERVICE for DUPR only (submit/status, plus
    a DUPR-connect door for a GripBat user). Nothing a GripBat user sees depends on an hkpl account. Existing engine users
    keep their rows and get native logins; nobody uses prod yet, so no public migration is owed. A "link your league
    account" button may come later as an OPTIONAL link — never a requirement. Usernames are chosen by the user and never
    derived from an email address.

## G16 — Verification traps (each one fooled a check this week; every probe must avoid all of them)
G12 says checks prove function. These are the specific ways a check lied to us, 2026-09-20..23 — five instruments
read green while blind. A verdict that falls into one of these is not evidence.
1. **Plant the fault first, every time.** Before trusting a check, make it fail on purpose, then pass. Blind instances:
   a "private" fixture club whose insert failed silently, so the run read as a pass; a litter counter that never
   queried the meet table; a deploy check grepping a path that doesn't exist in the image; a permission suite that
   read the wrong JSON key and reported "0 assertions, 0 leaks"; a `sed` range that stopped at the wrong `done`, so the
   guard under test was never in the block.
2. **Probe endpoints by their REAL registered name.** Read `packages/backend/src/server/api/endpoint-list.ts` first.
   A 404 on a guessed path proves nothing. Four "missing" or "broken" reports this week were built features probed
   under the wrong name (`coaches/schedules/mine`, `competitions/matches/dupr-submit`, `coaching/coaches/search`).
3. **A 200 is not the right page.** The production engine answers unknown paths with the Misskey app shell — a 200
   titled "silkvo social". Assert the `<title>` / content / `content-type`, never the status alone.
4. **Read the column types before writing a SQL fixture** (`information_schema.columns`). `club_setting."adminIds"`
   is `varchar[]`, not jsonb — the same wrong assumption broke a fixture AND a production guard.
5. **Assert the fixture is real before measuring against it** (read the row back; confirm the private club is private).
6. **A counter must reject a wrong-shaped input.** An empty or wrong-typed result must fail loudly, never sum to zero.
7. **Browser automation can misfire on Taro buttons.** Confirm a "dead button" with a real DOM click and a network
   capture before reporting it — "Join club does nothing" was the MCP click tool, not the app.
8. **Deploy markers come from code, not comments** — the bundler strips comments. Confirm the marker is in a local
   build before trusting a grep of the image.
9. **Stale gap lists deflate when re-checked.** Verify every item against the current build before building
   (tester-visible tier went 53 → 6 → 1; a 291 "missing" figure was mostly already built).
10. **Say what a family number means:** `found` = sites sharing the root cause, `fixed` = edits made. 17/1 means one
    shared fix served 17 screens, not that 16 were skipped.

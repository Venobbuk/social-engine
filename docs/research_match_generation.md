# Match generation for the social engine — open-source landscape, ranked shortlist, recommended combination, pseudo-code

Date: 2026-09-10. No server touched. Method: WebSearch/WebFetch (page content summarised by the fetch tool = **L1-web**, I did not read raw source unless marked), npm registry JSON parsed by me with `curl`+`node` (**L2-npm**), GitHub REST API JSON via fetch (**L1-api**), the decoded Reclub bundle in this folder read by me (**L2-local**), and a whist-table checker/search I wrote and ran (`whist_check.js`, output `whist_check.out.txt`, **L5-local**). Every fact carries a URL; the level is the weakest link.

---

## 0. Ground truth first: what Reclub's generator actually is (L2-local, decoded bundle)

The task brief lists 11 "schemes". The decoded app has **four** generator schemes plus per-sport display names; several brief items are labels, scoring modes or dialogs, not schemes. Source: `spec_meets.md` L333–350, L539, L567, L625; `spec_competition_dupr.md` L125, L128, L178, L208, L806–829; `domain_meets.md` L184; `i18n_en.json`; `help/1769552961-match-generator.md` (fetched 2026-09-10 from https://help.reclub.co/hc/reclub-help/articles/1769552961-match-generator).

| Brief term | What it is in the bundle | Evidence |
|---|---|---|
| Round Robin / Singles | scheme `SINGLES` ("Each player will play against each other in successive rounds in a round robin format."), ≤ 12 players, full RR = n−1 rounds | `spec_meets.md` L335, L341; `MeetMatchGeneratorScheme` L539 |
| Rotating Partners / Scramble / Americano | scheme `ROTATING_PARTNERS` ("Each player will be paired with every other player in successive rounds…"); padel label = "Americano"; "Scramble" is the label used in the uneven warning ("mathematically impossible to generate an even scramble for {{num}} players. Two players will have [+/-] one match"); ≤ 32 | `spec_meets.md` L335, L341, L344; `i18n_en.json` |
| Preset teams / Team Americano | scheme `PRESET_TEAMS` (round robin over teams from the participants tab); padel label "Team Americano"; ≤ 12 teams | `spec_meets.md` L335, L341 |
| Ladder Run / Mexicano / Team Mexicano / "Social Ladder" | scheme `LADDER_RUN` ("order of who you play against … created depending on the results of the other matches"); padel label "Mexicano"; help calls it "Social ladder / Team Mexicano"; min 4 players; rounds generated one at a time ("Generate Next Round"); **continuous play**: next match generated for empty courts as soon as eligible players exist; `rankingCriteria` ∈ `MATCHES_WON, POINTS_WON, WIN_PCT, POINTS_PCT`; toggle `prioritizeLeastMatches` | `spec_meets.md` L335–350, L539; help article above |
| Rally | not a scheme — a **scoring format** (Rally vs Sideout) | `help/1765844686-…sideout-and-rally-format.md` |
| Round & Court | not a scheme — the "Select Round & Court" placement dialog for custom matches (`select_round_court`, i18n key `ROUND_COURT`) | `domain_competition_dupr.md` L175; `domain_meets.md` L184 |
| Constraints | `POST /matches/generate {scheme, sublocations (court count), participantIds, teamIds, limitRounds, persist, rankingCriteria, prioritizeLeastMatches, totalSetPoints}`; `GET /meets/generator/stats {scheme, num_sublocations, num_participants}` | `spec_meets.md` L344, L625 |
| Total set points | padel-only; entering one side's score auto-fills the other; presets 16/21/24/32 (+ custom) | help article; `spec_competition_dupr.md` L526 |
| Competitions | `CompetitionDrawFormatType` = Single/Double/Triple RoundRobin, SingleElimination, DoubleElimination, Single/Double/Triple PoolPlay (pools → playoffs + consolation, `numGroups`, `numContinue` winners per pool, `thirdPlaceMatch`) | `spec_competition_dupr.md` L125, L806–808 |
| Standings | `CompetitionPointCalculationType` Win-Loss points / Win % / Sets Win % / Sets Won / Total scores; `CompetitionTiebreaker` = `h2h_wins, score_diff, h2h_diff, total_score, sets_won, win_pct, sets_win_pct` applied in `tiebreaker1..4` order; row fields `{points, wins, losses, draws, tiebreakerWins, tiebreakerLosses, h2hWins, scoreDiff, h2hDiff, winPct, setsWon, setsLoss, setsWinPct, totalScore}` | `spec_competition_dupr.md` L128, L178, L467–469, L835–836 |
| Swiss | **not found** anywhere in the decoded bundle (grep `swiss` → 0 hits in `spec_*`/`domain_*`/`i18n_en.json`) | this folder |
| "Manual seeding" | competitions: pool assignment (`Manage Pools`, `Randomize pools`, `Choose pool for {{teamName}}`); meets: manual player selection per court in custom matches | `i18n_en.json`; help article §1 |

Consequence for scope: the engine needs (a) round robin singles/teams, (b) rotating-partner doubles with court/round limits and fair sit-outs, (c) standings-driven next-round generation with a pluggable ranking criterion and continuous per-court generation, (d) pool play → playoffs/consolation/3rd place, single/double elimination, (e) a standings/tiebreaker calculator. Swiss is a nice-to-have (not in Reclub).

---

## 1. Ranked shortlist (all candidates)

Legend for the coverage columns: RR = round robin (singles/teams), ROT = rotating-partner doubles (individual standings), LAD = standings-driven next round (Mexicano/Ladder), POOL = pools→playoffs (+consolation/3rd), ELIM = single/double elimination, SWISS, STAND = standings/tiebreakers, COURT = court assignment / court count as constraint, SIT = fair sit-outs / prioritise fewest matches.

| # | Project | URL | Licence | Lang | Last push | Stars | Maintained? | RR | ROT | LAD | POOL | ELIM | SWISS | STAND | COURT | SIT | Tests | Port/integration effort |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | **brackets-manager.js** | https://github.com/Drarig29/brackets-manager.js/ | ISC (npm `brackets-manager@1.11.0`, L2-npm) / MIT per API (L1-api; discrepancy noted) | JS/TS | 2026-05-17 (L1-api) | 334 (L1-api) | yes (published 2026-05-17, L2-npm) | ✔ groups, simple/double | ✖ | ✖ | ✔ multi-stage, `groupCount`, `finalStandings(stageId, {rankingFormula, maxQualifiedParticipantsPerGroup})`, `consolationFinal` | ✔ SE/DE, `grandFinal none/simple/double`, BYEs, `balanceByes`, `skipFirstRound` | ✖ ("Swiss-system tournaments are not currently supported", L1-web) | partial: RR ranking formula only; elimination final standings | ✖ | ✖ | Mocha + GitHub Actions CI (L1-web README) | **Low** for competitions: bring-your-own `CrudInterface` storage (Prisma adapter exists: `brackets-prisma-db` mentioned in docs, L1-web) |
| 2 | **tods-competition-factory** (CourtHive) | https://github.com/CourtHive/tods-competition-factory · docs https://courthive.github.io/competition-factory/ | MIT (L2-npm, v6.38.0 published 2026-09-08) | TS | 2026-09-10 (L1-api) | 31 (L1-api) | yes, very active | ✔ ROUND_ROBIN groups | ✖ as a scheme (AD_HOC + DrawMatic "probabilistic pairing … skill-based matching and team boundary awareness", L1-web; individual-doubles rotation not documented) | partial: AD_HOC rounds generated one at a time (`generateAdHocRounds`, L1-web) | ✔ ROUND_ROBIN_WITH_PLAYOFF, PLAYOFF, CURTIS, FEED_IN_* consolation, OLYMPIC, COMPASS | ✔ SE, DE, LUCKY_DRAW | ✖ (not in the 19 draw types listed, L1-web) | ✔ ranking points, scoring formats | ✔ courts/venues scheduling (Garman + "Pro scheduling" grid, L1-web) | ✖ | 9,800+ Vitest tests, zero runtime deps (L1-web README) | **Medium–high**: TODS JSON document model is large; engine-first API. Best "reference implementation" for pool→playoff/consolation and court scheduling rather than a drop-in |
| 3 | **tournament-organizer** (slashinfty) | https://github.com/slashinfty/tournament-organizer · docs https://slashinfty.github.io/tournament-organizer/ | MIT, **but depends on `tournament-pairings` ^2.0.1 which is GPL-3.0-or-later** (L2-npm; package.json L1-web) | TS (ESM only) | 2025-12-22 (L1-api) | 57 (L1-api) | yes (v4.1.1 2025-12-22) | ✔ RR, double RR | ✖ | ✖ | ✔ stage-two playoffs (`advance {method: points/rank/all}`) | ✔ SE, DE, stepladder, consolation | ✔ (blossom) | ✔ 17 tiebreaks incl. Buchholz/Solkoff/SB/game-win% (L1-web) | ✖ | ✖ | **no `test` script in package.json** (L1-web) | Low API-wise (`Manager.createTournament`, `createPlayer`, `startTournament`, `nextRound`, `enterResult(id, p1Wins, p2Wins, draws)`, `getStandings()`), but **licence-blocked** for us (see §4) |
| 4 | **tournament-pairings** (slashinfty) | https://github.com/slashinfty/tournament-pairings | **GPL-3.0-or-later** (L2-npm v2.0.1, 2025-09-10) | TS (ESM) | 2025-09-10 (L1-api) | 29 (L1-api) | yes | ✔ Berger tables (`RoundRobin(players, startingRound, ordered)`) | ✖ | ✖ | ✖ | ✔ `SingleElimination(players, startingRound, consolation, ordered)`, `DoubleElimination` | ✔ `Swiss(players, round, rated, seating)` with `avoid`/byes (L1-web) | ✖ | ✖ | ✖ | mocha (L1-web) | Excluded by the spec's "MIT/Apache deps only" rule (memory `project_social_engine_spec_20260909`); algorithms are public knowledge — reimplement, don't copy |
| 5 | **@echecs/swiss** | https://github.com/echecsjs/swiss · npm `@echecs/swiss@5.0.0` | MIT (L2-npm, published 2026-05-27) | TS, zero deps | 208 commits (L1-web); pushed date unknown (API rate-limited) | 3 (L1-web) | yes (new 2026) | ✖ | ✖ | ✖ | ✖ | ✖ | ✔ FIDE Dutch/Dubov/Burstein/Lim/Double-Swiss/Team; `pair(players: {id, rating?}[], games: Game[][]) → {pairings, byes}` (L1-web) | ✖ (README shows no standings fn) | ✖ | ✖ | Vitest (L1-web) | **Low** if Swiss is wanted; chess-shaped (white/black) but sport-agnostic |
| 6 | **swiss-pairing** (dambrisco) | https://github.com/dambrisco/swiss-pairing | MIT (L2-npm v1.4.3, 2024-02-23); dep `edmonds-blossom` (MIT) | JS | 2026-02-14 (L1-api) | 12 (L1-api) | light | ✖ | ✖ | ✖ | ✖ | ✖ | ✔ `getMatchups(round, participants, matches)`, avoids rematches, byes to lowest | ✔ `getStandings` (wins, modified median) | ✖ | ✖ | test dir (L1-web) | Low; simpler than @echecs |
| 7 | **roundrobin** (tournament-js/clux) | https://github.com/tournament-js/roundrobin | MIT (L2-npm v2.0.0, 2021-06-24) | JS | 2022-03-30 (L1-api) | 80 (L1-api) | dormant | ✔ circle method `robin(n, [names]) → rounds[][pairs]` (L1-web) | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | tap + CI (L1-web) | Trivial; 30-line algorithm — reimplement |
| 8 | **tournament / duel / groupstage / tiebreaker** (tournament-js) | https://github.com/clux/tournament , https://github.com/clux/groupstage , https://github.com/clux/tiebreaker | MIT (L2-npm) | JS | 2017-09-06 (L1-api) | 65 (L1-api) | **abandoned** (last publish 2016) | ✔ | ✖ | ✖ | ✔ groupstage→duel chaining (`groupstage-tb-duel`) | ✔ duel SE/DE | ✖ | ✔ tiebreaker rounds | ✖ | ✖ | tap | Not worth adopting; design ideas only |
| 9 | **tournicano** (alimfeld) | https://github.com/alimfeld/tournicano · live https://alimfeld.github.io/tournicano/ | **no licence** (API `license: null`, package.json no field, L1-api/L1-web) → all rights reserved; dep `@graph-algorithm/maximum-matching` is **AGPL-3.0** (L2-npm) | TS (Mithril PWA) | 2026-09-02 (L1-api) | 3 | yes, 428 commits | ✖ | ✔ **the best algorithm found**: two-level maximum-weight matching (players→pairs, pairs→matches), weights = variety (freq×100 + recency×10 + saturation×1), performance (EQUAL / AVERAGE / MEXICANO = rank-diff 2), groups; `matching(players, spec, roundIdx, maxMatches, teams?) → [matches, paused]` (L1-web raw source) | ✔ Mexicano mode | ✖ | ✖ | ✖ | ✔ per-player points/win ratio/plus-minus | ✔ `maxMatches = courts` | ✔ `playRatio = matches/(pauses+matches+ε)` asc, tie → most-recent pause first (L1-web `Partitioning.ts`) | Vitest + simulation scenarios (`Tournament.scenarios.test.ts`, L1-web) | **Cannot lift code** (no licence, AGPL dep). Re-derive the design (§5) with an MIT blossom (`edmonds-blossom-fixed`, MIT, L2-npm) or a greedy/annealing optimiser |
| 10 | **Padel-Americano** (ptzimmerman) | https://github.com/ptzimmerman/Padel-Americano · live padelme.io | README says MIT, **no LICENSE file** (API `license: null`; top-level listing has no LICENSE, L1-api) | TS (React 19) | 2026-05-09 (L1-api) | 5 | light | ✖ | ✔ hard-coded whist tables 8/16, cyclic seed for 12, Berger fallback for other N; `generateAdditionalRound` greedy (partner repeat +10, opponent repeat +1, fewest-matches first); `optimizeCourtAssignments` permutes courts to minimise "same court as last round" | ✔ championship round 1st+3rd vs 2nd+4th | ✖ | ✖ | ✖ | ✔ total points → match wins → point diff | ✔ | ✔ (byes = most-played players) | none seen | Reference only; **its 8-table and 12-seed verified correct by me (L5-local, §6)** |
| 11 | **akulanikhil/pickleball** | https://github.com/akulanikhil/pickleball | README says MIT, API `license: null` (L1-web/L1-api) | JS (vanilla, browser) | 2026-07-14 (L1-api) | 3 | light | ✖ | ✔ **beam search** with cost = teammate-repeat + opponent-repeat + play-balance penalties, seeded PRNG for reproducibility; 1–10 courts, 1–50 rounds, any N; optional "no consecutive bench" (L1-web) | ✖ | ✖ | ✖ | ✖ | ✖ | ✔ | ✔ | none (L1-web) | Reference for the arbitrary-N optimiser |
| 12 | **PickleAdmin / CourtControl** (chinmaymahajan) | https://github.com/chinmaymahajan/PickleAdmin | README MIT, API null (L1) | TS (React) | 2026-03-24 | 1 | new | ✖ | ✔ partnership-history tracking, bye fairness | ✔ "King and Queen" | ✖ | ✖ | ✖ | ✖ | ✔ drag-drop courts | ✔ | Jest + fast-check (L1-web) | App, not library; reference for ladder/KotC UX |
| 13 | **doubles-tournament** (turutupa) | https://github.com/turutupa/doubles-tournament | none (L1-api) | TS | 2021-05-28 | 2 | dead | ✔ | ✔ `Tournament.roundRobin.switchPartners()` from bridge cyclic solutions (L1-web) | ✖ | ✖ | ✔ SE/DE claimed | ✖ | ✔ leaderboard | ✖ | ✖ | Jest config | Skip |
| 14 | **rbongard/tournament-scheduler** | https://github.com/rbongard/tournament-scheduler | MIT (L1-web) | TS (Next.js+Prisma) | 2026-06-09 | 1 | new | ✔ circle method, standings by points/matches won with diff tiebreaks | ✖ | ✖ | ✖ | ✖ | ✖ | ✔ | ✖ | ✖ | Vitest + DB integration (L1-web) | Full app; only its "pure domain engines" idea is relevant |
| 15 | **court-shuffle** (imathis) | https://github.com/imathis/court-shuffle | MIT (L1-web) | TS | 2026-08-22 | 2 | new | ✖ | random card-draw mixer only | ✖ | ✖ | ✖ | ✖ | ✖ | ✔ | ✖ | Bun tests | Skip |
| 16 | **boldcompass/roundrobinscheduler** | https://github.com/boldcompass/roundrobinscheduler | MIT (L1-api) | C# | 2023-04-22 | 2 | dormant | ✔ multi-division RR on shared courts | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✔ | ✖ | ? | Idea only (shared-court division scheduling) |
| 17 | **roundrobin-tournament-js** (EnrickyHip) | https://github.com/EnrickyHip/roundrobin-tournament-js | MIT (L2-npm v1.2.0, 2022-09-08) | TS | 2022 | ? | dormant | ✔ (+ auto second leg) | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ? | Skip (duplicate of #7) |
| 18 | **banjo/padel**, **alikianinejad/padel-tournament-manager** | https://github.com/banjo/padel , https://github.com/alikianinejad/padel-tournament-manager | none / none (L1-api) | Vue / Google Apps Script | 2022-02 / 2025-08 | 0 / 1 | no | ✖ | ✔ Americano 4/8/12 only (L1-web) | ✖ | ✖ | ✖ | ✖ | ✔ | ✖ | ✖ | ? | Skip |
| 19 | Python: **py4swiss** (FIDE Dubov 2026), **swissdutch**, **round-robin-tournament**, **rstt**, **SoL** | https://pypi.org/project/py4swiss/ , https://pypi.org/project/swissdutch/ , https://pypi.org/project/round-robin-tournament/ , https://pypi.org/project/rstt/ , https://pypi.org/project/SoL/ | various (not checked individually, L1-web search snippets) | Python | — | — | — | RR/Swiss/SE only | ✖ | ✖ | ✖ | partial | ✔ | partial | ✖ | ✖ | — | Nothing here covers rotating partners; no reason to port from Python when TS references exist |

Non-open-source generators seen (for feature parity only, not code): PicklePal https://picklepal.team/ ("never benches the same person twice in a row"), PickleMixer https://picklefriend.net/ (4–150 players, repeat-avoiding), Bounce https://www.bounce.game/pickleball-round-robin-generator , PlayRez https://playrez.com/tools/pickleball-round-robin-generator , dcode https://www.dcode.fr/americano-tournament-generator , Pickleheads https://www.pickleheads.com/round-robin , printyourbrackets rotating-doubles tables https://www.printyourbrackets.com/rotating-doubles-round-robin-schedules.html (L1-web).

---

## 2. Coverage matrix — our schemes/constraints × candidates

✔ = covered as-is · ◐ = partly / reference algorithm · ✖ = absent. Sources as in §1.

| Requirement (Reclub) | brackets-manager | competition-factory | tournament-organizer (+pairings, GPL) | @echecs/swiss | tournicano (no licence) | Padel-Americano | akulanikhil/pickleball | Must be written by us |
|---|---|---|---|---|---|---|---|---|
| SINGLES round robin (≤12), `limitRounds` | ✔ (`roundRobinMode simple/double`, groups) — no round limit param; slice rounds ourselves | ✔ | ✔ | ✖ | ✖ | ◐ Berger | ✖ | round slicing |
| PRESET_TEAMS round robin (≤12 teams) | ✔ (participants are opaque ids → teams) | ✔ PAIR events | ✔ | ✖ | ✔ `teams?` param | ✖ | ✖ | – |
| ROTATING_PARTNERS ≤32, courts, players/court=4, limit rounds, even scramble warning | ✖ | ◐ AD_HOC/DrawMatic (undocumented for individual doubles) | ✖ | ✖ | ✔ | ✔ 8/12/16 perfect tables; others greedy | ✔ optimiser | **yes** — §5/§6 |
| Prioritise players with fewest matches (sit-outs) | ✖ | ✖ | ✖ (byes only) | byes only | ✔ playRatio + last pause | ✔ | ✔ | **yes** (trivial once data model exists) |
| LADDER_RUN next round from standings (Mexicano), ranking criteria, min 4, continuous per-court generation | ✖ | ◐ AD_HOC rounds one at a time | ✖ | ✖ | ✔ (batch rounds; not per-court continuous) | ◐ championship round only | ✖ | **yes** — §5 |
| Total set points (auto-fill opponent score) | ✖ (score is opaque) | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | trivial UI/validation rule |
| Manual seeding / pool assignment | ✔ `manualOrdering`, `seedOrdering` | ✔ | ✔ (player order) | ✔ `rating` | ✖ | ✖ | ✖ | – |
| Pool play → winners per pool → playoffs + consolation + 3rd place (single/double/triple RR in pools) | ✔ pools (`groupCount`, RR mode simple/double — **no triple**), `finalStandings(...maxQualifiedParticipantsPerGroup)`, `consolationFinal` (3rd place); consolation *bracket* for non-advancers = second stage we create | ✔ ROUND_ROBIN_WITH_PLAYOFF, CURTIS/FEED_IN consolation, PLAYOFF | ✔ stage-two `advance` | ✖ | ✖ | ✖ | ✖ | triple RR = run the pool stage generator ×3 or write 3-leg RR |
| Single / double elimination, BYEs, 3rd-place, grand final | ✔ | ✔ | ✔ | ✖ | ✖ | ✖ | ✖ | – |
| Swiss (not in Reclub) | ✖ | ✖ | ✔ | ✔ | ✖ | ✖ | ✖ | optional |
| Standings with Reclub tiebreakers (win %, sets won, set win %, total score, score diff, H2H wins, H2H diff) | ◐ `rankingFormula(item)` only (wins/draws/losses) | ◐ | ◐ chess-style tiebreaks (no H2H-diff/sets%) | ✖ | ◐ | ◐ | ✖ | **yes** — one pure function (§5.5) |
| Quick score input | n/a | n/a | n/a | n/a | n/a | n/a | n/a | UI |

Reading of the matrix: **no single library covers the social side (ROT/LAD/SIT/COURT)**; the competition side is well covered by brackets-manager (drop-in) or competition-factory (heavier, richer). All three social references with real algorithms (tournicano, Padel-Americano, akulanikhil) are unlicensed or licence-ambiguous, so they are design references only.

---

## 3. Algorithms and academic references (what to implement from)

| Topic | Reference | What it gives us |
|---|---|---|
| Round robin scheduling | Wikipedia "Round-robin tournament" — circle method (fix one, rotate), Berger tables (Schurig 1886): n even → n−1 rounds of n/2 games; n odd → n rounds with a bye https://en.wikipedia.org/wiki/Round-robin_tournament (L1-web) | SINGLES / PRESET_TEAMS generator in ~30 lines; deterministic; supports `limitRounds` by slicing |
| Whist tournaments Wh(4n), Wh(4n+1) — "partner everyone once, oppose everyone twice" | Durango Bill cyclic solutions (4n all solvable; 4n+1 mostly; **no cyclic Wh(9)**) http://www.durangobill.com/BridgeCyclicSolutions.html ; Devenezia round-robin/whist pages incl. "social squares" and C source https://www.devenezia.com/downloads/round-robin/ ; jdawiseman individual-pairs designs 4…26 players with machine-readable files http://www.jdawiseman.com/papers/tournaments/individual-pairs/individual-pairs.html ; Z-cyclic definition (players Z_{4n−1}∪{∞}) and data for q² players http://hobbes.la.asu.edu/whist.html , https://hobbes.la.asu.edu/papers/whist.pdf ; Baker 1975 existence (via https://arxiv.org/pdf/1310.5240 intro) (all L1-web) | The *perfect* Americano for N ∈ {8,12,16,20,…}: N−1 rounds (4n) or N rounds with one bye (4n+1). §6 has starters I found and verified |
| Mixed-doubles / spouse-avoiding designs | Berman & Wakeling, "Complete Mixed Doubles Round Robin Tournaments" https://arxiv.org/abs/1310.5240 (L1-web) | Only needed if a "Mixicano" (fixed gender split) scheme is added later |
| Doubles training tournament as an optimisation problem | Ghoniem & Sherali, *J. Oper. Res. Soc.* 61:723–731 (2010), https://doi.org/10.1057/jors.2008.190 (abstract paywalled; title/authors/year via Semantic Scholar, L1-web) | Formal IP model for "every player partners everyone once, courts, rounds" — validates that arbitrary N needs a heuristic, not a closed form |
| Maximum-weight matching (blossom) for pairing | `edmonds-blossom-fixed` MIT, port of Joris van Rantwijk's implementation https://www.npmjs.com/package/edmonds-blossom-fixed (L2-npm) ; `@graph-algorithm/maximum-matching` is **AGPL-3.0** https://www.npmjs.com/package/@graph-algorithm/maximum-matching (L2-npm) — do not use | Optimal one-round pairing in O(n³); used by tournament-pairings and (AGPL variant) by tournicano |
| Swiss pairing | FIDE Dutch etc. via @echecs/swiss (MIT) https://github.com/echecsjs/swiss ; weighted-blossom approach described in tournament-pairings README https://github.com/slashinfty/tournament-pairings (L1-web) | If ever needed |
| Mexicano pairing rule | padelfast: "blocks of four: 1 and 3 vs 2 and 4, 5 and 7 vs 6 and 8" https://www.padelfast.com/formats/mexicano ; Padeli says "1 with 4 against 2 and 3" https://padeli.com/get-started/formats/ ; Reclub search snippet says "1st and 2nd partner, 3rd and 4th" (L1-web) — **three conventions exist → make it a setting** (`pairingPattern: '1-3v2-4' | '1-4v2-3' | '1-2v3-4'`) | §5.2 |
| Ladder / King of the Court movement | winners move up a court and split, losers move down and split; some variants keep pairs https://www.playpickleball.com/types-of-pickleball-rec-play/ ; Reclub "Ladder Run": "Win your games to move up… losers slide down" https://reclub.co/m/BLMAR8 (L1-web) | Ladder Run when standings ≙ court order; continuous mode = generate for an empty court from eligible players |
| Americano/Team Americano rules | https://www.padelfast.com/formats/americano ("Team Americano works exactly like the individual format, but… fixed, predetermined pairs while opponents rotate") (L1-web) | PRESET_TEAMS = plain RR over pairs; points per rally credited to both players |

---

## 4. Licence traps (L2-npm unless noted)

- `tournament-pairings@2.0.1` is **GPL-3.0-or-later**; `tournament-organizer@4.1.1` (MIT) depends on it, so shipping tournament-organizer pulls GPL code into the engine's `node_modules`. The signed spec forbids non-MIT/Apache deps (memory `project_social_engine_spec_20260909`, "MIT/Apache deps only (no AGPL code lifted)"). → both excluded.
- `@graph-algorithm/maximum-matching@3.0.0` is **AGPL-3.0** → excluded; tournicano itself has **no licence file** → cannot copy; Padel-Americano and akulanikhil/pickleball say MIT in README but have **no LICENSE file** (GitHub API `license: null`) → treat as reference-only until a LICENSE file exists.
- `brackets-manager` npm metadata says **ISC** while the GitHub API reports MIT; both permissive; confirm the LICENSE file in the repo before adding (L1 — I did not fetch the LICENSE file).
- `edmonds-blossom-fixed@1.0.1` MIT, `swiss-pairing@1.4.3` MIT, `@echecs/swiss@5.0.0` MIT, `tods-competition-factory@6.38.0` MIT, `roundrobin@2.0.0` MIT.

---

## 5. Recommended combination

**Decision (L0 — my recommendation; needs operator yes):** adopt **brackets-manager** for the competition side, write a small **`social-scheduler` package** (pure TS, zero deps except optional `edmonds-blossom-fixed`) for the meet side, and one shared **standings/tiebreaker module**. Keep competition-factory as the reference to read (not to depend on) for pool→playoff/consolation edge cases and court scheduling.

| Reclub scheme / feature | Use | Why |
|---|---|---|
| Competitions: single/double elimination, pools→playoffs, consolation final (3rd place), BYEs, seeding | **brackets-manager** (`manager.create.stage({type:'round_robin'|'single_elimination'|'double_elimination', seeding, settings:{groupCount, roundRobinMode, seedOrdering, manualOrdering, consolationFinal, grandFinal, balanceByes}})`, `manager.update.match`, `manager.get.finalStandings(stageId, {rankingFormula, maxQualifiedParticipantsPerGroup})`, `manager.get.currentMatches`) with a Prisma `CrudInterface` (L1-web docs) | Maintained (2026-05), tested, multi-stage, storage-agnostic, viewer available (`brackets-viewer@1.9.1`, MIT/ISC) |
| Triple round robin / triple pool play | our wrapper: generate the RR fixture list ourselves (circle method) ×3 legs and feed brackets-manager only for the playoff stage, or run the pool stage entirely in our RR generator and start brackets-manager at the playoffs with `manualOrdering` from pool standings | brackets-manager has only simple/double RR |
| Consolation *bracket* for non-advancers | second elimination stage seeded with the non-qualified pool participants (brackets-manager supports multiple stages per tournament) | matches Reclub `consolationBracket` |
| SINGLES, PRESET_TEAMS meets (≤12) | our `roundRobin(ids, {limitRounds, courts})` circle method + court slotting | 30 lines; no dep |
| ROTATING_PARTNERS (Americano/Scramble, ≤32, courts, fewest-matches priority, limit rounds) | our `americano()` — §6 perfect whist tables when N ∈ {5,8,12,13,16,17,20,21,24} and courts ≥ N/4; otherwise the **beam/annealing optimiser** with cost = partner repeats ≫ opponent repeats > play-balance > court repeat; sit-out rule = fewest matches, then longest since last sit-out (tournicano's rule) | no licensed library exists; this is the core IP |
| LADDER_RUN / Mexicano / Team Mexicano / Social Ladder | our `nextRound(standings, rankingCriteria, {courts, prioritizeLeastMatches, pairingPattern, teams?})` + `nextMatchForCourt(courtIdx)` for continuous play — §5.2 | standings-driven, round-at-a-time; Reclub's continuous per-court generation is unique and simple to do once eligibility is defined |
| Ranking criteria (MATCHES_WON, POINTS_WON, WIN_PCT, POINTS_PCT) and competition tiebreakers (h2h_wins, score_diff, h2h_diff, total_score, sets_won, win_pct, sets_win_pct) | one pure `computeStandings(matches, config)` returning the Reclub row shape (§0) | shared by meets and competitions; brackets-manager's `rankingFormula` is too thin |
| Swiss (optional, not in Reclub) | `@echecs/swiss` (MIT) if ever requested | avoids GPL tournament-pairings |
| Total set points | validation + auto-fill in the score endpoint: `if (totalSetPoints && a != null) b = totalSetPoints − a` | trivial |

Size estimate (L0): social-scheduler ≈ 600–900 lines TS + tests (whist tables + optimiser + Mexicano + standings); brackets-manager integration ≈ 300 lines (Prisma CRUD adapter + stage orchestration for triple RR/consolation).

---

## 6. Verified whist starters (perfect Americano tables) — L5-local

`whist_check.js` (this folder) verifies "each pair partners exactly once and opposes exactly twice, every player plays every round (4n) or sits out once (4n+1)". Output in `whist_check.out.txt`:

```
Padel-Americano SCHEDULE_8:                {"ok":true,...,"played":[7,7,7,7,7,7,7,7]}
Padel-Americano WHIST_SEEDS[12] developed: {"ok":true,...,"played":[11 x12]}
N=8:  seeds=[[7,1,5,0],[2,6,4,3]]                                             rounds=7
N=12: seeds=[[11,0,5,4],[3,7,9,6],[8,2,1,10]]                                 rounds=11
N=16: seeds=[[15,10,6,11],[1,14,8,4],[2,5,3,9],[0,7,13,12]]                  rounds=15
N=20: seeds=[[19,4,18,5],[14,12,0,16],[13,1,2,10],[9,8,6,15],[17,3,7,11]]    rounds=19
N=5:  seeds=[[4,1,2,3]]                                                       rounds=5
N=13: seeds=[[11,2,10,5],[9,8,4,6],[1,7,3,0]]                                 rounds=13
N=17: seeds=[[11,15,16,14],[0,7,13,5],[10,4,1,6],[9,12,2,3]]                 rounds=17
N=21: seeds=[[15,12,6,13],[14,8,20,10],[19,0,16,11],[17,4,7,3],[18,9,1,2]]   rounds=21
N=24: seeds=[[23,7,6,14],[18,15,3,13],[9,16,10,19],[2,8,22,4],[17,5,21,0],[1,20,11,12]]  rounds=23  (28 s, whist24.out.txt)
```
Run: `node whist_check.js` (defaults) or `WHIST_N=24 WHIST_MS=300000 node whist_check.js`. Search = randomised greedy over Z_m difference classes (partner class once, opponent class twice) + full development check; not guaranteed to terminate for every N (N=9 provably has no cyclic design).

Development rule (the whole table from one seed row): game `[a,b,c,d]` = team {a,b} vs team {c,d}; for 4n players, player `N−1` is ∞ (fixed) and every other index becomes `(x + r) mod (N−1)` in round `r = 0..N−2`; for 4n+1 players there is no ∞, every index becomes `(x + r) mod N` for `r = 0..N−1`, and the one unused residue each round is the bye. N=9 has no cyclic solution (Durango Bill) — use the optimiser or jdawiseman's non-cyclic 9-player design.

These are the tables the Americano generator should ship as constants (regenerate with the script; do not hand-edit).

---

## 7. Pseudo-code

### 7.1 Data model (shared)

```ts
type Id = string;
interface Player { id: Id; matches: number; sitOuts: number; lastSitOutRound: number;
                   partners: Map<Id, number>; opponents: Map<Id, number>; courts: Map<number, number>;
                   points: number; wins: number; pointsAgainst: number; }
interface Match  { round: number; court: number; team1: [Id, Id] | [Id]; team2: [Id, Id] | [Id];
                   score?: [number, number]; }
interface GenConfig { courts: number; playersPerCourt: 2 | 4; limitRounds?: number;
                      prioritizeLeastMatches: boolean; totalSetPoints?: number; seed?: number; }
```

### 7.2 Americano / ROTATING_PARTNERS — full schedule up front

```
function americano(playerIds, cfg):
  N = |playerIds|; perRound = min(cfg.courts, floor(N / 4))           // matches playable per round
  if perRound == 0: error "not enough players"
  rounds = []
  if N in WHIST_SEEDS and perRound*4 >= N - (N % 4):                   // perfect table fits the courts
      seeds = WHIST_SEEDS[N]; m = (N % 4 == 0) ? N-1 : N
      for r in 0..m-1:
          games = seeds.map(g => g.map(x => (N%4==0 && x==N-1) ? x : (x + r) mod m))
          rounds.push(assignCourts(games, r))                          // §7.4
  else:
      // arbitrary N / court-limited: greedy + local search per round (akulanikhil-style beam or SA)
      state = initPlayers(playerIds)
      totalRounds = cfg.limitRounds ?? ceil((N-1) * N / (perRound*4)) // ≈ everyone partners everyone once
      for r in 0..totalRounds-1:
          active, benched = chooseActive(state, perRound*4, r)         // §7.5 fewest-matches rule
          best = null
          repeat BEAM_WIDTH times (or SA schedule):
              cand = randomGrouping(active) into groups of 4 → [a,b,c,d] pairs by best of 3 splittings
              cost = Σ_pairs partnerRepeat(a,b)*W_P + Σ opponentRepeat*W_O + courtRepeat*W_C
              local-search: swap two players between games while cost decreases
              keep best
          apply(best, state); rounds.push(assignCourts(best, r))
  if rounds.length has uneven play (N % 4 != 0): emit warning "uneven scramble" (Reclub copy)
  return cfg.limitRounds ? rounds.slice(0, cfg.limitRounds) : rounds
```
Weights (from the references, L1-web): partner repeat ≫ opponent repeat (Padel-Americano 10:1; tournicano freq×100 + recency×10 + saturation×1). Use `W_P=100, W_O=10, W_C=1`. Optional exact mode: build the "pair graph" and call `edmonds-blossom-fixed` twice (players→pairs with weight = −cost, then pairs→matches), which is tournicano's structure (L1-web `Matching.ts`).

### 7.3 Mexicano / LADDER_RUN — next round from standings (+ Team Mexicano, + continuous mode)

```
function nextRound(state, cfg, criteria, pattern = '1-3v2-4', teams = null):
  ranked = standings(state, criteria)            // MATCHES_WON | POINTS_WON | WIN_PCT | POINTS_PCT, tie → fewer matches first, then random(seed)
  if round == 0: ranked = shuffle(playerIds, seed)  // "opening lottery" (padelfast)
  if teams: units = teams ranked by team standings (Team Mexicano) else units = ranked players
  capacity = min(cfg.courts, floor(|units| / unitsPerMatch))          // 4 players or 2 teams per court
  active, benched = cfg.prioritizeLeastMatches ? chooseActive(units, capacity*unitsPerMatch) : units[0 : capacity*unitsPerMatch]
  // keep rank order inside the active set
  active.sort(by rank)
  games = []
  for i in 0 .. capacity-1:
      block = active[4i .. 4i+3]                  // or [2i, 2i+1] for teams
      switch pattern:
        '1-3v2-4': games.push([block0, block2, block1, block3])   // padelfast
        '1-4v2-3': games.push([block0, block3, block1, block2])   // padeli
        '1-2v3-4': games.push([block0, block1, block2, block3])   // Reclub snippet
      // partner-repeat guard: if pattern repeats a partnership from last round, try the other two splittings of the same block
  court i ← block i  (court 1 = top block; this *is* the ladder: winners rise, losers fall)
  return games, benched

// Continuous play (Reclub help 1769552961): a court frees up before the round ends
function nextMatchForCourt(state, courtIdx, cfg):
  eligible = players not currently on a court, sorted by (matches asc, lastSitOutRound asc, rank asc)
  if |eligible| < 4: return null
  block = eligible[0..3] sorted by rank; return game by pattern on courtIdx
```

### 7.4 Court assignment (both schemes)

```
function assignCourts(games, r):
  if games.length <= 6: enumerate all permutations of court indices          // 720 max (Padel-Americano does this)
  else: greedy + 2-opt swaps
  score(perm) = Σ_players [player was on that court last round] * 2 + Σ_players courts[player][court]  // avoid same court twice in a row, then balance
  tie → parity of r
  return games mapped to argmin perm
```
For Mexicano skip this: the court *is* the rank block.

### 7.5 Sit-out / "prioritize least matches" rule

```
function chooseActive(players, slots, r):
  order by (matches asc, lastSitOutRound asc /* longest since last bench first */, random(seed))
  active = first `slots`; benched = rest; benched.forEach(p => p.sitOuts++, p.lastSitOutRound = r)
  guarantee: nobody is benched two rounds in a row unless |players| - slots > slots
```
(tournicano: `playRatio = matches/(pauses+matches+ε)` asc, tie → most recent pause first — L1-web; PicklePal advertises the same "never benches the same person twice in a row" — L1-web.)

### 7.6 Standings / tiebreakers (meets and competitions)

```
function computeStandings(matches, cfg):
  rows = per participant {points, wins, losses, draws, tiebreakerWins, tiebreakerLosses,
                          totalScore (points for), pointsAgainst, scoreDiff, setsWon, setsLoss, setsWinPct, winPct, h2hWins, h2hDiff}
  primary = cfg.pointCalculation: WinLoss → points = wins*W + losses*L + draws*D + tbWins*TW + tbLosses*TL
                                  WinPct | SetsWinPct | SetsWon | TotalScores → that field
  sort by primary desc, then for each tied group apply cfg.tiebreaker1..4 in order
       (h2h_wins / h2h_diff computed only among the tied group), then remaining ties share the place
  meet ranking criteria map: MATCHES_WON→wins, POINTS_WON→totalScore, WIN_PCT→winPct, POINTS_PCT→totalScore/(totalScore+pointsAgainst)
```

---

## 8. What hkpl-like league engines lack for social play (and what hkpl has)

- hkpl already has `Tournament/Bracket` models and `OpenPlaySession/Signup/Game` (memory `project_hkpl_social_layer_already_exists_20260909`, L2 source + L5 prod DB read in a previous session; modules `open_play/social_games/tournament` are OFF on prod). I did not re-read hkpl source in this session (L1 — memory). What that class of engine (team-vs-team fixture generators: brackets-manager, tournament-organizer, Challonge/Toornament/LeagueLobster, hkpl brackets) typically lacks, evidenced by their APIs:
  1. **The individual is not the unit of standing.** brackets-manager participants are opaque seeds and `finalStandings` ranks *participants*; tournament-organizer ranks `Player`s that are the match units. Rotating doubles needs *player* standings aggregated from *pair* matches (Reclub meet standings are per player; competition standings are per `statsTeam`) — `spec_competition_dupr.md` L178, L191.
  2. **No partner-history / opponent-history state.** None of the fixture libraries store who partnered whom; the whist property (partner once, oppose twice) and the "even scramble" warning require it (§7.1 `partners`, `opponents` maps).
  3. **No sit-out fairness.** Byes in Swiss/elimination go to the lowest seed or are structural; social play needs "fewest matches first, never bench twice in a row" (tournicano, PicklePal, Reclub's `prioritizeLeastMatches`).
  4. **Courts are not a first-class constraint.** brackets-manager has no court concept; competition-factory has venues/courts but as scheduling, not as the divisor of a round (`sublocations` in Reclub's generate call). Round size = `min(courts, floor(N/4))` changes the schedule itself.
  5. **Standings-driven next round with per-court continuous generation** (Mexicano / Social Ladder) does not exist in fixture libraries; competition-factory's AD_HOC + DrawMatic is the closest documented idea (L1-web) but is rating-based and not documented for individual doubles.
  6. **Score-entry ergonomics** (total set points auto-fill, players entering their own scores — Reclub `/matches/quick-input-score`, "Allow players to input their own scores", `domain_meets.md` L184) are application concerns no library covers.
  7. Reclub's own "how does the schedule work" article confirms the split: *"the platform provides a Match Generator, not a fully automated scheduling engine"* — timings are manual (`help/1765846183-competition-schedule-generator.md`). We should keep the same boundary: generator returns rounds/courts, the host orders them.

---

## 9. Open items / risks (facts, for the operator)

- **L1 caveat on all web facts:** the fetch tool summarises pages; stars/dates from the GitHub API were read from the API JSON by the tool, npm data I parsed myself. Before depending on brackets-manager, read its LICENSE file (ISC vs MIT discrepancy).
- brackets-manager `roundRobinMode` has no *triple*; Reclub has Triple RR / Triple Pool Play — handled by our RR generator (§5).
- Mexicano block pattern differs across sources (1-3v2-4 / 1-4v2-3 / 1-2v3-4) — must be a setting; Reclub's actual pattern is not in the decoded strings (L2-local: no match).
- Perfect tables now verified for N ∈ {5,8,12,13,16,17,20,21,24}; N=9 has no cyclic solution (use the optimiser or jdawiseman's design); N=28/32 not attempted (Reclub caps rotating at 32 — run the script with `WHIST_N=28,32` if wanted).
- Spec non-goal "no league logic" (memory) — the operator should confirm that meet-level match generation (schemes above) is inside the social engine's scope (phase 2 events) and competitions/brackets are hkpl-adapter territory, or vice versa. This document assumes the engine owns *meet* generation and brackets-manager sits wherever competitions live.

## 10. Source index (all URLs used)

brackets-manager https://github.com/Drarig29/brackets-manager.js/ · docs https://drarig29.github.io/brackets-docs/getting-started/ · https://drarig29.github.io/brackets-docs/reference/model/interfaces/StageSettings.html · https://drarig29.github.io/brackets-docs/reference/manager/classes/Get.html · https://drarig29.github.io/brackets-docs/reference/manager/interfaces/RoundRobinFinalStandingsOptions.html · https://www.npmjs.com/package/brackets-manager · brackets-viewer https://github.com/Drarig29/brackets-viewer.js · competition-factory https://github.com/CourtHive/tods-competition-factory · https://courthive.github.io/competition-factory/docs/concepts/draw-types · https://courthive.github.io/competition-factory/docs/governors/draws-governor/ · https://www.npmjs.com/package/tods-competition-factory · tournament-organizer https://github.com/slashinfty/tournament-organizer · https://slashinfty.github.io/tournament-organizer/ · https://slashinfty.github.io/tournament-organizer/interfaces/SettableTournamentValues.html · https://slashinfty.github.io/tournament-organizer/classes/Tournament.html · tournament-pairings https://github.com/slashinfty/tournament-pairings · https://www.npmjs.com/package/tournament-pairings · @echecs/swiss https://github.com/echecsjs/swiss · swiss-pairing https://github.com/dambrisco/swiss-pairing · roundrobin https://github.com/tournament-js/roundrobin · tournament-js https://github.com/clux/tournament , https://github.com/clux/groupstage , https://github.com/clux/tiebreaker · tournicano https://github.com/alimfeld/tournicano (+ `FAQ.md`, `src/model/matching/{Matching,WeightFunctions,Partitioning,MaximumMatching}.ts`) · Padel-Americano https://github.com/ptzimmerman/Padel-Americano (+ `utils/scheduler.ts`) · akulanikhil/pickleball https://github.com/akulanikhil/pickleball · PickleAdmin https://github.com/chinmaymahajan/PickleAdmin · court-shuffle https://github.com/imathis/court-shuffle · rbongard https://github.com/rbongard/tournament-scheduler · doubles-tournament https://github.com/turutupa/doubles-tournament · roundrobinscheduler https://github.com/boldcompass/roundrobinscheduler · roundrobin-tournament-js https://github.com/EnrickyHip/roundrobin-tournament-js · banjo/padel https://github.com/banjo/padel · alikianinejad https://github.com/alikianinejad/padel-tournament-manager · GitHub topic https://github.com/topics/pickleball · blossom libs https://www.npmjs.com/package/edmonds-blossom-fixed , https://www.npmjs.com/package/@graph-algorithm/maximum-matching , https://github.com/mattkrick/EdmondsBlossom · Python https://pypi.org/project/py4swiss/ , https://pypi.org/project/swissdutch/ , https://pypi.org/project/round-robin-tournament/ , https://pypi.org/project/rstt/ , https://pypi.org/project/SoL/ · algorithms https://en.wikipedia.org/wiki/Round-robin_tournament , http://www.durangobill.com/BridgeCyclicSolutions.html , https://www.devenezia.com/downloads/round-robin/ , http://www.jdawiseman.com/papers/tournaments/individual-pairs/individual-pairs.html , http://hobbes.la.asu.edu/whist.html , https://hobbes.la.asu.edu/papers/whist.pdf , https://arxiv.org/abs/1310.5240 , https://doi.org/10.1057/jors.2008.190 , https://arxiv.org/pdf/2502.04159 · format rules https://www.padelfast.com/formats/mexicano , https://www.padelfast.com/formats/americano , https://padeli.com/get-started/formats/ , https://www.playpickleball.com/types-of-pickleball-rec-play/ , https://reclub.co/m/BLMAR8 , https://help.reclub.co/hc/reclub-help/articles/1769552961-match-generator , https://help.reclub.co/hc/reclub-help/articles/1765846183-competition-schedule-generator · commercial generators https://picklepal.team/ , https://picklefriend.net/ , https://www.bounce.game/pickleball-round-robin-generator , https://playrez.com/tools/pickleball-round-robin-generator , https://www.pickleheads.com/round-robin , https://www.dcode.fr/americano-tournament-generator , https://www.printyourbrackets.com/rotating-doubles-round-robin-schedules.html , https://scheduler.leaguelobster.com/round-robin-generator/ , https://challonge.com/ · local: `spec_meets.md`, `spec_competition_dupr.md`, `domain_meets.md`, `domain_competition_dupr.md`, `i18n_en.json`, `help/*.md`, `whist_check.js`, `whist_check.out.txt`, `whist24.out.txt`.

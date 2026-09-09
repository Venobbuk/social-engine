# BLUEPRINT

## WORKING STATE
Current step: KIT v5 — dev loop (N), proof tiers + ledger (O), artifact verdicts (P); checks C10–C12 selftested
Last completed: contract-rules.cjs v5 selftest + hook e2e green; ledger.cjs + probe-template.cjs added; CDN copy refreshed
Next action: install into the next real project root (see INSTALL.md); first act there = build the DEV LOOP (rule N) and fill the section below

## NORTH STAR
One paste-in kit (CLAUDE.md + BLUEPRINT.md + contract-rules.cjs + ledger + probe template + hook)
that makes every project run at immaculate delivery standard: blueprint before build, no drift,
no unproven claims, verify-once-and-record, walked UAT at delivery — enforced by script, not by discipline.

## AUDIENCE & SOPHISTICATION BAR
Audience: the operator (Vincent) and any future collaborator opening a fresh project chat.
Bar: every rule checkable or convertible to a required output token; every check self-tested
by re-planting its violation; NO VERDICT over silent pass; an edit never costs an image build.

## INPUT → EXPECTED OUTPUT
- Input: a fresh project directory. Output: kit files copied in, blueprint filled (incl. DEV LOOP), selftest + hook e2e green.
- Input: a code edit. Output: visible in the running dev instance in ~1 s with ZERO image builds (rule N).
- Input: a fix. Output: `probes/<id>.verdict.json` (condition fired, pass, evidence) + ledger entries for the files it verifies.
- Input: a progress report/message. Output: `node contract-kit/contract-rules.cjs . report.md` grades it (C5/C6/C8/C9/C10/C11).
- Input: a repo with product code. Output: C7 FAILS until the operator writes `SIGN-OFF: yes (date)` here.
- Input: a delivery claim. Output: C11 FAILS while any changed code file lacks a current-sha pass in `.verify-ledger.json`; C8 needs the fresh real-click screenshot.

## PIPELINE
DISCUSS → BLUEPRINT → SIGN-OFF → BUILD (T0+T1 per fix, no rebuilds) → WALK-UAT (T2, once) → DELIVER → SHIP (one build).

## DEV LOOP
Run without rebuild: <fill — e.g. `docker compose -f docker-compose.dev.yml up` (bind-mounted source + nodemon, alt port, sandbox tenant)>
Ship (one build per feature): <fill — e.g. `scripts/deploy.sh`>
Image layout: <fill — deps/codegen above COPY . . ; .dockerignore present; base image tag>  (check C12)

## SIGN-OFF
SIGN-OFF: yes (2026-08-31) — operator directed kit v2 built from the stock-session read.
(In a fresh project this line starts as `SIGN-OFF: no` and only the operator flips it.)

## DECISIONS
- 2026-08-30 — Strong wording rejected; every rule must be checkable or a required output token.
- 2026-08-30 — Negatives kept only where mechanically detectable (banned-words scan).
- 2026-08-30 — Checks must abstain: NO VERDICT when the instrument can't fire (house rule R8).
- 2026-08-31 — v2 rebuilt from full read of stock session (93 operator msgs): added ROLE, phase
  gates (C7), hardened evidence (C5 must RESOLVE), family counts (C6), walked-proof file (C8),
  no-naked-numbers, audience/bar section, money-arming rule.
- 2026-08-31 — Reviewer gaps accepted: auto-run hook added (--hook mode + settings example);
  "L6"/"screenshot" as bare words demoted from evidence tokens.
- 2026-08-31 — v3: hook reads Stop-hook stdin JSON → extracts the actual assistant turn from
  transcript_path → grades C5/C6/C8 against MY OWN words (the lie-loop closed); C7 scans code
  recursively (lib/, routes/, depth 4, skips node_modules/.git/dist); stop_hook_active loop-guard;
  C6 trigger narrowed to completed-fix claims, C8 to delivery/UAT-PASS claims (no over-blocking).
- 2026-08-31 — C6 closed by measure→change→re-measure: a fix claim must carry
  `family: N/N · residual: /<pattern>/`; the checker RE-RUNS the pattern over project code
  (.md excluded so the claim quoting the pattern never self-matches) and FAILS if it still
  matches — the half-fixed-sibling failure (F1's "Search by / OR" case) is now mechanical.
  Known residual CLOSED for git projects (v4): the pattern must also match the REMOVED lines
  of git diff HEAD + the last commit, else VACUOUS FAIL. Limits: checks working tree + HEAD~1
  only (claim must land in the same turn as the fix — which rule A demands anyway); non-git
  projects keep the eyeball caveat, stated in the PASS detail itself.
- 2026-08-31 — C8 freshness: a delivery screenshot must be <1h old (mtime) — a stale png cannot
  prove THIS delivery. The pixels themselves are judged by Claude's eyes (CDP walk + Read the PNG,
  rule G) and finally the operator's; the script's job is forcing a fresh artifact to exist.
- 2026-08-31 — Synonym-dodge rule (rule M in action): banned list grows by WHOLE CLAIM IDIOMS only
  (good to go, all set, ready to ship, fully functional, no issues left, everything in place) —
  never bare words like "complete"/"ready"/"working", which over-block ordinary prose. Each new
  dodge caught in the wild gets added the same way, with a plant, in the same commit.
- 2026-09-02 — v5 from the operator's "20 min per change / gate misses lots / re-looks at everything"
  (measured: 89 image builds in 3 days, 402 MB COPY layer, prisma generate after COPY, base cache
  lost; hook regexed words and scanned a catch-all folder). Rule N + C12 (dev = bind-mount + hot
  reload, one build per feature, deps above COPY, .dockerignore). Rule O + C11 + ledger.cjs
  (T0/T1/T2 tiers; verify-once ledger keyed by content-sha; browser walk ONLY at DELIVER). Rule P +
  C10 + probe-template.cjs (claims graded against an executed probe's verdict artifact that must
  abstain when the condition never fired; any fresh red probe fails the claim). Kit must be installed
  in the code's own root, never a catch-all.
- 2026-09-02 — Pre-rollout drill found two install-killers and fixed them: (1) CLAIM-SHAPE GUARD —
  "not fixed yet", "fixed-width", "when done, run…", 'the word "fixed"', "NOT deliverable" each blocked a
  discussion turn; claim words now count only when used AS a claim (negation/future/quoted/compound/noun
  senses stripped before matching; bare noun "deliverable" dropped); 7 prose samples must pass and 4 real
  claims must still fail in the selftest. (2) This template's INDEX used kit-relative links, so the copy at
  the project root failed C3 on EVERY turn — links are now root-relative (`contract-kit/...`).
- 2026-09-02 — REAL-DATA CALIBRATION: graded all 3,528 assistant turns from the 40 most recent real sessions
  (written WITHOUT the contract). First v5 cut blocked 65.5%; C9 alone blocked 462 turns, and 40% of its
  hits were the operator's own "$0" vocabulary, many others IPv4 addresses matching the semver shape.
  C9 now requires the claim verb ADJACENT to a semver (not inside an IPv4) or a non-zero price → 79 turns.
  Claim-shape guard extended with intent/inquiry ("let me verify it works", "check whether…") and
  explanation ("how the record works", "works?") forms. Final: 61.3% of pre-contract turns would still be
  bounced — sampled, these are overwhelmingly genuine unevidenced claims ("Done — live on prod, verified",
  "It works — email SENT"), which is the contract's purpose; under the contract the same turn passes by
  putting the artifact on the same line. Residual prose false positives exist and grow the guard per rule M.
- 2026-09-02 — DEV LOOP PROVEN on HKPL (L6): `/root/hkpl-docker/dev.sh` runs /root/hkpl-dev bind-mounted
  into the same image with `node --watch` on :3949 against an isolated Postgres (5434, nightly dump) +
  Redis (6382), schedulers off, SMTP blackholed. Edit → restart +0.27 s → serving +2.5 s, builds 0.
  Two traps recorded: pg_isready answers during init before the DB exists (restore silently hit a missing
  DB); host node_modules carry the host's Prisma engine (bookworm needs a volume seeded from the image).

- 2026-09-02 — Operator yes ("do it as you recommended") on three items, in order: (1) GATE STATS — the hook
  appends every verdict to `.contract-stats.jsonl`; `ledger.cjs stats` reports bounce rate + bounced lines so
  false positives feed rule M from real use, not samples. (2) PROVE PROBES CAN GO RED — `ledger.cjs prove
  <probe>` reverts the probe's FILES to the pre-fix content (HEAD, or HEAD~1 when already committed), re-runs
  the probe and requires a non-pass, restores, re-runs and requires pass, then marks the ledger entries
  `proved: true` with the pre-fix ref; C11 accepts only proved pass entries for a delivery. (3) HKPL prod
  Dockerfile relayout + tagged base image + trimmed .dockerignore, measured with one build.
- 2026-09-02 — All three DONE (L6): (1) hook appends to `.contract-stats.jsonl`, e2e asserts 3 rows; `ledger.cjs
  stats`. (2) `ledger.cjs prove` + `proved` flag; selftest: SHARP probe proved, LAZY probe refused, file always
  restored, C11 PASS only after prove. (3) HKPL prod: `Dockerfile.base` → `hkpl-base:<lock md5>` via
  `ensure-base.sh` (wired into redeploy.sh + deploy.sh, committed from hkpl-dev); per-edit image rebuild 11 s,
  full redeploy.sh 27 s wall, site + DB route 200, rollback tag `hkpl-app-rollback:2026-09-02`.

## OPEN
- Which project gets the kit next (operator picks at each project start — paste all files in).
- Per-project: extend contract-rules.cjs with project-specific checks as slips occur (rule M).
- C12 reads the Dockerfile only (root or one level down); compose build contexts elsewhere are NO VERDICT.

## INDEX
(Paths are relative to the PROJECT ROOT where this file lives after install — check C3 fails a dead link. Add every project doc here.)
- [CLAUDE.md](contract-kit/CLAUDE.md) — the contract (rules 0, A–P); auto-loads every session when copied into a project.
- [BLUEPRINT.md](contract-kit/BLUEPRINT.md) — this template; WORKING STATE on top is the compaction-recovery point; DEV LOOP section is rule N.
- [START.md](contract-kit/START.md) — ≤20-line per-project start card (ports, dev loop, ship, accounts, isolation, traps); read FIRST every turn (rule 0).
- [contract-rules.cjs](contract-kit/contract-rules.cjs) — checks C1–C12 + --selftest (re-plants every violation) + --hook; exports ledger helpers.
- [ledger.cjs](contract-kit/ledger.cjs) — verify ledger CLI: `status` (what still needs proof) / `record` / `show` (rule O).
- [probe-template.cjs](contract-kit/probe-template.cjs) — copy to probes/<id>.cjs; fires the real path, abstains if the condition never fired, writes the verdict JSON, records the ledger (rule P).
- [LESSONS_2026-08-31_stock-session.md](contract-kit/LESSONS_2026-08-31_stock-session.md) — failures F1–F10 each rule A–M was earned by.
- [LESSONS_2026-09-02_devloop-gating.md](contract-kit/LESSONS_2026-09-02_devloop-gating.md) — failures F11–F13 behind rules N, O, P and checks C10–C12.
- [settings-hook-example.json](contract-kit/settings-hook-example.json) — merge into a project's .claude/settings.json to auto-run the checker.
- [test-hook-e2e.cjs](contract-kit/test-hook-e2e.cjs) — spawn-level Stop-hook proof (lying turn blocked / unproven fix blocked / clean passes / loop-guard).
- [INSTALL.md](contract-kit/INSTALL.md) — the paste-in prompt that installs this kit into a project root.

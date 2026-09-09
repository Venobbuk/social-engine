# FAILURE CATALOG — evidence base for contract-kit v5 (dev loop + gating)
Source: operator 2026-09-02 ("all the work is making everything super slow… you rebuild on every little
thing about 20 mins per change… the gating gates out most but still misses lots, and is super slow, on
every step you look at them all again") + measurements taken on the shared VM the same day.
Each failure cites the measurement and names the kit rail that now guards it.

## F11. Every edit went through a production image build (~20 min worst case)
- Measured: 89 commits in 3 days on the HKPL repo, each one triggering `docker compose build` via deploy.sh.
  `COPY . .` layer = 402 MB / ~10,070 files, re-sent and re-written per build. `prisma generate` sat AFTER
  the whole-source COPY, so it re-ran per build. Base layers (apt 851 MB + npm 336 MB) were rebuilt 48 min
  before the last COPY — a cache miss on unchanged instructions = the 20-minute case.
- Root: development and shipping shared ONE path (the prod image). Dev never ran from bind-mounted source.
- → Rail: rule **N** (dev = bind-mounted source + hot reload, zero builds; ship = ONE build per feature) +
  check **C12** (deps/codegen must sit above `COPY . .`; `.dockerignore` must exist) + BLUEPRINT `DEV LOOP`
  section (the run-without-rebuild command and the ship command, written at blueprint time).

## F12. The gate graded my WORDS, not the code — and scanned the wrong tree
- The v4 hook regex-matched "done/fixed/works" in the turn text and asked for a resolving artifact on the
  same line. A path or command on the line satisfied it whether or not anything had been executed.
- The residual re-measure (C6) and screenshot freshness (C8) ran over the LOCAL cwd (a catch-all
  Downloads folder with 118 sub-folders) while the code under repair lived on the VM. C6 = 0 residual by
  construction; a structurally vacuous pass.
- → Rail: rule **P** + check **C10**: a fix/delivery claim must cite a FRESH `probes/<id>.verdict.json` that an
  EXECUTED probe wrote, with `condition_fired: true`, `verdict: pass`, non-empty evidence; any fresh
  non-pass verdict in `probes/` fails the claim. `probe-template.cjs` forces the abstain step (R8).
  Install rule: the kit goes into the project ROOT that holds the code (never a catch-all), so the
  hook grades the tree it is supposed to grade.

## F13. Re-verifying everything on every step
- Nothing recorded what had been verified at which content. Each turn re-walked the UI / re-grepped the
  fleet from zero; blocked turns repeated the whole cycle. The checker itself takes 0.09 s — the waste
  was the doctrine demanding a full browser walk PER EDIT and never remembering the result.
- → Rail: rule **O** PROOF TIERS + VERIFY LEDGER: T0 (ms, every turn, CHANGED files only) · T1 (seconds,
  one probe per fix against the RUNNING dev instance) · T2 (minutes, the real-cursor browser walk, ONCE per
  feature, at DELIVER, the LAST step). `.verify-ledger.json` maps file → content-sha → verdict → evidence;
  unchanged sha = not re-verified; check **C11** blocks a delivery while any changed code file lacks a pass
  entry at its current sha. `ledger.cjs status` shows exactly what still needs proof.

## F14. The gate was calibrated on fixtures, not on real conversations
- Graded 3,528 real assistant turns (40 sessions) with the first v5 cut: 65.5% bounced. C9 alone hit 462
  turns — 40% on the operator's own "$0" shorthand, many on IPv4 addresses that match the semver shape,
  the rest on analysis prose with a claim verb somewhere else on the line. C5 hit "let me verify it works",
  "how the record works", "cut-over's done, so mirroring should stop".
- → Rail: C9 requires the claim verb ADJACENT to a non-IPv4 semver or a non-zero price (462 → 79). The
  claim-shape guard strips intent/inquiry/explanation forms. Standing practice: before any checker
  change ships, re-grade the real transcripts (`overblock` script in the session scratchpad) — a regex
  that passes its plants can still bounce two thirds of real turns.

## F15. My own drill instrument silently did not fire — twice in one day
- Passed a git-bash `/tmp` transcript path to the hook on Windows → node could not resolve it → the turn
  was "unavailable" → every claim check abstained → the drill looked clean. Then `pg_isready` answered
  during Postgres init before the database existed → the restore ran against nothing, logged zero SQL
  errors, and the "restored" DB had no tables.
- → Rail: house rule R8 applies to the DRILL too. A drill step must assert its condition fired (transcript
  parsed N chars; DB has N tables) before its verdict counts. `dev.sh db` waits for `select 1` on the real
  database, not on pg_isready.

# Installing the contract kit (v5) into a project

Paste the prompt below at the top of a Claude Code / Claude Desktop chat, **from the root of the
ONE project** you want under contract. (Not a shared/home/catch-all folder — see step 0.)

---
Load my engineering contract kit into THIS project, then obey it.

0. GUARD — first confirm this is the root of ONE project (a single app/repo: it has a
   package.json / pyproject.toml / go.mod / Cargo.toml / .git for THIS project, or I named the
   project). If instead this is a shared or home/catch-all directory holding many unrelated
   projects (Downloads, Documents, Desktop, home), STOP and ask me for the project root path,
   then install into THAT path — never here. (In a catch-all the hook grades the wrong tree:
   C7 blocks every turn on unsigned code, and C6/C11 can never see the code being fixed.)

1. Make a folder `contract-kit/` in the project root.
2. Download these 11 files into contract-kit/ from base URL
   https://hkpl.silkvo.com/cdn/gcs/ck-e35c39d53f33ef0bad3748e9/
   (curl on macOS/Linux, Invoke-WebRequest on Windows PowerShell):
   CLAUDE.md  BLUEPRINT.md  START.md  contract-rules.cjs  ledger.cjs  probe-template.cjs
   settings-hook-example.json  test-hook-e2e.cjs  INSTALL.md
   LESSONS_2026-08-31_stock-session.md  LESSONS_2026-09-02_devloop-gating.md
3. Verify integrity: run `node contract-kit/contract-rules.cjs --selftest` — it MUST print
   "SELFTEST PASS" — then `node contract-kit/test-hook-e2e.cjs` — it MUST print "HOOK E2E PASS".
   If either prints HTML or anything else, the download was blocked — STOP and tell me.
4. If the project root has no BLUEPRINT.md, copy contract-kit/BLUEPRINT.md to the root and
   fill WORKING STATE, NORTH STAR, AUDIENCE and INPUT→OUTPUT for THIS project (the template's
   text describes the kit itself — replace it). Set `SIGN-OFF: no` — I sign, you never auto-sign.
   Then run `node contract-kit/contract-rules.cjs .` — C1–C4 must PASS (INDEX links resolve from
   the root) and C7 must FAIL only on the missing sign-off. Any other FAIL: fix before continuing.
   Also copy contract-kit/START.md to the root and fill its ≤20 lines from facts you can verify now
   (ports, commands, accounts, isolation, traps). START.md is the first thing read every turn.
5. DEV LOOP (rule N) — before any product work: establish how an edit becomes visible WITHOUT an
   image build (bind-mounted source + hot reload; a dev container from the same image on an alt
   port if the project runs in Docker). Write the two commands into the blueprint's DEV LOOP
   section: run-without-rebuild, and ship (ONE build per feature, after DELIVER). Run
   `node contract-kit/contract-rules.cjs .` and make C12 PASS (deps/codegen above `COPY . .`,
   `.dockerignore` present) — surface what it finds as facts for me; do not restructure prod alone.
6. Merge this Stop hook into .claude/settings.json (create the file if missing), PRESERVING any
   hooks already there:
   {"hooks":{"Stop":[{"hooks":[{"type":"command","command":"node contract-kit/contract-rules.cjs --hook ."}]}]}}
7. Read contract-kit/CLAUDE.md in full, adopt rules 0, A–P as binding for this project, and open
   every reply with its load line.
8. WORK RHYTHM from here on (rules O, P): at turn start read WORKING STATE +
   `node contract-kit/ledger.cjs status` — never the whole tree. Every fix = one probe
   (`probes/<id>.cjs` from probe-template.cjs) run against the RUNNING dev instance, writing
   `probes/<id>.verdict.json` and recording the verified files in the ledger, then
   `node contract-kit/ledger.cjs prove probes/<id>.cjs` to prove the probe goes RED on the pre-fix
   code (a probe that cannot fail is refused). Unchanged sha = not re-verified. The real-cursor
   browser walk (rule G) happens ONCE per feature, as the LAST step before DELIVER — never per edit.
   Weekly: `node contract-kit/ledger.cjs stats` — bounced prose becomes a plant, bounced claims stay bounced.

Then tell me what you installed, and REMIND me of what this turns on:
- the hook blocks turns (exit 2) until I write `SIGN-OFF: yes (date)` in BLUEPRINT.md
  (rule B: no product code before sign-off) — the contract working, not a bug;
- the hook grades EVERY turn (~0.1 s): a turn claiming done/works/fixed without a resolving
  artifact (real file / URL / exact command) on the same line is blocked;
- a "fixed" with no fresh `probes/<id>.verdict.json` from an executed probe (condition fired,
  pass, evidence) is blocked, and any fresh red probe in probes/ blocks a claim (C10);
- a delivery claim is blocked while any changed code file lacks a current-sha pass entry in
  `.verify-ledger.json` (C11) or while the Dockerfile rebuilds deps on every edit (C12).
---

## Notes
- Targets Claude **with tools** (Claude Code / Desktop that can download + write files). A plain
  claude.ai chat can read the URL but cannot install it.
- **"Secret" = an unguessable URL, not authentication.** Anyone with the exact link can read it; the
  files include the operator's own quotes and project references.
- To pause enforcement: remove the `Stop` block from `.claude/settings.json`.
- To grade a project by hand any time: `node contract-kit/contract-rules.cjs .` (add a report file as
  the 2nd arg to also grade C5/C6/C8/C9/C10/C11 against written claims).
- What still needs proof: `node contract-kit/ledger.cjs status`.
- v4 → v5 upgrade in an existing project: re-download the 10 files over contract-kit/, add a DEV LOOP
  section to the root BLUEPRINT.md, create `probes/`. Existing turns keep working; the new checks only
  fire on fix/delivery claims and on Dockerfiles.

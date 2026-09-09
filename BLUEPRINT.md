# BLUEPRINT — social-engine (independent social layer; Misskey fork + adapters for hkpl / pyke / any host)

MODE: explore
PROJECT: root@kaka.silkvo.com:/root/social-engine  (this chat's cwd holds the blueprint + hook; code lives on kaka)

## WORKING STATE
Current step: PHASE 0 CLOSED (both probes PASS) → DEMO SEEDED 2026-09-10 (10 HKPL clubs as channels with logos, 12 demo players, 30 meet posts, 86 replies/reactions; `ops-seed_demo.py`; demo tokens in /root/social-engine.demo-users) → NEXT = MEET FLOW (docs/FLOW_MEET_SPEC_20260910.md, awaiting operator go on §4) then dev loop (rule N: Misskey `pnpm dev` is RAM-heavy on kaka — decide dev-in-container vs off-box) then events module build. Earlier: **2026-09-10 00:3x: SIGN-OFF: yes received; stack UP on kaka** (`docker compose -f compose.prod.yml up -d`: db healthy, redis, web healthy with caps 1536M/512M/256M; fix needed on the way: `.config` chowned to container uid 991, mode 640). Web log: "Now listening on port 3000 on https://social.silkvo.com"; `curl http://127.0.0.1:3960/` → 200; `https://social.silkvo.com/` → 200 (L5). Admin `admin` created by operator (setupPassword set once, then removed from config; web restarted). Admin token moved browser→`/root/social-engine.admintoken` (600) without display. `ops-apply_object_storage.sh` → `admin/update-meta` 204; read-back: useObjectStorage true, bucket silkvo-social, base https://media.social.silkvo.com, federation none, disableRegistration true. **Probes:** `probes/no-fed.verdict.json` PASS (federation none, registration off, POST /inbox → 403). `probes/oss-upload.verdict.json` **FAIL** — web log: `Upload Failed: key=files/… AccessDenied: You have no right to access this object because of bucket acl` and SDK checks from inside the container return AccessDenied / "bucket does not belong to you" for HEAD/ACL → the RAM user `silkvo-social` has NO permission on the bucket (policy not attached) and bucket ACL is private. Phantom drive row deleted. Operator attached the OSS permission + set bucket ACL public-read (2026-09-10) → re-run `probes/oss-upload.verdict.json` **PASS** (64 KB upload → https://media.social.silkvo.com/files/… HTTP 200, sha256 identical). **PHASE 0 GATE CLOSED (L6 on both probes).** Probe object deleted via drive/files/delete. Next: lock working set + commit (rules Q/R), then PHASE 1 = hkpl adapter (SSO endpoint in hkpl → Misskey session; clubs → channels; stock client in com.hkpl.app shell) + dev loop (compose.dev.yml, bind-mount, pnpm dev on :3970). Misskey 2026.9.0 (upstream master c7b8cdca97) cloned into /root/social-engine on kaka; contract-kit v6 armed there (`bootstrap.cjs` → hook armed: yes · integrity v6@379dba191765; hook e2e PASS); phase-0 scaffolding committed locally as 3a153ed92b (compose.prod.yml, .github/workflows/build-image.yml, BLUEPRINT/START, docs, contract-kit); 2026-09-10 00:xx: fork `Venobbuk/social-engine` CREATED by me via the operator's signed-in GitHub session in the controlled Chrome (:9333) — it had never existed; deploy key (SHA256:Fmc0nFNT…) attached with write access the same way; `git push origin master` OK (c7b8cdca97..3a153ed92b, then 40c7be1a65 "ci: build on master"); Actions enabled on the fork (upstream's workflows also run — prune later). Infisical: operator logged in (account vincentsio88@gmail.com; Google/GitHub SSO buttons are unconfigured on that instance); SMTP wired + captcha blanked on kaka (`probes/infisical-smtp.cjs` PASS); folder `/social-engine` created in project estate env dev with OSS_SOCIAL_BUCKET/REGION/ENDPOINT/PUBLIC_BASE_URL set and OSS_SOCIAL_ACCESS_KEY_ID/SECRET as REPLACE_ME placeholders for the operator to fill in the UI; C7 FAILS by design until SIGN-OFF: yes; C12 FAILS on upstream's Dockerfile layout (deps after COPY) — builds run on GitHub Actions with layer cache, not on kaka, so surfaced, not restructured; nginx vhosts + Let's Encrypt cert for social.silkvo.com and media.social.silkvo.com LIVE (https social → 502 until app; media → OSS 403 until first object); root disk grown 160→200 GB (50 GB free); OSS bucket silkvo-social (cn-hongkong, Block Public Access OFF, ACL private) created by operator; RAM key pair to be rotated and stored by operator in secrets.silkvo.com (names OSS_SOCIAL_*).
Last completed: 2026-09-09 — spec `D:\Downloads\SPEC_SOCIAL_ENGINE_20260909.md` (draft, unsigned); bedrock doc `D:\Downloads\HKPL_VS_RECLUB_BEDROCK_20260909.md`; compose + GitHub Actions build workflow drafted (scratchpad/social-engine-phase0/); contract-kit v6 files fetched into PROJECT/contract-kit and here; local Stop hook wired; local selftest PASS.
Next action: 2026-09-10 — operator pasted the rotated OSS key pair into Infisical; `/root/infisical/social_env_sync.py` wrote `/root/social-engine.env` (6 keys, placeholders: none). Image build SUCCEEDED on GitHub Actions (run 34375165363, 2026-09-09 16:11→16:21Z); package `ghcr.io/venobbuk/social-engine` made public via the operator's GitHub session; tag `master` pullable anonymously from kaka (`docker manifest inspect` OK); `latest` absent because the fork's default branch is develop → workflow now tags latest on master (commit pushed). `probes/social-env.verdict.json` PASS (six keys, no placeholders). `.config/default.yml` + `/root/social-engine.dbpass` written on kaka (600, gitignored). When the image lands: `cd /root/social-engine && docker compose -f compose.prod.yml pull && up -d` (caps) → first-run admin account created by operator in the controlled browser → admin token file `/root/social-engine.admintoken` (operator-created) → `apply_object_storage.sh` (scratchpad/social-engine-phase0/) sets OSS + federation none + registration off via admin/update-meta → probes `oss-upload` and `sso`. NOTHING product-side is built until SIGN-OFF: yes below.

## NORTH STAR
One self-hosted social engine at social.silkvo.com (forked Misskey, AGPL, public fork) that any silkvo property mounts through a small adapter contract: hkpl becomes a Reclub-class social open-play platform, pyke gets a TikTok/Xiaohongshu-shaped community with commerce behind it, later properties plug in the same way. One identity across the estate; money stays in pyke; league logic stays in hkpl.

## AUDIENCE & SOPHISTICATION BAR
Audience: the operator (Vincent) and future collaborators; end users = hkpl's 2,642 members (386 active/30d) and pyke shoppers, HK, zh-Hant/zh-Hans/en, on WeChat/Android/iOS/web.
Bar: experience parity with the apps they already use (feed, reactions, video, chat) using stock Misskey wherever it can be shown; everything we add is a probe-proved module; the shared box never OOMs (caps on every container, builds off-box); media never on disk.

## INPUT → EXPECTED OUTPUT
- Input: a host-signed SSO JWT → Output: a Misskey session for that external user (probe `sso`).
- Input: a video upload → Output: object in OSS `silkvo-social`, served at https://media.social.silkvo.com/… (probe `oss-upload`); later: HLS variants from the transcode worker.
- Input: a note with `refs` → Output: a card resolved from the host (probe `ref-card`).
- Input: an RSVP on a full event → Output: waitlist position; on a cancel → auto-promotion + notification (probe `waitlist`).
- Input: a priced RSVP → Output: pyke pay URL → webhook → `payment_state=paid` (probe `pay-seam`, gated on pyke booking readiness).
- Input: a code edit → Output: visible in the dev instance without an image build (rule N).

## PIPELINE
DISCUSS → BLUEPRINT → SIGN-OFF → BUILD (T0+T1 per fix, no rebuilds) → WALK-UAT (T2, once) → DELIVER → SHIP (one build, off-box).

## DEV LOOP
Run without rebuild: <to be established in phase 0 — plan: `docker compose -f compose.dev.yml up` on kaka: same image, /root/social-engine bind-mounted, `pnpm dev` (backend watch + vite), alt port 3970, own postgres/redis on alt ports, federation none, SMTP blackholed>
Ship (one build per feature): push to `main` → GitHub Actions `build-image.yml` → ghcr.io/venobbuk/social-engine → on kaka `docker compose pull && docker compose up -d` (never build on kaka)
Image layout: upstream Misskey multi-stage Dockerfile (deps installed before COPY of sources; .dockerignore present upstream) — verify with C12 once the tree is in place.

## SIGN-OFF
SIGN-OFF: yes (2026-09-10) — operator wrote "SIGN-OFF: yes" in chat after the spec (docs/SPEC_SOCIAL_ENGINE_20260909.md §10) and the decisions of 2026-09-09: AGPL yes; first adapter hkpl; model C; box kaka with caps; OSS cn-hongkong; repo Venobbuk/social-engine.

## DECISIONS
- 2026-09-09 — Build the social layer as an INDEPENDENT system with left/right adapters; do not put it inside hkpl or pyke; never reshape pyke (estate law) or hkpl's league engine.
- 2026-09-09 — Base = fork of misskey-dev/misskey (Node/TS, Postgres, Redis; federation defaults to `none`; object storage, chat, roles, channels, zh-TW/zh-CN built in). No fork of Misskey beats upstream for a closed deployment (Sharkey 14 months behind, CherryPick dormant, others niche). AGPL accepted → fork is public.
- 2026-09-09 — Model C: one instance = the network and identity home; one Channel + Role per site; host-branded faces on host domains; public face of social.silkvo.com closed at launch. Per-site instances only for hard isolation later.
- 2026-09-09 — Front-end: stock Misskey client everywhere it can be shown (hkpl Capacitor shell, pyke web view, WeChat mini-program web-view); build only the vertical video feed page in uni-app for pyke; waterfall later if usage demands.
- 2026-09-09 — Box: kaka, no CPU/RAM upgrade; disk added (+40 GB → 200 GB). Conditions: cgroup caps (web 1536M, db 512M, redis 256M, transcode 1024M/2 cpus), NO builds on kaka (GitHub Actions → ghcr), media on Aliyun OSS cn-hongkong (bucket silkvo-social, internal endpoint for uploads, public base https://media.social.silkvo.com), Meilisearch off, one transcode job at a time.
- 2026-09-09 — Domains: social.silkvo.com (engine), media.social.silkvo.com (OSS front; later CNAME to Aliyun CDN with private origin). DNS-only at Cloudflare (no proxy: 100 MB upload cap + websockets).
- 2026-09-09 — Credentials: the agent never handles keys. A key pair pasted into chat is considered exposed → operator rotates; new pair stored by operator in secrets.silkvo.com (Infisical) under OSS_SOCIAL_*; container reads it via env file / admin panel.
- 2026-09-09 — First adapter = hkpl (SSO endpoint in hkpl, 196 clubs → channels, Misskey client in com.hkpl.app shell). pyke adapter second. Pay seam: pyke is the ledger for priced events on both hosts, superseding hkpl's 2026-08-03 Stripe-direct blueprint.

## OPEN
- Deploy key refused by GitHub (fingerprint above) — operator to verify on repo Settings → Deploy keys; API shows repo 404 (private or absent).
- OSS key rotation + Infisical entries (operator).
- SIGN-OFF line (operator).
- Phase-0 unknowns to be settled by probes: AWS SDK checksum behaviour against OSS; Misskey Node 26 image on kaka's Docker 26.1; dev-loop command for a pnpm monorepo without a host build.
- hkpl migration mode (replace dormant open-play/feed with engine pages vs run both) — recommended replace; decide at phase 1.

## INDEX
- [CLAUDE.md](contract-kit/CLAUDE.md) — the contract (rules 0, A–V).
- [BLUEPRINT.md template](contract-kit/BLUEPRINT.md) — kit template this file was filled from.
- [START.md](START.md) — per-project start card (this project).
- [contract-rules.cjs](contract-kit/contract-rules.cjs) — checks + selftest + hook.
- [ledger.cjs](contract-kit/ledger.cjs) — verify ledger CLI.
- [probe-template.cjs](contract-kit/probe-template.cjs) — probe skeleton for probes/<id>.cjs.
- [bootstrap.cjs](contract-kit/bootstrap.cjs) — integrity + arm-or-refuse.
- [manifest.json](contract-kit/manifest.json) — v6 file hashes.
- [Spec — social engine](docs/SPEC_SOCIAL_ENGINE_20260909.md) — the L1 spec awaiting sign-off.
- [Bedrock — hkpl vs Reclub](docs/HKPL_VS_RECLUB_BEDROCK_20260909.md) — evidence base.
- [Meet flow — Reclub mapped vs ours](docs/FLOW_MEET_SPEC_20260910.md) — L1 draft awaiting meet-flow sign-off; build plan for the events module.

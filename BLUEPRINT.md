# BLUEPRINT — social-engine (independent social layer; Misskey fork + adapters for hkpl / pyke / any host)

MODE: explore
PROJECT: root@kaka.silkvo.com:/root/social-engine  (this chat's cwd holds the blueprint + hook; code lives on kaka)

## WORKING STATE
Current step: PHASE 0 — bootstrap. Upstream Misskey cloning into /root/social-engine on kaka (HTTPS, in progress); origin set to github-social-engine:Venobbuk/social-engine.git (deploy key still refused by GitHub — operator to check fingerprint SHA256:Fmc0nFNTHKUVddl4k/QToOMNgFPV9m/PTIUYPksA6XQ); nginx vhosts + Let's Encrypt cert for social.silkvo.com and media.social.silkvo.com LIVE (https social → 502 until app; media → OSS 403 until first object); root disk grown 160→200 GB (50 GB free); OSS bucket silkvo-social (cn-hongkong, Block Public Access OFF, ACL private) created by operator; RAM key pair to be rotated and stored by operator in secrets.silkvo.com (names OSS_SOCIAL_*).
Last completed: 2026-09-09 — spec `D:\Downloads\SPEC_SOCIAL_ENGINE_20260909.md` (draft, unsigned); bedrock doc `D:\Downloads\HKPL_VS_RECLUB_BEDROCK_20260909.md`; compose + GitHub Actions build workflow drafted (scratchpad/social-engine-phase0/); contract-kit v6 files fetched into PROJECT/contract-kit and here; local Stop hook wired; local selftest PASS.
Next action: when clone finishes → `node contract-kit/bootstrap.cjs` on kaka; copy compose.yml + .github/workflows/build-image.yml into the repo; `.config/default.yml` (federation none, registration off, objectStorage → OSS via env); first push to the fork (needs the deploy key); GitHub Actions builds image; `docker compose up` with caps; probes `oss-upload` and `sso` (phase 0 gate). NOTHING product-side is built until SIGN-OFF: yes below.

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
SIGN-OFF: no
(Operator flips this to `SIGN-OFF: yes (date)` after reading D:\Downloads\SPEC_SOCIAL_ENGINE_20260909.md §10. Decisions already given verbally on 2026-09-09: AGPL yes; first adapter hkpl; model C; box kaka with caps; OSS cn-hongkong; repo Venobbuk/social-engine.)

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

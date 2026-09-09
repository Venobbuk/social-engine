# START — social-engine (≤20 lines; read FIRST every turn)
What it is: independent self-hosted social engine (Misskey fork, AGPL, public repo Venobbuk/social-engine) mounted by hkpl, pyke and future silkvo properties via adapters (SSO in, REST/WS out, signed webhooks back). Operator = Vincent.
Live: https://social.silkvo.com (nginx → 127.0.0.1:3960, vhost /etc/nginx/sites-enabled/social.silkvo.com.conf) · https://media.social.silkvo.com (nginx → OSS bucket silkvo-social, cn-hongkong) · cert /etc/letsencrypt/live/social.silkvo.com (both names) · app NOT UP YET (phase 0)
Box: root@kaka.silkvo.com (SHARED with hkpl/pyke/kaka/mimi/pulse…; 8 vCPU, 15 GB RAM, swap already full, 200 GB disk / 50 GB free). Caps on every container; NEVER `docker build` on kaka (BuildKit ignores memory limits — 4 prior OOMs). Images come from ghcr via GitHub Actions.
Code: /root/social-engine (git; remote `upstream` = misskey-dev/misskey, `origin` = github-social-engine:Venobbuk/social-engine.git via /root/.ssh/social-engine_ed25519 — key currently REFUSED by GitHub, operator checking).
Dev loop (rule N): TO ESTABLISH in phase 0 — plan: compose.dev.yml, bind-mounted source, `pnpm dev`, port 3970, own db/redis on alt ports.
Ship: push main → Actions builds → `cd /root/social-engine && docker compose pull && docker compose up -d`.
Secrets: OSS_SOCIAL_* live in secrets.silkvo.com (Infisical) → /root/social-engine.env (600) created by the OPERATOR; the agent never reads/writes/prints key values. Any key seen in chat = exposed → rotate.
Blueprint: BLUEPRINT.md (this cwd; WORKING STATE on top) · spec D:\Downloads\SPEC_SOCIAL_ENGINE_20260909.md · ledger `node contract-kit/ledger.cjs status` · probes probes/<id>.cjs → verdict → `ledger.cjs prove`.
Isolation: federation `none`; registration off; content hidden from logged-out; dev instance must never email, never hit pyke pay, never write to the prod OSS prefix (use `dev/` prefix).
Doctrine (traps already met):
- Prod DB for hkpl is 5433 and read-only for probes; the engine gets its OWN postgres/redis (compose project social-engine) — never share hkpl's.
- Cloudflare: keep both social records DNS-only (proxy = 100 MB upload cap, websocket limits).
- OSS bucket ACL private + Block Public Access OFF; objects get public-read per upload; media served via media.social.silkvo.com.
- The hkpl Android app exists (com.hkpl.app on Play, AAB /root/app-release.aab); PushDevice=0 rows → push never fired; hkpl modules open_play/tournament/social_games are OFF in prod (`/api/v1/public/tenant-brand`).
- Claims: every level stated; nothing is "working" below L6 with the command/log line attached.
Open items live in BLUEPRINT.md OPEN — do not duplicate them here.

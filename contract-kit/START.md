# START — <project> (≤20 lines; the FIRST thing read every turn, before anything else)
What it is: <one line — what the system does and who uses it>
Live: <url> · port <n> (docker/pm2) · DB <host:port/db> · redis <port> · nginx vhost <file>
Dev loop (rule N): <run-without-rebuild command, e.g. /root/<proj>-docker/dev.sh up → http://127.0.0.1:<port>> — edit → serving in ~2 s, 0 builds
Ship (one build per feature, after DELIVER): <command>
Repo: <dev clone path> → `scripts/git-save.sh "<msg>" <explicit paths>` (never -a; the tree is shared with other sessions) → prod pulls via deploy
Blueprint: BLUEPRINT.md (read WORKING STATE) · ledger: `node contract-kit/ledger.cjs status` · probes: probes/<id>.cjs → verdict → `ledger.cjs prove`
Roles / test accounts: <role → how to sign in on the dev instance>
Isolation: <uat tenant / sandbox DB / what must NEVER be hit from dev (mail, payments, external APIs)>
Doctrine (project-specific traps, one line each):
- <e.g. never edit prod checkout — edit dev clone, commit, deploy>
- <e.g. bump SW cache VERSION on any static change>
- <e.g. read voice_transcript, not message>
- <e.g. every fix updates the report row status + admin_notes (R9)>
Open items live in BLUEPRINT.md OPEN — do not duplicate them here.

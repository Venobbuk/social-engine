# modules/competitions — user-created competitions (TOURNAMENT-V1, 2026-09-19)

Self-contained module of the social engine: a GripBat player (host or club owner) creates and runs a tournament the way
a Reclub admin does (docs: `D:\Downloads\reclub_forensic\spec_competition_dupr.md` §2, §3.1–3.2, §Y.1–Y.2; host walk
§10 CREATE COMPETITION). Everything competition-specific lives here: entities (`models/`), the state machine
(`CompetitionService.ts`), the pure standings / result module (`CompetitionStandings.ts`), the knockout adapter over
brackets-manager (`CompetitionBracket.ts`), the API packer (`CompetitionEntityService.ts`) and the endpoints
(`endpoints/`, registered as `competitions/*`).

Boundary rules (the meets README's): the rest of Misskey is touched only through registration lines (entity list,
DI symbols, repository providers, CoreModule providers, endpoint list) plus ONE read in `UserEntityService` — the
`placements` field of a detailed `users/show`, a raw query over `competition_award` so a profile shows its podiums.
This module imports ONE thing from another module: `modules/meets/MeetMatchGenerator.generate` (the circle-method
round robin) for round-robin and pool stages, per `research_match_generation.md` §5 ("MeetMatchGenerator already does
round robin — reuse it"). Knockouts (single / double elimination, BYEs, seeding, third-place match) are
`brackets-manager` + `brackets-memory-db` (pure JS, no native deps): the whole brackets database of a competition is
the JSON on `competition.bracketData`; every operation imports it, runs the manager, exports it back, and the rows
of `competition_match` mirror it (`bracketId`).

Lifecycle: `draft → publish → open → lock → closed → start → inProgress → finish → done`; `reopen` (closed → open),
`reopenEnded` (done → inProgress), `reset` (matches + bracket wiped), `cancel`. Entries: `competitions/enter`
(self, autoApprove decides confirmed / pending), `competitions/entries/update` (host add / approve / seed / pool /
paid / forfeit / remove), `competitions/withdraw`. Draw: `competitions/draw` (auto picks the missing stage; pools
→ playoffs once every pool match is complete; `reset` redraws). Results: `competitions/matches/upsert` (score sets
`{t1,t2,type}`, forfeit, finalize, reopen, extra matches). Tables: `competitions/standings`. Podium:
`competitions/awards` + `competitions/awards/upsert`. Chat: `competitions/chat` → the general chat room (meet
pattern: minted at create, entrants joined when confirmed).

Migration: `migration/1789010000000-tournament-v1.js` (additive, idempotent). Probe: `probes/tournament-v1.probe.cjs`
on kaka (UAT).

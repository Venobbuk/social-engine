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

COMP-W1B4 (2026-09-20, wave 1 lane B4; Reclub triage family "competitions"): migration
`1789094000000-competitions-w1b4.js` (additive). **Teams with consent** — `competition_entry.invitedUserIds`: a partner
named by the entrant waits there until `competitions/invitations/respond` (accept → seated + chat; decline → the place
opens); `competitions/invitations` lists my open ones; `competitions/entries/partners` lets the captain re-invite /
cancel. Block-aware through `CompetitionService.assertNoBlocks` (either direction). The guard inside `enter()` /
`assertTeam()` (partners go to invitedUserIds, blocks refused) is lane A's patch — contract `kaka:/root/gen/w1-engine-api.md`.
An incomplete team (fewer accepted players than teamMinSize) is never drawn and is withdrawn at the start.
**Join an existing team** — `requestedUserIds` + `competitions/entries/join` / `competitions/entries/requests/decide`.
**Free agents** — an entry with status `freeAgent` (one player + notes; outside every count, never drawn, never an
already_entered lock): `competitions/free-agent`, host `competitions/free-agents/assign`; free agents leave at the start.
**Staff** — `competition.adminIds` (co-admins pass every host gate: `isHost` admits them, `isOwner` is the creator) and
`refereeIds` (score + finalize any match, open the chat): `competitions/staff/update`. **Announcements** —
`competition.announcements` jsonb + `competitions/announcements/post|delete` (every player + staff notified). A match
whose time / court the host changes (`competitions/matches/upsert` startAt / courtIndex) notifies its players.

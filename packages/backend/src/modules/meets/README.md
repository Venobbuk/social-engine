# modules/meets — the meet (social open-play) module

Self-contained module of the social engine. Everything meet-specific lives here: entities (`models/`), the
state machine (`MeetService.ts`), the API packer (`MeetEntityService.ts`), the minute sweep
(`MeetSweepProcessorService.ts`) and the API endpoints (`endpoints/`). The rest of Misskey is touched only
through registration lines (entity list, DI symbols, repository providers, CoreModule providers, queue job
name, endpoint list) and the SSO adapter's level sync.

Boundary rules: nothing outside this folder imports from it except those registration points; this folder
uses Misskey only for accounts, chat rooms, notifications, ids, queue logging and the endpoint base class.
Other hosts (pyke) may use or ignore the module; the hkpl/pyke adapters stay outside it.

Spec: docs/spec_meets.md (Reclub-derived), docs/MEET_MODULE_PLAN_20260910.md, docs/FLOW_MEET_SPEC_20260910.md.

#!/bin/bash
# Run an engine probe, then ALWAYS sweep its leftovers (probes/_sweep.cjs). Exit code is the probe's.
#
# THIS WRAPPER IS MANDATORY (2026-09-20). It is the only thing that sweeps a probe's fixtures afterwards, and probes
# refuse to start without the PROBE_WRAPPED marker it sets — see probes/_guard.cjs for why (measured: two probes on
# the box had been launched bare, leaving 243 fixtures in the sandbox with nothing but the nightly reset to clear
# them, which is how '[probe]' threads reached an independent tester's Inbox).
#
# THE DATABASE. _sweep.cjs takes its database from SE_DB and defaults to `social` — PRODUCTION. Probes run against the
# SANDBOX (se_sbx, Redis db 1), so every "always sweep" here used to scrub the one database the probe had not touched.
# Both are swept, so neither can be the forgotten one. A sweep of a clean database is a no-op. The notification sweep
# (Redis, every db) runs inside _sweep.cjs and is idempotent, so it is asked for once.
cd /root/social-engine/probes || exit 2
PROBE_WRAPPED=1 node "$1"; code=$?
SE_DB=se_sbx node _sweep.cjs
SWEEP_NOTIF=skip SE_DB=social node _sweep.cjs
exit $code

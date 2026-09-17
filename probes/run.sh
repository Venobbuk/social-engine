#!/bin/bash
# Run an engine probe, then ALWAYS sweep its leftovers (probes/_sweep.cjs). Exit code is the probe's.
cd /root/social-engine/probes || exit 2
node "$1"; code=$?
node _sweep.cjs
exit $code

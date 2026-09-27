#!/bin/bash
# GIPHY-RATING-G-V1 unit probe runner: the engine's own image, --network none, the REAL GbChatExtras.ts.
#   bash probes/giphy-rating.unit.sh                                   # this worktree (after)
#   SRC=<a GbChatExtras.ts> TAG=before bash probes/giphy-rating.unit.sh # e.g. origin/master's copy
set -euo pipefail
WT=${WT:-/root/se-wt-enginefix}
SRC=${SRC:-$WT/packages/backend/src/core/GbChatExtras.ts}
TAG=${TAG:-after}
OUT=$WT/probes/giphy-rating.unit.$TAG.verdict.json
IMG=${IMG:-$(docker inspect social-engine-web-uat-1 --format '{{.Config.Image}}')}
T=$(mktemp -d /tmp/gr-unit.XXXXXX); trap 'rm -rf "$T"' EXIT
cp "$SRC" "$T/GbChatExtras.ts"; cp "$WT/probes/giphy-rating.unit.mjs" "$T/"
chmod 755 "$T"; chmod 644 "$T"/*
docker run --rm --network none -v "$T:/t:ro" --entrypoint node "$IMG" /t/giphy-rating.unit.mjs > "$T/out.json"
cp "$T/out.json" "$OUT"
node -e 'const v=require(process.argv[1]);console.log("VERDICT",v.verdict,"|",v.evidence.join(" | "))' "$OUT"
echo "verdict file: $OUT (image $IMG)"

#!/usr/bin/env bash
# apply_object_storage.sh — push OSS settings from /root/social-engine.env into Misskey's instance meta via admin API.
# Values are read from the env file on the box and sent to the local API only; nothing is printed.
# Usage: MISSKEY_ADMIN_TOKEN_FILE=/root/social-engine.admintoken ./apply_object_storage.sh [http://127.0.0.1:3960]
set -euo pipefail
API="${1:-http://127.0.0.1:3960}"
TOKEN_FILE="${MISSKEY_ADMIN_TOKEN_FILE:-/root/social-engine.admintoken}"
ENV_FILE="/root/social-engine.env"
[ -r "$TOKEN_FILE" ] || { echo "admin token file missing: $TOKEN_FILE"; exit 2; }
[ -r "$ENV_FILE" ] || { echo "env file missing: $ENV_FILE"; exit 2; }
set -a; . "$ENV_FILE"; set +a
TOKEN="$(tr -d '[:space:]' < "$TOKEN_FILE")"
payload=$(python3 - <<PY
import json, os
print(json.dumps({
  "i": "${TOKEN}",
  "useObjectStorage": True,
  "objectStorageBucket": os.environ["OSS_SOCIAL_BUCKET"],
  "objectStoragePrefix": "files",
  "objectStorageBaseUrl": os.environ["OSS_SOCIAL_PUBLIC_BASE_URL"],
  "objectStorageEndpoint": os.environ["OSS_SOCIAL_ENDPOINT"],
  "objectStorageRegion": os.environ["OSS_SOCIAL_REGION"],
  "objectStorageAccessKey": os.environ["OSS_SOCIAL_ACCESS_KEY_ID"],
  "objectStorageSecretKey": os.environ["OSS_SOCIAL_ACCESS_KEY_SECRET"],
  "objectStorageUseSSL": True,
  "objectStorageUseProxy": False,
  "objectStorageSetPublicRead": True,
  "objectStorageS3ForcePathStyle": False,
  "federation": "none",
  "disableRegistration": True,
  "emailRequiredForSignup": False
}))
PY
)
code=$(curl -s -o /tmp/apply_os.out -w "%{http_code}" -H "Content-Type: application/json" -d "$payload" "$API/api/admin/update-meta")
echo "admin/update-meta -> HTTP $code"
[ "$code" = "204" ] || { sed -E 's/"objectStorage(AccessKey|SecretKey)":"[^"]*"/"objectStorage\1":"<hidden>"/g' /tmp/apply_os.out | head -c 300; echo; exit 1; }
# read back (secret key is never returned by admin/meta; access key is)
curl -s -H "Content-Type: application/json" -d "{\"i\":\"$TOKEN\"}" "$API/api/admin/meta" | python3 -c "import sys,json; m=json.load(sys.stdin); print({k:m.get(k) for k in ['useObjectStorage','objectStorageBucket','objectStorageBaseUrl','objectStorageEndpoint','objectStorageRegion','objectStorageSetPublicRead','federation','disableRegistration']})"

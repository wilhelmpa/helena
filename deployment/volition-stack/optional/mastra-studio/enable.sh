#!/usr/bin/env bash
set -euo pipefail
studio_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
stack_dir="${VOLITION_STACK_DIR:-/home/pw/services/volition-stack}"
cd "$studio_dir"
docker compose -f compose.yml up -d --wait --wait-timeout 60
python3 tests/probe.py >/dev/null
route_result="$(python3 gateway-route.py add --config "$stack_dir/config/gateway.json")"
printf '%s\n' "$route_result"
# Recreate this container only so its read-only config bind sees the new inode.
if ! docker compose -f "$stack_dir/compose.gateway.yml" up -d --no-deps --force-recreate gateway; then
  if [[ "$route_result" == 'gateway-route: added:'* ]]; then
    python3 gateway-route.py remove --config "$stack_dir/config/gateway.json"
    docker compose -f "$stack_dir/compose.gateway.yml" up -d --no-deps --force-recreate gateway || true
  fi
  printf '%s\n' 'Gateway activation failed; newly added Studio routing was reverted. Check gateway status before continuing.' >&2
  exit 1
fi
printf '%s\n' 'Studio enabled: https://plan.volition.one/mastra/workflows'

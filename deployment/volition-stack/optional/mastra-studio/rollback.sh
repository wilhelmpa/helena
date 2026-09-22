#!/usr/bin/env bash
set -euo pipefail
studio_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
stack_dir="${VOLITION_STACK_DIR:-/home/pw/services/volition-stack}"
cd "$studio_dir"
# Remove only our exact route, preserving all concurrent unrelated configuration.
python3 gateway-route.py remove --config "$stack_dir/config/gateway.json"
docker compose -f "$stack_dir/compose.gateway.yml" up -d --no-deps --force-recreate gateway
docker compose -f compose.yml down
printf '%s\n' 'Studio removed from the gateway; its container and network are stopped/removed.'
printf '%s\n' 'The source, image, isolated data volume and pre-change configuration snapshot remain for recovery.'

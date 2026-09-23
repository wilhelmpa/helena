#!/bin/bash
# The Plan API the isolation proof tests run against: this checkout on 127.0.0.1:3900 with a
# test database of its own in the private Postgres of ~/agent-work (plan-isolation-setup.sh).
#   plan-api.sh start | stop | seed
set -euo pipefail
repo=$(cd "$(dirname "$0")/../../../.." && pwd)
proof=$HOME/agent-work/plan-isolation-proof
port=${PLAN_PROOF_PORT:-3900}
db=postgres://wilhelmpa@127.0.0.1:55481/itsaplan_isolation_test
mkdir -p "$proof"
cd "$repo"
env_file=$proof/api.env
sed "s#^DATABASE_URL=.*#DATABASE_URL=$db#" .env.test > "$env_file"
chmod 600 "$env_file"
case "${1:-}" in
  start)
    /usr/lib/postgresql/17/bin/createdb -h 127.0.0.1 -p 55481 -U wilhelmpa itsaplan_isolation_test 2>/dev/null || true
    BACKUP_DIR=$HOME/agent-work/tmp bun --env-file="$env_file" packages/db/src/migrate.ts 2>&1 | tail -1
    # A transient unit of its own, so it outlives the shell that started it.
    sudo -n systemctl stop vpt-plan-api.service 2>/dev/null || true
    sudo -n systemd-run --unit=vpt-plan-api --quiet --collect --uid="$(id -u)" --gid="$(id -g)" \
      --working-directory="$repo" -p ProtectSystem=full \
      --setenv=AGENT_EGRESS_TOKEN_FILE="$proof/egress.token" --setenv=API_HOST=127.0.0.1 \
      --setenv=API_PORT="$port" --setenv=TMPDIR="$HOME/agent-work/tmp" \
      /usr/local/bin/bun --env-file="$env_file" apps/api/src/index.ts
    for _ in $(seq 60); do curl -sf -o /dev/null "http://127.0.0.1:$port/" && break; sleep 0.5; done
    curl -sf "http://127.0.0.1:$port/" && echo
    ;;
  seed)
    (cd apps/api && NODE_ENV=test bun --env-file="$env_file" src/__tests__/isolation-proof/seed.ts "$proof/keys.json")
    ;;
  stop)
    sudo -n systemctl stop vpt-plan-api.service 2>/dev/null || true
    ;;
  *) echo "usage: plan-api.sh start|stop|seed" >&2; exit 64 ;;
esac

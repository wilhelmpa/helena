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
    if [[ -f $proof/api.pid ]] && kill -0 "$(cat "$proof/api.pid")" 2>/dev/null; then kill "$(cat "$proof/api.pid")"; sleep 1; fi
    AGENT_EGRESS_TOKEN_FILE=$proof/egress.token API_HOST=127.0.0.1 API_PORT=$port \
      nohup bun --env-file="$env_file" apps/api/src/index.ts > "$proof/api.log" 2>&1 &
    echo $! > "$proof/api.pid"
    for _ in $(seq 60); do curl -sf -o /dev/null "http://127.0.0.1:$port/" && break; sleep 0.5; done
    curl -sf "http://127.0.0.1:$port/" && echo
    ;;
  seed)
    (cd apps/api && NODE_ENV=test bun --env-file="$env_file" src/__tests__/isolation-proof/seed.ts "$proof/keys.json")
    ;;
  stop)
    if [[ -f $proof/api.pid ]]; then kill "$(cat "$proof/api.pid")" 2>/dev/null || true; rm -f "$proof/api.pid"; fi
    ;;
  *) echo "usage: plan-api.sh start|stop|seed" >&2; exit 64 ;;
esac

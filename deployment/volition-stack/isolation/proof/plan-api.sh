#!/bin/bash
# The Plan API the isolation proof tests run against: this checkout on 127.0.0.1:3900 with a
# test database of its own in a private Postgres of ~/agent-work (plan-isolation-setup.sh).
# Runs as the ordinary user (no sudo: wilhelmpa's sudo asks for a password since 2026-09-25);
# only harness.py needs root (reprove.sh, README.md "Proofs").
#   plan-api.sh start | stop | seed
#   PLAN_PROOF_PG_PORT   the private Postgres (default 55481)
#   PLAN_PROOF_PORT      the API's port (default 3900)
#   PLAN_PROOF_DIR       env file, pidfile, log and keys.json (default ~/agent-work/plan-isolation-proof,
#                        where harness.py reads the keys)
set -euo pipefail
repo=$(cd "$(dirname "$0")/../../../.." && pwd)
proof=${PLAN_PROOF_DIR:-$HOME/agent-work/plan-isolation-proof}
port=${PLAN_PROOF_PORT:-3900}
pg_port=${PLAN_PROOF_PG_PORT:-55481}
db=postgres://wilhelmpa@127.0.0.1:$pg_port/itsaplan_isolation_test
pidfile=$proof/api.pid
mkdir -p "$proof" "$HOME/agent-work/tmp"
cd "$repo"
env_file=$proof/api.env
sed "s#^DATABASE_URL=.*#DATABASE_URL=$db#" .env.test > "$env_file"
chmod 600 "$env_file"

stop_api() {
  if [ -f "$pidfile" ]; then
    # Its own session (setsid below): the whole group goes.
    kill -- -"$(cat "$pidfile")" 2>/dev/null || true
    rm -f "$pidfile"
  fi
}

case "${1:-}" in
  start)
    /usr/lib/postgresql/17/bin/createdb -h 127.0.0.1 -p "$pg_port" -U wilhelmpa itsaplan_isolation_test 2>/dev/null || true
    BACKUP_DIR=$HOME/agent-work/tmp bun --env-file="$env_file" packages/db/src/migrate.ts 2>&1 | tail -1
    stop_api
    # A session of its own, so it outlives the shell that started it; stopped by its pidfile.
    AGENT_EGRESS_TOKEN_FILE="$proof/egress.token" API_HOST=127.0.0.1 API_PORT="$port" \
      TMPDIR="$HOME/agent-work/tmp" setsid nohup /usr/local/bin/bun --env-file="$env_file" \
      apps/api/src/index.ts > "$proof/api.log" 2>&1 < /dev/null &
    echo $! > "$pidfile"
    for _ in $(seq 60); do curl -sf -o /dev/null "http://127.0.0.1:$port/" && break; sleep 0.5; done
    curl -sf "http://127.0.0.1:$port/" && echo
    ;;
  seed)
    (cd apps/api && NODE_ENV=test bun --env-file="$env_file" src/__tests__/isolation-proof/seed.ts "$proof/keys.json")
    ;;
  stop)
    stop_api
    ;;
  *) echo "usage: plan-api.sh start|stop|seed" >&2; exit 64 ;;
esac

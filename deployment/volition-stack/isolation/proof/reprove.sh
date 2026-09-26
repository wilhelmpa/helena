#!/bin/bash
# The isolation proofs of this checkout, split at the one point that needs root.
#
#   reprove.sh prepare          as the ordinary user (wilhelmpa): dependencies, the runner bundle,
#                               the private Postgres, the test Plan API and its seed
#   reprove.sh root [--only E]  as root: harness.py teardown, setup, start, prove
#   reprove.sh finish           as the ordinary user: stops the test API and the Postgres
#
# wilhelmpa's sudo asks for a password (since 2026-09-25); root work goes through the helena-ops
# account from the Mac, so a whole run is three commands there:
#
#   R=/home/wilhelmpa/agent-work/plan-isolation/deployment/volition-stack/isolation/proof
#   ssh wilhelmpa@kingston-server.local "$R/reprove.sh prepare"
#   ssh helena-ops@kingston-server.local "sudo $R/reprove.sh root --only E"
#   ssh wilhelmpa@kingston-server.local "$R/reprove.sh finish"
#
#   PLAN_PROOF_PG_PORT   the private Postgres (default 55477, the orchestrator's)
#   PLAN_PROOF_PG_DIR    its data directory (default ~wilhelmpa/agent-work/plan-isolation-pg)
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../../../.." && pwd)
isolation=$(cd "$here/.." && pwd)
export PLAN_PROOF_PG_PORT=${PLAN_PROOF_PG_PORT:-55477}
pg_dir=${PLAN_PROOF_PG_DIR:-/home/wilhelmpa/agent-work/plan-isolation-pg}
pg_ctl=/usr/lib/postgresql/17/bin/pg_ctl

case "${1:-}" in
  prepare)
    [ "$(id -u)" != 0 ] || { echo "prepare runs as the ordinary user, not root" >&2; exit 64; }
    export TMPDIR=$HOME/agent-work/tmp
    mkdir -p "$TMPDIR"
    cd "$repo"
    git log --oneline -1
    bun install --frozen-lockfile >/dev/null
    # The runner bundle the harness copies into the test tree (profile helper, clone job).
    (cd packages/runner && bun build src/cli.ts --target=node --outfile dist/cli.js >/dev/null)
    "$pg_ctl" -D "$pg_dir" status >/dev/null 2>&1 ||
      "$pg_ctl" -D "$pg_dir" -o "-p $PLAN_PROOF_PG_PORT -k $pg_dir -c listen_addresses=127.0.0.1" \
        -l "$pg_dir.log" -w start >/dev/null
    /usr/lib/postgresql/17/bin/dropdb -h 127.0.0.1 -p "$PLAN_PROOF_PG_PORT" -U wilhelmpa --if-exists itsaplan_isolation_test
    "$here/plan-api.sh" stop
    "$here/plan-api.sh" start
    "$here/plan-api.sh" seed >/dev/null
    echo "prepared: now run the root part (reprove.sh root) as root"
    ;;
  root)
    [ "$(id -u)" = 0 ] || { echo "root runs as root (ssh helena-ops@… 'sudo …')" >&2; exit 64; }
    shift
    harness=(/usr/bin/python3 "$here/harness.py")
    "${harness[@]}" teardown >/dev/null
    "${harness[@]}" setup --source "$isolation" >/dev/null
    "${harness[@]}" start >/dev/null
    "${harness[@]}" prove "$@"
    ;;
  finish)
    [ "$(id -u)" != 0 ] || { echo "finish runs as the ordinary user, not root" >&2; exit 64; }
    "$here/plan-api.sh" stop
    "$pg_ctl" -D "$pg_dir" stop -m fast >/dev/null 2>&1 || true
    echo finished
    ;;
  *) sed -n '2,21p' "$0" >&2; exit 64 ;;
esac

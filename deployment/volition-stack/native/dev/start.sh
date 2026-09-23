#!/usr/bin/env bash
# Start the dev API and web servers in the tmux session "plan-dev" (see README.md).
set -euo pipefail

root=$(cd "$(dirname "$0")/../../../.." && pwd)
here="$root/deployment/volition-stack/native/dev"
session=plan-dev
logs="${XDG_STATE_HOME:-$HOME/.local/state}/plan-dev"
mkdir -p "$logs"

[[ -r /etc/volition/plan-dev.env ]] || { echo "start.sh: run setup.sh first" >&2; exit 1; }
if tmux has-session -t "$session" 2>/dev/null; then
  echo "already running: tmux attach -t $session"
  exit 0
fi

tmux new-session -d -s "$session" -n api -c "$root" \
  "$here/with-env.sh bun --watch run apps/api/src/index.ts 2>&1 | tee -a '$logs/api.log'"
tmux new-window -t "$session" -n web -c "$root/apps/web" \
  "$here/with-env.sh node_modules/.bin/next dev -p 3101 --hostname 127.0.0.1 2>&1 | tee -a '$logs/web.log'"
echo "started: tmux attach -t $session (logs in $logs)"

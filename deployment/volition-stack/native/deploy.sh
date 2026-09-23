#!/usr/bin/env bash
# Deploys a branch to the live Plan instance on Kingston: fast-forwards the live checkout,
# migrates the database, rebuilds what runs from a build, restarts what does not reload
# by itself, and checks that everything answers again.
#
#   sudo deployment/volition-stack/native/deploy.sh [branch]    (default: volition/hub)
#
# The API, web and worker services reload on their own when their files change.
set -euo pipefail

[[ $EUID -eq 0 ]] || { echo "deploy.sh: run with sudo" >&2; exit 1; }

live=/srv/volition/source/plan
branch=${1:-volition/hub}
owner=$(stat -c %U "$live")
as_owner() { runuser -u "$owner" -- "$@"; }

before=$(as_owner git -C "$live" rev-parse HEAD)
as_owner git -C "$live" merge --ff-only --quiet "$branch"
after=$(as_owner git -C "$live" rev-parse HEAD)
if [[ $before == "$after" ]]; then
  echo "deploy.sh: $branch is already live"
  exit 0
fi
changed() { ! as_owner git -C "$live" diff --quiet "$before" "$after" -- "$@"; }
restart=()

if changed packages/db/drizzle; then
  echo "migrating the database"
  systemctl start volition-plan-migrate.service
fi

# The runner executes a bundle owned by root, so the agent user it runs as cannot replace
# the code that drives it. The bundle is built by the checkout's owner and installed.
if changed packages/runner; then
  echo "building the runner"
  bundle=$(runuser -u "$owner" -- mktemp --suffix=.js)
  as_owner bash -c "cd '$live/packages/runner' && bun build src/cli.ts --target=node --outfile '$bundle' >/dev/null"
  install -m 0755 -o root -g volition "$bundle" "$live/packages/runner/dist/cli.js"
  rm -f "$bundle"
  restart+=(volition-hermes-runner.service)
fi

if changed deployment/volition-stack/integration; then
  restart+=(volition-provisioning.service volition-hermes-team-bridge.service)
fi

# The runner's start script runs an installed copy of the catalog script, which writes the
# runner config from the Hermes profile.
if changed deployment/volition-stack/integration/scripts/volition-hermes-catalog.py; then
  install -m 0755 "$live/deployment/volition-stack/integration/scripts/volition-hermes-catalog.py" \
    /usr/local/libexec/volition-hermes-catalog.py
  restart+=(volition-hermes-runner.service)
fi

if changed deployment/volition-stack/optional/mastra-studio; then
  echo "building Mastra"
  as_owner bash -c "cd '$live/deployment/volition-stack/optional/mastra-studio' && bun install --frozen-lockfile >/dev/null && bun run build >/dev/null"
  restart+=(volition-mastra.service)
fi

# A restart ends every open terminal session. The shell script and tmux.conf are read
# for each new session, so only the router and the unit need one.
if changed deployment/volition-stack/native/terminal/project-terminal-router.mjs \
  deployment/volition-stack/native/systemd/volition-terminal.service; then
  install -m 0644 "$live/deployment/volition-stack/native/systemd/volition-terminal.service" /etc/systemd/system/
  systemctl daemon-reload
  restart+=(volition-terminal.service)
fi

# The router runs from this checkout; its unit is installed from here as well.
if changed deployment/volition-stack/browser deployment/volition-stack/native/systemd/volition-project-browser-router.service; then
  install -m 0644 "$live/deployment/volition-stack/native/systemd/volition-project-browser-router.service" /etc/systemd/system/
  systemctl daemon-reload
  restart+=(volition-project-browser-router.service)
fi

if ((${#restart[@]} > 0)); then
  echo "restarting ${restart[*]}"
  systemctl restart "${restart[@]}"
fi

# Every service the instance consists of has to be running again, and the API and web
# entry have to answer.
failed=0
for unit in volition-plan-api-dev volition-plan-web-dev volition-plan-worker-dev \
  volition-hermes-runner volition-mastra volition-provisioning volition-terminal \
  volition-project-browser-router; do
  if ! systemctl is-active --quiet "$unit.service"; then
    echo "deploy.sh: $unit is not running" >&2
    failed=1
  fi
done
for url in http://127.0.0.1:3000/docs http://127.0.0.1:3001/login; do
  if ! curl -sf -o /dev/null --retry 20 --retry-delay 1 --retry-all-errors "$url"; then
    echo "deploy.sh: $url does not answer" >&2
    failed=1
  fi
done
as_owner git -C "$live" log --oneline "$before..$after"
exit "$failed"

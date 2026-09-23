#!/usr/bin/env bash
# Deploys a branch to the live Plan instance on Kingston: fast-forwards the live checkout,
# installs changed dependencies, migrates the database, rebuilds what runs from a build,
# restarts what changed, and checks that everything answers again.
#
#   sudo deployment/volition-stack/native/deploy.sh [branch]    (default: volition/hub)
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

if changed bun.lock; then
  echo "installing dependencies"
  as_owner bash -c "cd '$live' && bun install --frozen-lockfile >/dev/null"
fi

# The vault's layout, groups, permissions and git history; idempotent.
"$live/deployment/volition-stack/native/vault-setup.sh"

if changed packages/db/drizzle; then
  # The Docs pages still stored in the database become files in the vault before the
  # migration drops their tables; the script does nothing once they are gone.
  runuser -u volition-plan -- env PROJECT_VAULT_ROOT=/srv/volition/vault \
    bash -c "cd '$live' && /usr/local/bin/bun --env-file=/etc/volition/plan.env apps/api/src/scripts/convert-documents-to-vault.ts"
  echo "migrating the database"
  systemctl start volition-plan-migrate.service
fi

# Creates the Mastra tokens the units below load, before any of them starts.
if changed deployment/volition-stack/native/nginx/install-mastra-studio.sh \
  deployment/volition-stack/native/nginx/mastra-studio.conf; then
  "$live/deployment/volition-stack/native/nginx/install-mastra-studio.sh"
fi

# Syncthing syncs the vault with the owner's devices. Its setup writes the API key the
# API unit loads, so it runs before the Plan units are installed.
if changed deployment/volition-stack/native/syncthing \
  deployment/volition-stack/native/systemd/volition-syncthing.service; then
  echo "setting up Syncthing"
  "$live/deployment/volition-stack/native/syncthing/setup.sh"
fi

# The vault folders, code-server's access to the vault, and the attachments moved into it.
"$live/deployment/volition-stack/native/files-documents.sh"

# The API and the worker run from the checkout's sources; the web app runs from a
# production build, which web-release.sh installs as a release of its own.
plan_units=(volition-plan-api.service volition-plan-worker.service volition-plan-web.service)
if changed "${plan_units[@]/#/deployment/volition-stack/native/systemd/}"; then
  for unit in "${plan_units[@]}"; do
    install -m 0644 "$live/deployment/volition-stack/native/systemd/$unit" /etc/systemd/system/
  done
  systemctl daemon-reload
  restart+=("${plan_units[@]}")
fi
if changed apps/api apps/worker packages bun.lock; then
  restart+=(volition-plan-api.service volition-plan-worker.service)
fi
if changed apps/web bun.lock; then
  echo "building the web app"
  "$live/deployment/volition-stack/native/web-release.sh"
  restart+=(volition-plan-web.service)
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

for unit in volition-mastra.service volition-provisioning.service; do
  if changed "deployment/volition-stack/native/systemd/$unit"; then
    install -m 0644 "$live/deployment/volition-stack/native/systemd/$unit" /etc/systemd/system/
    systemctl daemon-reload
    restart+=("$unit")
  fi
done

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

# Chromium reads its managed policies from this directory; a running project browser applies
# a change when it reloads its policies, at the latest when it restarts. The project browsers
# keep no passwords: logins come from Plan through Hermes' vault.
chromium_policy=deployment/volition-stack/native/chromium/volition-project-browser.json
if changed "$chromium_policy"; then
  install -D -m 0644 "$live/$chromium_policy" /etc/chromium/policies/managed/volition-project-browser.json
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
for unit in volition-plan-api volition-plan-web volition-plan-worker \
  volition-hermes-runner volition-mastra volition-provisioning volition-terminal \
  volition-project-browser-router volition-syncthing; do
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

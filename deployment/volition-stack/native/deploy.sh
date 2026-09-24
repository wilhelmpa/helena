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

# Edits made in the live checkout itself would be lost to a later reset, and a fast-forward
# would ship them untested; they belong on a branch. Untracked files are only named.
if [[ -n $(as_owner git -C "$live" status --porcelain --untracked-files=no) ]]; then
  echo "deploy.sh: the live checkout has uncommitted changes; commit them to a branch first:" >&2
  as_owner git -C "$live" status --short --untracked-files=no >&2
  exit 1
fi
untracked=$(as_owner git -C "$live" status --porcelain --untracked-files=normal | sed -n 's/^?? //p')
[[ -z $untracked ]] || printf 'deploy.sh: untracked in the live checkout (left alone): %s\n' $untracked >&2

# The commit the last complete deploy shipped. A deploy that stopped halfway leaves the
# checkout ahead of it, so the next one compares against this and repeats every step.
state_dir=/var/lib/volition/deploy
install -d -m 0755 "$state_dir"
deployed=$(cat "$state_dir/deployed" 2>/dev/null || true)
head=$(as_owner git -C "$live" rev-parse HEAD)
if [[ -n $deployed ]] && as_owner git -C "$live" merge-base --is-ancestor "$deployed" "$head"; then
  before=$deployed
else
  before=$head
fi
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

# Mastra and the Hermes team bridge were replaced by the Helena engine, which runs inside the
# API. An instance that still has them stops them before the migration drops Mastra's tables,
# and loses their units and Studio's nginx route; this does nothing once they are gone. Their
# tokens in /etc/volition, /var/lib/volition/mastra and the volition-mastra user stay until
# they are removed by hand (docs/breaking-changes.md).
retired=()
for unit in volition-mastra volition-hermes-team-bridge volition-mastra-dev volition-hermes-team-bridge-dev; do
  if [[ -e /etc/systemd/system/$unit.service ]]; then
    systemctl disable --now "$unit.service" >/dev/null 2>&1 || true
    rm -rf "/etc/systemd/system/$unit.service" "/etc/systemd/system/$unit.service.d" \
      "/etc/systemd/system/$unit.service.wants"
    retired+=("$unit")
  fi
done
if ((${#retired[@]} > 0)); then
  systemctl daemon-reload
  echo "removed ${retired[*]}"
fi
site=/etc/nginx/sites-available/volition.conf
studio='    include /etc/nginx/snippets/volition-mastra-studio.conf;'
if [[ -f $site ]] && grep -qxF -- "$studio" "$site"; then
  cp -p -- "$site" "$site.pre-engine"
  grep -vxF -- "$studio" "$site.pre-engine" >"$site"
  if nginx -t && systemctl reload nginx.service; then
    rm -f -- "$site.pre-engine" /etc/nginx/snippets/volition-mastra-studio.conf \
      /etc/nginx/conf.d/volition-mastra-gateway.conf
  else
    cp -p -- "$site.pre-engine" "$site"
    rm -f -- "$site.pre-engine"
    echo "deploy.sh: nginx refused the site without the Mastra route; it was restored" >&2
  fi
fi

if changed packages/db/drizzle; then
  # The Docs pages still stored in the database become files in the vault before the
  # migration drops their tables; the script does nothing once they are gone.
  runuser -u volition-plan -- env PROJECT_VAULT_ROOT=/srv/volition/vault \
    bash -c "cd '$live' && /usr/local/bin/bun --env-file=/etc/volition/plan.env apps/api/src/scripts/convert-documents-to-vault.ts"
  echo "migrating the database"
  systemctl start volition-plan-migrate.service
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
  restart+=(volition-provisioning.service)
fi

for unit in volition-hermes-runner.service volition-provisioning.service; do
  if changed "deployment/volition-stack/native/systemd/$unit"; then
    install -m 0644 "$live/deployment/volition-stack/native/systemd/$unit" /etc/systemd/system/
    systemctl daemon-reload
    restart+=("$unit")
  fi
done

# The runner's start script runs an installed copy of the catalog script, which writes the
# runner config from the Hermes profile. The start script itself is installed the same way.
if changed deployment/volition-stack/integration/scripts/volition-hermes-catalog.py; then
  install -m 0755 "$live/deployment/volition-stack/integration/scripts/volition-hermes-catalog.py" \
    /usr/local/libexec/volition-hermes-catalog.py
  restart+=(volition-hermes-runner.service)
fi
if changed deployment/volition-stack/integration/scripts/volition-hermes-runner; then
  install -m 0755 "$live/deployment/volition-stack/integration/scripts/volition-hermes-runner" \
    /usr/local/libexec/volition-hermes-runner
  restart+=(volition-hermes-runner.service)
fi

# Claude Code, Codex and the ACP adapters are installed by install-cli-runtimes.sh, pinned.
# A changed pin is a download, which needs the owner's OK: the deploy only says so.
if changed deployment/volition-stack/native/runtimes; then
  echo "NOTE: the pinned CLI runtimes changed. After the owner's OK run:"
  echo "  sudo $live/deployment/volition-stack/native/runtimes/install-cli-runtimes.sh plan"
  echo "  sudo $live/deployment/volition-stack/native/runtimes/install-cli-runtimes.sh install"
fi

# The update center's root helper runs its own copies of itself and of the runtime installer;
# they follow the repository once installed (updates/install.sh).
if [[ -x /usr/local/libexec/helena-update ]] &&
  changed deployment/volition-stack/native/updates deployment/volition-stack/native/runtimes; then
  "$live/deployment/volition-stack/native/updates/install.sh" --refresh
fi

# A restart ends every open terminal session. The shell script and tmux.conf are read
# for each new session, so only the router and the unit need one.
if changed deployment/volition-stack/native/terminal/project-terminal-router.mjs \
  deployment/volition-stack/native/systemd/volition-terminal.service; then
  install -m 0644 "$live/deployment/volition-stack/native/systemd/volition-terminal.service" /etc/systemd/system/
  systemctl daemon-reload
  restart+=(volition-terminal.service)
fi

# The owner terminal: its own setup.sh installs the unit, the nginx snippet and the
# signing key, and restarts volition-owner-terminal.service itself (same shape as the
# Syncthing setup above). It never touches /etc/sudoers.d/90-wilhelmpa here -- that is a
# separate, deliberate step (setup.sh --install-sudo-policy=...) the orchestrator takes
# by hand only once the instance's SSH automation has been audited against the sudoers
# policy; see setup.sh and 90-wilhelmpa's own comments for why. A restart here ends every
# open owner-terminal session the same way the project terminal's does; the tmux sessions
# behind them are unaffected and a reconnect finds them again after a fresh step-up.
# Brings the provisioned project browsers (and Home's) back after a boot.
if changed deployment/volition-stack/native/browser-restore; then
  install -m 0755 "$live/deployment/volition-stack/native/browser-restore/volition-browser-restore" \
    /usr/local/libexec/volition-browser-restore
  install -m 0644 "$live/deployment/volition-stack/native/browser-restore/volition-project-browser-restore.service" \
    /etc/systemd/system/volition-project-browser-restore.service
  systemctl daemon-reload
  systemctl enable volition-project-browser-restore.service >/dev/null
fi

# The project terminal's nginx routes (the owner terminal's come with its setup.sh below).
if changed deployment/volition-stack/native/nginx/project-terminal.conf; then
  install -m 0644 -o root -g root "$live/deployment/volition-stack/native/nginx/project-terminal.conf" \
    /etc/nginx/snippets/volition-project-terminal.conf
  nginx -t && systemctl reload nginx.service
fi

if changed deployment/volition-stack/native/owner-terminal; then
  "$live/deployment/volition-stack/native/owner-terminal/setup.sh"
fi

# Chromium reads its managed policies from this directory; a running project browser applies
# a change when it reloads its policies, at the latest when it restarts. The project browsers
# keep no passwords: logins come from Plan through Hermes' vault.
chromium_policy=deployment/volition-stack/native/chromium/volition-project-browser.json
if changed "$chromium_policy"; then
  install -D -m 0644 "$live/$chromium_policy" /etc/chromium/policies/managed/volition-project-browser.json
fi

# The browser gateway's MCP shim is a build of packages/browser-gateway, installed outside the
# checkout (an isolated agent's unit hides it); only rebuilt once install-browser-gateway.sh
# installed it. The gateway itself runs inside the router, from the checkout.
if changed packages/browser-gateway deployment/volition-stack/native/install-browser-gateway.sh; then
  "$live/deployment/volition-stack/native/install-browser-gateway.sh" sync
fi

# The router runs from this checkout; its unit is installed from here as well.
if changed deployment/volition-stack/browser packages/browser-gateway \
  deployment/volition-stack/native/systemd/volition-project-browser-router.service; then
  install -m 0644 "$live/deployment/volition-stack/native/systemd/volition-project-browser-router.service" /etc/systemd/system/
  systemctl daemon-reload
  restart+=(volition-project-browser-router.service)
fi

# The token keeper (token-keeper/install.sh, docs/helena-decisions/token-keeper.md) renews the
# logins agents share and writes the views isolated agents get of them. `sync` keeps an
# installed keeper current and installs it where agent isolation is installed, whose launcher
# refuses a run without the views; so it runs before isolation.sh sync.
if changed deployment/volition-stack/native/token-keeper deployment/volition-stack/isolation/launcher.json; then
  "$live/deployment/volition-stack/native/token-keeper/install.sh" sync
fi

# Agent isolation (isolation.sh): an installed launcher, egress proxy and Plan socket get the
# checkout's code and units. Installing and switching it on is `isolation.sh apply`.
if changed deployment/volition-stack/isolation deployment/volition-stack/native/isolation.sh \
  deployment/volition-stack/integration/project-browser.mjs \
  deployment/volition-stack/integration/project-browser-state.mjs; then
  "$live/deployment/volition-stack/native/isolation.sh" sync
fi
# Now that the installed launcher binds the views, the keeper's sync takes the agents' group's
# read access to the real stores away (idempotent; nothing to do on later deploys).
if changed deployment/volition-stack/native/token-keeper deployment/volition-stack/isolation/launcher.json; then
  "$live/deployment/volition-stack/native/token-keeper/install.sh" sync
fi

if ((${#restart[@]} > 0)); then
  echo "restarting ${restart[*]}"
  systemctl restart "${restart[@]}"
fi

# Every service the instance consists of has to be running again, and the API and web
# entry have to answer.
failed=0
for unit in volition-plan-api volition-plan-web volition-plan-worker \
  volition-hermes-runner volition-provisioning volition-terminal \
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
if ((failed == 0)); then
  echo "$after" >"$state_dir/deployed.tmp" && mv "$state_dir/deployed.tmp" "$state_dir/deployed"
fi
exit "$failed"

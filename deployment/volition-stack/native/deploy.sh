#!/usr/bin/env bash
# Deploys a branch to the live Helena instance: fast-forwards the live checkout, installs
# changed dependencies, migrates the database, rebuilds what runs from a build, restarts what
# changed, checks that everything answers again and that the pages render, and rolls back to
# the last good commit when any of that fails.
#
#   sudo deployment/volition-stack/native/deploy.sh [options] [branch]   (default: volition/hub)
#
#   --expect SHA          refuse unless the branch is exactly this commit (the gated one)
#   --web-artifact DIR    install the web app from a build made elsewhere (web-artifact.sh)
#                         instead of building it here; it must be built from the exact commit
#   --wait-inflight SEC   how long to wait for running agent work to finish first (600)
#   --allow-inflight      deploy while agent work is running
#   --no-rollback         on a failure, stop and leave the half-deployed state for inspection
#   --retry               deploy a commit that was rolled back before
#
# Exit codes: 0 deployed; 1 refused or failed before anything changed; 2 failed and rolled
# back to the last good commit, which answers again; 3 failed and the rollback did not bring
# the instance back either (or --no-rollback): needs a person.
#
# The rollback (docs: deployment/volition-stack/native/DEPLOY.md) resets the live checkout
# to the commit the marker names (the one sanctioned reset of the live checkout: only ever to
# that commit, only from a checkout this script verified clean), and runs this script again
# for the way back: the same steps for the same changed paths, with the previous web release
# and runner bundle restored instead of built. The database is not rolled back: a migration is
# one transaction, so a failed one changed nothing; one that succeeded stays (its backup is
# named in the journal of volition-plan-migrate).
set -Eeuo pipefail
umask 022

[[ $EUID -eq 0 ]] || { echo "deploy.sh: run with sudo" >&2; exit 1; }

# The paths are fixed on a server; tests/test_deploy_rollback.py points them at a fixture.
live=${HELENA_DEPLOY_LIVE:-/srv/volition/source/plan}
branch=volition/hub
expect=''
web_artifact=${HELENA_WEB_ARTIFACT:-}
wait_inflight=600
allow_inflight=0
rollback_enabled=1
retry=0
# Set only when the script runs itself for the way back (internal).
rollback_to=''
rollback_of=''
while (($# > 0)); do
  case $1 in
    --expect) expect=$2; shift 2 ;;
    --web-artifact) web_artifact=$2; shift 2 ;;
    --wait-inflight) wait_inflight=$2; shift 2 ;;
    --allow-inflight) allow_inflight=1; shift ;;
    --no-rollback) rollback_enabled=0; shift ;;
    --retry) retry=1; shift ;;
    --rollback-to) rollback_to=$2; rollback_of=$3; shift 3 ;;
    -*) echo "deploy.sh: unknown option $1" >&2; exit 1 ;;
    *) branch=$1; shift ;;
  esac
done
self=$(readlink -f "${BASH_SOURCE[0]}")
owner=$(stat -c %U "$live")
as_owner() { runuser -u "$owner" -- "$@"; }

# Edits made in the live checkout itself would be lost to a later reset, and a fast-forward
# would ship them untested; they belong on a branch. Untracked files are only named. On the
# way back, the one file a failed web build leaves changed is restored first.
if [[ -n $rollback_to ]]; then
  as_owner git -C "$live" checkout -- apps/web/next-env.d.ts 2>/dev/null || true
fi
if [[ -n $(as_owner git -C "$live" status --porcelain --untracked-files=no) ]]; then
  echo "deploy.sh: the live checkout has uncommitted changes; commit them to a branch first:" >&2
  as_owner git -C "$live" status --short --untracked-files=no >&2
  [[ -z $rollback_to ]] || exit 3
  exit 1
fi
untracked=$(as_owner git -C "$live" status --porcelain --untracked-files=normal | sed -n 's/^?? //p')
[[ -z $untracked ]] || printf 'deploy.sh: untracked in the live checkout (left alone): %s\n' $untracked >&2

# The commit the last complete deploy shipped. A deploy that stopped halfway leaves the
# checkout ahead of it, so the next one compares against this and repeats every step.
state_dir=${HELENA_DEPLOY_STATE:-/var/lib/volition/deploy}
install -d -m 0755 "$state_dir"
[[ ! -L "$state_dir/deploy.lock" ]] || { echo "deploy.sh: unexpected lock symlink" >&2; exit 1; }
# The way back runs with the lock its failed deployment still holds (the same open file).
[[ -n $rollback_to ]] || exec 9>>"$state_dir/deploy.lock"
flock -n 9 || { echo "deploy.sh: another deployment is active" >&2; exit 1; }
rollback_dir=$state_dir/rollback
install -d -m 0700 "$rollback_dir"
deployed=$(cat "$state_dir/deployed" 2>/dev/null || true)
head=$(as_owner git -C "$live" rev-parse HEAD)
if [[ -n $rollback_to ]]; then
  # The way back: from the failed target (still checked out) to the last good commit.
  [[ $head == "$rollback_of" ]] || { echo "deploy.sh: rollback expected $rollback_of checked out, found $head" >&2; exit 3; }
  before=$rollback_of
  branch=$rollback_to
elif [[ -n $deployed ]] && as_owner git -C "$live" merge-base --is-ancestor "$deployed" "$head"; then
  before=$deployed
else
  before=$head
fi

# Running agent work: a restart of the API or the runner in the middle of it is what the
# owner's rule (CLAUDE.md, 28.09.) forbids. Claimed runs and answers being written are
# waited for, up to --wait-inflight seconds; the runner drain below handles its own.
inflight() {
  runuser -u postgres -- psql -d "${HELENA_DB_NAME:-itsaplan}" -qAtX -c "
    SELECT (SELECT count(*) FROM agent_run WHERE status = 'pending' AND claimed_at IS NOT NULL
              AND next_attempt_at > now())
         + (SELECT count(*) FROM agent_chat_message WHERE status = 'streaming')"
}
if [[ -z $rollback_to ]] && ((allow_inflight == 0)); then
  waited=0
  while :; do
    busy=$(inflight) || { echo "deploy.sh: could not read the running agent work (--allow-inflight to skip)" >&2; exit 1; }
    ((busy == 0)) && break
    if ((waited >= wait_inflight)); then
      echo "deploy.sh: $busy runs or chat answers are still running after ${waited}s; try later or --allow-inflight" >&2
      exit 1
    fi
    ((waited == 0)) && echo "waiting for $busy running runs or chat answers to finish"
    sleep 10
    waited=$((waited + 10))
  done
fi

# The runner drain refuses while the legacy bootstrap timer can start the runner behind its
# back (runner-drain/README.md). It used to be held by hand around each deployment; the
# deployment holds it itself and gives it back on every way out.
# A deployment that failed with the runner drained keeps holding it (the drain must not be
# crossed by a start); the file says so, and the next successful deployment gives it back.
bootstrap_mark=$state_dir/bootstrap-timer-held
bootstrap_held=0
[[ -f $bootstrap_mark ]] && bootstrap_held=1
hold_bootstrap_timer() {
  systemctl is-active --quiet volition-hermes-bootstrap.timer || return 0
  echo "holding volition-hermes-bootstrap.timer during the runner drain"
  touch "$bootstrap_mark"
  bootstrap_held=1
  systemctl stop volition-hermes-bootstrap.timer
  local i
  for i in $(seq 1 60); do
    systemctl is-active --quiet volition-hermes-bootstrap.service || return 0
    sleep 2
  done
  echo "deploy.sh: volition-hermes-bootstrap.service is still running" >&2
  return 1
}
release_bootstrap_timer() {
  if ((bootstrap_held)); then
    systemctl start volition-hermes-bootstrap.timer || echo "deploy.sh: could not start volition-hermes-bootstrap.timer again" >&2
    rm -f "$bootstrap_mark"
    bootstrap_held=0
  fi
}
bootstrap_note() {
  if ((bootstrap_held)) && [[ -f $bootstrap_mark ]]; then
    echo "NOTE: volition-hermes-bootstrap.timer stays stopped while the runner is drained; once it" >&2
    echo "  runs again: sudo systemctl start volition-hermes-bootstrap.timer && sudo rm $bootstrap_mark" >&2
  fi
}
trap bootstrap_note EXIT

# A failure once the checkout moved: run this script again for the way back (see the top).
ff_done=0
prev_web=''
on_failure() {
  local status=$? line=${1:-?}
  # errtrace hands the trap to command substitutions too: a failure inside one only ends that
  # subshell, and the script itself sees it fail and comes here once.
  [[ $BASHPID == "$$" ]] || exit "$status"
  trap - ERR
  set +e
  echo "deploy.sh: step failed (exit $status, line $line)" >&2
  if [[ -n $rollback_to ]]; then
    echo "deploy.sh: the rollback failed as well; the instance needs a person" >&2
    exit 3
  fi
  if ((ff_done == 0)); then
    echo "deploy.sh: the checkout was not changed" >&2
    exit 1
  fi
  if ((rollback_enabled == 0)); then
    echo "deploy.sh: --no-rollback: $after stays checked out, the marker still names $before" >&2
    exit 3
  fi
  echo "deploy.sh: rolling back to $before" >&2
  exec env HELENA_DEPLOY_PREV_WEB="$prev_web" HELENA_DEPLOY_RUNNER_AFFECTED="$runner_affected" \
    "$self" --rollback-to "$before" "$after"
}
after=$(as_owner git -C "$live" rev-parse --verify "$branch^{commit}")
if [[ -n ${expect:-} && $after != "$expect" ]]; then
  echo "deploy.sh: $branch is $after, not the expected $expect" >&2; exit 1
fi
if [[ -z ${rollback_to:-} && ${retry:-0} != 1 && -n ${state_dir:-} ]] &&
  grep -qxF "$after" "$state_dir/rolled-back" 2>/dev/null; then
  echo "deploy.sh: $after was rolled back before; fix it or pass --retry" >&2; exit 1
fi
if [[ -z ${rollback_to:-} ]]; then
  as_owner git -C "$live" merge-base --is-ancestor "$head" "$after" || {
    echo "deploy.sh: target is not a fast-forward" >&2; exit 1;
  }
fi
if [[ $before == "$after" ]]; then
  echo "deploy.sh: $branch is already live"
  exit 0
fi
changed() { ! as_owner git -C "$live" diff --quiet "$before" "$after" -- "$@"; }
api_runtime_changed() {
  changed apps/api \
    ':(exclude,glob)apps/api/src/**/__tests__/**' \
    ':(exclude,glob)apps/api/src/**/*.test.ts'
}
restart=()
runner_affected=false
if changed packages/runner packages/sdk bun.lock \
  deployment/volition-stack/native/systemd/volition-hermes-runner.service \
  deployment/volition-stack/integration/scripts/volition-hermes-catalog.py \
  deployment/volition-stack/integration/scripts/volition-hermes-runner; then
  runner_affected=true
fi
runner_drain="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/runner-drain/runner-drain.py"
if $runner_affected && [[ -z ${rollback_to:-} ]]; then
  # This happens before checkout, migration, build installation or API restart.
  if declare -F hold_bootstrap_timer >/dev/null; then hold_bootstrap_timer; fi
  python3 "$runner_drain" drain --target "$after" --before "$before"
fi
if [[ -n ${rollback_to:-} ]]; then
  # The way back to the last good commit; the tree was verified clean above.
  as_owner git -C "$live" reset --keep --quiet "$after"
else
  as_owner git -C "$live" merge --ff-only --quiet "$after"
fi
ff_done=1
if declare -F on_failure >/dev/null; then
  trap 'on_failure $LINENO' ERR
fi

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

if changed packages/db/drizzle && [[ -n $rollback_to ]]; then
  echo "NOTE: the rolled-back commit changed migrations; the database keeps them (the backup"
  echo "  written before them is named in: journalctl -u volition-plan-migrate.service)"
elif changed packages/db/drizzle; then
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
if changed apps/worker packages bun.lock || api_runtime_changed; then
  restart+=(volition-plan-api.service volition-plan-worker.service)
fi
web_releases=${HELENA_WEB_RELEASES:-/srv/volition/releases/web}
if changed apps/web bun.lock && [[ -n $rollback_to ]]; then
  # The release that ran before the failed deployment (web-release.sh keeps three).
  previous=${HELENA_DEPLOY_PREV_WEB:-}
  if [[ -n $previous && -d $previous ]]; then
    echo "restoring the web release $previous"
    ln -sfn "$previous" "$web_releases/current"
  else
    echo "building the web app of the last good commit"
    "$live/deployment/volition-stack/native/web-release.sh"
  fi
  restart+=(volition-plan-web.service)
elif [[ -n $web_artifact ]] && ! changed apps/web bun.lock; then
  echo "NOTE: the web app did not change; $web_artifact is not needed"
elif changed apps/web bun.lock; then
  prev_web=$(readlink -f "$web_releases/current" 2>/dev/null || true)
  if [[ -n $web_artifact ]]; then
    echo "installing the web app from $web_artifact"
    "$live/deployment/volition-stack/native/web-release.sh" --artifact "$web_artifact"
  else
    echo "building the web app"
    "$live/deployment/volition-stack/native/web-release.sh"
  fi
  restart+=(volition-plan-web.service)
fi

# The runner executes a bundle owned by root, so the agent user it runs as cannot replace
# the code that drives it. The bundle is built by the checkout's owner and installed.
runner_bundle=$live/packages/runner/dist/cli.js
if changed packages/runner packages/sdk bun.lock && [[ -n $rollback_to && -f $rollback_dir/runner-cli.js ]]; then
  echo "restoring the runner bundle"
  install -m 0755 -o root -g volition "$rollback_dir/runner-cli.js" "$runner_bundle"
elif changed packages/runner packages/sdk bun.lock; then
  echo "building the runner"
  # The bundle that ran so far, for the way back.
  if [[ -z $rollback_to && -f $runner_bundle ]]; then
    install -m 0600 "$runner_bundle" "$rollback_dir/runner-cli.js"
  fi
  bundle=$(runuser -u "$owner" -- mktemp --suffix=.js)
  as_owner bash -c "cd '$live/packages/runner' && bun build src/cli.ts --target=node --outfile '$bundle' >/dev/null"
  install -m 0755 -o root -g volition "$bundle" "$runner_bundle"
  rm -f "$bundle"
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
  changed deployment/volition-stack/native/updates deployment/volition-stack/native/runtimes \
    deployment/volition-stack/native/local-ai/whisper_update.py \
    deployment/volition-stack/native/local-ai/whisper_acceptance.py \
    deployment/volition-stack/native/local-ai/whisper_ui.py; then
  "$live/deployment/volition-stack/native/updates/install.sh" --refresh
fi

# Deploy helper code without fetching/updating Hermes or changing its release tracking.
if [[ -x /usr/local/libexec/helena-hermes-update ]] &&
  changed deployment/volition-stack/native/hermes-update; then
  "$live/deployment/volition-stack/native/hermes-update/install.sh" --refresh
fi

# Refresh the installed audit without installing/enabling its timer or applying hardening.
audit_script=deployment/volition-stack/native/hardening/audit.sh
if [[ -f /usr/local/libexec/helena-security-audit ]] && changed "$audit_script"; then
  install -m 0755 -o root -g root "$live/$audit_script" /usr/local/libexec/helena-security-audit
fi

# A restart ends every open terminal session. The shell script and tmux.conf are read
# for each new session, so only the router and the unit need one.
if changed deployment/volition-stack/native/terminal/tmux.conf &&
  [[ -f /usr/local/lib/volition-isolation/tmux.conf ]]; then
  install -m 0644 "$live/deployment/volition-stack/native/terminal/tmux.conf" \
    /usr/local/lib/volition-isolation/tmux.conf
fi
if changed deployment/volition-stack/native/terminal/project-terminal-router.mjs \
  deployment/volition-stack/native/systemd/volition-terminal.service; then
  install -m 0644 "$live/deployment/volition-stack/native/systemd/volition-terminal.service" /etc/systemd/system/
  systemctl daemon-reload
  restart+=(volition-terminal.service)
fi

# The owner terminal: its own setup.sh installs the unit, the nginx snippet and the
# signing key; the router is then restarted through the shared restart queue. It never touches /etc/sudoers.d/90-wilhelmpa here -- that is a
# separate, deliberate step (setup.sh --install-sudo-policy=...) the orchestrator takes
# by hand only once the instance's SSH automation has been audited against the sudoers
# policy; see setup.sh and 90-wilhelmpa's own comments for why. A restart here ends every
# open owner-terminal session the same way the project terminal's does; the tmux sessions
# behind them are unaffected and a reconnect finds them again after a fresh step-up.
# Project browsers run on demand (browser/project-browser-power.mjs): the router starts one
# when it is used, stops it after the idle time and keeps the "immer an" ones running, after a
# boot as well. The boot-time restore that started every provisioned browser is retired. The
# polkit rule lets the router's user start and stop the browsers; the unit templates are
# installed here so a changed display (Full HD) takes effect at a browser's next start, without
# restarting a running one.
if [[ -e /etc/systemd/system/volition-project-browser-restore.service ]]; then
  systemctl disable volition-project-browser-restore.service >/dev/null 2>&1 || true
  rm -f /etc/systemd/system/volition-project-browser-restore.service /usr/local/libexec/volition-browser-restore
  systemctl daemon-reload
fi
if changed deployment/volition-stack/native/systemd/61-helena-browser-on-demand.rules; then
  install -m 0644 -o root -g root "$live/deployment/volition-stack/native/systemd/61-helena-browser-on-demand.rules" \
    /etc/polkit-1/rules.d/61-helena-browser-on-demand.rules
fi
browser_units=(volition-project-browser-kasm@.service volition-project-browser-chromium@.service volition-project-browser@.target)
if changed "${browser_units[@]/#/deployment/volition-stack/native/systemd/}"; then
  for unit in "${browser_units[@]}"; do
    install -m 0644 "$live/deployment/volition-stack/native/systemd/$unit" /etc/systemd/system/
  done
  systemctl daemon-reload
fi

# The project terminal's nginx routes (the owner terminal's come with its setup.sh below).
if changed deployment/volition-stack/native/nginx/project-terminal.conf; then
  install -m 0644 -o root -g root "$live/deployment/volition-stack/native/nginx/project-terminal.conf" \
    /etc/nginx/snippets/volition-project-terminal.conf
  nginx -t && systemctl reload nginx.service
fi

if changed deployment/volition-stack/native/owner-terminal \
  ':(exclude)deployment/volition-stack/native/owner-terminal/tmux.conf'; then
  "$live/deployment/volition-stack/native/owner-terminal/setup.sh"
  restart+=(volition-owner-terminal.service)
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
# The agents' runtime code (Hermes' venv, its Python, its tools) stays readable for them on every
# deploy, whatever installed into it since (docs/helena-decisions/agent-runtime-code.md): no
# restart, a no-op where isolation is not installed.
"$live/deployment/volition-stack/native/isolation.sh" open-code
# Now that the installed launcher binds the views, the keeper's sync takes the agents' group's
# read access to the real stores away (idempotent; nothing to do on later deploys).
if changed deployment/volition-stack/native/token-keeper deployment/volition-stack/isolation/launcher.json; then
  "$live/deployment/volition-stack/native/token-keeper/install.sh" sync
fi

# The way back leaves a drained runner stopped: its drain state names the failed target,
# and runner-drain/README.md wants a person to review and activate it.
runner_left_drained=false
if [[ -n $rollback_to && ${HELENA_DEPLOY_RUNNER_AFFECTED:-false} == true ]]; then
  runner_left_drained=true
  runner_affected=true
fi
if $runner_left_drained; then
  runner_affected=false
  kept=()
  for unit in "${restart[@]}"; do
    [[ $unit == volition-hermes-runner.service ]] || kept+=("$unit")
  done
  restart=("${kept[@]}")
fi
if $runner_affected; then
  without_runner=()
  for unit in "${restart[@]}"; do
    [[ $unit == volition-hermes-runner.service ]] || without_runner+=("$unit")
  done
  restart=("${without_runner[@]}")
fi
if ((${#restart[@]} > 0)); then
  echo "restarting ${restart[*]}"
  systemctl restart "${restart[@]}"
fi
if $runner_affected; then
  curl -sf -o /dev/null --connect-timeout 2 --max-time 5 \
    --retry 5 --retry-delay 1 --retry-max-time 30 --retry-all-errors http://127.0.0.1:3000/docs
  python3 "$runner_drain" ready --target "$after"
  python3 "$runner_drain" activate --target "$after"
fi

# Every service the instance consists of has to be running again, and the API and web
# entry have to answer.
failed=0
for unit in volition-plan-api volition-plan-web volition-plan-worker \
  volition-hermes-runner volition-provisioning volition-terminal \
  volition-project-browser-router volition-syncthing; do
  if [[ $unit == volition-hermes-runner ]] && $runner_left_drained; then continue; fi
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
# A green gate does not prove the pages render (CLAUDE.md, 27.09.: a component crashed every
# page for 20 minutes). A headless browser loads the sign-in page and, signed in as the LAN
# owner where this instance has one, / and /chat, through nginx like a browser at home; an
# uncaught exception, a failed script or Next's error page fails the deployment.
# HELENA_DEPLOY_BROWSER_SMOKE=0 leaves it out (an instance without Chromium skips it).
smoke=$live/deployment/volition-stack/native/smoke/web-smoke.mjs
if ((failed == 0)) && [[ ${HELENA_DEPLOY_BROWSER_SMOKE:-1} != 0 && -x /usr/bin/chromium && -f $smoke ]]; then
  env_file=/etc/volition/plan.env
  env_value() { awk -v key="$1" 'index($0, key "=") == 1 { v = substr($0, length(key) + 2); gsub(/"/, "", v); print v; exit }' "$env_file" 2>/dev/null || true; }
  smoke_url=${HELENA_SMOKE_URL:-$(env_value APP_URL)}
  smoke_url=${smoke_url%%,*}
  smoke_token=''
  if [[ $(env_value HELENA_LOCAL_SIGN_IN_MODE) == single-user ]]; then
    smoke_token=$(env_value LOCAL_SINGLE_USER_TOKEN)
  fi
  smoke_home=$(runuser -u "$owner" -- mktemp -d)
  if ! HOME=$smoke_home TMPDIR=$smoke_home HELENA_SMOKE_LOCAL_TOKEN=$smoke_token \
    runuser -u "$owner" -m -- timeout 180 /usr/local/bin/node "$smoke" \
    --base "${smoke_url:-http://127.0.0.1}" --resolve 127.0.0.1 --api http://127.0.0.1:3000 \
    /login / /chat; then
    echo "deploy.sh: the pages do not render cleanly" >&2
    failed=1
  fi
  rm -rf "$smoke_home"
  unset smoke_token
fi
as_owner git -C "$live" log --oneline "$before..$after"
if [[ -n $rollback_to ]]; then
  echo "$after" >"$state_dir/deployed.tmp" && mv "$state_dir/deployed.tmp" "$state_dir/deployed"
  echo "$before" >>"$state_dir/rolled-back"
  if $runner_left_drained; then
    echo "NOTE: the runner stays drained and stopped. Review, then (runner-drain/README.md):"
    echo "  sudo python3 $runner_drain status"
  fi
  if ((failed == 0)); then
    echo "deploy.sh: rolled back to $after; it answers again. $before is marked rolled back." >&2
    exit 2
  fi
  echo "deploy.sh: rolled back to $after, but it does not answer either; needs a person" >&2
  exit 3
fi
if ((failed == 0)); then
  echo "$after" >"$state_dir/deployed.tmp" && mv "$state_dir/deployed.tmp" "$state_dir/deployed"
  release_bootstrap_timer
  exit 0
fi
# The checks failed: the same way back as a failed step.
false

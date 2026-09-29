#!/usr/bin/env bash
# Agent isolation on Kingston (docs/volition-design-agent-isolation.md §5): every project's
# agents run as a Unix user of their own in a sandbox, the internet only through the egress
# proxy, the browsers as the browser user. Idempotent; --dry-run shows each change and makes
# none.
#
#   sudo deployment/volition-stack/native/isolation.sh apply [--dry-run]     install, migrate, enable
#   sudo deployment/volition-stack/native/isolation.sh install [--dry-run]   code, units, users, token only
#   sudo deployment/volition-stack/native/isolation.sh sync                  reinstall changed code (deploy)
#   sudo deployment/volition-stack/native/isolation.sh open-code [--dry-run] the agents' runtime code readable (deploy)
#   sudo deployment/volition-stack/native/isolation.sh rollback [--dry-run]  back to one runner user
#   sudo deployment/volition-stack/native/isolation.sh status
#
# The switch is the drop-in /etc/systemd/system/volition-hermes-runner.service.d/isolation.conf
# (AGENT_ISOLATION=on, the same for provisioning and the terminal). deploy.sh runs `sync`,
# which keeps an installed isolation's code current; `apply` is the owner's step.
set -euo pipefail

command=${1:-}
dry_run=0
[[ ${2:-} == --dry-run ]] && dry_run=1
# The ISOLATION_* variables exist for the script's own test (isolation/tests); the defaults
# are the live paths.
[[ $EUID -eq 0 || ${ISOLATION_TEST:-} == 1 ]] || { echo "isolation.sh: run with sudo" >&2; exit 1; }

here=$(cd "$(dirname "$0")" && pwd)
stack=$(cd "$here/.." && pwd)
source_dir=$stack/isolation
lib=${ISOLATION_LIB:-/usr/local/lib/volition-isolation}
units=${ISOLATION_UNITS:-/etc/systemd/system}
token=${ISOLATION_TOKEN:-/etc/volition/agent-egress.token}
hermes_home=${ISOLATION_HERMES_HOME:-/var/lib/volition/hermes}
browser_state=${ISOLATION_BROWSER_STATE:-/var/lib/volition/project-browser}
python=${ISOLATION_PYTHON:-/usr/bin/python3}
switch_units=(volition-hermes-runner volition-provisioning volition-terminal)
browser_units=(volition-project-browser-chromium@.service volition-project-browser-kasm@.service volition-project-browser-router.service
  volition-trash-purge.service)
isolation_units=(volition-agent-launcher.socket volition-agent-launcher.service volition-egress.socket
  volition-egress.service volition-agent-plan.socket volition-agent-plan.service)
sockets=(volition-agent-launcher.socket volition-egress.socket volition-agent-plan.socket)

say() { if ((dry_run)); then echo "would $*"; else echo "$*"; fi; }
run() {
  if ((dry_run)); then echo "would run: $*"; else "$@"; fi
}

# ── users and groups ────────────────────────────────────────────────────────────────────
ensure_group() {
  getent group "$1" >/dev/null || { say "create group $1"; run groupadd --system "$1"; }
}

ensure_accounts() {
  ensure_group volition-agents
  ensure_group volition-launcher
  if ! id -nG volition-hermes | tr ' ' '\n' | grep -qx volition-launcher; then
    say "add volition-hermes to volition-launcher (it may start agents through the launcher)"
    run usermod -aG volition-launcher volition-hermes
  fi
  if ! id -nG volition-plan | tr ' ' '\n' | grep -qx volition-launcher; then
    say "allow the API to manage previews through the launcher"
    run usermod -aG volition-launcher volition-plan
  fi
  if ! getent passwd volition-egress >/dev/null; then
    say "create system user volition-egress"
    run useradd --system --user-group --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin \
      --comment "Volition agent egress proxy" volition-egress
  fi
  getent passwd volition-browser >/dev/null || { echo "isolation.sh: the user volition-browser is missing" >&2; exit 1; }
}

# ── code, units, token ──────────────────────────────────────────────────────────────────
install_file() { # mode source target
  if [[ -f $3 ]] && cmp -s "$2" "$3" && [[ $(stat -c %a "$3") == "${1#0}" ]]; then return; fi
  say "install $3"
  if [[ ${ISOLATION_TEST:-} == 1 ]]; then run install -D -m "$1" "$2" "$3"; else run install -D -o root -g root -m "$1" "$2" "$3"; fi
}

install_code() {
  ((dry_run)) || install -d -m 0755 "$lib" "$lib/browser"
  for file in isolation_common.py launcher.py sandbox.py egress.py plan_proxy.py launch_client.py migrate.py \
    runtime_modes.py helena_previews.py helena_preview_worker.py helena_preview_firewall.py; do
    install_file 0644 "$source_dir/$file" "$lib/$file"
  done
  install_file 0644 "$source_dir/launcher.json" "$lib/launcher.json"
  install_file 0644 "$source_dir/egress.json" "$lib/egress.json"
  install_file 0644 "$stack/native/terminal/tmux.conf" "$lib/tmux.conf"
  for file in project-browser-state.mjs project-browser.mjs atomic-json.mjs move-path.mjs; do
    install_file 0644 "$stack/integration/$file" "$lib/browser/$file"
  done
}

install_token() {
  if [[ -s $token ]]; then return; fi
  say "create the egress proxy's Plan token $token (not shown)"
  if ((!dry_run)); then
    (umask 077 && head -c 32 /dev/urandom | base64 | tr -d '\n=' > "$token")
    chmod 0600 "$token"
  fi
}

install_units() {
  local changed=0
  for unit in "${isolation_units[@]}"; do
    if ! cmp -s "$source_dir/systemd/$unit" "$units/$unit"; then
      install_file 0644 "$source_dir/systemd/$unit" "$units/$unit"
      changed=1
    fi
  done
  for unit in "${browser_units[@]}"; do
    if ! cmp -s "$stack/native/systemd/$unit" "$units/$unit"; then
      install_file 0644 "$stack/native/systemd/$unit" "$units/$unit"
      changed=1
    fi
  done
  # Plan reads the egress proxy's reports with the same token; a drop-in, so the API unit
  # itself does not depend on a file only isolation creates.
  local dropin=$units/volition-plan-api.service.d/agent-egress.conf
  local content=$'[Service]\nLoadCredential=agent_egress_token:/etc/volition/agent-egress.token\nEnvironment=AGENT_EGRESS_TOKEN_FILE=%d/agent_egress_token\n'
  if [[ ! -f $dropin ]] || [[ $(cat "$dropin") != "${content%$'\n'}" ]]; then
    say "install $dropin"
    ((dry_run)) || { install -d -m 0755 "$(dirname "$dropin")"; printf '%s' "$content" > "$dropin"; }
    changed=1
  fi
  if ((changed)); then run systemctl daemon-reload; fi
  for socket in "${sockets[@]}"; do
    if ! systemctl is-active --quiet "$socket"; then
      say "enable and start $socket"
      run systemctl enable --now "$socket"
    fi
  done
  return 0
}

# ── the runtimes' code, readable by every agent ─────────────────────────────────────────
# The units bind Hermes' venv, its Python and its tools read-only (launcher.json sharedCode);
# a bind keeps the files' modes, so one only its owner may read fails every agent that imports
# it (2026-09-25: docstring_parser in the venv was root 0600, and every agent on a Claude
# model stopped at "credentials or agent init failed"). A repair never stops a deploy: what it
# cannot open it names, and the hourly audit (files.agent_code) keeps reporting it.
open_shared_code() {
  local script=$lib/runtime_modes.py args=(repair --config "$lib/launcher.json") tree trees
  if [[ ! -f $script ]]; then
    say "open the agents' shared runtime code to every reader (after install)"
    return 0
  fi
  # The script's own test names its trees; the live ones come from launcher.json.
  if [[ -n ${ISOLATION_SHARED_CODE:-} ]]; then
    IFS=: read -ra trees <<<"$ISOLATION_SHARED_CODE"
    for tree in "${trees[@]}"; do args+=(--tree "$tree"); done
  fi
  ((dry_run)) && args+=(--dry-run)
  "$python" -I "$script" "${args[@]}" \
    || echo "isolation.sh: some of the agents' runtime code is still closed to them (see above)" >&2
  return 0
}

# ── the switch ──────────────────────────────────────────────────────────────────────────
switch() { # on|off
  for unit in "${switch_units[@]}"; do
    local dropin=$units/$unit.service.d/isolation.conf
    if [[ $1 == on ]]; then
      if [[ ! -f $dropin ]]; then
        say "set AGENT_ISOLATION=on for $unit"
        ((dry_run)) || { install -d -m 0755 "$(dirname "$dropin")"; printf '[Service]\nEnvironment=AGENT_ISOLATION=on\n' > "$dropin"; }
      fi
    elif [[ -f $dropin ]]; then
      say "remove AGENT_ISOLATION=on from $unit"
      run rm -f "$dropin"
    fi
  done
  # Chromium and KasmVNC get browser-user.conf; the router, which also serves the browser
  # gateway's sockets to the project users, browser-router.conf.
  for unit in chromium@ kasm@ router; do
    local name=volition-project-browser-$unit.service
    local file=browser-user.conf
    [[ $unit == router ]] && file=browser-router.conf
    local dropin=$units/${name}.d/$file
    if [[ $1 == on ]]; then
      if ! cmp -s "$source_dir/systemd/$file" "$dropin"; then
        say "run $name as volition-browser"
        ((dry_run)) || install -D -m 0644 "$source_dir/systemd/$file" "$dropin"
      fi
    else
      for stale in "$units/${name}.d/browser-user.conf" "$units/${name}.d/browser-router.conf"; do
        if [[ -f $stale ]]; then
          say "run $name as volition-hermes again"
          run rm -f "$stale"
        fi
      done
    fi
  done
  run systemctl daemon-reload
}

enabled() { [[ -f $units/volition-hermes-runner.service.d/isolation.conf ]]; }

# The project browsers that run now, so the same ones run afterwards.
active_browsers() {
  systemctl list-units --plain --no-legend --state=active 'volition-project-browser@*.target' | awk '{print $1}'
}

# volition-hermes-bootstrap.timer starts the runner every 30 s; while the agents are being
# switched it would start the runner again mid-way (2026-09-24: "Job for
# volition-hermes-runner.service canceled", the apply stopped half done).
bootstrap_timer=volition-hermes-bootstrap.timer
has_unit() { systemctl cat "$1" >/dev/null 2>&1; }

stop_agents() {
  if has_unit "$bootstrap_timer"; then run systemctl stop "$bootstrap_timer" volition-hermes-bootstrap.service; fi
  run systemctl stop volition-hermes-runner.service volition-terminal.service volition-project-browser-router.service
  for target in "$@"; do run systemctl stop "$target"; done
}

start_agents() {
  for target in "$@"; do run systemctl start "$target"; done
  run systemctl reset-failed volition-project-browser-router.service 2>/dev/null || true
  run systemctl restart volition-project-browser-router.service volition-provisioning.service
  run systemctl start volition-terminal.service volition-hermes-runner.service
  if has_unit "$bootstrap_timer"; then run systemctl start "$bootstrap_timer"; fi
}

# A step that fails after the agents were stopped must not leave them stopped: start them
# again as they are and say how to go back.
restore_after_failure() {
  echo "isolation.sh: $1 stopped half way; starting the agents again as they are." >&2
  echo "isolation.sh: run 'isolation.sh status', and 'isolation.sh rollback' to go back to one runner user." >&2
  start_agents "${browsers[@]}" || true
}

# What every agent reads of the Hermes home directly. The model logins are not among them: the
# agents get the token keeper's views of auth.json and .codex, without refresh tokens
# (token-keeper/, docs/helena-decisions/token-keeper.md).
model_auth() {
  for path in "$hermes_home/config.yaml" "$hermes_home/.env"; do
    [[ -e $path ]] && printf -- '--model-auth\n%s\n' "$path"
  done
  return 0
}

migrate() { # apply|rollback
  local args=("$1" --config "$lib/launcher.json" --browser-root "$browser_state" --browser-user volition-browser)
  [[ $1 == apply ]] && mapfile -t -O "${#args[@]}" args < <(model_auth)
  ((dry_run)) && args+=(--dry-run)
  if [[ ! -f $lib/migrate.py ]]; then
    echo "would run migrate.py ${args[*]} (after install)"
    return
  fi
  "$python" -I "$lib/migrate.py" "${args[@]}"
}

check() {
  local failed=0
  for socket in "${sockets[@]}"; do
    systemctl is-active --quiet "$socket" || { echo "isolation.sh: $socket is not listening" >&2; failed=1; }
  done
  if ! runuser -u volition-hermes -- "$python" -I "$lib/launch_client.py" ping >/dev/null; then
    echo "isolation.sh: volition-hermes cannot reach the launcher" >&2
    failed=1
  fi
  return "$failed"
}

case $command in
  install)
    ensure_accounts
    install_code
    open_shared_code
    install_token
    install_units
    ;;
  sync)
    # Deploy refreshes isolation code and grants the API preview-only launcher access.
    # Running agent units are left to the deploy's in-flight gate.
    [[ -f $lib/launcher.py ]] || exit 0
    ensure_accounts
    install_code
    open_shared_code
    install_units
    run systemctl try-restart volition-agent-launcher.service volition-egress.service volition-agent-plan.service
    migrate apply
    ;;
  open-code)
    # Every deploy: the runtimes' code readable for every agent again (launcher.json sharedCode).
    # Nothing is installed or restarted; where isolation is not installed there is nothing to do.
    [[ -f $lib/launcher.py ]] || exit 0
    open_shared_code
    ;;
  apply)
    ensure_accounts
    install_code
    open_shared_code
    install_token
    install_units
    mapfile -t browsers < <(active_browsers)
    if ((dry_run)); then
      migrate apply
      switch on
      echo "would restart: the runner, provisioning, the terminal, the browser router and ${#browsers[@]} project browser(s)"
      exit 0
    fi
    trap 'restore_after_failure apply' ERR
    stop_agents "${browsers[@]}"
    run install -d -o volition-browser -g volition -m 0700 "$browser_state/trash"
    migrate apply
    switch on
    run systemctl try-restart volition-agent-launcher.service volition-egress.service volition-agent-plan.service
    run systemctl restart volition-plan-api.service
    start_agents "${browsers[@]}"
    trap - ERR
    check
    echo "isolation.sh: agents run isolated"
    ;;
  rollback)
    mapfile -t browsers < <(active_browsers)
    if ((dry_run)); then
      switch off
      migrate rollback
      exit 0
    fi
    trap 'restore_after_failure rollback' ERR
    stop_agents "${browsers[@]}"
    switch off
    migrate rollback
    start_agents "${browsers[@]}"
    trap - ERR
    echo "isolation.sh: agents run as volition-hermes again; the project users and the launcher stay"
    ;;
  status)
    if enabled; then echo "AGENT_ISOLATION=on"; else echo "AGENT_ISOLATION=off"; fi
    for unit in "${sockets[@]}"; do printf '%-34s %s\n' "$unit" "$(systemctl is-active "$unit" || true)"; done
    getent group volition-agents | cut -d: -f4 | tr ',' '\n' | sed 's/^/project user: /'
    if [[ -f $lib/runtime_modes.py ]]; then
      "$python" -I "$lib/runtime_modes.py" check --config "$lib/launcher.json" | sed 's/^/runtime code: /' || true
    fi
    ;;
  *)
    sed -n '2,16p' "$0" >&2
    exit 64
    ;;
esac

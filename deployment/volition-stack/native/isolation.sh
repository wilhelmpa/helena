#!/usr/bin/env bash
# Agent isolation on Kingston (docs/volition-design-agent-isolation.md §5): every project's
# agents run as a Unix user of their own in a sandbox, the internet only through the egress
# proxy, the browsers as the browser user. Idempotent; --dry-run shows each change and makes
# none.
#
#   sudo deployment/volition-stack/native/isolation.sh apply [--dry-run]     install, migrate, enable
#   sudo deployment/volition-stack/native/isolation.sh install [--dry-run]   code, units, users, token only
#   sudo deployment/volition-stack/native/isolation.sh sync                  reinstall changed code (deploy)
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
  for file in isolation_common.py launcher.py sandbox.py egress.py plan_proxy.py launch_client.py migrate.py; do
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
  for unit in chromium@ kasm@ router; do
    local name=volition-project-browser-$unit.service
    local dropin=$units/${name}.d/rollback.conf
    if [[ $1 == off ]]; then
      if [[ ! -f $dropin ]]; then
        say "run $name as volition-hermes again"
        ((dry_run)) || { install -d -m 0755 "$(dirname "$dropin")"; printf '[Service]\nUser=volition-hermes\n' > "$dropin"; }
      fi
    elif [[ -f $dropin ]]; then
      say "run $name as volition-browser"
      run rm -f "$dropin"
    fi
  done
  run systemctl daemon-reload
}

enabled() { [[ -f $units/volition-hermes-runner.service.d/isolation.conf ]]; }

# The project browsers that run now, so the same ones run afterwards.
active_browsers() {
  systemctl list-units --plain --no-legend --state=active 'volition-project-browser@*.target' | awk '{print $1}'
}

stop_agents() {
  run systemctl stop volition-hermes-runner.service volition-terminal.service volition-project-browser-router.service
  for target in "$@"; do run systemctl stop "$target"; done
}

start_agents() {
  for target in "$@"; do run systemctl start "$target"; done
  run systemctl restart volition-project-browser-router.service volition-provisioning.service
  run systemctl start volition-terminal.service volition-hermes-runner.service
}

model_auth() {
  for path in "$hermes_home/config.yaml" "$hermes_home/auth.json" "$hermes_home/.env" "$hermes_home/.codex"; do
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
    install_token
    install_units
    ;;
  sync)
    # What deploy.sh runs: keeps an installed isolation's code and units current. It installs
    # nothing new, migrates nothing and restarts no agent; `apply` does that.
    [[ -f $lib/launcher.py ]] || exit 0
    install_code
    install_units
    run systemctl try-restart volition-agent-launcher.service volition-egress.service volition-agent-plan.service
    ;;
  apply)
    ensure_accounts
    install_code
    install_token
    install_units
    mapfile -t browsers < <(active_browsers)
    if ((dry_run)); then
      migrate apply
      switch on
      echo "would restart: the runner, provisioning, the terminal, the browser router and ${#browsers[@]} project browser(s)"
      exit 0
    fi
    stop_agents "${browsers[@]}"
    run install -d -o volition-browser -g volition -m 0700 "$browser_state/trash"
    migrate apply
    switch on
    run systemctl try-restart volition-agent-launcher.service volition-egress.service volition-agent-plan.service
    run systemctl restart volition-plan-api.service
    start_agents "${browsers[@]}"
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
    stop_agents "${browsers[@]}"
    switch off
    migrate rollback
    start_agents "${browsers[@]}"
    echo "isolation.sh: agents run as volition-hermes again; the project users and the launcher stay"
    ;;
  status)
    if enabled; then echo "AGENT_ISOLATION=on"; else echo "AGENT_ISOLATION=off"; fi
    for unit in "${sockets[@]}"; do printf '%-34s %s\n' "$unit" "$(systemctl is-active "$unit" || true)"; done
    getent group volition-agents | cut -d: -f4 | tr ',' '\n' | sed 's/^/project user: /'
    ;;
  *)
    sed -n '2,15p' "$0" >&2
    exit 64
    ;;
esac

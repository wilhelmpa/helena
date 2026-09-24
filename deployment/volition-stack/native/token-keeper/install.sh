#!/usr/bin/env bash
# helena-token-keeper (docs/helena-decisions/token-keeper.md): renews the model logins Helena's
# agents share before they expire, through Hermes' own credential pool, and writes the views
# isolated agents get of them (no refresh tokens). Idempotent; --dry-run shows each change.
#
#   sudo deployment/volition-stack/native/token-keeper/install.sh install [--dry-run]
#   sudo deployment/volition-stack/native/token-keeper/install.sh sync        (deploy.sh)
#   sudo deployment/volition-stack/native/token-keeper/install.sh status
#   sudo deployment/volition-stack/native/token-keeper/install.sh remove [--dry-run]
#
# install  the program, its folders, the timer, the runner and API drop-ins; one run at once.
#          Once the installed agent launcher binds the views, the agents' group loses its read
#          access to the real stores (auth.json, .codex), which no agent needs any more.
# sync     what deploy.sh runs: keeps an installed keeper current, and installs it where agent
#          isolation is installed (its launcher binds the keeper's views and refuses a run
#          without them).
set -euo pipefail

command=${1:-}
dry_run=0
[[ ${2:-} == --dry-run ]] && dry_run=1
# The TOKEN_KEEPER_* variables exist for the script's own test; the defaults are the live paths.
[[ $EUID -eq 0 || ${TOKEN_KEEPER_TEST:-} == 1 ]] || { echo "install.sh: run with sudo" >&2; exit 1; }

here=$(cd "$(dirname "$0")" && pwd)
lib=${TOKEN_KEEPER_LIB:-/usr/local/lib/helena-token-keeper}
units=${TOKEN_KEEPER_UNITS:-/etc/systemd/system}
state=${TOKEN_KEEPER_STATE:-/var/lib/helena-token-keeper}
hermes_home=${TOKEN_KEEPER_HERMES_HOME:-/var/lib/volition/hermes}
launcher_config=${TOKEN_KEEPER_LAUNCHER:-/usr/local/lib/volition-isolation/launcher.json}
user=volition-hermes
agents_group=volition-agents
readers_group=volition
runner_unit=volition-hermes-runner.service
api_unit=volition-plan-api.service
test_mode=${TOKEN_KEEPER_TEST:-0}

say() { if ((dry_run)); then echo "would $*"; else echo "$*"; fi; }
run() { if ((dry_run)); then echo "would run: $*"; else "$@"; fi; }

# A folder with its owner, group and mode (the test runs without root: no owner there).
folder() { # mode group path
  if [[ -d $3 ]] && [[ $test_mode == 1 || "$(stat -c '%U:%G %a' "$3")" == "$user:$2 ${1#0}" ]]; then return; fi
  say "create $3 ($user:$2 $1)"
  if [[ $test_mode == 1 ]]; then run install -d -m "$1" "$3"; else run install -d -o "$user" -g "$2" -m "$1" "$3"; fi
}

install_file() { # mode source target
  if [[ -f $3 ]] && cmp -s "$2" "$3" && [[ $(stat -c %a "$3") == "${1#0}" ]]; then return 1; fi
  say "install $3"
  if [[ $test_mode == 1 ]]; then run install -D -m "$1" "$2" "$3"; else run install -D -o root -g root -m "$1" "$2" "$3"; fi
  return 0
}

installed() { [[ -f $units/helena-token-keeper.service ]]; }
isolation_installed() { [[ -f $launcher_config ]]; }
launcher_binds_views() { [[ -f $launcher_config ]] && grep -q "$state/view/" "$launcher_config"; }

install_code() {
  local changed=0
  install_file 0644 "$here/helena_token_keeper.py" "$lib/helena_token_keeper.py" && changed=1
  install_file 0644 "$here/helena-token-keeper.service" "$units/helena-token-keeper.service" && changed=1
  install_file 0644 "$here/helena-token-keeper.timer" "$units/helena-token-keeper.timer" && changed=1
  install_file 0644 "$here/runner-dropin.conf" "$units/$runner_unit.d/helena-token-keeper.conf" && changed=1
  install_file 0644 "$here/api-dropin.conf" "$units/$api_unit.d/helena-token-keeper.conf" && changed=1
  ((changed)) && run systemctl daemon-reload
  return 0
}

# The keeper's folder. The views are read by the project users (group volition-agents), the
# status by the API (group volition); the state (fingerprints, attempts) by nobody else. The
# setgid bit hands each file the folder's group.
folders() {
  if [[ $test_mode != 1 ]] && ! getent group "$agents_group" >/dev/null; then
    say "create group $agents_group"
    run groupadd --system "$agents_group"
  fi
  folder 0750 "$readers_group" "$state"
  folder 2750 "$readers_group" "$state/status"
  folder 0700 "$readers_group" "$state/state"
  folder 2750 "$agents_group" "$state/view"
  folder 2750 "$agents_group" "$state/view/hermes"
  folder 2750 "$agents_group" "$state/view/codex"
}

# The agents read the views; the real stores are the runner's alone again.
revoke_direct_access() {
  launcher_binds_views || { echo "the installed launcher does not bind the views yet; the agents keep their read access for now"; return 0; }
  command -v setfacl >/dev/null || return 0
  getent group "$agents_group" >/dev/null || return 0
  local path
  for path in "$hermes_home/auth.json" "$hermes_home/.codex"; do
    [[ -e $path ]] || continue
    if getfacl -p -R "$path" 2>/dev/null | grep -q "group:$agents_group:"; then
      say "remove $agents_group's read access to $path"
      run setfacl -R -x "g:$agents_group" "$path" || true
      if [[ -d $path ]]; then
        if ((dry_run)); then echo "would run: setfacl -d -x g:$agents_group on the folders in $path"
        else find "$path" -type d -exec setfacl -d -x "g:$agents_group" {} + 2>/dev/null || true; fi
      fi
    fi
  done
}

first_run() {
  say "run the keeper once (renews what is due, writes the views and the status)"
  run systemctl start helena-token-keeper.service || {
    echo "install.sh: the first run failed; see: journalctl -u helena-token-keeper.service" >&2
    return 1
  }
}

case $command in
  install)
    [[ -x $hermes_home/venv/bin/python || $test_mode == 1 || $dry_run == 1 ]] || {
      echo "install.sh: no Hermes interpreter in $hermes_home/venv" >&2; exit 1; }
    folders
    install_code
    run systemctl enable --now helena-token-keeper.timer
    first_run
    revoke_direct_access
    echo "installed. The runner runs the keeper before it starts; the API reads its status after its next restart."
    ;;
  sync)
    if installed; then
      folders
      install_code
      revoke_direct_access
    elif isolation_installed; then
      echo "agent isolation is installed and binds the keeper's views: installing the keeper"
      "$0" install
    fi
    ;;
  status)
    systemctl --no-pager status helena-token-keeper.timer helena-token-keeper.service 2>/dev/null | sed -n '1,20p' || true
    cat "$state/status/hermes.json" 2>/dev/null || echo "no status yet"
    ;;
  remove)
    if launcher_binds_views; then
      echo "NOTE: the agent launcher binds the keeper's views. Without the keeper they stop being renewed;"
      echo "      the files stay, so agents keep working until their access tokens expire."
    fi
    run systemctl disable --now helena-token-keeper.timer || true
    for file in "$units/helena-token-keeper.service" "$units/helena-token-keeper.timer" \
      "$units/$runner_unit.d/helena-token-keeper.conf" "$units/$api_unit.d/helena-token-keeper.conf"; do
      [[ -e $file ]] && run rm -f "$file"
    done
    run systemctl daemon-reload
    echo "removed (the program in $lib and the folder $state are kept)"
    ;;
  *)
    sed -n '2,17p' "$0" >&2
    exit 64
    ;;
esac
